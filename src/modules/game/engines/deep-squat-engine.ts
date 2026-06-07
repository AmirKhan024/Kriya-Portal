/**
 * Deep Squat Descend (KS5/MM3) Engine — Bilateral squat depth tracking
 *
 * Game structure: Calibration (full body + feet wide + arms overhead) →
 * Single phase (40s) with rep counting via knee flexion depth.
 *
 * Movement quality: Track squat depth via knee flexion angle, detect form violations
 * (heel lift, knee valgus, trunk lean), and compute MQS combining smoothness,
 * form adherence, and depth completion. Depth Consistency Index (DCI) measures
 * rep-to-rep consistency.
 *
 * Scoring: MQS (smoothness×0.35 + formAdherence×0.40 + completion×0.25),
 * DCI as depth variation penalty.
 */

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics, type NormalizedLandmark } from './types';
import { speakInstruction } from '@/lib/game/audio-feedback';
import type { NormalizedLandmark as MPNormalizedLandmark } from '@mediapipe/tasks-vision';

// ─── Type Definitions ─────────────────────────────────────────────────────────

interface SquatCalibrationData {
  shoulderMid: NormalizedLandmark;
  hipMid: NormalizedLandmark;
  leftAnkle: NormalizedLandmark;
  rightAnkle: NormalizedLandmark;
  leftHeel: NormalizedLandmark;
  rightHeel: NormalizedLandmark;
  ankleY_baseline: number;
  hipWidth: number;
  shoulderWidth: number;
  torsoHeight: number;
  leftKneeX: number;
  rightKneeX: number;
  leftHip: NormalizedLandmark;
  rightHip: NormalizedLandmark;
}

interface RepData {
  maxFlexion: number;
  completionScore: number;
  formAdherence: number;
  smoothness: number;
  hasHeelLift: boolean;
  hasKneeValgus: boolean;
  hasTrunkLean: boolean;
}

interface TimeSeriesPoint {
  timestamp: number;
  mqs: number;
  kneeFlexion: number;
}

// ─── Calibration Constants ────────────────────────────────────────────────────

const CAL_VISIBILITY_THRESHOLD = 0.3;
const CAL_CONFIRM_DURATION = 2000;
const CAL_TIMEOUT_MS = 20000;
const FEET_WIDTH_RATIO = 1.05;

// ─── Game Logic Constants ─────────────────────────────────────────────────────

const SAP_DURATION = 40; // seconds
const DESCEND_START = 25; // V2-ported 2026-05-14 — V2 DESCEND_START=25° (was 20°)
const STANDING_THRESHOLD = 18; // V2-ported 2026-05-14 — V2 STANDING_THRESHOLD=18° (more complete return; was 15°)
const ASCENT_FROM_PEAK_DEG = 10;   // V2-ported 2026-05-14 — V2 EMA-tuned threshold to leave AT_BOTTOM
const MIN_REP_DEPTH = 45;          // V2-ported 2026-05-14 — V2 MIN_REP_DEPTH=45° — reps shallower are discarded
const BOTTOM_STABILITY_FRAMES = 8; // frames to confirm bottom
const BOTTOM_STABILITY_DELTA = 3; // max degree change to be "stable"
const ASCENDING_DELTA_MIN = 3; // degrees reduction to detect ascending
const EMA_ALPHA_KNEE = 0.15;
const EMA_ALPHA_HIP = 0.15;
const HEEL_LIFT_THRESHOLD = 0.025;
const VALGUS_THRESHOLD_RATIO = 0.12;
const TRUNK_WARN_DEG = 55;
const TRUNK_TERMINATE_DEG = 75;
const POSE_LOSS_DEBOUNCE = 800;

// ─── Rendering Constants ─────────────────────────────────────────────────────

const SKELETON_JOINTS = [
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

const SKELETON_CONNECTIONS = [
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
];

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Distance between two landmarks
 */
function distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * EMA smoothing
 */
function ema(current: number, prev: number, alpha: number): number {
  return alpha * current + (1 - alpha) * prev;
}

/**
 * Clamp value to range
 */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Compute mean of array
 */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Compute standard deviation of array
 */
function stdev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  const variance = mean(arr.map((x) => (x - m) ** 2));
  return Math.sqrt(variance);
}

/**
 * Coefficient of variation (0-inf, lower is smoother)
 */
function coefficientOfVariation(arr: number[]): number {
  const m = mean(arr);
  if (m === 0) return 0;
  return stdev(arr) / m;
}

/**
 * Calculate knee flexion angle from hip, knee, ankle landmarks
 * Returns angle in degrees (0-180)
 */
function calculateKneeFlexion(
  hip: NormalizedLandmark,
  knee: NormalizedLandmark,
  ankle: NormalizedLandmark
): number {
  // v1 = hip → knee
  const v1x = knee.x - hip.x;
  const v1y = knee.y - hip.y;

  // v2 = ankle → knee
  const v2x = ankle.x - knee.x;
  const v2y = ankle.y - knee.y;

  // Dot product and magnitudes
  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

  if (mag1 === 0 || mag2 === 0) return 0;

  // Clamp to avoid numerical errors in acos
  const cosAngle = clamp(dot / (mag1 * mag2), -1, 1);
  const radians = Math.acos(cosAngle);
  const degrees = radians * (180 / Math.PI);

  // Interior angle is 180 - angle between vectors
  // Flexion is how much the angle is bent from straight (180°)
  return Math.max(0, 180 - degrees);
}

