/**
 * Hip Gate (KS2) Engine — Circle tracking with hip stabilization
 *
 * Game structure: Calibration (hands on hips) → Phase 1 (left leg, 20s) →
 * Transition (5s) → Phase 2 (right leg, 20s) → Complete (45s total)
 *
 * Movement quality: Smooth circular knee lifts tracking a ghost circle,
 * minimizing trunk lean and maintaining proper form (correct knee raised,
 * not swaying, smooth motion).
 *
 * Scoring: MQS per leg (smoothness*0.35 + formAdherence*0.40 + completion*0.25),
 * TCI as left/right symmetry, total circles as extra metric.
 */

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics, type NormalizedLandmark } from './types';
import { speakInstruction } from '@/lib/game/audio-feedback';

// ─── Type Definitions ─────────────────────────────────────────────────────────

interface CircleFrame {
  x: number;
  y: number;
  angle: number;
  distance: number;
  timestamp: number;
  inPath: boolean;
}

interface TimeSeriesPoint {
  timestamp: number;
  mqs: number;
}

// ─── Calibration Constants ────────────────────────────────────────────────────

const CAL_VISIBILITY_THRESHOLD = 0.3;
const WRIST_Y_TOLERANCE = 0.15;
const WRIST_X_TOLERANCE = 0.20;
const CAL_CONFIRM_DURATION = 2000;
const CAL_BAD_POSTURE_BUFFER = 300;
const CAL_TIMEOUT_MS = 20000;
const CAL_HIP_DISTANCE_MIN = 0.03;

// ─── Game Logic Constants ─────────────────────────────────────────────────────

const PHASE_DURATION = 20; // seconds per leg
const TRANSITION_DURATION = 5; // seconds between legs
const POSE_LOSS_DEBOUNCE = 800;
const TRUNK_LEAN_MAX_DEG = 10;
const EMA_ALPHA = 0.15;
const CIRCLE_COMPLETE_RAD = 5.236; // 300 degrees in radians
const FORM_ADHERENCE_TOLERANCE = 0.25; // V2-ported 2026-05-14 — accounts for oval circumduction path (was 0.15)
const MIN_ARC_FOR_ATTEMPT = Math.PI / 2;     // V2-ported 2026-05-14 — 90° = attempted circle
const MAX_DELTA_PER_FRAME = Math.PI / 6; // 30 degrees cap
const WRONG_LEG_RAISE_THRESHOLD = 0.05;

// ─── Rendering Constants ─────────────────────────────────────────────────────

const SKELETON_JOINTS = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

const SKELETON_CONNECTIONS = [
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
];

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Compute trunk lean angle: measure deviation from vertical between shoulder-mid
 * and hip-mid vectors
 */
