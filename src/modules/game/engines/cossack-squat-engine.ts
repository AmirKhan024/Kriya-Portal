/**
 * Cossack Squat (KS6/MM5) Engine — Bilateral leg squat with rep-based scoring
 *
 * Game structure: Calibration (wide stance, upright, arms forward) →
 * Phase 1 (left leg squat, 20s) → Transition (5s) → Phase 2 (right leg squat, 20s)
 * → Complete (45s total)
 *
 * Movement quality: Track interior knee angle, measure squat reps per phase,
 * assess smoothness, form adherence (straight opposite leg, upright trunk, heel grounded,
 * feet planted), and depth (completion). Bilateral symmetry via TCI.
 *
 * Scoring: MQS per rep = smoothness*0.35 + formAdherence*0.40 + completion*0.25,
 * phase MQS as average of rep MQS values (or capped fallback if zero reps),
 * TCI as symmetry between left and right MQS.
 */

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics, type NormalizedLandmark } from './types';
import { speakInstruction } from '@/lib/game/audio-feedback';

// ─── Type Definitions ─────────────────────────────────────────────────────────

interface SquatRep {
  repNumber: number;
  startTime: number;
  endTime: number;
  bottomAngle: number; // Interior knee angle at deepest point
  smoothness: number;
  formAdherence: number;
  completion: number;
  mqs: number;
}

interface CalibrationData {
  shoulderMidpoint: NormalizedLandmark;
  hipMidpoint: NormalizedLandmark;
  shoulderWidth: number;
  stanceWidth: number;
  trunkLength: number;
  leftAnklePos: NormalizedLandmark;
  rightAnklePos: NormalizedLandmark;
  leftKneeAngle: number;
  rightKneeAngle: number;
  hipCenterX: number;
}

// ─── Calibration Constants ────────────────────────────────────────────────────

const CAL_VISIBILITY_THRESHOLD = 0.3;
const CAL_CONFIRM_DURATION = 2000;
const CAL_TIMEOUT_MS = 20000;
const WIDE_STANCE_MIN = 1.2;
const WIDE_STANCE_MAX = 2.3;
const KNEE_STRAIGHT_MIN = 165;
const TRUNK_UPRIGHT_MAX = 5; // degrees
const WRIST_VISIBILITY = 0.3;
const WRIST_OFFSET_THRESHOLD = 0.3; // ±30% of trunkLength

// ─── Game Logic Constants ─────────────────────────────────────────────────────

const PHASE_DURATION = 20; // seconds per leg
const TRANSITION_DURATION = 5; // seconds between legs
const POSE_LOSS_DEBOUNCE = 800;
const EMA_ALPHA = 0.35;
const SQUAT_START_THRESHOLD = 155; // degrees
const SQUAT_PEAK_HOLD_DEG = 3;
const PEAK_HOLD_FRAMES_CS = 3;              // V2-ported 2026-05-14 — V2 PEAK_HOLD_FRAMES=3 stable frames to detect bottom
const SMOOTHNESS_WEIGHT_CS = 0.35;          // V2-ported 2026-05-14 — V2 SMOOTHNESS_WEIGHT for MQS
const FORM_ADHERENCE_WEIGHT_CS = 0.40;      // V2-ported 2026-05-14 — V2 FORM_ADHERENCE_WEIGHT for MQS
const COMPLETION_WEIGHT_CS = 0.25;          // V2-ported 2026-05-14 — V2 COMPLETION_WEIGHT for MQS
const MIN_LANDMARK_CONFIDENCE_CS = 0.5;     // V2-ported 2026-05-14 — V2 MIN_LANDMARK_CONFIDENCE
const PEAK_HOLD_FRAMES = 3;
const SQUAT_RETURN_THRESHOLD = 155; // degrees
const MIN_REP_DEPTH_ANGLE = 85; // V2-ported 2026-05-14 — V2 BUG-CS08 fix: BlazePose-lite mobile bias (was 148; raised to 85° to accept real deep reps that measure 80-85° on mobile despite being ≤75° in true 3D)
// V2 BUG-CS06 four-signal mobile false-rep gates (ported 2026-05-14)
// All four signals + the depth gate must pass for a rep to count. Defeats
// flick-squats, half-bobs, and bilateral half-squats that fool the depth
// gate alone on mobile (BlazePose-lite 2D-projection noise).
const DEPTH_HOLD_THRESH = 125;          // V2 — frames at angle ≤ this count toward sustained depth
const SUSTAINED_DEPTH_FRAMES = 10;      // V2 — frames required at DEPTH_HOLD_THRESH (≈333ms @30fps)
const MIN_HIP_DROP_RATIO = 0.20;        // V2 — hip Y drop / trunkLength must exceed this
const MIN_LATERAL_SHIFT_RATIO = 0.22;   // V2 — hip X shift toward bending side / stanceWidth
const OPP_LEG_STRAIGHT_MIN = 160;       // V2 — opposite knee must stay at least this straight
const STATIC_VELOCITY_THRESH = 2.0; // deg/s
const SMOOTHNESS_SCALING_FACTOR = 0.15;
const ANKLE_HEEL_RISE_MAX = 0.04; // 4% of trunkLength
const ANKLE_DRIFT_MAX = 0.5; // 50% of stanceWidth

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Compute interior knee angle: angle at knee between hip and ankle vectors
 */
function computeInteriorKneeAngle(
  hip: NormalizedLandmark,
  knee: NormalizedLandmark,
  ankle: NormalizedLandmark
): number {
  const vec_BA = {
    x: hip.x - knee.x,
    y: hip.y - knee.y,
  };
  const vec_BC = {
    x: ankle.x - knee.x,
    y: ankle.y - knee.y,
  };

  const mag_BA = Math.sqrt(vec_BA.x * vec_BA.x + vec_BA.y * vec_BA.y);
  const mag_BC = Math.sqrt(vec_BC.x * vec_BC.x + vec_BC.y * vec_BC.y);

  if (mag_BA < 1e-6 || mag_BC < 1e-6) {
    return 180;
  }

  const dot = vec_BA.x * vec_BC.x + vec_BA.y * vec_BC.y;
  const cosAngle = dot / (mag_BA * mag_BC);
  const clamped = Math.max(-1, Math.min(1, cosAngle));
  const angle = Math.acos(clamped) * (180 / Math.PI);

  return angle;
}

/**
 * Compute trunk lean angle: deviation from vertical
 */