/**
 * Compute trunk lean angle: lateral deviation from vertical + compression proxy
 */
function computeTrunkLean(
  lm: NormalizedLandmark[],
  calibData: SquatCalibrationData,
  currentFlexion: number
): number {
  const ls = lm[LM.LEFT_SHOULDER];
  const rs = lm[LM.RIGHT_SHOULDER];
  const lh = lm[LM.LEFT_HIP];
  const rh = lm[LM.RIGHT_HIP];

  if (!ls?.visibility || !rs?.visibility || !lh?.visibility || !rh?.visibility) {
    return 0;
  }

  const shoulderMidX = (ls.x + rs.x) / 2;
  const shoulderMidY = (ls.y + rs.y) / 2;
  const hipMidX = (lh.x + rh.x) / 2;
  const hipMidY = (lh.y + rh.y) / 2;

  // Lateral lean: angle of deviation from vertical
  const lateral = Math.atan2(Math.abs(shoulderMidX - hipMidX), Math.abs(hipMidY - shoulderMidY)) * (180 / Math.PI);

  // Compression proxy: at low flexion, measure torso shortening
  let compression = 0;
  if (currentFlexion < 60) {
    const currentTorsoH = Math.abs(shoulderMidY - hipMidY);
    if (currentTorsoH > 0) {
      compression = (1 - currentTorsoH / calibData.torsoHeight) * 100;
    }
  }

  return Math.max(lateral, compression);
}

// ─── Engine Class ─────────────────────────────────────────────────────────────

export class DeepSquatEngine implements GameEngine {
  // ── Calibration State ──
  private calGoodStart = 0;
  private calBadStart = 0;
  private calStartTime = 0;
  private calReady = false;

  // ── Calibration References ──
  private calibData: SquatCalibrationData | null = null;

  // ── Game Timing ──
  private startTime = 0;
  private elapsed = 0;
  private gameComplete = false;

  // ── Pose Loss Tracking ──
  private poseLostSince: number | null = null;
  private timerFrozenTime = 0;
  private poseLostDisplaySince: number | null = null;

  // ── Squat State Machine ──
  private repState: 'standing' | 'descending' | 'at_bottom' | 'ascending' = 'standing';
  private repCount = 0;
  private repsDiscarded = 0; // V2-ported 2026-05-14 — MIN_REP_DEPTH gate rejections
  private bottomFlexionStart = 0;
  private consecutiveStableFrames = 0;
  private bottomFlexionValue = 0;
  private repMaxFlexion = 0;
  private bottomFlexionHistory: number[] = [];

  // ── Knee Flexion (EMA smoothed) ──
  private smoothedFlexionL = 0;
  private smoothedFlexionR = 0;
  private prevFlexionL = 0;
  private prevFlexionR = 0;

  // ── Hip Vertical Motion (for smoothness) ──
  private smoothedHipY = 0;
  private hipVelocities: number[] = [];
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  // ── Form Tracking ──
  private heelOKCount = 0;
  private kneeOKCount = 0;
  private trunkOKCount = 0;
  private totalFormFrames = 0;
  private heelLiftDetected = false;
  private kneeValgusDetected = false;
  private trunkLeanActive = false;
  private autoTerminated = false;

  // ── Rep Data ──
  private repDataList: RepData[] = [];

  // ── Time Series ──
  private timeSeries: TimeSeriesPoint[] = [];
  private lastRecordTime = 0;

  // ── Rendering ──
  private lastLandmarks: NormalizedLandmark[] | null = null;
  private currentMQS = 0;

  // V2 deviation catalog (ported 2026-05-15)
  private heelLiftSince = 0;
  private kneeValgusSince = 0;
  private trunkLeanSince = 0;
  private tooFarSince = 0;
  private tooCloseSince = 0;
  private idleSince = 0;
  private shallowSquatSince = 0;
  private squatLastWarningKey = '';
  private squatLastWarningAt = 0;
  /** Per-deviation activation counters (transition 0 → now triggers ++). */
  private devCounts: Record<string, number> = {};

  constructor() {
    this.reset();
  }