function computeTrunkLeanDeg(lm: NormalizedLandmark[]): number {
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

  const dx = shoulderMidX - hipMidX;
  const dy = shoulderMidY - hipMidY;

  // Angle from vertical (0, -1 in screen coords)
  const angle = Math.atan2(Math.abs(dx), -dy) * (180 / Math.PI);
  return angle;
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
 * Median of array
 */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// ─── Engine Class ─────────────────────────────────────────────────────────────

export class HipGateEngine implements GameEngine {
  // ── Calibration State ──
  private calGoodStart = 0;
  private calBadStart = 0;
  private calStartTime = 0;
  private calReady = false;

  // ── Calibration References ──
  private hipCentreL: NormalizedLandmark | null = null;
  private hipCentreR: NormalizedLandmark | null = null;
  private targetCircleRadius = 0;
  private shoulderMid: NormalizedLandmark | null = null;
  private hipMid: NormalizedLandmark | null = null;

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

  // ── Warnings State ──
  private trunkLeanActive = false;
  private wrongLegActive = false;
  private wrongLegSince: number | null = null;
  private poseLostDisplaySince: number | null = null;
  // V2 deviation catalog (ported 2026-05-15)
  private trunkLeanSince = 0;
  private noMovementSince = 0;
  private smallCircleSince = 0;
  private bigCircleSince = 0;
  private tooFastSince = 0;
  private kneeNotRaisedSince = 0;
  private tooFarSince = 0;
  private tooCloseSince = 0;
  private supportLegBentSince = 0;
  private lastKneePosX = 0;
  private lastKneePosY = 0;
  private lastKneeStillSince = 0;
  private hipGateLastWarningKey = '';
  private hipGateLastWarningAt = 0;

  // ── Per-Phase Metrics ──
  private phase1Circles: CircleFrame[][] = [];
  private phase2Circles: CircleFrame[][] = [];
  private phase1CircleMQS: number[] = [];
  private phase2CircleMQS: number[] = [];
  private phase1MQS = 0;
  private phase2MQS = 0;
  private phaseAllFrames: CircleFrame[] = [];
  private lastLandmarks: NormalizedLandmark[] | null = null;

  // ── Current Circle Tracking ──
  private currentCircleFrames: CircleFrame[] = [];
  private smoothedKneePos: NormalizedLandmark | null = null;
  private kneeVelocities: number[] = [];
  private absoluteArcAccum = 0;
  private quadrantsVisited = new Set<number>();
  private measuredRadii: number[] = [];
  private dynamicTargetRadius = 0;
  private framesInPath = 0;
  private totalFramesInCircle = 0;
  private circleMQS = 0;
  private currentMQS = 0;

  // ── Time Series Recording ──
  private timeSeriesL: TimeSeriesPoint[] = [];
  private timeSeriesR: TimeSeriesPoint[] = [];
  private lastRecordTime = 0;

  // ── Results Accumulation ──
  private completeCirclesL = 0;
  private completeCirclesR = 0;
  private runningMQS_L = 0;
  private runningMQS_R = 0;

  // ── Instruction Text ──
  private instructionText = '';
  /** Per-deviation activation counters (transition 0 → now triggers ++). */
  private devCounts: Record<string, number> = {};
  /** Max observed knee bend (interior angle deviation from 180°) — previously a hardcoded 0 placeholder. */
  private maxKneeBendForRawData = 0;

  constructor() {
    this.reset();
  }

  /** V2-parity per-key throttled speech */
  private hipGateMaybeSpeak(key: string, text: string, cooldownMs: number): void {
    const now = performance.now();
    if (this.hipGateLastWarningKey === key && now - this.hipGateLastWarningAt < cooldownMs) return;
    // Only update per-key cooldown when speech actually fires — otherwise
    // a dropped second-slot warning ghost-silences itself for cooldownMs.
    const spoke = speakInstruction(text);
    if (spoke) {
      this.hipGateLastWarningKey = key;
      this.hipGateLastWarningAt = now;
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

    this.hipCentreL = null;
    this.hipCentreR = null;
    this.targetCircleRadius = 0;
    this.shoulderMid = null;
    this.hipMid = null;

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

    this.trunkLeanActive = false;
    this.wrongLegActive = false;
    this.trunkLeanSince = 0;
    this.noMovementSince = 0;
    this.smallCircleSince = 0;
    this.bigCircleSince = 0;
    this.tooFastSince = 0;
    this.kneeNotRaisedSince = 0;
    this.tooFarSince = 0;
    this.tooCloseSince = 0;
    this.supportLegBentSince = 0;
    this.lastKneePosX = 0;
    this.lastKneePosY = 0;
    this.lastKneeStillSince = 0;
    this.hipGateLastWarningKey = '';
    this.hipGateLastWarningAt = 0;
    this.devCounts = {};
    this.maxKneeBendForRawData = 0;
    this.wrongLegSince = null;
    this.poseLostDisplaySince = null;

    this.phase1Circles = [];
    this.phase2Circles = [];
    this.phase1CircleMQS = [];
    this.phase2CircleMQS = [];
    this.phase1MQS = 0;
    this.phase2MQS = 0;
    this.phaseAllFrames = [];

    this.currentCircleFrames = [];
    this.smoothedKneePos = null;
    this.kneeVelocities = [];
    this.absoluteArcAccum = 0;
    this.quadrantsVisited = new Set();
    this.measuredRadii = [];
    this.dynamicTargetRadius = 0;
    this.framesInPath = 0;
    this.totalFramesInCircle = 0;
    this.circleMQS = 0;
    this.currentMQS = 0;

    this.timeSeriesL = [];
    this.timeSeriesR = [];
    this.lastRecordTime = 0;

    this.completeCirclesL = 0;
    this.completeCirclesR = 0;
    this.runningMQS_L = 0;
    this.runningMQS_R = 0;

    this.instructionText = '';
    this.lastLandmarks = null;
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

    // Gate A: Full body visible
    const requiredLandmarks = [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ];

    for (const idx of requiredLandmarks) {
      const lm = landmarks[idx];
      if (!lm || lm.visibility < CAL_VISIBILITY_THRESHOLD) {
        return { isReady: false, progress: 0, message: 'Full body not visible' };
      }
      // Check frame bounds
      if (lm.x < 0.05 || lm.x > 0.95 || lm.y < 0.05 || lm.y > 0.95) {
        return { isReady: false, progress: 0, message: 'Move closer to camera' };
      }
    }

    // Gate B: Hip landmarks detected with distance > 0.03
    const lhip = landmarks[LM.LEFT_HIP];
    const rhip = landmarks[LM.RIGHT_HIP];
    if (!lhip || !rhip) {
      return { isReady: false, progress: 0, message: 'Hips not detected' };
    }

    const hipDist = distance(lhip, rhip);
    if (hipDist < CAL_HIP_DISTANCE_MIN) {
      return { isReady: false, progress: 0, message: 'Stand wider' };
    }

    // Gate C: Both hands on hips
    const lwrist = landmarks[LM.LEFT_WRIST];
    const rwrist = landmarks[LM.RIGHT_WRIST];
    if (!lwrist || !rwrist) {
      return { isReady: false, progress: 0, message: 'Hands not visible' };
    }

    // Wrist should be near corresponding hip
    const lWristNearHip =
      Math.abs(lwrist.x - lhip.x) < WRIST_X_TOLERANCE &&
      Math.abs(lwrist.y - lhip.y) < WRIST_Y_TOLERANCE;

    const rWristNearHip =
      Math.abs(rwrist.x - rhip.x) < WRIST_X_TOLERANCE &&
      Math.abs(rwrist.y - rhip.y) < WRIST_Y_TOLERANCE;

    if (!lWristNearHip || !rWristNearHip) {
      return { isReady: false, progress: 0, message: 'Hands on hips' };
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
      // Accumulate pose-lost time separately, don't advance game time
      if (now - this.poseLostSince > POSE_LOSS_DEBOUNCE) {
        // Pose still lost after debounce — freeze timer
        this.timerFrozenTime = now;
      }
    } else {
      // Pose is tracked — advance game time
      if (this.timerFrozenTime > 0) {
        // Resume: shift startTime forward by the frozen gap
        this.startTime += now - this.timerFrozenTime;
        this.timerFrozenTime = 0;
      }
    }

    this.elapsed = (now - this.startTime) / 1000;
    this.totalElapsed = Math.min(45, this.elapsed);

    // Check pose loss
    const visibleHip = (landmarks[LM.LEFT_HIP]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.RIGHT_HIP]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.LEFT_KNEE]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.RIGHT_KNEE]?.visibility ?? 0) > 0.3;

    if (!visibleHip) {
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

    // ─── PHASE STATE MANAGEMENT ───
    // Phase 1 active: 0-20s
    if (this.phase === 1 && this.phaseState === 'active' && this.totalElapsed >= PHASE_DURATION) {
      // End phase 1 active, start transition
      this.finalizePhase(1);
      this.phaseState = 'transition';
      this.transitionStartTime = now;
    }

    // Transition to phase 2: 20-25s
    if (this.phase === 1 && this.phaseState === 'transition' && this.totalElapsed >= PHASE_DURATION + TRANSITION_DURATION) {
      // End transition, start phase 2
      this.phase = 2;
      this.phaseState = 'active';
      this.phaseStartTime = now;
      this.phaseAllFrames = [];
      this.startNewCircle();
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
    if (!this.hipCentreL || !this.hipCentreR) return;

    // Determine active leg
    const isPhase1 = this.phase === 1;
    const activeKneeLM = isPhase1 ? landmarks[LM.LEFT_KNEE] : landmarks[LM.RIGHT_KNEE];
    const otherKneeLM = isPhase1 ? landmarks[LM.RIGHT_KNEE] : landmarks[LM.LEFT_KNEE];
    const activeHip = isPhase1 ? this.hipCentreL : this.hipCentreR;
    const otherHip = isPhase1 ? this.hipCentreR : this.hipCentreL;

    if (!activeKneeLM || !otherKneeLM) return;

    // Check trunk lean
    const trunkLean = computeTrunkLeanDeg(landmarks);
    this.trunkLeanActive = trunkLean > TRUNK_LEAN_MAX_DEG;
    if (this.trunkLeanActive) {
      if (!this.trunkLeanSince) {

        this.trunkLeanSince = now;

        this.devCounts.trunkLean = (this.devCounts.trunkLean ?? 0) + 1;

      }
    } else {
      this.trunkLeanSince = 0;
    }

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
    }
    // SUPPORT LEG BENT — non-active knee should remain straight
    const otherKnee2 = this.phase === 1 ? landmarks[LM.RIGHT_KNEE] : landmarks[LM.LEFT_KNEE];
    const otherHip2 = this.phase === 1 ? landmarks[LM.RIGHT_HIP] : landmarks[LM.LEFT_HIP];
    const otherAnkle = this.phase === 1 ? landmarks[LM.RIGHT_ANKLE] : landmarks[LM.LEFT_ANKLE];
    if (otherKnee2 && otherHip2 && otherAnkle) {
      const hipY = otherHip2.y, kY = otherKnee2.y, aY = otherAnkle.y;
      const expectedKY = (hipY + aY) / 2;
      if (Math.abs(kY - expectedKY) > 0.05) {
        if (!this.supportLegBentSince) {

          this.supportLegBentSince = now;

          this.devCounts.supportLegBent = (this.devCounts.supportLegBent ?? 0) + 1;

        }
      } else { this.supportLegBentSince = 0; }
    }
    // KNEE NOT RAISED — active knee should hover at or above hip level during
    // circumduction. If it stays well below hip (>0.06 norm below hip Y),
    // the user is mostly shuffling their foot — not lifting the knee.
    const activeKnee3 = this.phase === 1 ? landmarks[LM.LEFT_KNEE] : landmarks[LM.RIGHT_KNEE];
    const activeHip3 = this.phase === 1 ? this.hipCentreL : this.hipCentreR;
    // Track max knee bend (interior angle delta from a straight reference)
    // using the active knee's interior angle hip-knee-ankle. Surfaced in raw data.
    const activeAnkle3 = this.phase === 1 ? landmarks[LM.LEFT_ANKLE] : landmarks[LM.RIGHT_ANKLE];
    if (activeKnee3 && activeHip3 && activeAnkle3) {
      const dxHK = activeHip3.x - activeKnee3.x;
      const dyHK = activeHip3.y - activeKnee3.y;
      const dxAK = activeAnkle3.x - activeKnee3.x;
      const dyAK = activeAnkle3.y - activeKnee3.y;
      const dot = dxHK * dxAK + dyHK * dyAK;
      const magHK = Math.sqrt(dxHK * dxHK + dyHK * dyHK);
      const magAK = Math.sqrt(dxAK * dxAK + dyAK * dyAK);
      if (magHK > 0 && magAK > 0) {
        const interior = Math.acos(Math.max(-1, Math.min(1, dot / (magHK * magAK)))) * (180 / Math.PI);
        const bend = 180 - interior; // 0 = straight leg, larger = more bent
        if (bend > this.maxKneeBendForRawData) this.maxKneeBendForRawData = bend;
      }
    }
    if (activeKnee3 && activeHip3 && activeKnee3.y > activeHip3.y + 0.06) {
      if (!this.kneeNotRaisedSince) {

        this.kneeNotRaisedSince = now;

        this.devCounts.kneeNotRaised = (this.devCounts.kneeNotRaised ?? 0) + 1;

      }
    } else {
      this.kneeNotRaisedSince = 0;
    }
    // TOO FAST — average knee velocity over the last 12 frames > 3.5 norm/s
    // (V2 threshold; circles should be smooth & controlled).
    if (this.kneeVelocities.length >= 12) {
      const recent = this.kneeVelocities.slice(-12);
      const avgVel = recent.reduce((s, v) => s + v, 0) / recent.length;
      if (avgVel > 3.5) {
        if (!this.tooFastSince) {

          this.tooFastSince = now;

          this.devCounts.tooFast = (this.devCounts.tooFast ?? 0) + 1;

        }
      } else {
        this.tooFastSince = 0;
      }
    }

    // Check wrong leg raised
    const activeKneeAboveHip = activeKneeLM.y < activeHip.y - 0.05;
    const otherKneeAboveHip = otherKneeLM.y < otherHip.y - WRONG_LEG_RAISE_THRESHOLD;
    this.wrongLegActive = otherKneeAboveHip && !activeKneeAboveHip;

    if (this.wrongLegActive && this.wrongLegSince === null) {
      this.wrongLegSince = now;
      this.devCounts.wrongLeg = (this.devCounts.wrongLeg ?? 0) + 1;
    } else if (!this.wrongLegActive) {
      this.wrongLegSince = null;
    }

    // EMA smooth active knee
    if (this.smoothedKneePos === null) {
      this.smoothedKneePos = { ...activeKneeLM };
    } else {
      this.smoothedKneePos.x = ema(activeKneeLM.x, this.smoothedKneePos.x, EMA_ALPHA);
      this.smoothedKneePos.y = ema(activeKneeLM.y, this.smoothedKneePos.y, EMA_ALPHA);
      this.smoothedKneePos.z = ema(activeKneeLM.z, this.smoothedKneePos.z, EMA_ALPHA);
    }

    // Circle tracking
    const dx = this.smoothedKneePos.x - activeHip.x;
    const dy = this.smoothedKneePos.y - activeHip.y;
    const currentRadius = Math.sqrt(dx * dx + dy * dy);
    const currentAngle = Math.atan2(dy, dx);

    // Determine dynamic target radius after 10 samples
    if (this.measuredRadii.length < 10) {
      this.measuredRadii.push(currentRadius);
      this.dynamicTargetRadius = this.targetCircleRadius;
    } else if (this.dynamicTargetRadius === 0) {
      this.dynamicTargetRadius = median(this.measuredRadii);
    }

    // ── V2 stillness + circle-size detection ──
    {
      const dxk = this.smoothedKneePos.x - this.lastKneePosX;
      const dyk = this.smoothedKneePos.y - this.lastKneePosY;
      const dKnee = Math.sqrt(dxk * dxk + dyk * dyk);
      if (dKnee < 0.003) {
        if (!this.lastKneeStillSince) {

          this.lastKneeStillSince = now;

          this.devCounts.lastKneeStill = (this.devCounts.lastKneeStill ?? 0) + 1;

        }
      } else {
        this.lastKneeStillSince = 0;
      }
      this.lastKneePosX = this.smoothedKneePos.x;
      this.lastKneePosY = this.smoothedKneePos.y;
      this.noMovementSince = this.lastKneeStillSince;
      // SMALL / BIG circle — measured radius vs target
      if (this.dynamicTargetRadius > 0) {
        const ratio = currentRadius / this.dynamicTargetRadius;
        if (ratio < 0.55) {
          if (!this.smallCircleSince) {

            this.smallCircleSince = now;

            this.devCounts.smallCircle = (this.devCounts.smallCircle ?? 0) + 1;

          }
        } else { this.smallCircleSince = 0; }
        if (ratio > 1.55) {
          if (!this.bigCircleSince) {

            this.bigCircleSince = now;

            this.devCounts.bigCircle = (this.devCounts.bigCircle ?? 0) + 1;

          }
        } else { this.bigCircleSince = 0; }
      }
    }
    // Angle delta with cap
    let angleDelta = 0;
    if (this.currentCircleFrames.length > 0) {
      const prevAngle = this.currentCircleFrames[this.currentCircleFrames.length - 1].angle;
      let delta = currentAngle - prevAngle;
      // Unwrap angle wrapping
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      angleDelta = Math.min(Math.abs(delta), MAX_DELTA_PER_FRAME);
    }

    this.absoluteArcAccum += angleDelta;

    // Quadrant tracking (using corrected reference quadrant mapping)
    const quadrant = this.getQuadrant(currentAngle);
    this.quadrantsVisited.add(quadrant);

    // Form adherence: distance from target radius
    const radiusDiff = Math.abs(currentRadius - this.dynamicTargetRadius);
    const inPath = radiusDiff / this.dynamicTargetRadius <= FORM_ADHERENCE_TOLERANCE;
    if (inPath) this.framesInPath++;
    this.totalFramesInCircle++;

    // Record frame with x,y coordinates
    const frameData: CircleFrame = {
      x: this.smoothedKneePos.x,
      y: this.smoothedKneePos.y,
      angle: currentAngle,
      distance: currentRadius,
      timestamp: now - this.phaseStartTime,
      inPath: inPath,
    };
    this.currentCircleFrames.push(frameData);
    this.phaseAllFrames.push(frameData);

    // Compute Cartesian velocity for smoothness (using x,y deltas, not angular)
    if (this.currentCircleFrames.length > 1) {
      const prev = this.currentCircleFrames[this.currentCircleFrames.length - 2];
      const curr = this.currentCircleFrames[this.currentCircleFrames.length - 1];
      const fdx = curr.x - prev.x;
      const fdy = curr.y - prev.y;
      const dist = Math.sqrt(fdx * fdx + fdy * fdy);
      const dt = (curr.timestamp - prev.timestamp) / 1000;
      if (dt > 0) {
        const vel = dist / dt;
        this.kneeVelocities.push(vel);
      }
    }

    // Check circle complete
    if (this.absoluteArcAccum >= CIRCLE_COMPLETE_RAD && this.quadrantsVisited.size >= 3) {
      this.completeCircle();
    }

    // Update current MQS
    this.updateCurrentMQS();
  }

  /**
   * Map angle to quadrant (0-3) using reference implementation logic
   * Reference: if (angle >= 0 && angle < PI/2) return 0; etc.
   */
  private getQuadrant(angle: number): number {
    if (angle >= 0 && angle < Math.PI / 2) return 0;
    if (angle >= Math.PI / 2) return 1;
    if (angle < -Math.PI / 2) return 2;
    return 3;
  }

  /**
   * Complete current circle: calculate MQS, store, start new
   */
  private completeCircle(): void {
    // Smoothness: 100 - CV*100 (using Cartesian velocities)
    const cv = coefficientOfVariation(this.kneeVelocities);
    const smoothness = Math.max(0, 100 - cv * 100);

    // Form adherence: framesInPath / totalFrames * 100
    const formAdherence = (this.framesInPath / this.totalFramesInCircle) * 100;

    // Completion: 100 (always, circle is complete)
    const completion = 100;

    // MQS
    this.circleMQS = smoothness * 0.35 + formAdherence * 0.4 + completion * 0.25;

    // Store circle and its MQS
    if (this.phase === 1) {
      this.phase1Circles.push([...this.currentCircleFrames]);
      this.phase1CircleMQS.push(this.circleMQS);
      this.completeCirclesL++;
    } else if (this.phase === 2) {
      this.phase2Circles.push([...this.currentCircleFrames]);
      this.phase2CircleMQS.push(this.circleMQS);
      this.completeCirclesR++;
    }

    // Start new circle
    this.startNewCircle();
  }

  /**
   * Reset circle state for next circle (but DO NOT clear phaseAllFrames for fallback MQS)
   */
  private startNewCircle(): void {
    this.currentCircleFrames = [];
    this.kneeVelocities = [];
    this.absoluteArcAccum = 0;
    this.quadrantsVisited = new Set();
    this.measuredRadii = [];
    this.dynamicTargetRadius = 0;
    this.framesInPath = 0;
    this.totalFramesInCircle = 0;
    this.circleMQS = 0;
    // Note: phaseAllFrames is NOT cleared — it accumulates all frames for phase-level fallback MQS
  }

  /**
   * Update current MQS from live metrics
   */
  private updateCurrentMQS(): void {
    if (this.totalFramesInCircle === 0) {
      this.currentMQS = 0;
      return;
    }

    const cv = this.kneeVelocities.length > 0 ? coefficientOfVariation(this.kneeVelocities) : 0;
    const smoothness = Math.max(0, 100 - cv * 100);
    const formAdherence = (this.framesInPath / this.totalFramesInCircle) * 100;
    const completion = Math.min(100, (this.absoluteArcAccum / CIRCLE_COMPLETE_RAD) * 100);

    this.currentMQS = smoothness * 0.35 + formAdherence * 0.4 + completion * 0.25;
  }

  /**
   * Finalize phase: calculate phase MQS from stored per-circle MQS or fallback to all frames
   */
  private finalizePhase(phaseNum: 1 | 2): void {
    const circleMQSArray = phaseNum === 1 ? this.phase1CircleMQS : this.phase2CircleMQS;
    const allFrames = this.phaseAllFrames;

    if (circleMQSArray.length > 0) {
      // Use stored per-circle MQS values
      const mqs = mean(circleMQSArray);
      if (phaseNum === 1) {
        this.phase1MQS = clamp(mqs, 0, 100);
        this.runningMQS_L = this.phase1MQS;
      } else {
        this.phase2MQS = clamp(mqs, 0, 100);
        this.runningMQS_R = this.phase2MQS;
      }
    } else if (allFrames.length > 3) {
      // Fallback: compute from all phase frames (when 0 complete circles)
      const mqs = this.computeFallbackPhaseMQS(allFrames);
      if (phaseNum === 1) {
        this.phase1MQS = clamp(mqs, 0, 100);
        this.runningMQS_L = this.phase1MQS;
      } else {
        this.phase2MQS = clamp(mqs, 0, 100);
        this.runningMQS_R = this.phase2MQS;
      }
    } else {
      // No valid data
      if (phaseNum === 1) {
        this.phase1MQS = 0;
        this.runningMQS_L = 0;
      } else {
        this.phase2MQS = 0;
        this.runningMQS_R = 0;
      }
    }
  }

  /**
   * Fallback MQS computation when no complete circles were achieved
   * Uses all accumulated phase frames with completion=0
   */
  private computeFallbackPhaseMQS(frames: CircleFrame[]): number {
    if (frames.length < 3) return 0;

    // Smoothness: Cartesian velocity-based CV
    const velocities: number[] = [];
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1];
      const curr = frames[i];
      const fdx = curr.x - prev.x;
      const fdy = curr.y - prev.y;
      const dist = Math.sqrt(fdx * fdx + fdy * fdy);
      const dt = (curr.timestamp - prev.timestamp) / 1000;
      if (dt > 0) {
        velocities.push(dist / dt);
      }
    }

    let smoothness = 0;
    if (velocities.length > 0) {
      const cv = coefficientOfVariation(velocities);
      smoothness = Math.max(0, 100 - cv * 100);
    }

    // Form adherence: fraction of frames in-path
    const framesInPath = frames.filter(f => f.inPath).length;
    const formAdherence = (framesInPath / frames.length) * 100;

    // Completion: 0 (no complete circles)
    const completion = 0;

    // Fallback MQS formula per spec: smoothness*0.35 + formAdherence*0.40 + completion*0.25
    const mqs = smoothness * 0.35 + formAdherence * 0.40 + completion * 0.25;
    return clamp(mqs, 0, 100);
  }

  /**
   * Record time series point
   */
  private recordTimeSeries(): void {
    const point: TimeSeriesPoint = {
      timestamp: this.totalElapsed,
      mqs: this.currentMQS,
    };

    if (this.phase === 1) {
      this.timeSeriesL.push(point);
    } else if (this.phase === 2) {
      this.timeSeriesR.push(point);
    }
  }

  /**
   * Called when calibration succeeds
   */
  private onCalibrationSuccess(landmarks: NormalizedLandmark[]): void {
    const lhip = landmarks[LM.LEFT_HIP];
    const rhip = landmarks[LM.RIGHT_HIP];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];

    if (!lhip || !rhip || !ls || !rs) return;

    this.hipCentreL = lhip;
    this.hipCentreR = rhip;

    const hipDistance = distance(lhip, rhip);
    this.targetCircleRadius = (hipDistance * 1.8) / 2;

    this.shoulderMid = {
      x: (ls.x + rs.x) / 2,
      y: (ls.y + rs.y) / 2,
      z: (ls.z + rs.z) / 2,
      visibility: 1,
    };

    this.hipMid = {
      x: (lhip.x + rhip.x) / 2,
      y: (lhip.y + rhip.y) / 2,
      z: (lhip.z + rhip.z) / 2,
      visibility: 1,
    };
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.calReady) return;

    // Draw skeleton
    this.drawSkeleton(ctx, w, h);

    // Draw game overlays only during active phase
    if (this.phaseState === 'active') {
      this.drawGameOverlays(ctx, w, h);
    }

    // Draw transition overlay during transition state
    if (this.phaseState === 'transition') {
      this.drawTransitionOverlay(ctx, w, h);
    }

    // Draw warnings
    this.drawWarnings(ctx, w, h);
  }

  /**
   * Draw 12-joint skeleton with active leg highlight
   */
  private drawSkeleton(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const landmarks = this.getCurrentLandmarks();
    if (!landmarks) return;

    // Draw connections
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    for (const [start, end] of SKELETON_CONNECTIONS) {
      const startLm = landmarks[start];
      const endLm = landmarks[end];
      if (!startLm?.visibility || !endLm?.visibility) continue;

      ctx.beginPath();
      ctx.moveTo(startLm.x * w, startLm.y * h);
      ctx.lineTo(endLm.x * w, endLm.y * h);
      ctx.stroke();
    }

    // Draw joints
    for (const idx of SKELETON_JOINTS) {
      const lm = landmarks[idx];
      if (!lm?.visibility) continue;

      // Highlight active leg (left knee + ankle for phase 1, right for phase 2)
      const isActiveLeg =
        (this.phase === 1 && (idx === LM.LEFT_KNEE || idx === LM.LEFT_ANKLE)) ||
        (this.phase === 2 && (idx === LM.RIGHT_KNEE || idx === LM.RIGHT_ANKLE));

      ctx.fillStyle = isActiveLeg ? '#00E5CC' : '#FFF';
      ctx.fillRect(lm.x * w - 4, lm.y * h - 4, 8, 8);
    }
  }

  /**
   * Draw game-specific overlays: ghost circle, trace, hip dots, direction arrow, bars
   */
  private drawGameOverlays(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.hipCentreL || !this.hipCentreR || !this.smoothedKneePos) return;

    const isPhase1 = this.phase === 1;
    const activeHip = isPhase1 ? this.hipCentreL : this.hipCentreR;

    // Ghost circle: dashed teal — drawn as ELLIPSE because normalized [0,1]
    // space maps to non-square pixel space. With ctx.arc, the "circle" would
    // appear narrow in Y on portrait mobile (h > w). Using ctx.ellipse with
    // both r*w and r*h gives the user a target that matches their actual
    // movement extent. (V2-parity fix 2026-05-15)
    ctx.strokeStyle = '#00E5CC';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.shadowColor = 'rgba(0,229,204,0.55)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(
        activeHip.x * w,
        activeHip.y * h,
        this.dynamicTargetRadius * w,
        this.dynamicTargetRadius * h,
        0, 0, Math.PI * 2,
      );
    } else {
      // Fallback for older browsers
      ctx.arc(activeHip.x * w, activeHip.y * h, this.dynamicTargetRadius * w, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);

    // Centre dot at the active hip joint (V2 parity — anchor visual)
    ctx.beginPath();
    ctx.arc(activeHip.x * w, activeHip.y * h, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00E5CC';
    ctx.fill();

    // Circle trace: draw currentCircleFrames
    if (this.currentCircleFrames.length > 0) {
      for (const frame of this.currentCircleFrames) {
        const posX = activeHip.x + frame.distance * Math.cos(frame.angle);
        const posY = activeHip.y + frame.distance * Math.sin(frame.angle);

        // Check if in path
        const radiusDiff = Math.abs(frame.distance - this.dynamicTargetRadius);
        const inPath = radiusDiff / this.dynamicTargetRadius <= FORM_ADHERENCE_TOLERANCE;

        ctx.fillStyle = inPath ? '#00E5CC' : '#FFB547';
        ctx.fillRect(posX * w - 2, posY * h - 2, 4, 4);
      }
    }

    // Hip dots
    ctx.fillStyle = '#FFF';
    ctx.fillRect(this.hipCentreL.x * w - 3, this.hipCentreL.y * h - 3, 6, 6);
    ctx.fillRect(this.hipCentreR.x * w - 3, this.hipCentreR.y * h - 3, 6, 6);

    // Direction arrow (first 3s of each phase)
    const timeInPhase = this.totalElapsed % (PHASE_DURATION + TRANSITION_DURATION);
    if (timeInPhase < 3) {
      this.drawDirectionArrow(ctx, w, h, isPhase1 ? 'cw' : 'ccw');
    }

    // MQS live bar on right edge
    const barX = w - 20;
    const barY = h / 2 - 50;
    const barH = 100;
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, 15, barH);
    const fillH = (this.currentMQS / 100) * barH;
    ctx.fillStyle = this.currentMQS >= 50 ? '#00E5CC' : this.currentMQS >= 25 ? '#FFB547' : '#FF6B6B';
    ctx.fillRect(barX, barY + barH - fillH, 15, fillH);

    // TCI symmetry bar at bottom
    const liveTCI = 100 - Math.abs(this.runningMQS_L - this.runningMQS_R);
    const tciBarY = h - 30;
    const tciBarW = w - 40;
    ctx.fillStyle = '#333';
    ctx.fillRect(20, tciBarY, tciBarW, 20);
    const tciBarFill = (liveTCI / 100) * tciBarW;
    ctx.fillStyle = '#00E5CC';
    ctx.fillRect(20, tciBarY, tciBarFill, 20);
  }

  /**
   * Draw direction arrow (clockwise or counterclockwise)
   */
  private drawDirectionArrow(ctx: CanvasRenderingContext2D, w: number, h: number, direction: 'cw' | 'ccw'): void {
    if (!this.hipCentreL || !this.hipCentreR) return;

    const isPhase1 = this.phase === 1;
    const activeHip = isPhase1 ? this.hipCentreL : this.hipCentreR;

    const centerX = activeHip.x * w;
    const centerY = activeHip.y * h;
    const radius = this.dynamicTargetRadius * w;

    // Draw curved arrow
    ctx.strokeStyle = '#00E5CC';
    ctx.lineWidth = 3;
    ctx.beginPath();

    const startAngle = direction === 'cw' ? 0 : Math.PI;
    const endAngle = direction === 'cw' ? Math.PI / 2 : -Math.PI / 2;

    ctx.arc(centerX, centerY, radius, startAngle, endAngle, direction === 'ccw');
    ctx.stroke();

    // Arrow head
    const arrowAngle = direction === 'cw' ? Math.PI / 2 : -Math.PI / 2;
    const arrowX = centerX + radius * Math.cos(arrowAngle);
    const arrowY = centerY + radius * Math.sin(arrowAngle);
    const arrowSize = 10;

    ctx.fillStyle = '#00E5CC';
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(arrowX - arrowSize * Math.cos(arrowAngle + 0.5), arrowY - arrowSize * Math.sin(arrowAngle + 0.5));
    ctx.lineTo(arrowX - arrowSize * Math.cos(arrowAngle - 0.5), arrowY - arrowSize * Math.sin(arrowAngle - 0.5));
    ctx.fill();
  }

  /**
   * Draw transition overlay text
   */
  private drawTransitionOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#00E5CC';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Get ready for right leg', w / 2, h / 2);
  }

  /**
   * Draw warning overlays
   */
  private drawWarnings(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const warnings: string[] = [];

    if (this.trunkLeanActive) {
      warnings.push('Keep trunk straight');
    }

    if (this.wrongLegActive) {
      warnings.push('Raise correct leg');
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

  /**
   * Get current landmarks (needed for skeleton draw)
   */
  private getCurrentLandmarks(): NormalizedLandmark[] | null {
    return this.lastLandmarks;
  }

  getHudMetrics(): HudMetrics {
    const phaseLabel = this.phase === 0 ? 'READY' : this.phase === 1 ? 'LEFT LEG' : 'RIGHT LEG';
    const tci = clamp(100 - Math.abs(this.runningMQS_L - this.runningMQS_R), 0, 100);
    const now = performance.now();
    const dirLabel = this.phase === 1 ? 'LEFT' : 'RIGHT';
    let warningSlot1: string | undefined;
    let warningSlot2: string | undefined;
    let instructionText = phaseLabel;
    let instructionColor = '#94a3b8';

    // SLOT 1 (RED, urgent) — wrong_leg > too_far > too_close > no_movement > knee_not_raised > small_circle
    if (this.wrongLegActive) {
      warningSlot1 = `⚠ Raise your ${dirLabel} leg — not the other`;
      this.hipGateMaybeSpeak('wrong_leg', `Raise your ${dirLabel.toLowerCase()} leg`, 4000);
    } else if (this.tooFarSince > 0 && now - this.tooFarSince > 1500) {
      warningSlot1 = '⚠ Move closer to the camera';
      this.hipGateMaybeSpeak('too_far', 'Move closer to the camera', 6000);
    } else if (this.tooCloseSince > 0 && now - this.tooCloseSince > 1500) {
      warningSlot1 = '⚠ Move back — full body must be visible';
      this.hipGateMaybeSpeak('too_close', 'Move back from the camera', 6000);
    } else if (this.phaseState === 'active' && this.lastKneeStillSince > 0 && now - this.lastKneeStillSince > 3000) {
      warningSlot1 = `⚠ Move your ${dirLabel} knee in a circle`;
      this.hipGateMaybeSpeak('no_movement', `Move your ${dirLabel.toLowerCase()} knee in a circle`, 5000);
    } else if (this.smallCircleSince > 0 && now - this.smallCircleSince > 2000) {
      warningSlot1 = '⚠ Make a bigger circle';
      this.hipGateMaybeSpeak('small_circle', 'Make a bigger circle', 5000);
    } else if (this.kneeNotRaisedSince > 0 && now - this.kneeNotRaisedSince > 1500) {
      warningSlot1 = `⚠ Lift your ${dirLabel} knee higher`;
      this.hipGateMaybeSpeak('knee_not_raised', `Lift your ${dirLabel.toLowerCase()} knee higher`, 5000);
    }

    // SLOT 2 (AMBER) — trunk_lean > support_leg_bent > big_circle > too_fast
    if (this.trunkLeanSince > 0 && now - this.trunkLeanSince > 1200) {
      warningSlot2 = '● Keep your trunk straight';
      this.hipGateMaybeSpeak('trunk_lean', 'Keep your trunk straight, do not lean', 6000);
    } else if (this.supportLegBentSince > 0 && now - this.supportLegBentSince > 1500) {
      warningSlot2 = '● Keep support leg straight';
      this.hipGateMaybeSpeak('support_bent', 'Keep your support leg straight', 7000);
    } else if (this.bigCircleSince > 0 && now - this.bigCircleSince > 2000) {
      warningSlot2 = '● Smaller, controlled circles';
      this.hipGateMaybeSpeak('big_circle', 'Make smaller, controlled circles', 7000);
    } else if (this.tooFastSince > 0 && now - this.tooFastSince > 1500) {
      warningSlot2 = '● Slow down — controlled circles';
      this.hipGateMaybeSpeak('too_fast', 'Slow down, make controlled circles', 6000);
    }

    // Positive instruction text
    if (this.phaseState === 'active') {
      if (!warningSlot1) {
        instructionText = `Trace circle with ${dirLabel} knee`;
        instructionColor = '#22c55e';
      } else {
        instructionText = warningSlot1.replace(/^[⚠●]\s*/, '');
        instructionColor = '#FF4D6A';
      }
    }

    return {
      primary: {
        label: this.phase === 1 ? 'MQS (L)' : 'MQS (R)',
        value: Math.round(this.currentMQS),
        color: '#00E5CC',
      },
      secondary: {
        label: 'TCI',
        value: Math.round(tci),
        color: '#FFB547',
      },
      timer: {
        elapsed: Math.round(this.totalElapsed),
        total: 45,
      },
      instruction: phaseLabel,
      instructionText,
      instructionColor,
      extra: {
        label: 'Circles',
        value: this.completeCirclesL + this.completeCirclesR,
      },
      warningSlot1,
      warningSlot2,
      leftAngle: Math.round(this.runningMQS_L),
      rightAngle: Math.round(this.runningMQS_R),
      symmetryIndex: Math.round(100 - tci),
      bigRepChip: this.completeCirclesL + this.completeCirclesR,
    };
  }

  isComplete(): boolean {
    return this.gameComplete;
  }

  getRawData(): Record<string, unknown> {
    const tci = clamp(100 - Math.abs(this.runningMQS_L - this.runningMQS_R), 0, 100);
    const mqsAvg = clamp((this.runningMQS_L + this.runningMQS_R) / 2, 0, 100);

    return {
      testId: 'KS2',
      mqsL: Math.round(this.runningMQS_L),
      mqsR: Math.round(this.runningMQS_R),
      mqsAvg: Math.round(mqsAvg),
      tci: Math.round(tci),
      circlesL: this.completeCirclesL,
      circlesR: this.completeCirclesR,
      totalCircles: this.completeCirclesL + this.completeCirclesR,
      completions: this.completeCirclesL + this.completeCirclesR,
      maxKneeBend: Math.round(this.maxKneeBendForRawData * 10) / 10,
      duration: Math.round(this.totalElapsed),
      deviationCounts: { ...this.devCounts },
      timeSeries: [...this.timeSeriesL, ...this.timeSeriesR],
      timeSeriesL: this.timeSeriesL,
      timeSeriesR: this.timeSeriesR,
    };
  }

  destroy(): void {
    // Cleanup
    this.reset();
  }
}