function computeTrunkLeanDeg(shoulderMid: NormalizedLandmark, hipMid: NormalizedLandmark): number {
  const dx = shoulderMid.x - hipMid.x;
  const dy = hipMid.y - shoulderMid.y; // Flip y for screen coords

  return Math.atan2(dx, dy) * (180 / Math.PI);
}

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
 * Compute sample variance (N-1 denominator)
 */
function sampleVariance(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const m = mean(arr);
  const sumSq = arr.reduce((sum, x) => sum + (x - m) ** 2, 0);
  return sumSq / (arr.length - 1);
}

// ─── Engine Class ─────────────────────────────────────────────────────────────

export class CossackSquatEngine implements GameEngine {
  // ── Calibration State ──
  private calGoodStart = 0;
  private calBadStart = 0;
  private calStartTime = 0;
  private calReady = false;
  private calData: CalibrationData | null = null;

  // ── Game Timing ──
  private startTime = 0;
  private elapsed = 0;
  private gameComplete = false;

  // ── Phase State (0=not started, 1=left, 2=right) ──
  private phase: 0 | 1 | 2 = 0;
  private phaseState: 'idle' | 'active' | 'transition' = 'idle';
  private phaseStartTime = 0;
  private totalElapsed = 0;
  private transitionStartTime = 0;

  // ── Pose Loss Tracking ──
  private poseLostSince: number | null = null;
  private timerFrozenTime = 0;

  // ── Per-Phase Rep Tracking ──
  private phase1Reps: SquatRep[] = [];
  private phase2Reps: SquatRep[] = [];
  private phase1MQS = 0;
  private phase2MQS = 0;

  // ── Current Rep State Machine ──
  private repState: 'STANDING' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING' = 'STANDING';
  private repStartTime = 0;
  private bottomAngle = 180;
  private peakHoldFrames = 0;
  // ── BUG-CS06 four-signal gate accumulators (V2-ported 2026-05-14) ──
  private lastDiscardReason: string | null = null; // V2 parity — speak this on rep rejection
  private repFramesAtDepth = 0;     // frames where smoothedKneeAngle ≤ DEPTH_HOLD_THRESH
  private repHipMaxY = 0;           // max Y of hip midpoint during rep (Y grows downward → lowest point)
  private repHipMinX = 1;           // min X of hip midpoint during rep
  private repHipMaxX = 0;           // max X of hip midpoint during rep
  private repOppKneeMin = 180;      // min angle of the opposite (straight) knee during rep
  private repsDiscarded = 0;        // total reps rejected by gates (diagnostic)

  // ── Smoothness & Form Tracking ──
  private kneeAngles: number[] = [];
  private smoothedKneeAngle = 180;
  private lastAngle = 180;
  private velocities: number[] = [];
  private lastAnklePos: NormalizedLandmark | null = null;
  private anklePositions: NormalizedLandmark[] = [];

  // ── FPS Measurement ──
  private fpsFrameCount = 0;
  private fpsStartTime = 0;
  private measuredFPS = 30;

  // ── Phase-level fallback tracking (for zero-rep phases) ──
  private phaseFormScores: number[] = [];
  private phaseAngularVelocities: number[] = [];
  private phaseBestDepthAngle = 180;

  // ── Results Accumulation ──
  private bestDepthL = 180;
  private bestDepthR = 180;
  private lastLandmarks: NormalizedLandmark[] | null = null;

  // Time series for Movement Over Time chart
  private timeSeries: Array<{ timestamp: number; kneeAngle: number; side: string }> = [];
  private lastTimeSeriesAt = 0;

  // V2 deviation catalog (ported 2026-05-15)
  private heelLiftSince = 0;
  private kneeValgusSince = 0;
  private trunkLeanSince = 0;
  private straightLegBendSince = 0;
  private shallowSquatSince = 0;
  private idleSince = 0;
  private tooFarSince = 0;
  private tooCloseSince = 0;
  private cossackLastWarningKey = '';
  private cossackLastWarningAt = 0;
  /** Per-deviation activation counters (transition 0 → now triggers ++). */
  private devCounts: Record<string, number> = {};

  constructor() {
    this.reset();
  }