  private squatMaybeSpeak(key: string, text: string, cooldownMs: number): void {
    const now = performance.now();
    if (this.squatLastWarningKey === key && now - this.squatLastWarningAt < cooldownMs) return;
    // Only update per-key cooldown when speech actually fires — otherwise
    // a dropped second-slot warning ghost-silences itself for cooldownMs.
    const spoke = speakInstruction(text);
    if (spoke) {
      this.squatLastWarningKey = key;
      this.squatLastWarningAt = now;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GameEngine Interface
  // ═══════════════════════════════════════════════════════════════════════════

  reset(): void {
    this.calGoodStart = 0;
    this.calBadStart = 0;
    this.calStartTime = 0;
    this.calReady = false;

    this.calibData = null;

    this.startTime = 0;
    this.elapsed = 0;
    this.gameComplete = false;

    this.poseLostSince = null;
    this.timerFrozenTime = 0;
    this.poseLostDisplaySince = null;

    this.repState = 'standing';
    this.repCount = 0;
    this.repsDiscarded = 0;
    this.bottomFlexionStart = 0;
    this.consecutiveStableFrames = 0;
    this.bottomFlexionValue = 0;
    this.repMaxFlexion = 0;
    this.bottomFlexionHistory = [];

    this.smoothedFlexionL = 0;
    this.smoothedFlexionR = 0;
    this.prevFlexionL = 0;
    this.prevFlexionR = 0;

    this.smoothedHipY = 0;
    this.hipVelocities = [];
    this.prevHipY = 0;
    this.prevHipTimestamp = 0;

    this.heelOKCount = 0;
    this.kneeOKCount = 0;
    this.trunkOKCount = 0;
    this.totalFormFrames = 0;
    this.heelLiftDetected = false;
    this.kneeValgusDetected = false;
    this.trunkLeanActive = false;
    this.autoTerminated = false;

    this.repDataList = [];
    this.timeSeries = [];
    this.lastRecordTime = 0;
    this.lastLandmarks = null;
    this.currentMQS = 0;
    this.heelLiftSince = 0;
    this.kneeValgusSince = 0;
    this.trunkLeanSince = 0;
    this.tooFarSince = 0;
    this.tooCloseSince = 0;
    this.idleSince = 0;
    this.shallowSquatSince = 0;
    this.squatLastWarningKey = '';
    this.squatLastWarningAt = 0;
    this.devCounts = {};
  }

  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) {
      return { isReady: true, progress: 1, message: 'Ready!' };
    }

    const now = performance.now();
    if (this.calStartTime === 0) this.calStartTime = now;

    // Timeout check
    if (now - this.calStartTime > CAL_TIMEOUT_MS) {
      return { isReady: false, progress: 0, message: 'Calibration timed out — tap to retry' };
    }

    // Gate A: Full body visible (landmarks 11,12,23,24,25,26,27,28)
    const requiredLandmarks = [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
    ];

    for (const idx of requiredLandmarks) {
      const lm = landmarks[idx];
      if (!lm || lm.visibility < CAL_VISIBILITY_THRESHOLD) {
        this.calBadStart = now;
        this.calGoodStart = 0;
        return { isReady: false, progress: 0, message: 'Full body not visible' };
      }
      // Check frame bounds
      if (lm.x < 0.05 || lm.x > 0.95 || lm.y < 0.05 || lm.y > 0.95) {
        this.calBadStart = now;
        this.calGoodStart = 0;
        return { isReady: false, progress: 0, message: 'Move closer to camera' };
      }
    }

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    if (!ls || !rs || !lh || !rh || !lk || !rk || !la || !ra) {
      this.calBadStart = now;
      this.calGoodStart = 0;
      return { isReady: false, progress: 0, message: 'Landmarks missing' };
    }

    // Gate B: Feet wider than shoulder width
    const shoulderWidth = distance(ls, rs);
    const feetWidth = distance(la, ra);

    if (feetWidth / shoulderWidth < FEET_WIDTH_RATIO) {
      this.calBadStart = now;
      this.calGoodStart = 0;
      return { isReady: false, progress: 0, message: 'Stand with feet wider apart' };
    }

    // Gate C: Arms overhead (both wrists visible, wrist.y < shoulder.y)
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    if (!lw || !rw || lw.visibility < CAL_VISIBILITY_THRESHOLD || rw.visibility < CAL_VISIBILITY_THRESHOLD) {
      this.calBadStart = now;
      this.calGoodStart = 0;
      return { isReady: false, progress: 0, message: 'Raise arms overhead' };
    }

    if (lw.y >= ls.y || rw.y >= rs.y) {
      this.calBadStart = now;
      this.calGoodStart = 0;
      return { isReady: false, progress: 0, message: 'Raise arms overhead' };
    }

    // All gates pass — confirm hold
    this.calBadStart = 0;
    if (this.calGoodStart === 0) this.calGoodStart = now;

    const held = now - this.calGoodStart;
    const progress = Math.min(1, held / CAL_CONFIRM_DURATION);

    if (held >= CAL_CONFIRM_DURATION) {
      this.calReady = true;
      this.startTime = performance.now();
      this.onCalibrationSuccess(landmarks);
      return { isReady: true, progress: 1, message: 'Ready!' };
    }

    return { isReady: false, progress, message: 'Hold still...' };
  }

  /**
   * Store calibration references
   */
  private onCalibrationSuccess(landmarks: NormalizedLandmark[]): void {
    const ls = landmarks[LM.LEFT_SHOULDER]!;
    const rs = landmarks[LM.RIGHT_SHOULDER]!;
    const lh = landmarks[LM.LEFT_HIP]!;
    const rh = landmarks[LM.RIGHT_HIP]!;
    const la = landmarks[LM.LEFT_ANKLE]!;
    const ra = landmarks[LM.RIGHT_ANKLE]!;
    const lheel = landmarks[LM.LEFT_HEEL]!;
    const rheel = landmarks[LM.RIGHT_HEEL]!;
    const lk = landmarks[LM.LEFT_KNEE]!;
    const rk = landmarks[LM.RIGHT_KNEE]!;

    const shoulderMid = {
      x: (ls.x + rs.x) / 2,
      y: (ls.y + rs.y) / 2,
      z: (ls.z + rs.z) / 2,
      visibility: 1,
    };

    const hipMid = {
      x: (lh.x + rh.x) / 2,
      y: (lh.y + rh.y) / 2,
      z: (lh.z + rh.z) / 2,
      visibility: 1,
    };

    const torsoHeight = Math.abs(shoulderMid.y - hipMid.y);

    this.calibData = {
      shoulderMid,
      hipMid,
      leftAnkle: la,
      rightAnkle: ra,
      leftHeel: lheel,
      rightHeel: rheel,
      ankleY_baseline: (la.y + ra.y) / 2,
      hipWidth: distance(lh, rh),
      shoulderWidth: distance(ls, rs),
      torsoHeight,
      leftKneeX: lk.x,
      rightKneeX: rk.x,
      leftHip: lh,
      rightHip: rh,
    };

    this.smoothedHipY = hipMid.y;
    this.prevHipY = hipMid.y;
  }