  private cossackMaybeSpeak(key: string, text: string, cooldownMs: number): void {
    const now = performance.now();
    if (this.cossackLastWarningKey === key && now - this.cossackLastWarningAt < cooldownMs) return;
    // Only update per-key cooldown when speech actually fires — otherwise
    // a dropped second-slot warning ghost-silences itself for cooldownMs.
    const spoke = speakInstruction(text);
    if (spoke) {
      this.cossackLastWarningKey = key;
      this.cossackLastWarningAt = now;
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
    this.calData = null;

    this.startTime = 0;
    this.elapsed = 0;
    this.gameComplete = false;

    this.phase = 0;
    this.phaseState = 'idle';
    this.phaseStartTime = 0;
    this.transitionStartTime = 0;
    this.totalElapsed = 0;

    this.poseLostSince = null;
    this.timerFrozenTime = 0;

    this.phase1Reps = [];
    this.phase2Reps = [];
    this.phase1MQS = 0;
    this.phase2MQS = 0;

    this.repState = 'STANDING';
    this.repStartTime = 0;
    this.bottomAngle = 180;
    this.peakHoldFrames = 0;
    this.repFramesAtDepth = 0;
    this.repHipMaxY = 0;
    this.repHipMinX = 1;
    this.repHipMaxX = 0;
    this.repOppKneeMin = 180;
    this.repsDiscarded = 0;

    this.kneeAngles = [];
    this.smoothedKneeAngle = 180;
    this.lastAngle = 180;
    this.velocities = [];
    this.lastAnklePos = null;
    this.anklePositions = [];

    this.bestDepthL = 180;
    this.bestDepthR = 180;
    this.lastLandmarks = null;

    this.fpsFrameCount = 0;
    this.fpsStartTime = 0;
    this.measuredFPS = 30;
    this.phaseFormScores = [];
    this.phaseAngularVelocities = [];
    this.phaseBestDepthAngle = 180;
    this.timeSeries = [];
    this.lastTimeSeriesAt = 0;
    this.heelLiftSince = 0;
    this.kneeValgusSince = 0;
    this.trunkLeanSince = 0;
    this.straightLegBendSince = 0;
    this.shallowSquatSince = 0;
    this.idleSince = 0;
    this.tooFarSince = 0;
    this.tooCloseSince = 0;
    this.cossackLastWarningKey = '';
    this.cossackLastWarningAt = 0;
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

    // Gate E: Full body visible (10 landmarks: 11,12,15,16,23,24,25,26,27,28)
    const requiredLandmarks = [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
    ];

    for (const idx of requiredLandmarks) {
      const lm = landmarks[idx];
      if (!lm || lm.visibility < CAL_VISIBILITY_THRESHOLD) {
        return { isReady: false, progress: 0, message: 'Full body not visible' };
      }
      if (lm.x < 0.05 || lm.x > 0.95 || lm.y < 0.05 || lm.y > 0.95) {
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
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    if (!ls || !rs || !lh || !rh || !lk || !rk || !la || !ra || !lw || !rw) {
      return { isReady: false, progress: 0, message: 'Landmarks missing' };
    }

    // Gate A: Wide stance (ankle distance / shoulder width between 1.2 and 2.3)
    const ankleDistance = distance(la, ra);
    const shoulderWidth = distance(ls, rs);
    const stanceRatio = ankleDistance / shoulderWidth;

    if (stanceRatio < WIDE_STANCE_MIN || stanceRatio > WIDE_STANCE_MAX) {
      return { isReady: false, progress: 0, message: `Stand wider (${stanceRatio.toFixed(1)}x)` };
    }

    // Gate B: Upright trunk (lateral angle < 5°)
    const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: 0, visibility: 1 };
    const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: 0, visibility: 1 };
    const trunkLean = computeTrunkLeanDeg(shoulderMid, hipMid);

    if (Math.abs(trunkLean) > TRUNK_UPRIGHT_MAX) {
      return { isReady: false, progress: 0, message: 'Keep trunk upright' };
    }

    // Gate C: Knees straight (both interior knee angles > 165°)
    const leftKneeAngle = computeInteriorKneeAngle(lh, lk, la);
    const rightKneeAngle = computeInteriorKneeAngle(rh, rk, ra);

    if (leftKneeAngle < KNEE_STRAIGHT_MIN || rightKneeAngle < KNEE_STRAIGHT_MIN) {
      return { isReady: false, progress: 0, message: 'Straighten knees' };
    }

    // Gate D: Arms forward (wrists visible, within ±30% of trunkLength from shoulder height)
    const trunkLength = distance(shoulderMid as NormalizedLandmark, hipMid as NormalizedLandmark);
    const shoulderHeight = shoulderMid.y;
    const offsetThreshold = trunkLength * WRIST_OFFSET_THRESHOLD;

    if (lw.visibility < WRIST_VISIBILITY || rw.visibility < WRIST_VISIBILITY) {
      return { isReady: false, progress: 0, message: 'Raise arms forward' };
    }

    const lwOffset = Math.abs(lw.y - shoulderHeight);
    const rwOffset = Math.abs(rw.y - shoulderHeight);

    if (lwOffset > offsetThreshold || rwOffset > offsetThreshold) {
      return { isReady: false, progress: 0, message: 'Raise arms forward' };
    }

    // All gates pass — confirm hold
    this.calBadStart = 0;
    if (this.calGoodStart === 0) this.calGoodStart = now;

    const held = now - this.calGoodStart;
    const progress = Math.min(1, held / CAL_CONFIRM_DURATION);

    if (held >= CAL_CONFIRM_DURATION) {
      this.calReady = true;
      this.startTime = performance.now();
      this.onCalibrationSuccess(landmarks, shoulderMid, hipMid, shoulderWidth, ankleDistance, trunkLength);
      return { isReady: true, progress: 1, message: 'Ready!' };
    }

    return { isReady: false, progress, message: 'Hold still...' };
  }

  /**
   * Reset startTime + phase timers after countdown finishes
   */
  startPlaying(): void {
    const now = performance.now();
    this.startTime = now;
    this.elapsed = 0;
    this.phase = 1;
    this.phaseState = 'active';
    this.phaseStartTime = now;
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
    this.totalElapsed = Math.min(45, this.elapsed);

    // Check pose loss
    const visibleLegLandmarks = (landmarks[LM.LEFT_HIP]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.RIGHT_HIP]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.LEFT_KNEE]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.RIGHT_KNEE]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.LEFT_ANKLE]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.RIGHT_ANKLE]?.visibility ?? 0) > 0.3;

    if (!visibleLegLandmarks) {
      if (!this.poseLostSince) {

        this.poseLostSince = now;

        this.devCounts.poseLost = (this.devCounts.poseLost ?? 0) + 1;

      }
    } else {
      this.poseLostSince = null;
    }

    // ─── PHASE STATE MANAGEMENT ───
    // Phase 1 active: 0-20s
    if (this.phase === 1 && this.phaseState === 'active' && this.totalElapsed >= PHASE_DURATION) {
      this.finalizePhase(1);
      this.phaseState = 'transition';
      this.transitionStartTime = now;
    }

    // Transition to phase 2: 20-25s
    if (this.phase === 1 && this.phaseState === 'transition' && this.totalElapsed >= PHASE_DURATION + TRANSITION_DURATION) {
      this.phase = 2;
      this.phaseState = 'active';
      this.phaseStartTime = now;
      this.resetRepState();
    }

    // Complete game at 45s
    if (this.totalElapsed >= 45) {
      if (this.phaseState === 'active' && this.phase === 2) {
        this.finalizePhase(2);
      }
      this.gameComplete = true;
      return;
    }

    // ─── GAME LOGIC (only during active phase) ───
    if (this.phaseState === 'active' && (this.phase === 1 || this.phase === 2)) {
      this.processGameFrame(landmarks, now);
    }
  }

  /**
   * Core game frame processing
   */
  private processGameFrame(landmarks: NormalizedLandmark[], now: number): void {
    if (!this.calData) return;

    // Measure FPS (recalculate every 30 frames)
    this.fpsFrameCount++;
    if (this.fpsFrameCount >= 30) {
      const elapsed = (now - this.fpsStartTime) / 1000;
      if (elapsed > 0) {
        this.measuredFPS = this.fpsFrameCount / elapsed;
      }
      this.fpsFrameCount = 0;
      this.fpsStartTime = now;
    }
    if (this.fpsStartTime === 0) {
      this.fpsStartTime = now;
    }

    const bendingLeg = this.phase === 1 ? 'left' : 'right';
    const bendingLegIndices = bendingLeg === 'left'
      ? { hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE }
      : { hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE };

    const straightLegIndices = bendingLeg === 'left'
      ? { hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE }
      : { hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE };

    const bendingHip = landmarks[bendingLegIndices.hip];
    const bendingKnee = landmarks[bendingLegIndices.knee];
    const bendingAnkle = landmarks[bendingLegIndices.ankle];
    const straightKnee = landmarks[straightLegIndices.knee];
    const straightHip = landmarks[straightLegIndices.hip];
    const straightAnkle = landmarks[straightLegIndices.ankle];

    if (!bendingHip || !bendingKnee || !bendingAnkle || !straightKnee || !straightHip || !straightAnkle) {
      return;
    }

    // Compute knee angles
    const rawKneeAngle = computeInteriorKneeAngle(bendingHip, bendingKnee, bendingAnkle);
    this.smoothedKneeAngle = ema(rawKneeAngle, this.smoothedKneeAngle, EMA_ALPHA);
    this.kneeAngles.push(this.smoothedKneeAngle);

    // Compute angular velocity
    const dt = (now - this.repStartTime) / 1000;
    if (dt > 0 && this.kneeAngles.length > 1) {
      const velocity = (this.smoothedKneeAngle - this.lastAngle) / dt;
      if (Math.abs(velocity) > STATIC_VELOCITY_THRESH) {
        this.velocities.push(velocity);
      }
    }
    this.lastAngle = this.smoothedKneeAngle;

    // Record time-series point every 100ms (V2 parity)
    if (now - this.lastTimeSeriesAt >= 100) {
      this.timeSeries.push({
        timestamp: this.totalElapsed,
        kneeAngle: this.smoothedKneeAngle,
        side: this.phase === 1 ? 'left' : 'right',
      });
      this.lastTimeSeriesAt = now;
    }

    // Track ankle positions for form checks
    this.anklePositions.push({ ...bendingAnkle });
    if (this.lastAnklePos === null) this.lastAnklePos = bendingAnkle;

    // ─── Phase-level fallback tracking ───
    if (this.velocities.length > 0) {
      this.phaseAngularVelocities.push(this.velocities[this.velocities.length - 1]);
    }
    this.phaseBestDepthAngle = Math.min(this.phaseBestDepthAngle, this.smoothedKneeAngle);

    // ─── BUG-CS06 four-signal accumulators (V2-ported 2026-05-14) ───
    // Active while we are NOT in STANDING — collect per-frame stats so the
    // rep-completion handler can apply the gates.
    const straightLegAngle = computeInteriorKneeAngle(straightHip, straightKnee, straightAnkle);

    // ── V2 deviation detection (ported 2026-05-15) ──
    const _ls = landmarks[LM.LEFT_SHOULDER];
    const _rs = landmarks[LM.RIGHT_SHOULDER];
    const _lh = landmarks[LM.LEFT_HIP];
    const _rh = landmarks[LM.RIGHT_HIP];
    if (_ls && _rs && _lh && _rh) {
      const trunkH = Math.abs(((_lh.y + _rh.y) / 2) - ((_ls.y + _rs.y) / 2));
      if (trunkH < 0.18) {
        if (!this.tooFarSince) {

          this.tooFarSince = now;

          this.devCounts.tooFar = (this.devCounts.tooFar ?? 0) + 1;

        }
      } else { this.tooFarSince = 0; }
      if (trunkH > 0.45) {
        if (!this.tooCloseSince) {

          this.tooCloseSince = now;

          this.devCounts.tooClose = (this.devCounts.tooClose ?? 0) + 1;

        }
      } else { this.tooCloseSince = 0; }
      // TRUNK LEAN — shoulder midpoint vs hip midpoint lateral offset
      const _shoulderMidX = (_ls.x + _rs.x) / 2;
      const _hipMidX = (_lh.x + _rh.x) / 2;
      if (Math.abs(_shoulderMidX - _hipMidX) > 0.08) {
        if (!this.trunkLeanSince) {

          this.trunkLeanSince = now;

          this.devCounts.trunkLean = (this.devCounts.trunkLean ?? 0) + 1;

        }
      } else { this.trunkLeanSince = 0; }
    }
    // STRAIGHT LEG BENT — straightLegAngle should stay > 160°
    if (this.repState !== 'STANDING' && straightLegAngle < 155) {
      if (!this.straightLegBendSince) {

        this.straightLegBendSince = now;

        this.devCounts.straightLegBend = (this.devCounts.straightLegBend ?? 0) + 1;

      }
    } else { this.straightLegBendSince = 0; }
    // HEEL LIFT — bending ankle moved more than 0.04 from initial pos
    if (this.lastAnklePos && Math.abs(bendingAnkle.y - this.lastAnklePos.y) > 0.04) {
      if (!this.heelLiftSince) {

        this.heelLiftSince = now;

        this.devCounts.heelLift = (this.devCounts.heelLift ?? 0) + 1;

      }
    } else { this.heelLiftSince = 0; }
    // KNEE VALGUS — bending knee X far from bending ankle X
    if (Math.abs(bendingKnee.x - bendingAnkle.x) > 0.06) {
      if (!this.kneeValgusSince) {

        this.kneeValgusSince = now;

        this.devCounts.kneeValgus = (this.devCounts.kneeValgus ?? 0) + 1;

      }
    } else { this.kneeValgusSince = 0; }
    // SHALLOW SQUAT — at BOTTOM but smoothedKneeAngle still > DEPTH_HOLD_THRESH+10
    if (this.repState === 'BOTTOM' && this.smoothedKneeAngle > DEPTH_HOLD_THRESH + 10) {
      if (!this.shallowSquatSince) {

        this.shallowSquatSince = now;

        this.devCounts.shallowSquat = (this.devCounts.shallowSquat ?? 0) + 1;

      }
    } else { this.shallowSquatSince = 0; }
    // IDLE — STANDING + knee angle near upright for sustained period
    if (this.repState === 'STANDING' && this.smoothedKneeAngle > 165) {
      if (!this.idleSince) {

        this.idleSince = now;

        this.devCounts.idle = (this.devCounts.idle ?? 0) + 1;

      }
    } else { this.idleSince = 0; }

    if (this.repState !== 'STANDING') {
      // Gate A — sustained depth
      if (this.smoothedKneeAngle <= DEPTH_HOLD_THRESH) {
        this.repFramesAtDepth++;
      }
      // Gate B — track maximum hip Y (lowest point on screen)
      const hipMidY = (bendingHip.y + straightHip.y) / 2;
      const hipMidX = (bendingHip.x + straightHip.x) / 2;
      if (hipMidY > this.repHipMaxY) this.repHipMaxY = hipMidY;
      // Gate C — track min/max hip X (lateral shift toward bending side)
      if (hipMidX < this.repHipMinX) this.repHipMinX = hipMidX;
      if (hipMidX > this.repHipMaxX) this.repHipMaxX = hipMidX;
      // Gate D — track minimum opposite-leg knee angle (must stay extended)
      if (straightLegAngle < this.repOppKneeMin) this.repOppKneeMin = straightLegAngle;
    }

    // ─── REP STATE MACHINE ───

    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedKneeAngle < SQUAT_START_THRESHOLD) {
          this.repState = 'DESCENDING';
          this.repStartTime = now;
          this.bottomAngle = this.smoothedKneeAngle;
          // BUG-CS06 — reset four-signal gate accumulators at rep start
          this.repFramesAtDepth = 0;
          this.repHipMaxY = 0;
          this.repHipMinX = 1;
          this.repHipMaxX = 0;
          this.repOppKneeMin = 180;
        }
        break;

      case 'DESCENDING':
        this.bottomAngle = Math.min(this.bottomAngle, this.smoothedKneeAngle);
        if (Math.abs(this.smoothedKneeAngle - this.bottomAngle) <= SQUAT_PEAK_HOLD_DEG) {
          this.peakHoldFrames++;
          if (this.peakHoldFrames >= PEAK_HOLD_FRAMES) {
            this.repState = 'BOTTOM';
            this.peakHoldFrames = 0;
          }
        } else {
          this.peakHoldFrames = 0;
        }
        break;

      case 'BOTTOM':
        this.repState = 'ASCENDING';
        break;

      case 'ASCENDING':
        if (this.smoothedKneeAngle >= SQUAT_RETURN_THRESHOLD) {
          // Rep complete — apply depth gate AND BUG-CS06 four-signal gates
          if (this.bottomAngle <= MIN_REP_DEPTH_ANGLE && this.isValidCossackRep()) {
            this.completeRep(now, straightLegAngle, bendingAnkle, bendingHip, landmarks);
          } else if (this.bottomAngle <= MIN_REP_DEPTH_ANGLE) {
            // Depth passed but a four-signal gate failed
            this.repsDiscarded++;
            if (this.lastDiscardReason) speakInstruction(this.lastDiscardReason);
          } else if (this.totalElapsed >= PHASE_DURATION - 1) {
            // Salvage path at phase end — depth-gate-only fallback (V2 parity)
            this.completeRep(now, straightLegAngle, bendingAnkle, bendingHip, landmarks);
          } else {
            this.repsDiscarded++;
            speakInstruction('Squat lower for it to count');
          }
          this.resetRepState();
        }
        break;
    }
  }

  /**
   * Complete a rep: compute MQS, store, reset tracking
   */
  private completeRep(now: number, straightLegAngle: number, bendingAnkle: NormalizedLandmark, bendingHip: NormalizedLandmark, landmarks: NormalizedLandmark[]): void {
    if (!this.calData) return;

    // Smoothness calculation (FPS-adjusted scaling factor)
    let smoothness = 0;
    if (this.velocities.length >= 10) {
      const variance = sampleVariance(this.velocities);
      const fpsRatio = 30 / Math.max(1, this.measuredFPS);
      const adjustedScale = SMOOTHNESS_SCALING_FACTOR * (fpsRatio * fpsRatio);
      const rawScore = 100 - variance * adjustedScale;
      smoothness = clamp(rawScore, 0, 100);
    }

    // Form adherence (4 checks, weighted)
    let formScore = 0;

    // 1. Straight leg (30%): Opposite knee angle > 150°
    const straightLegOk = straightLegAngle > 150 ? 1 : 0;

    // 2. Trunk upright (25%): |trunkLeanAngle| < 25°
    const shoulderMid = this.calData.shoulderMidpoint;
    const hipMid = this.calData.hipMidpoint;
    const trunkLean = computeTrunkLeanDeg(shoulderMid, hipMid);
    const trunkOk = Math.abs(trunkLean) < 25 ? 1 : 0;

    // 3. Heel grounded (25%): Signed delta from calibration baseline
    // In screen coords y increases downward; heel lift means ankle y DECREASES
    const refAnkle = this.phase === 1 ? this.calData.leftAnklePos : this.calData.rightAnklePos;
    const heelRise = refAnkle.y - bendingAnkle.y; // positive = ankle moved UP
    const heelThreshold = this.calData.trunkLength * ANKLE_HEEL_RISE_MAX;
    const heelOk = heelRise < heelThreshold ? 1 : 0;

    // 4. Feet planted (20%): 2D Euclidean drift from calibration < 50% of stanceWidth
    const lAnkleDrift = distance(
      landmarks[LM.LEFT_ANKLE] ?? this.calData.leftAnklePos,
      this.calData.leftAnklePos,
    );
    const rAnkleDrift = distance(
      landmarks[LM.RIGHT_ANKLE] ?? this.calData.rightAnklePos,
      this.calData.rightAnklePos,
    );
    const maxDrift = Math.max(lAnkleDrift, rAnkleDrift);
    const driftThreshold = this.calData.stanceWidth * ANKLE_DRIFT_MAX;
    const feetOk = maxDrift < driftThreshold ? 1 : 0;

    formScore = (straightLegOk * 0.30 + trunkOk * 0.25 + heelOk * 0.25 + feetOk * 0.20) * 100;
    const formAdherence = formScore;

    // Track phase-level form for zero-rep fallback
    this.phaseFormScores.push(formAdherence);

    // Completion score (using interior knee angle at bottom)
    let completion = 0;
    if (this.bottomAngle <= 90) completion = 100;
    else if (this.bottomAngle <= 110) completion = 75;
    else if (this.bottomAngle <= 130) completion = 50;
    else if (this.bottomAngle <= 150) completion = 25;
    else completion = 0;

    // MQS per rep
    const mqs = smoothness * 0.35 + formAdherence * 0.40 + completion * 0.25;

    // Track best depth
    const bendingPhase = this.phase;
    if (bendingPhase === 1) {
      this.bestDepthL = Math.min(this.bestDepthL, this.bottomAngle);
    } else {
      this.bestDepthR = Math.min(this.bestDepthR, this.bottomAngle);
    }

    // Store rep
    const rep: SquatRep = {
      repNumber: (bendingPhase === 1 ? this.phase1Reps.length : this.phase2Reps.length) + 1,
      startTime: this.repStartTime,
      endTime: now,
      bottomAngle: this.bottomAngle,
      smoothness,
      formAdherence,
      completion,
      mqs: clamp(mqs, 0, 100),
    };

    if (bendingPhase === 1) {
      this.phase1Reps.push(rep);
    } else {
      this.phase2Reps.push(rep);
    }

    // Clear rep-level tracking
    this.kneeAngles = [];
    this.velocities = [];
    this.anklePositions = [];
    this.lastAnklePos = null;
  }

  /**
   * BUG-CS06 multi-signal rep validity check (V2-ported 2026-05-14)
   * All four signals must pass; depth gate is enforced separately at the call site.
   * Returns true if the rep should count, false if any signal failed.
   */
  private isValidCossackRep(): boolean {
    this.lastDiscardReason = null;
    if (!this.calData) {
      this.lastDiscardReason = 'Tracking lost';
      return false;
    }
    // Gate A — sustained depth
    if (this.repFramesAtDepth < SUSTAINED_DEPTH_FRAMES) {
      this.lastDiscardReason = 'Hold the bottom of the squat briefly';
      return false;
    }
    // Gate B — hip drop relative to trunkLength
    if (this.calData.trunkLength > 0) {
      const hipDrop = this.repHipMaxY - this.calData.hipMidpoint.y;
      const hipDropThreshold = MIN_HIP_DROP_RATIO * this.calData.trunkLength;
      if (hipDrop < hipDropThreshold) {
        this.lastDiscardReason = 'Drop your hips lower';
        return false;
      }
    }
    // Gate C — lateral hip shift toward the bending side
    // Mirrored selfie convention: user's LEFT side has HIGHER landmark X
    if (this.calData.stanceWidth > 0) {
      const minShift = MIN_LATERAL_SHIFT_RATIO * this.calData.stanceWidth;
      const calibHipX = this.calData.hipMidpoint.x;
      const lateralShift = this.phase === 1
        ? this.repHipMaxX - calibHipX     // LEFT bending: X should INCREASE
        : calibHipX - this.repHipMinX;    // RIGHT bending: X should DECREASE
      if (lateralShift < minShift) {
        this.lastDiscardReason = 'Shift your weight over the bending leg';
        return false;
      }
    }
    // Gate D — opposite leg stayed straight
    if (this.repOppKneeMin < OPP_LEG_STRAIGHT_MIN) {
      this.lastDiscardReason = 'Keep your other leg straight';
      return false;
    }
    return true;
  }

  /**
   * Reset rep state machine
   */
  private resetRepState(): void {
    this.repState = 'STANDING';
    this.repStartTime = 0;
    this.bottomAngle = 180;
    this.peakHoldFrames = 0;
    this.repFramesAtDepth = 0;
    this.repHipMaxY = 0;
    this.repHipMinX = 1;
    this.repHipMaxX = 0;
    this.repOppKneeMin = 180;
    this.kneeAngles = [];
    this.velocities = [];
    this.anklePositions = [];
    this.lastAnklePos = null;
  }

  /**
   * Finalize phase: calculate phase MQS from stored reps, or fallback capped at 15.0
   */
  private finalizePhase(phaseNum: 1 | 2): void {
    const reps = phaseNum === 1 ? this.phase1Reps : this.phase2Reps;

    let phaseMqs: number;

    if (reps.length > 0) {
      const mqsValues = reps.map(r => r.mqs);
      phaseMqs = clamp(mean(mqsValues), 0, 100);
    } else {
      // Fallback: compute from phase-level frame data, capped at 15%
      const smoothness = this.computeFallbackSmoothness();
      const formAdherence = this.phaseFormScores.length > 0
        ? mean(this.phaseFormScores)
        : 0;
      const completionScore = this.computeFallbackCompletion(this.phaseBestDepthAngle);
      const rawMqs = smoothness * 0.35 + formAdherence * 0.40 + completionScore * 0.25;
      phaseMqs = Math.min(rawMqs, 15.0);
    }

    if (phaseNum === 1) {
      this.phase1MQS = phaseMqs;
    } else {
      this.phase2MQS = phaseMqs;
    }

    // Reset phase-level tracking for next phase
    this.phaseFormScores = [];
    this.phaseAngularVelocities = [];
    this.phaseBestDepthAngle = 180;
    this.timeSeries = [];
    this.lastTimeSeriesAt = 0;
    this.heelLiftSince = 0;
    this.kneeValgusSince = 0;
    this.trunkLeanSince = 0;
    this.straightLegBendSince = 0;
    this.shallowSquatSince = 0;
    this.idleSince = 0;
    this.tooFarSince = 0;
    this.tooCloseSince = 0;
    this.cossackLastWarningKey = '';
    this.cossackLastWarningAt = 0;
    this.devCounts = {};
  }

  /** Fallback smoothness from phase-level angular velocities */
  private computeFallbackSmoothness(): number {
    if (this.phaseAngularVelocities.length < 5) return 0;
    const variance = sampleVariance(this.phaseAngularVelocities);
    const fpsRatio = 30 / Math.max(1, this.measuredFPS);
    const adjustedScale = SMOOTHNESS_SCALING_FACTOR * (fpsRatio * fpsRatio);
    return clamp(100 - variance * adjustedScale, 0, 100);
  }

  /** Fallback completion from best depth angle in the phase */
  private computeFallbackCompletion(bestAngle: number): number {
    if (bestAngle <= 90) return 100;
    if (bestAngle <= 110) return 75;
    if (bestAngle <= 130) return 50;
    if (bestAngle <= 150) return 25;
    return 0;
  }

  /**
   * Called when calibration succeeds
   */
  private onCalibrationSuccess(
    landmarks: NormalizedLandmark[],
    shoulderMid: NormalizedLandmark,
    hipMid: NormalizedLandmark,
    shoulderWidth: number,
    ankleDistance: number,
    trunkLength: number
  ): void {
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];

    if (!la || !ra || !lk || !rk || !lh || !rh) return;

    const leftKneeAngle = computeInteriorKneeAngle(lh, lk, la);
    const rightKneeAngle = computeInteriorKneeAngle(rh, rk, ra);

    this.calData = {
      shoulderMidpoint: shoulderMid,
      hipMidpoint: hipMid,
      shoulderWidth,
      stanceWidth: ankleDistance,
      trunkLength,
      leftAnklePos: la,
      rightAnklePos: ra,
      leftKneeAngle,
      rightKneeAngle,
      hipCenterX: hipMid.x,
    };

    this.smoothedKneeAngle = Math.min(leftKneeAngle, rightKneeAngle);
    this.lastAngle = this.smoothedKneeAngle;
    this.resetRepState();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const w = width;
    const h = height;

    // Draw skeleton
    if (this.lastLandmarks) {
      this.drawSkeleton(ctx, w, h, this.lastLandmarks);
    }

    // Draw phase-specific overlays
    if (this.phaseState === 'transition') {
      this.drawTransitionOverlay(ctx, w, h);
      return;
    }

    if (this.phaseState === 'active') {
      // Depth bar on right edge
      this.drawDepthBar(ctx, w, h);

      // MQS bar on right edge (upper)
      this.drawMQSBar(ctx, w, h);

      // Knee flexion arc at bending knee
      if (this.lastLandmarks && this.calData) {
        this.drawKneeFlexionArc(ctx, w, h, this.lastLandmarks);
      }

      // Straight leg guide (amber warning if opposite knee bending)
      this.drawStraightLegGuide(ctx, w, h);

      // HUD: Phase label, rep count, timer, MQS
      this.drawHUD(ctx, w, h);
    }
  }

  /**
   * Draw skeleton with bending-side leg highlighted in teal
   */
  private drawSkeleton(ctx: CanvasRenderingContext2D, w: number, h: number, landmarks: NormalizedLandmark[]): void {
    const connections = [
      [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
      [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
      [LM.LEFT_ELBOW, LM.LEFT_WRIST],
      [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
      [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
      [LM.LEFT_SHOULDER, LM.LEFT_HIP],
      [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
      [LM.LEFT_HIP, LM.RIGHT_HIP],
      [LM.LEFT_HIP, LM.LEFT_KNEE],
      [LM.LEFT_KNEE, LM.LEFT_ANKLE],
      [LM.RIGHT_HIP, LM.RIGHT_KNEE],
      [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
    ];

    // Draw connections
    for (const [startIdx, endIdx] of connections) {
      const start = landmarks[startIdx];
      const end = landmarks[endIdx];

      if (!start || !end || start.visibility < 0.3 || end.visibility < 0.3) continue;

      const startNum = startIdx as number;
      const isBendingLeg = (this.phase === 1 && (startNum === LM.LEFT_HIP || startNum === LM.LEFT_KNEE || startNum === LM.LEFT_ANKLE)) ||
        (this.phase === 2 && (startNum === LM.RIGHT_HIP || startNum === LM.RIGHT_KNEE || startNum === LM.RIGHT_ANKLE));

      const sx = (1 - start.x) * w;
      const sy = start.y * h;
      const ex = (1 - end.x) * w;
      const ey = end.y * h;

      ctx.strokeStyle = isBendingLeg ? '#00E5CC' : '#FFFFFF';
      ctx.lineWidth = isBendingLeg ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }

    // Draw joints
    for (const lm of landmarks) {
      if (lm.visibility < 0.3) continue;
      const mx = (1 - lm.x) * w;
      const my = lm.y * h;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Draw depth bar on right edge
   */
  private drawDepthBar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const barX = w - 40;
    const barY = h / 2 - 75;
    const barH = 150;
    const barW = 15;

    // Background
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, barH);

    // Best depth marker
    const bendingPhase = this.phase;
    const bestDepth = bendingPhase === 1 ? this.bestDepthL : this.bestDepthR;
    const depthRatio = clamp((180 - bestDepth) / 90, 0, 1);
    const markerY = barY + barH * (1 - depthRatio);

    ctx.fillStyle = '#FFB547';
    ctx.fillRect(barX - 5, markerY - 2, barW + 10, 4);

    // Fill for current angle
    const fillH = barH * depthRatio;
    ctx.fillStyle = '#00E5CC';
    ctx.fillRect(barX, barY + barH - fillH, barW, fillH);
  }

  /**
   * Draw MQS bar (upper right)
   */
  private drawMQSBar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const barX = w - 40;
    const barY = h / 2 - 200;
    const barH = 100;
    const barW = 15;

    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, barH);

    const mqs = this.phase === 1 ? this.phase1MQS : this.phase2MQS;
    const fillH = (mqs / 100) * barH;
    ctx.fillStyle = mqs >= 50 ? '#00E5CC' : mqs >= 25 ? '#FFB547' : '#FF6B6B';
    ctx.fillRect(barX, barY + barH - fillH, barW, fillH);
  }

  /**
   * Draw knee flexion arc at bending knee
   */
  private drawKneeFlexionArc(ctx: CanvasRenderingContext2D, w: number, h: number, landmarks: NormalizedLandmark[]): void {
    const bendingLegIndices = this.phase === 1
      ? { knee: LM.LEFT_KNEE }
      : { knee: LM.RIGHT_KNEE };

    const knee = landmarks[bendingLegIndices.knee];
    if (!knee || knee.visibility < 0.3) return;

    const kx = (1 - knee.x) * w;
    const ky = knee.y * h;
    const radius = 30;

    ctx.strokeStyle = '#00E5CC';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const startAngle = Math.PI / 4;
    const endAngle = -Math.PI / 4;
    ctx.arc(kx, ky, radius, startAngle, endAngle);
    ctx.stroke();
  }

  /**
   * Draw straight leg guide (amber warning if opposite knee bending)
   */
  private drawStraightLegGuide(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.lastLandmarks) return;

    const straightLegIdx = this.phase === 1 ? LM.RIGHT_KNEE : LM.LEFT_KNEE;
    const knee = this.lastLandmarks[straightLegIdx];
    if (!knee || knee.visibility < 0.3) return;

    ctx.fillStyle = '#FFB547';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    const kx = (1 - knee.x) * w;
    const ky = knee.y * h;
    ctx.fillText('Keep straight', kx, ky - 20);
  }

  /**
   * Draw HUD: phase label, rep count, timer, MQS
   */
  private drawHUD(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const phase = this.phase === 1 ? 'LEFT LEG' : 'RIGHT LEG';
    const reps = this.phase === 1 ? this.phase1Reps.length : this.phase2Reps.length;
    const mqs = this.phase === 1 ? this.phase1MQS : this.phase2MQS;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(phase, 20, 30);

    ctx.font = '16px sans-serif';
    ctx.fillText(`Reps: ${reps}`, 20, 60);
    ctx.fillText(`MQS: ${Math.round(mqs)}`, 20, 90);

    // Timer
    const secs = Math.ceil(45 - this.totalElapsed);
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${secs}s`, w - 20, 40);
  }

  /**
   * Draw transition overlay
   */
  private drawTransitionOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#00E5CC';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nextSide = this.phase === 1 ? 'right' : 'left';
    ctx.fillText(`Get ready for ${nextSide} leg`, w / 2, h / 2);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUD & Results
  // ═══════════════════════════════════════════════════════════════════════════

  getHudMetrics(): HudMetrics {
    const phaseLabel = this.phase === 0 ? 'READY' : this.phase === 1 ? 'LEFT LEG' : 'RIGHT LEG';
    const mqs = this.phase === 1 ? this.phase1MQS : this.phase === 2 ? this.phase2MQS : 0;
    const reps = this.phase === 1 ? this.phase1Reps.length : this.phase === 2 ? this.phase2Reps.length : 0;
    const now = performance.now();
    const dirLabel = this.phase === 1 ? 'LEFT' : 'RIGHT';
    let warningSlot1: string | undefined;
    let warningSlot2: string | undefined;
    let instructionText = `Cossack squat on ${dirLabel} leg`;
    let instructionColor = '#94a3b8';

    // SLOT 1 (RED) — heel_lift > too_far > too_close > idle > shallow_squat > straight_leg_bend
    if (this.heelLiftSince > 0 && now - this.heelLiftSince > 600) {
      warningSlot1 = '⚠ Keep heels on the floor';
      this.cossackMaybeSpeak('heel_lift', 'Keep your heels on the floor', 5000);
    } else if (this.tooFarSince > 0 && now - this.tooFarSince > 1500) {
      warningSlot1 = '⚠ Move closer to the camera';
      this.cossackMaybeSpeak('too_far', 'Move closer to the camera', 6000);
    } else if (this.tooCloseSince > 0 && now - this.tooCloseSince > 1500) {
      warningSlot1 = '⚠ Move back — full body must be visible';
      this.cossackMaybeSpeak('too_close', 'Move back from the camera', 6000);
    } else if (this.straightLegBendSince > 0 && now - this.straightLegBendSince > 1000) {
      warningSlot1 = '⚠ Keep opposite leg straight';
      this.cossackMaybeSpeak('straight_leg', 'Keep your opposite leg straight', 5000);
    } else if (this.idleSince > 0 && now - this.idleSince > 5000) {
      warningSlot1 = `⚠ Lunge sideways onto ${dirLabel} leg`;
      this.cossackMaybeSpeak('idle', `Lunge sideways onto your ${dirLabel.toLowerCase()} leg`, 6000);
    } else if (this.shallowSquatSince > 0 && now - this.shallowSquatSince > 1500) {
      warningSlot1 = '⚠ Sink deeper into the squat';
      this.cossackMaybeSpeak('shallow', 'Sink deeper into the squat', 5000);
    }

    // SLOT 2 (AMBER) — knee_valgus > trunk_lean
    if (this.kneeValgusSince > 0 && now - this.kneeValgusSince > 800) {
      warningSlot2 = '● Track knee over toes';
      this.cossackMaybeSpeak('knee_valgus', 'Track your knee over your toes', 6000);
    } else if (this.trunkLeanSince > 0 && now - this.trunkLeanSince > 1000) {
      warningSlot2 = '● Chest up — keep trunk upright';
      this.cossackMaybeSpeak('trunk_lean', 'Keep your chest up and trunk upright', 6000);
    }

    if (warningSlot1) {
      instructionText = warningSlot1.replace(/^[⚠●]\s*/, '');
      instructionColor = '#FF4D6A';
    } else if (this.repState === 'BOTTOM') {
      instructionText = 'GREAT — rise up';
      instructionColor = '#22c55e';
    }

    return {
      primary: {
        label: this.phase === 1 ? 'MQS (L)' : 'MQS (R)',
        value: Math.round(mqs),
        color: '#00E5CC',
      },
      secondary: {
        label: 'Reps',
        value: reps,
        color: '#FFB547',
      },
      timer: {
        elapsed: Math.round(this.totalElapsed),
        total: 45,
      },
      instruction: phaseLabel,
      instructionText,
      instructionColor,
      warningSlot1,
      warningSlot2,
      leftAngle: Math.round(this.phase1MQS),
      rightAngle: Math.round(this.phase2MQS),
      symmetryIndex: Math.round(Math.abs(this.phase1MQS - this.phase2MQS)),
      bigRepChip: this.phase1Reps.length + this.phase2Reps.length,
    };
  }

  isComplete(): boolean {
    return this.gameComplete;
  }

  getRawData(): Record<string, unknown> {
    const tci = clamp(100 - Math.abs(this.phase1MQS - this.phase2MQS), 0, 100);
    const mqsAvg = (this.phase1MQS + this.phase2MQS) / 2;

    return {
      testId: 'KS6',
      mqsL: Math.round(this.phase1MQS),
      mqsR: Math.round(this.phase2MQS),
      mqsAvg: Math.round(mqsAvg),
      tci: Math.round(tci),
      repsL: this.phase1Reps.length,
      repsR: this.phase2Reps.length,
      repsDiscarded: this.repsDiscarded,
      bestDepthL: Math.round(this.bestDepthL),
      bestDepthR: Math.round(this.bestDepthR),
      duration: Math.round(this.totalElapsed),
      deviationCounts: { ...this.devCounts },
      timeSeries: this.timeSeries,
      customMetrics: {
        mqsAvg: Math.round(mqsAvg),
        tci: Math.round(tci),
        mqsL: Math.round(this.phase1MQS),
        mqsR: Math.round(this.phase2MQS),
        repsL: this.phase1Reps.length,
        repsR: this.phase2Reps.length,
        repsDiscarded: this.repsDiscarded,
        bestDepthL: Math.round(this.bestDepthL),
        bestDepthR: Math.round(this.bestDepthR),
      },
    };
  }

  destroy(): void {
    this.reset();
  }
}