  /**
   * Reset game timing after countdown finishes
   */
  startPlaying(): void {
    const now = performance.now();
    this.startTime = now;
    this.elapsed = 0;
    this.poseLostSince = null;
    this.timerFrozenTime = 0;
    this.lastLandmarks = null;
  }

  processFrame(landmarks: NormalizedLandmark[], timestampMs: number): void {
    if (!this.calReady || this.gameComplete) return;

    const now = performance.now();

    // Store landmarks for skeleton drawing
    this.lastLandmarks = landmarks;

    // Compute elapsed time, accounting for pose loss
    if (this.poseLostSince !== null) {
      if (now - this.poseLostSince > POSE_LOSS_DEBOUNCE) {
        this.timerFrozenTime = now;
      }
    } else {
      if (this.timerFrozenTime > 0) {
        this.startTime += now - this.timerFrozenTime;
        this.timerFrozenTime = 0;
      }
    }

    this.elapsed = (now - this.startTime) / 1000;

    // Check pose loss (check key landmarks)
    const visibleHips = (landmarks[LM.LEFT_HIP]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.RIGHT_HIP]?.visibility ?? 0) > 0.3;
    const visibleKnees = (landmarks[LM.LEFT_KNEE]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.RIGHT_KNEE]?.visibility ?? 0) > 0.3;
    const visibleAnkles = (landmarks[LM.LEFT_ANKLE]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.RIGHT_ANKLE]?.visibility ?? 0) > 0.3;

    const poseVisible = visibleHips && visibleKnees && visibleAnkles;

    if (!poseVisible) {
      if (!this.poseLostSince) {

        this.poseLostSince = now;

        this.devCounts.poseLost = (this.devCounts.poseLost ?? 0) + 1;

      }
      if (now - this.poseLostSince > POSE_LOSS_DEBOUNCE) {
        this.poseLostDisplaySince = now;
      }
    } else {
      this.poseLostSince = null;
    }

    // Complete game at 40s
    if (this.elapsed >= SAP_DURATION) {
      this.finalizeRep();
      this.gameComplete = true;
      return;
    }

    // Process game frame during active phase
    if (poseVisible) {
      this.processGameFrame(landmarks, now);
    }

    // Record time series every 100ms
    if (now - this.lastRecordTime >= 100) {
      this.recordTimeSeries();
      this.lastRecordTime = now;
    }
  }

  /**
   * Core game frame processing
   */
  private processGameFrame(landmarks: NormalizedLandmark[], now: number): void {
    if (!this.calibData) return;

    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    if (!lh || !rh || !lk || !rk || !la || !ra) return;

    // Calculate knee flexion for both legs
    const flexionL = calculateKneeFlexion(lh, lk, la);
    const flexionR = calculateKneeFlexion(rh, rk, ra);

    // EMA smooth
    this.smoothedFlexionL = this.smoothedFlexionL === 0 ? flexionL : ema(flexionL, this.smoothedFlexionL, EMA_ALPHA_KNEE);
    this.smoothedFlexionR = this.smoothedFlexionR === 0 ? flexionR : ema(flexionR, this.smoothedFlexionR, EMA_ALPHA_KNEE);

    // Average flexion (only count valid readings)
    const avgFlexion = (this.smoothedFlexionL + this.smoothedFlexionR) / 2;

    // ─── REP STATE MACHINE ───
    const DESCENT_THRESHOLD = DESCEND_START;
    const STAND_THRESHOLD = STANDING_THRESHOLD;

    if (this.repState === 'standing') {
      if (avgFlexion > DESCENT_THRESHOLD) {
        this.repState = 'descending';
        this.repMaxFlexion = avgFlexion;
      }
    } else if (this.repState === 'descending') {
      this.repMaxFlexion = Math.max(this.repMaxFlexion, avgFlexion);

      // Check if stable at bottom
      if (this.bottomFlexionStart === 0) {
        this.bottomFlexionStart = avgFlexion;
        this.bottomFlexionValue = avgFlexion;
        this.consecutiveStableFrames = 1;
      } else {
        const delta = Math.abs(avgFlexion - this.bottomFlexionValue);
        if (delta < BOTTOM_STABILITY_DELTA) {
          this.consecutiveStableFrames++;
          this.bottomFlexionValue = ema(avgFlexion, this.bottomFlexionValue, 0.3);

          if (this.consecutiveStableFrames >= BOTTOM_STABILITY_FRAMES) {
            this.repState = 'at_bottom';
            this.bottomFlexionHistory.push(this.repMaxFlexion);
          }
        } else {
          this.consecutiveStableFrames = 1;
          this.bottomFlexionValue = avgFlexion;
        }
      }
    } else if (this.repState === 'at_bottom') {
      // Check if ascending
      const delta = avgFlexion - this.bottomFlexionValue;
      if (delta <= -ASCENDING_DELTA_MIN) {
        this.repState = 'ascending';
      } else {
        this.repMaxFlexion = Math.max(this.repMaxFlexion, avgFlexion);
      }
    } else if (this.repState === 'ascending') {
      this.repMaxFlexion = Math.max(this.repMaxFlexion, avgFlexion);

      // Check if returned to standing
      if (avgFlexion < STAND_THRESHOLD) {
        this.finalizeRep();
        this.repState = 'standing';
      }
    }

    // ─── FORM CHECKS (only during active squat) ───
    // ── V2 deviation detection (ported 2026-05-15) ──
    {
      const now2 = performance.now();
      const _ls = landmarks[LM.LEFT_SHOULDER];
      const _rs = landmarks[LM.RIGHT_SHOULDER];
      const _lh = landmarks[LM.LEFT_HIP];
      const _rh = landmarks[LM.RIGHT_HIP];
      if (_ls && _rs && _lh && _rh) {
        const trunkH = Math.abs(((_lh.y + _rh.y) / 2) - ((_ls.y + _rs.y) / 2));
        if (trunkH < 0.18) {
          if (!this.tooFarSince) {

            this.tooFarSince = now2;

            this.devCounts.tooFar = (this.devCounts.tooFar ?? 0) + 1;

          }
        } else { this.tooFarSince = 0; }
        if (trunkH > 0.45) {
          if (!this.tooCloseSince) {

            this.tooCloseSince = now2;

            this.devCounts.tooClose = (this.devCounts.tooClose ?? 0) + 1;

          }
        } else { this.tooCloseSince = 0; }
      }
      if (this.heelLiftDetected) {
        if (!this.heelLiftSince) {

          this.heelLiftSince = now2;

          this.devCounts.heelLift = (this.devCounts.heelLift ?? 0) + 1;

        }
      } else { this.heelLiftSince = 0; }
      if (this.kneeValgusDetected) {
        if (!this.kneeValgusSince) {

          this.kneeValgusSince = now2;

          this.devCounts.kneeValgus = (this.devCounts.kneeValgus ?? 0) + 1;

        }
      } else { this.kneeValgusSince = 0; }
      if (this.trunkLeanActive) {
        if (!this.trunkLeanSince) {

          this.trunkLeanSince = now2;

          this.devCounts.trunkLean = (this.devCounts.trunkLean ?? 0) + 1;

        }
      } else { this.trunkLeanSince = 0; }
      const avgFlex = (this.smoothedFlexionL + this.smoothedFlexionR) / 2;
      if (avgFlex < 10 && this.repState === 'standing') {
        if (!this.idleSince) {

          this.idleSince = now2;

          this.devCounts.idle = (this.devCounts.idle ?? 0) + 1;

        }
      } else { this.idleSince = 0; }
      // Shallow squat — at-bottom but flexion below MIN_REP_DEPTH
      if (this.repState === 'at_bottom' && this.bottomFlexionValue < 70) {
        if (!this.shallowSquatSince) {

          this.shallowSquatSince = now2;

          this.devCounts.shallowSquat = (this.devCounts.shallowSquat ?? 0) + 1;

        }
      } else { this.shallowSquatSince = 0; }
    }
    const isActiveSquat = this.repState === 'descending' || this.repState === 'at_bottom' || this.repState === 'ascending';
    if (isActiveSquat) {
      this.checkFormViolations(landmarks, avgFlexion);
    }

    // ─── SMOOTHNESS (hip vertical motion) ───
    const hipMidY = (lh.y + rh.y) / 2;
    this.smoothedHipY = this.smoothedHipY === 0 ? hipMidY : ema(hipMidY, this.smoothedHipY, EMA_ALPHA_HIP);

    if (isActiveSquat && (this.repState === 'descending' || this.repState === 'ascending')) {
      if (this.prevHipTimestamp > 0) {
        const dt = now - this.prevHipTimestamp; // milliseconds
        if (dt > 0) {
          const vel = Math.abs(this.smoothedHipY - this.prevHipY) / dt; // normalized units per ms
          this.hipVelocities.push(vel);
        }
      }
    }

    this.prevHipY = this.smoothedHipY;
    this.prevHipTimestamp = now;

    // ─── COMPUTE MQS FOR CURRENT STATE ───
    this.computeCurrentMQS();
  }

  /**
   * Check for form violations: heel lift, knee valgus, trunk lean
   */
  private checkFormViolations(landmarks: NormalizedLandmark[], currentFlexion: number): void {
    if (!this.calibData) return;

    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lheel = landmarks[LM.LEFT_HEEL];
    const rheel = landmarks[LM.RIGHT_HEEL];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    if (!la || !ra || !lheel || !rheel || !lk || !rk) return;

    this.totalFormFrames++;

    // 1. HEEL LIFT DETECTION
    const heelOK = (lheel.y >= this.calibData.ankleY_baseline - HEEL_LIFT_THRESHOLD) &&
      (rheel.y >= this.calibData.ankleY_baseline - HEEL_LIFT_THRESHOLD);

    if (heelOK) {
      this.heelOKCount++;
    } else {
      this.heelLiftDetected = true;
    }

    // 2. KNEE VALGUS DETECTION (only when flexion > 20°)
    let kneeOK = true;
    if (currentFlexion > 20) {
      const valgusThresh = this.calibData.hipWidth * VALGUS_THRESHOLD_RATIO;
      const leftValgus = (la.x - lk.x) > valgusThresh;
      const rightValgus = (rk.x - ra.x) > valgusThresh;

      kneeOK = !leftValgus && !rightValgus;
      if (!kneeOK) {
        this.kneeValgusDetected = true;
      }
    }

    if (kneeOK) {
      this.kneeOKCount++;
    }

    // 3. TRUNK LEAN DETECTION (only when flexion > 30°)
    let trunkOK = true;
    if (currentFlexion > 30) {
      const trunkLean = computeTrunkLean(landmarks, this.calibData, currentFlexion);

      if (trunkLean > TRUNK_WARN_DEG) {
        this.trunkLeanActive = true;
      }

      // AUTO-TERMINATE at 75°
      if (trunkLean > TRUNK_TERMINATE_DEG) {
        this.autoTerminated = true;
        this.gameComplete = true;
      }

      trunkOK = trunkLean <= TRUNK_WARN_DEG;
    }

    if (trunkOK) {
      this.trunkOKCount++;
    }
  }

  /**
   * Finalize current rep and store data
   */
  private finalizeRep(): void {
    if (this.repState === 'standing' || this.repMaxFlexion === 0) {
      return; // No valid rep in progress
    }

    // V2-ported 2026-05-14 — MIN_REP_DEPTH gate (45 deg)
    // Reject reps that didn't reach a clinically meaningful depth. V2 logic:
    // shallow movements (e.g., 30 deg knee bend) are not counted because the
    // user only initiated descent and returned without actually squatting.
    // Without this gate, half-descents inflate rep count and dilute MQS
    // averages with non-squat motions.
    if (this.repMaxFlexion < MIN_REP_DEPTH) {
      this.repsDiscarded++;
      // V2 parity — coach user to go deeper
      speakInstruction('Squat deeper for it to count');
      this.bottomFlexionStart = 0;
      this.consecutiveStableFrames = 0;
      this.bottomFlexionValue = 0;
      this.repMaxFlexion = 0;
      this.heelOKCount = 0;
      this.kneeOKCount = 0;
      this.trunkOKCount = 0;
      this.totalFormFrames = 0;
      this.heelLiftDetected = false;
      this.kneeValgusDetected = false;
      this.trunkLeanActive = false;
      this.hipVelocities = [];
      return;
    }

    // Compute rep metrics
    const completion = this.computeCompletionScore(this.repMaxFlexion);
    const formAdherence = this.totalFormFrames > 0
      ? (this.heelOKCount + this.kneeOKCount + this.trunkOKCount) / (this.totalFormFrames * 3) * 100
      : 0;

    const smoothness = this.hipVelocities.length > 0
      ? Math.max(0, 100 - (coefficientOfVariation(this.hipVelocities) * 100))
      : 50;

    const repData: RepData = {
      maxFlexion: this.repMaxFlexion,
      completionScore: completion,
      formAdherence: clamp(formAdherence, 0, 100),
      smoothness: clamp(smoothness, 0, 100),
      hasHeelLift: this.heelLiftDetected,
      hasKneeValgus: this.kneeValgusDetected,
      hasTrunkLean: this.trunkLeanActive,
    };

    this.repDataList.push(repData);
    this.repCount++;

    // Reset rep state
    this.bottomFlexionStart = 0;
    this.consecutiveStableFrames = 0;
    this.bottomFlexionValue = 0;
    this.repMaxFlexion = 0;
    this.heelOKCount = 0;
    this.kneeOKCount = 0;
    this.trunkOKCount = 0;
    this.totalFormFrames = 0;
    this.heelLiftDetected = false;
    this.kneeValgusDetected = false;
    this.trunkLeanActive = false;
    this.hipVelocities = [];
  }

  /**
   * Compute completion score based on max flexion depth
   */
  private computeCompletionScore(maxFlexion: number): number {
    if (maxFlexion >= 120) return 100;
    if (maxFlexion >= 90) return 75;
    if (maxFlexion >= 60) return 50;
    if (maxFlexion >= 30) return 25;
    return 0;
  }

  /**
   * Compute current MQS (weighted average)
   */
  private computeCurrentMQS(): void {
    if (this.repDataList.length === 0) {
      this.currentMQS = 0;
      return;
    }

    const avgCompletion = mean(this.repDataList.map((r) => r.completionScore));
    const avgFormAdherence = mean(this.repDataList.map((r) => r.formAdherence));
    const avgSmoothness = mean(this.repDataList.map((r) => r.smoothness));

    // MQS = smoothness×0.35 + formAdherence×0.40 + completion×0.25
    this.currentMQS = clamp(
      avgSmoothness * 0.35 + avgFormAdherence * 0.40 + avgCompletion * 0.25,
      0,
      100
    );
  }

  /**
   * Compute Depth Consistency Index
   */
  private computeDCI(): number {
    if (this.bottomFlexionHistory.length < 2) {
      return 50; // Neutral if not enough reps
    }

    const std = stdev(this.bottomFlexionHistory);
    return clamp(100 - std * 2, 0, 100);
  }

  /**
   * Record time series point
   */
  private recordTimeSeries(): void {
    const avgFlex = (this.smoothedFlexionL + this.smoothedFlexionR) / 2;
    this.timeSeries.push({
      timestamp: this.elapsed,
      mqs: this.currentMQS,
      kneeFlexion: avgFlex,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.lastLandmarks) return;

    const w = width;
    const h = height;

    // Draw skeleton
    this.drawSkeleton(ctx, w, h);

    // Draw form violation badges
    this.drawFormBadges(ctx, w, h);

    // Draw depth bar
    this.drawDepthBar(ctx, w, h);

    // Draw rep state indicator
    this.drawRepStateIndicator(ctx, w, h);

    // Draw metrics on HUD
    this.drawMetricsHUD(ctx, w, h);

    // Draw warnings
    this.drawWarnings(ctx, w, h);
  }

  /**
   * Draw skeleton with squat joints highlighted
   */
  private drawSkeleton(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.lastLandmarks) return;

    const lm = this.lastLandmarks;

    ctx.strokeStyle = '#00E5CC';
    ctx.lineWidth = 2;

    // Draw connections
    for (const [from, to] of SKELETON_CONNECTIONS) {
      const lmFrom = lm[from];
      const lmTo = lm[to];

      if (!lmFrom || !lmTo || lmFrom.visibility < 0.3 || lmTo.visibility < 0.3) continue;

      // Mirror coordinates
      const x0 = (1 - lmFrom.x) * w;
      const y0 = lmFrom.y * h;
      const x1 = (1 - lmTo.x) * w;
      const y1 = lmTo.y * h;

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Draw joints as circles
    ctx.fillStyle = '#00E5CC';
    for (const jointIdx of SKELETON_JOINTS) {
      const lmJoint = lm[jointIdx];
      if (!lmJoint || lmJoint.visibility < 0.3) continue;

      const x = (1 - lmJoint.x) * w;
      const y = lmJoint.y * h;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Draw form violation badges near relevant joints
   */
  private drawFormBadges(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.lastLandmarks) return;

    const lm = this.lastLandmarks;

    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Heel lift badge near ankles
    if (this.heelLiftDetected) {
      const la = lm[LM.LEFT_ANKLE];
      const ra = lm[LM.RIGHT_ANKLE];

      if (la && la.visibility > 0.3) {
        const x = (1 - la.x) * w;
        const y = la.y * h + 20;
        ctx.fillStyle = '#FFB547';
        ctx.fillText('HEEL!', x, y);
      }
      if (ra && ra.visibility > 0.3) {
        const x = (1 - ra.x) * w;
        const y = ra.y * h + 20;
        ctx.fillStyle = '#FFB547';
        ctx.fillText('HEEL!', x, y);
      }
    }

    // Knee valgus badge near knees
    if (this.kneeValgusDetected) {
      const lk = lm[LM.LEFT_KNEE];
      const rk = lm[LM.RIGHT_KNEE];

      if (lk && lk.visibility > 0.3) {
        const x = (1 - lk.x) * w;
        const y = lk.y * h - 20;
        ctx.fillStyle = '#FFB547';
        ctx.fillText('KNEE IN!', x, y);
      }
      if (rk && rk.visibility > 0.3) {
        const x = (1 - rk.x) * w;
        const y = rk.y * h - 20;
        ctx.fillStyle = '#FFB547';
        ctx.fillText('KNEE IN!', x, y);
      }
    }
  }

  /**
   * Draw depth bar on right edge (0-150°)
   */
  private drawDepthBar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const barX = w - 35;
    const barY = h / 2 - 80;
    const barH = 160;
    const barW = 15;

    // Background
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, barH);

    // Current depth fill
    const avgFlexion = (this.smoothedFlexionL + this.smoothedFlexionR) / 2;
    const fillH = (Math.min(avgFlexion, 150) / 150) * barH;
    ctx.fillStyle = '#00E5CC';
    ctx.fillRect(barX, barY + barH - fillH, barW, fillH);

    // Best depth marker
    if (this.bottomFlexionHistory.length > 0) {
      const bestDepth = Math.max(...this.bottomFlexionHistory);
      const bestY = barY + barH - (Math.min(bestDepth, 150) / 150) * barH;
      ctx.fillStyle = '#FFB547';
      ctx.fillRect(barX - 5, bestY - 2, barW + 10, 4);
    }
  }

  /**
   * Draw rep state indicator
   */
  private drawRepStateIndicator(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#00E5CC';

    let stateText = '';
    if (this.repState === 'descending') stateText = '▼ Descending';
    else if (this.repState === 'at_bottom') stateText = '◼ Hold';
    else if (this.repState === 'ascending') stateText = '▲ Rising';
    else stateText = '● Standing';

    ctx.fillText(stateText, w / 2, 40);
  }

  /**
   * Draw metrics HUD
   */
  private drawMetricsHUD(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#FFF';
    ctx.textAlign = 'left';

    // Rep count
    ctx.fillText(`Reps: ${this.repCount}`, 20, 80);

    // Timer
    const timeStr = `${Math.round(this.elapsed)}s / ${SAP_DURATION}s`;
    ctx.fillText(`Time: ${timeStr}`, 20, 110);

    // MQS bar
    const mqs_x = 20;
    const mqs_y = 140;
    const mqs_w = 150;
    const mqs_h = 12;

    ctx.fillStyle = '#333';
    ctx.fillRect(mqs_x, mqs_y, mqs_w, mqs_h);

    const fillW = (this.currentMQS / 100) * mqs_w;
    ctx.fillStyle = this.currentMQS >= 50 ? '#00E5CC' : this.currentMQS >= 25 ? '#FFB547' : '#FF6B6B';
    ctx.fillRect(mqs_x, mqs_y, fillW, mqs_h);

    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`MQS: ${Math.round(this.currentMQS)}`, mqs_x + mqs_w / 2, mqs_y + mqs_h + 12);
  }

  /**
   * Draw warning overlays
   */
  private drawWarnings(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const warnings: string[] = [];

    if (this.trunkLeanActive) {
      warnings.push('Keep trunk straight');
    }

    if (this.poseLostDisplaySince !== null && performance.now() - this.poseLostDisplaySince < 2000) {
      warnings.push('Pose lost — move back in frame');
    }

    if (warnings.length === 0) return;

    ctx.fillStyle = 'rgba(255, 107, 107, 0.8)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';

    let y = 60;
    for (const warning of warnings) {
      ctx.fillText(warning, w / 2, y);
      y += 25;
    }
  }

  getHudMetrics(): HudMetrics {
    const dci = this.computeDCI();
    const now = performance.now();
    let warningSlot1: string | undefined;
    let warningSlot2: string | undefined;
    let instructionText = 'Squat down slowly';
    let instructionColor = '#94a3b8';

    // SLOT 1 (RED) — heel_lift > too_far > too_close > idle > shallow_squat
    if (this.heelLiftSince > 0 && now - this.heelLiftSince > 600) {
      warningSlot1 = '⚠ Keep heels on the floor';
      this.squatMaybeSpeak('heel_lift', 'Keep your heels on the floor', 5000);
    } else if (this.tooFarSince > 0 && now - this.tooFarSince > 1500) {
      warningSlot1 = '⚠ Move closer to the camera';
      this.squatMaybeSpeak('too_far', 'Move closer to the camera', 6000);
    } else if (this.tooCloseSince > 0 && now - this.tooCloseSince > 1500) {
      warningSlot1 = '⚠ Move back — full body must be visible';
      this.squatMaybeSpeak('too_close', 'Move back from the camera', 6000);
    } else if (this.idleSince > 0 && now - this.idleSince > 5000) {
      warningSlot1 = '⚠ Begin squatting down';
      this.squatMaybeSpeak('idle', 'Begin squatting down slowly', 6000);
    } else if (this.shallowSquatSince > 0 && now - this.shallowSquatSince > 1500) {
      warningSlot1 = '⚠ Squat deeper — knees past 70°';
      this.squatMaybeSpeak('shallow', 'Squat deeper, knees past 70 degrees', 5000);
    }

    // SLOT 2 (AMBER) — knee_valgus > trunk_lean
    if (this.kneeValgusSince > 0 && now - this.kneeValgusSince > 800) {
      warningSlot2 = '● Knees out — over your toes';
      this.squatMaybeSpeak('knee_valgus', 'Push your knees out over your toes', 6000);
    } else if (this.trunkLeanSince > 0 && now - this.trunkLeanSince > 1000) {
      warningSlot2 = '● Chest up — keep trunk upright';
      this.squatMaybeSpeak('trunk_lean', 'Keep your chest up and trunk upright', 6000);
    }

    if (warningSlot1) {
      instructionText = warningSlot1.replace(/^[⚠●]\s*/, '');
      instructionColor = '#FF4D6A';
    } else if (this.repState === 'at_bottom') {
      instructionText = 'HOLD — then rise up';
      instructionColor = '#22c55e';
    } else if (this.repState === 'ascending') {
      instructionText = 'Rise back up';
      instructionColor = '#3b82f6';
    }

    return {
      primary: {
        label: 'MQS',
        value: Math.round(this.currentMQS),
        color: '#00E5CC',
      },
      secondary: {
        label: 'DCI',
        value: Math.round(dci),
        color: '#FFB547',
      },
      timer: {
        elapsed: Math.round(this.elapsed),
        total: SAP_DURATION,
      },
      instruction: `Reps: ${this.repCount}`,
      instructionText,
      instructionColor,
      warningSlot1,
      warningSlot2,
      bigRepChip: this.repCount,
      extra: {
        label: 'Max Depth',
        value: this.bottomFlexionHistory.length > 0 ? `${Math.round(Math.max(...this.bottomFlexionHistory))}°` : '—',
      },
    };
  }

  isComplete(): boolean {
    return this.gameComplete;
  }

  getRawData(): Record<string, unknown> {
    const mqs = this.currentMQS;
    const dci = this.computeDCI();
    const avgFlexion = this.bottomFlexionHistory.length > 0 ? mean(this.bottomFlexionHistory) : 0;
    const maxFlexion = this.bottomFlexionHistory.length > 0 ? Math.max(...this.bottomFlexionHistory) : 0;

    return {
      testId: 'KS5',
      mqs: Math.round(mqs),
      dci: Math.round(dci),
      mqsAvg: Math.round(mqs), // Single phase, so same as mqs
      reps: this.repCount,
      repsDiscarded: this.repsDiscarded,
      maxFlexion: Math.round(maxFlexion),
      avgFlexion: Math.round(avgFlexion),
      duration: Math.round(this.elapsed),
      terminated: this.autoTerminated,
      deviationCounts: { ...this.devCounts },
      bottomFlexionHistory: this.bottomFlexionHistory.map((v) => Math.round(v * 10) / 10),
      customMetrics: {
        mqsAvg: Math.round(mqs),
        dci: Math.round(dci),
        reps: this.repCount,
        maxFlexion: Math.round(maxFlexion),
        avgFlexion: Math.round(avgFlexion),
        smoothness: Math.round(mean(this.repDataList.map((r) => r.smoothness))),
        formAdherence: Math.round(mean(this.repDataList.map((r) => r.formAdherence))),
        completion: Math.round(mean(this.repDataList.map((r) => r.completionScore))),
      },
      timeSeries: this.timeSeries,
    };
  }

  destroy(): void {
    this.reset();
  }
}
