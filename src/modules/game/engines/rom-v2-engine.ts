/**
 * ROM v2 Engine — Faithful port of 5 Range of Motion HTML prototypes.
 *
 * FA1: Shoulder Sunrise — bilateral forward arm raise, peak angle + symmetry
 * FA2: Backstitch — spinal reach behind-back, left/right phases, reach percentage
 * FA3: Neck Compass — head rotation left/right phases, ear-span angle
 * FA4: Hip Hinge Arc — trunk flexion with quality index (smoothness + knee)
 * FA5: Windmill Reach — combined trunk rotation + overhead arm elevation
 *
 * Each game implements the GameEngine interface (reset, processCalibration,
 * processFrame, render, getHudMetrics, isComplete, getRawData, destroy).
 *
 * Source of truth: C:\Users\HP\kriya\docs\v2-reference\range_of_motion_new\
 */

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics, type NormalizedLandmark } from './types';
import { speakInstruction } from '@/lib/game/audio-feedback';

// ─── Type Definitions ─────────────────────────────────────────────────────────

export type ROMv2TestId = 'FA1' | 'FA2' | 'FA3' | 'FA4' | 'FA5';

interface TimeSeriesPoint {
  timestamp: number;
  leftAngle?: number;
  rightAngle?: number;
  reachPercent?: number;
  arm?: string;
  trunkAngle?: number;
  armElevation?: number;
  side?: string;
}

// ─── Shared Constants ─────────────────────────────────────────────────────────

const VISIBILITY_THRESHOLD = 0.6;
const CALIBRATION_VIS_THRESHOLD = 0.3;
const CAL_CONFIRM_MS = 2000;
const CAL_BAD_BUFFER_MS = 300;
const CAL_TIMEOUT_MS = 20000;
const CAL_ARM_ANGLE_MAX = 35;
const CAL_BODY_SIZE_MIN = 0.15;
const CAL_SHOULDER_LEVEL_MAX = 0.07;
const CAL_REQUIRED_LMS = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
];

// ─── FA1 Constants (Shoulder Sunrise) ─────────────────────────────────────────

// V2-ported FA1 Shoulder Sunrise constants (2026-05-14)
// Source: rom_V2/range_of_motion_new/shoulder_sunrise/js/activity.js  RR1_THRESHOLDS block
// V2 rationale (2026-05-01): clinical strictness — 150° peak gate ensures genuine overhead reach
const FA1_DURATION_S = 30;
const FA1_EMA_ALPHA = 0.4;
const FA1_REP_RISE = 50;          // V2 REP_RISE_THRESHOLD — both arms > 50° starts rising
const FA1_REP_PARTIAL = 75;       // V2 PARTIAL_THRESHOLD — forward reach (partial rep candidate)
const FA1_REP_HIGH = 150;         // V2 REP_PEAK_THRESHOLD — both arms ≥ 150° = full overhead rep
const FA1_REP_LOW = 35;           // V2 REP_NEUTRAL_THRESHOLD — both arms < 35° = neutral / completed return
const FA1_CONFIRM_FRAMES = 4;     // V2 MIN_OVERHEAD_FRAMES — require 4 consecutive frames (~130ms)
const FA1_OVERHEAD_ELEVATION_MIN = 0.85;  // V2 wrist must reach ≥ 0.85 × trunk-height above shoulder line
const FA1_PEAK_TOLERANCE = 15;
const FA1_LATERAL_DRIFT_MAX = 0.10;
const FA1_ELBOW_RISE_MIN = 0.05;
const FA1_WRONG_WARN_DELAY_MS = 600;

// ─── FA2 Constants (Backstitch) ───────────────────────────────────────────────

const FA2_PHASE_DURATION_S = 30;
const FA2_TRANSITION_S = 5;
const FA2_EMA_ALPHA = 0.30;
const FA2_REP_UP = 32;
const FA2_REP_DOWN = 22;
const FA2_WRIST_SPINE_MAX = 0.35;

// ─── FA3 Constants (Neck Compass) ─────────────────────────────────────────────

const FA3_PHASE_DURATION_S = 15;
const FA3_TRANSITION_S = 5;        // V2-ported 2026-05-14 — manager req (was 3)
const FA3_EMA_ALPHA = 0.55;        // V2-ported 2026-05-14 — responsive smoothing for fast neck turns
const FA3_REP_HIGH = 25;
const FA3_REP_LOW = 15;
const FA3_WRONG_DIR_DELAY_MS = 500;
const FA3_PHYSIO_MAX = 85;         // V2-ported 2026-05-14 — clinical cervical-rotation ceiling
const FA3_NEUTRAL_GATE_ANGLE = 25; // V2-ported 2026-05-14 — raised from 20° to absorb EMA lag

// ─── FA4 Constants (Hip Hinge Arc) ────────────────────────────────────────────

const FA4_DURATION_S = 30;
const FA4_EMA_ALPHA = 0.55;        // V2-ported 2026-05-14 — V2 EMA_ALPHA = 0.55
const FA4_REP_HIGH = 45;            // V2-ported 2026-05-14 — V2 REP_DOWN_THRESHOLD=45° (clinically meaningful hip hinge; was 30°)
const FA4_REP_LOW = 20;             // V2-ported 2026-05-14 — V2 REP_UP_THRESHOLD=20° (must return to near-upright)
const FA4_SAFETY_ANGLE = 120;
const FA4_KNEE_FLEXION_MAX = 22;    // V2-ported 2026-05-14 — V2 KNEE_PAA_GATE_MAX=22° (clinical threshold for compensation; was 30°)
const FA4_PARTIAL_BEND_THRESHOLD = 25; // V2-ported 2026-05-14 — below REP_DOWN but above this → motivation prompt
const FA4_KNEE_WARN_THRESHOLD = 38;    // V2-ported 2026-05-14 — V2 KNEE_WARN_THRESHOLD: amber warning but rep counts
const FA4_KNEE_DISCARD_THRESHOLD = 79; // V2-ported 2026-05-14 — V2 KNEE_DISCARD_THRESHOLD: rep discarded

// ─── FA5 Constants (Windmill Reach) ───────────────────────────────────────────

const FA5_PHASE_DURATION_S = 20;
const FA5_TRANSITION_S = 5;        // V2-ported 2026-05-14 — manager req (was 3)
const FA5_EMA_ALPHA = 0.35;
const FA5_TRA_WEIGHT = 0.45;
const FA5_OAEA_WEIGHT = 0.55;
// V2 multi-gate validation (ported 2026-05-14) — see V2 RR5 block in activity.js for full rationale
const FA5_MIN_TRA_FOR_VALID_REP = 45;    // V2 — TRA must reach ≥45° for rep to count (defeats EMA echo)
const FA5_MIN_OAEA_FOR_VALID_REP = 25;   // V2 — OAEA must reach ≥25° for rep to count
const FA5_OAEA_GATE_MIN_TRA = 50;        // V2 — OAEA only credited when TRA≥50° (rejects fake rotation)
const FA5_MIN_SUSTAINED_TRA_FRAMES = 8;  // V2 — require 8 frames at TRA≥45° (~1.1s at 7fps; defeats single-spike-frame echo)
const FA5_MIN_HIGH_TRA_RATIO = 0.45;     // V2 — ≥45% of rep frames must be high-TRA
const FA5_MIN_VALID_PEAKED_FRAMES = 3;   // V2 — peaked state must hold for ≥3 valid frames (rejects single-spike entries)
const FA5_REP_RETURN_OAEA_MAX = 25;      // V2 — return below this OAEA to complete rep
const FA5_REP_RETURN_TRA_MAX = 20;       // V2 — return below this TRA to complete rep
const FA5_TRA_PHYSIO_MAX = 85;           // V2 — clinical trunk-rotation ceiling
const FA5_OAEA_PHYSIO_MAX = 90;          // V2 — clinical arm-elevation ceiling

// ─── Helper Functions ─────────────────────────────────────────────────────────

/** Compute the unsigned angle (degrees) between vectors shoulder→hip and shoulder→elbow */
function computeArmAngleDeg(
  shoulder: NormalizedLandmark,
  hip: NormalizedLandmark,
  elbow: NormalizedLandmark,
): number {
  const ax = hip.x - shoulder.x;
  const ay = hip.y - shoulder.y;
  const bx = elbow.x - shoulder.x;
  const by = elbow.y - shoulder.y;
  const dot = ax * bx + ay * by;
  const cross = Math.abs(ax * by - ay * bx);
  const deg = Math.atan2(cross, dot) * (180 / Math.PI);
  return Math.max(0, Math.min(180, deg));
}

/** Compute trunk angle: hip-midpoint → shoulder-midpoint relative to vertical */
function computeTrunkAngle(lm: NormalizedLandmark[]): number {
  const ls = lm[LM.LEFT_SHOULDER];
  const rs = lm[LM.RIGHT_SHOULDER];
  const lh = lm[LM.LEFT_HIP];
  const rh = lm[LM.RIGHT_HIP];
  if (!ls || !rs || !lh || !rh) return 0;
  const mx = ((ls.x + rs.x) / 2) - ((lh.x + rh.x) / 2);
  const my = ((ls.y + rs.y) / 2) - ((lh.y + rh.y) / 2);
  // Vertical reference is (0, -1) in screen coords
  const angleDeg = Math.atan2(Math.abs(mx), -my) * (180 / Math.PI);
  return Math.max(0, Math.min(180, angleDeg));
}

/** EMA smoothing helper */
function ema(current: number, prev: number, alpha: number): number {
  return alpha * current + (1 - alpha) * prev;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─── Engine Class ─────────────────────────────────────────────────────────────

export class ROMv2Engine implements GameEngine {
  private testId: ROMv2TestId;

  /** Per-deviation activation counters (transition 0 → now triggers ++). */
  private devCounts: Record<string, number> = {};

  // ── Calibration state ──
  private calGoodStart = 0;
  private calBadStart = 0;
  private calStartTime = 0;
  private calReady = false;

  // ── Shared game state ──
  private startTime = 0;
  private elapsed = 0;
  private gameComplete = false;
  private timeSeries: TimeSeriesPoint[] = [];
  private lastRecordTime = 0;
  private lastCountdownSpoken = -1;

  // ── FA1 State (Shoulder Sunrise) ──
  private fa1SmoothedLeft = 0;
  private fa1SmoothedRight = 0;
  // V2 shoulder-arc rendering — cache latest shoulder positions per frame.
  private fa1LastLeftShoulderX = 0;
  private fa1LastLeftShoulderY = 0;
  private fa1LastRightShoulderX = 0;
  private fa1LastRightShoulderY = 0;
  private fa1PeakAngleLeftForArc = 0;
  private fa1PeakAngleRightForArc = 0;
  // V2 per-frame deviation detection (ported 2026-05-14)
  private fa1TooFarSince = 0;
  private fa1TooCloseSince = 0;
  private fa1IdleSince = 0;
  private fa1TrunkLeanSince = 0;
  private fa1WristOffFrameSince = 0;
  private fa1LastWarningKey = '';
  private fa1LastWarningAt = 0;
  private fa1Reps = 0;
  private fa1LeftAboveThreshold = false;
  private fa1WrongMovementActive = false;
  private fa1WrongMovementSince: number | null = null;
  // Peak confirmation
  private fa1CandidateLeft = 0;
  private fa1CandidateRight = 0;
  private fa1ConfirmCountLeft = 0;
  private fa1ConfirmCountRight = 0;
  private fa1ConfirmedPeakLeft = 0;
  private fa1ConfirmedPeakRight = 0;
  // Per-rep drift tracking
  private fa1LeftRepMaxXDrift = 0;
  private fa1RightRepMaxXDrift = 0;
  private fa1LeftRepMinZDiff = 99;
  private fa1RightRepMinZDiff = 99;
  private fa1LeftEnteredClean = false;
  private fa1RightEnteredClean = false;

  // ── FA2 State (Backstitch) ──
  private fa2Phase: 'left' | 'transition' | 'right' = 'left';
  private fa2PhaseStartTime = 0;
  private fa2SmoothedReach = 0;
  private fa2PeakLeft = 0;
  private fa2PeakRight = 0;
  private fa2RepsLeft = 0;
  private fa2RepsRight = 0;
  private fa2RepState: 'down' | 'up' = 'down';
  private fa2CalRef = {
    spineTopY: 0, spineBottomY: 0, spineLength: 0, spineMidX: 0,
  };

  // ── FA3 State (Neck Compass) ──
  private fa3Phase: 'left' | 'transition' | 'right' = 'left';
  private fa3PhaseStartTime = 0;
  private fa3SmoothedAngle = 0;
  private fa3PeakLeft = 0;
  private fa3PeakRight = 0;
  private fa3RepsLeft = 0;
  private fa3RepsRight = 0;
  private fa3RepState: 'center' | 'turned' = 'center';
  private fa3BaselineEarSpan = 0;
  private fa3WrongDirSince: number | null = null;
  private fa3WrongDirActive = false;
  // V2 deviation catalog (ported 2026-05-15)
  private fa3ShoulderRotationSince = 0;
  private fa3HeadTiltSince = 0;
  private fa3BodyLeanSince = 0;
  private fa3IdleSince = 0;
  private fa3PartialMoveSince = 0;
  private fa3LastWarningKey = '';
  private fa3LastWarningAt = 0;
  private fa3BaselineShoulderTilt = 0;
  private fa3LastNoseX = 0.5;
  private fa3LastNoseY = 0.3;

  // ── FA4 State (Hip Hinge Arc) ──
  private fa4SmoothedTrunk = 0;
  private fa4LastHipX = 0;          // last hip-midpoint X in normalized [0,1] (for arc anchoring)
  private fa4LastHipY = 0;          // last hip-midpoint Y in normalized [0,1]
  private fa4FacingSide: 'left' | 'right' = 'left'; // which side is closer to camera
  private fa4PeakAngle = 0;
  private fa4Reps = 0;
  private fa4RepState: 'standing' | 'bent' = 'standing';
  private fa4SmoothnessSum = 0;
  private fa4SmoothnessCount = 0;
  private fa4PrevTrunk = 0;
  private fa4MaxKneeFlexion = 0;
  private fa4SafetyTriggered = false;
  // V2 deviation catalog (ported 2026-05-15)
  private fa4OverextendSince = 0;
  private fa4KneeBentSince = 0;
  private fa4LateralShiftSince = 0;
  private fa4IdleSince = 0;
  private fa4PartialBendSince = 0;
  private fa4TooCloseSince = 0;
  private fa4TooFarSince = 0;
  private fa4LastWarningKey = '';
  private fa4LastWarningAt = 0;
  private fa4ProfileLostSince = 0;

  // ── FA5 State (Windmill Reach) ──
  private fa5Phase: 'left' | 'transition' | 'right' = 'left';
  private fa5PhaseStartTime = 0;
  private fa5SmoothedTRA = 0;
  private fa5SmoothedOAEA = 0;
  private fa5PeakCRSLeft = 0;
  private fa5PeakCRSRight = 0;
  private fa5PeakTRALeft = 0;
  private fa5PeakTRARight = 0;
  private fa5PeakOAEALeft = 0;
  private fa5PeakOAEARight = 0;
  private fa5Reps = 0;
  private fa5RepState: 'center' | 'rotated' = 'center';
  private fa5BaselineShoulderSpan = 0;
  // V2 multi-gate per-rep tracking (ported 2026-05-14)
  private fa5ValidPeakedFrames = 0;   // count of valid frames while in 'rotated'
  private fa5ValidHighTRAFrames = 0;  // frames where smoothedTRA >= FA5_MIN_TRA_FOR_VALID_REP
  private fa5MaxOAEAPeaked = 0;       // peak OAEA seen during current 'rotated' span
  private fa5MaxTRAPeaked = 0;        // peak TRA seen during current 'rotated' span
  private fa5RepsDiscarded = 0;       // diagnostic: count of reps rejected by gates
  // V2 deviation catalog (ported 2026-05-15)
  private fa5WrongDirSince = 0;
  private fa5FootPivotSince = 0;
  private fa5BothArmsSince = 0;
  private fa5LateralTiltSince = 0;
  private fa5TooFarSince = 0;
  private fa5TooCloseSince = 0;
  private fa5IdleSince = 0;
  private fa5ReachMoreSince = 0;
  private fa5LastWarningKey = '';
  private fa5LastWarningAt = 0;
  private fa5LastHipMidX = 0.5;
  private fa5LastHipMidY = 0.6;
  private fa5LastShoulderMidX = 0.5;
  private fa5LastShoulderMidY = 0.4;

  // ── Instruction text state ──
  private instructionText = '';
  private instructionColor = '#22c55e';

  constructor(testId: ROMv2TestId) {
    this.testId = testId;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GameEngine Interface
  // ═══════════════════════════════════════════════════════════════════════════

  reset(): void {
    this.devCounts = {};
    this.calGoodStart = 0;
    this.calBadStart = 0;
    this.calStartTime = 0;
    this.calReady = false;
    this.startTime = 0;
    this.elapsed = 0;
    this.gameComplete = false;
    this.timeSeries = [];
    this.lastRecordTime = 0;
    this.lastCountdownSpoken = -1;
    this.instructionText = '';
    this.instructionColor = '#22c55e';
    this.resetFA1();
    this.resetFA2();
    this.resetFA3();
    this.resetFA4();
    this.resetFA5();
  }

  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) {
      return { isReady: true, progress: 1, message: 'Ready!', fullBodyVisible: true, armsAtSides: true, standingStraight: true };
    }

    const now = performance.now();
    if (this.calStartTime === 0) this.calStartTime = now;

    // Timeout check
    if (now - this.calStartTime > CAL_TIMEOUT_MS) {
      return { isReady: false, progress: 0, message: 'Calibration timed out — tap to retry' };
    }

    const result = this.checkCalibrationPosture(landmarks);
    // V2-parity calibration checks are surfaced to the layer via the
    // CalibrationStatus extra fields below (fullBodyVisible / armsAtSides /
    // standingStraight) so the UI can render the 3-pill checklist.
    if (result.pass) {
      this.calBadStart = 0;
      if (this.calGoodStart === 0) this.calGoodStart = now;
      const held = now - this.calGoodStart;
      const progress = Math.min(1, held / CAL_CONFIRM_MS);

      if (held >= CAL_CONFIRM_MS) {
        this.calReady = true;
        this.startTime = performance.now();
        this.onCalibrationSuccess(landmarks);
        return { isReady: true, progress: 1, message: 'Ready!', fullBodyVisible: true, armsAtSides: true, standingStraight: true };
      }
      return { isReady: false, progress, message: 'Hold still...' };
    }

    // Bad posture
    if (this.calBadStart === 0) this.calBadStart = now;
    if (now - this.calBadStart > CAL_BAD_BUFFER_MS) {
      this.calGoodStart = 0;
    }
    return { isReady: false, progress: 0, message: result.message, fullBodyVisible: result.fullBodyVisible, armsAtSides: result.armsAtSides, standingStraight: result.standingStraight };
  }

  /**
   * Reset timers for the start of active gameplay.
   * Call this AFTER the countdown finishes, just before the first processFrame.
   * Prevents the countdown period from consuming game time.
   */
  startPlaying(): void {
    const now = performance.now();
    this.startTime = now;
    this.elapsed = 0;

    // Also reset phase start times for phased games (FA2, FA3, FA5)
    switch (this.testId) {
      case 'FA2': this.fa2PhaseStartTime = now; break;
      case 'FA3': this.fa3PhaseStartTime = now; break;
      case 'FA5': this.fa5PhaseStartTime = now; break;
    }
  }

  processFrame(landmarks: NormalizedLandmark[], timestampMs: number): void {
    if (!this.calReady || this.gameComplete) return;

    const now = performance.now();
    this.elapsed = (now - this.startTime) / 1000;

    switch (this.testId) {
      case 'FA1': this.processFA1(landmarks, now); break;
      case 'FA2': this.processFA2(landmarks, now); break;
      case 'FA3': this.processFA3(landmarks, now); break;
      case 'FA4': this.processFA4(landmarks, now); break;
      case 'FA5': this.processFA5(landmarks, now); break;
    }

    // Record time series
    if (now - this.lastRecordTime >= 100) {
      this.recordTimeSeries();
      this.lastRecordTime = now;
    }

    // Check timer completion
    this.checkCompletion();
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    switch (this.testId) {
      case 'FA1': this.renderFA1(ctx, w, h); break;
      case 'FA2': this.renderFA2(ctx, w, h); break;
      case 'FA3': this.renderFA3(ctx, w, h); break;
      case 'FA4': this.renderFA4(ctx, w, h); break;
      case 'FA5': this.renderFA5(ctx, w, h); break;
    }
  }

  getHudMetrics(): HudMetrics {
    switch (this.testId) {
      case 'FA1': return this.getFA1Hud();
      case 'FA2': return this.getFA2Hud();
      case 'FA3': return this.getFA3Hud();
      case 'FA4': return this.getFA4Hud();
      case 'FA5': return this.getFA5Hud();
      default: return {};
    }
  }

  isComplete(): boolean {
    return this.gameComplete;
  }

  getRawData(): Record<string, unknown> {
    switch (this.testId) {
      case 'FA1': return this.getFA1RawData();
      case 'FA2': return this.getFA2RawData();
      case 'FA3': return this.getFA3RawData();
      case 'FA4': return this.getFA4RawData();
      case 'FA5': return this.getFA5RawData();
      default: return { testId: this.testId };
    }
  }

  destroy(): void {
    // No timers to clean — frame-driven
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Shared Calibration
  // ═══════════════════════════════════════════════════════════════════════════

  private checkCalibrationPosture(lm: NormalizedLandmark[]): {
    pass: boolean;
    message: string;
    fullBodyVisible: boolean;
    armsAtSides: boolean;
    standingStraight: boolean;
  } {
    // ── V2-parity 3-check breakdown (each renders as a left-side pill in the
    // calibration UI). All three must pass for calibration to advance. ──

    // CHECK 1 — Full upper body visible (Gates A + C combined)
    let fullBodyVisible = true;
    for (const idx of CAL_REQUIRED_LMS) {
      const p = lm[idx];
      if (!p || (p.visibility ?? 0) < CALIBRATION_VIS_THRESHOLD) {
        fullBodyVisible = false;
        break;
      }
      if (p.x < 0.05 || p.x > 0.95 || p.y < 0.05 || p.y > 0.95) {
        fullBodyVisible = false;
        break;
      }
    }
    const avgSY = lm[LM.LEFT_SHOULDER] && lm[LM.RIGHT_SHOULDER]
      ? (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2
      : 0;
    const avgHY = lm[LM.LEFT_HIP] && lm[LM.RIGHT_HIP]
      ? (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2
      : 0;
    if (Math.abs(avgHY - avgSY) < CAL_BODY_SIZE_MIN) {
      fullBodyVisible = false;
    }

    // CHECK 2 — Arms at sides (Gate B)
    // Game-aware: FA5 expects T-pose (arms out at 90°), so we DISABLE this check
    // for FA5. Other tests still require arms relaxed to baseline.
    let armsAtSides = true;
    const expectsTPose = this.testId === 'FA5';
    if (!expectsTPose) {
      if (lm[LM.LEFT_SHOULDER] && lm[LM.LEFT_HIP] && lm[LM.LEFT_ELBOW]
          && lm[LM.RIGHT_SHOULDER] && lm[LM.RIGHT_HIP] && lm[LM.RIGHT_ELBOW]) {
        const leftAngle = computeArmAngleDeg(lm[LM.LEFT_SHOULDER], lm[LM.LEFT_HIP], lm[LM.LEFT_ELBOW]);
        const rightAngle = computeArmAngleDeg(lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_HIP], lm[LM.RIGHT_ELBOW]);
        armsAtSides = leftAngle < CAL_ARM_ANGLE_MAX && rightAngle < CAL_ARM_ANGLE_MAX;
      } else {
        armsAtSides = false;
      }
    }

    // CHECK 3 — Standing straight (Gate D — shoulders level OR side-profile)
    // Game-aware: FA4 expects 90° side profile, so we accept EITHER level
    // shoulders OR a confirmed side profile (compressed shoulder X-span vs hip,
    // or shoulder Z-depth diff).
    let standingStraight = true;
    const expectsSideProfile = this.testId === 'FA4';
    if (lm[LM.LEFT_SHOULDER] && lm[LM.RIGHT_SHOULDER]) {
      const shoulderYDiff = Math.abs(lm[LM.LEFT_SHOULDER].y - lm[LM.RIGHT_SHOULDER].y);
      const shoulderLevel = shoulderYDiff <= CAL_SHOULDER_LEVEL_MAX;
      if (expectsSideProfile && lm[LM.LEFT_HIP] && lm[LM.RIGHT_HIP]) {
        const shoulderSpan = Math.abs(lm[LM.LEFT_SHOULDER].x - lm[LM.RIGHT_SHOULDER].x);
        const hipSpan = Math.abs(lm[LM.LEFT_HIP].x - lm[LM.RIGHT_HIP].x);
        const spanRatio = hipSpan > 0 ? shoulderSpan / hipSpan : 1;
        const zDiff = Math.abs((lm[LM.LEFT_SHOULDER].z ?? 0) - (lm[LM.RIGHT_SHOULDER].z ?? 0));
        const sideProfile = spanRatio < 0.55 || zDiff > 0.15;
        // For FA4, EITHER side profile OR shoulders-level counts as good posture
        standingStraight = sideProfile || shoulderLevel;
      } else {
        standingStraight = shoulderLevel;
      }
    } else {
      standingStraight = false;
    }

    const pass = fullBodyVisible && armsAtSides && standingStraight;
    const message = !fullBodyVisible
      ? 'Make sure your full upper body is visible'
      : !armsAtSides
      ? 'Lower your arms to your sides'
      : !standingStraight
      ? (expectsSideProfile ? 'Turn 90° — show your full side profile' : 'Level your shoulders')
      : 'Hold still...';
    return { pass, message, fullBodyVisible, armsAtSides, standingStraight };
  }

  private onCalibrationSuccess(lm: NormalizedLandmark[]): void {
    // Set game phase start
    switch (this.testId) {
      case 'FA2': {
        const lsy = lm[LM.LEFT_SHOULDER].y;
        const rsy = lm[LM.RIGHT_SHOULDER].y;
        const lhy = lm[LM.LEFT_HIP].y;
        const rhy = lm[LM.RIGHT_HIP].y;
        const spineTopY = (lsy + rsy) / 2;
        let spineBottomY = (lhy + rhy) / 2;
        let spineLength = spineBottomY - spineTopY;
        // Extend range for front camera compensation
        spineBottomY += spineLength * 0.15;
        const adjustedTop = spineTopY - spineLength * 0.10;
        spineLength = spineBottomY - adjustedTop;
        const spineMidX = (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x +
          lm[LM.LEFT_HIP].x + lm[LM.RIGHT_HIP].x) / 4;
        this.fa2CalRef = { spineTopY: adjustedTop, spineBottomY, spineLength, spineMidX };
        this.fa2PhaseStartTime = performance.now();
        break;
      }
      case 'FA3': {
        // Baseline ear span for rotation measurement
        const le = lm[LM.LEFT_EAR];
        const re = lm[LM.RIGHT_EAR];
        if (le && re && (le.visibility ?? 0) > 0.3 && (re.visibility ?? 0) > 0.3) {
          this.fa3BaselineEarSpan = Math.abs(le.x - re.x);
        } else {
          this.fa3BaselineEarSpan = 0.12; // Fallback
        }
        this.fa3PhaseStartTime = performance.now();
        break;
      }
      case 'FA5': {
        this.fa5BaselineShoulderSpan = Math.abs(lm[LM.LEFT_SHOULDER].x - lm[LM.RIGHT_SHOULDER].x);
        this.fa5PhaseStartTime = performance.now();
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Timer + Completion
  // ═══════════════════════════════════════════════════════════════════════════

  private getTotalDuration(): number {
    switch (this.testId) {
      case 'FA1': return FA1_DURATION_S;
      case 'FA2': return FA2_PHASE_DURATION_S * 2 + FA2_TRANSITION_S;
      case 'FA3': return FA3_PHASE_DURATION_S * 2 + FA3_TRANSITION_S;
      case 'FA4': return FA4_DURATION_S;
      case 'FA5': return FA5_PHASE_DURATION_S * 2 + FA5_TRANSITION_S;
      default: return 30;
    }
  }

  private checkCompletion(): void {
    if (this.elapsed >= this.getTotalDuration() && !this.gameComplete) {
      this.gameComplete = true;
    }
    // FA4 safety check
    if (this.testId === 'FA4' && this.fa4SafetyTriggered && !this.gameComplete) {
      this.gameComplete = true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FA1: Shoulder Sunrise
  // ═══════════════════════════════════════════════════════════════════════════

  private resetFA1(): void {
    this.fa1SmoothedLeft = 0;
    this.fa1SmoothedRight = 0;
    this.fa1Reps = 0;
    this.fa1LastLeftShoulderX = 0;
    this.fa1LastLeftShoulderY = 0;
    this.fa1LastRightShoulderX = 0;
    this.fa1LastRightShoulderY = 0;
    this.fa1PeakAngleLeftForArc = 0;
    this.fa1PeakAngleRightForArc = 0;
    this.fa1TooFarSince = 0;
    this.fa1TooCloseSince = 0;
    this.fa1IdleSince = 0;
    this.fa1TrunkLeanSince = 0;
    this.fa1WristOffFrameSince = 0;
    this.fa1LastWarningKey = '';
    this.fa1LastWarningAt = 0;
    this.fa1LeftAboveThreshold = false;
    this.fa1WrongMovementActive = false;
    this.fa1WrongMovementSince = null;
    this.fa1CandidateLeft = 0;
    this.fa1CandidateRight = 0;
    this.fa1ConfirmCountLeft = 0;
    this.fa1ConfirmCountRight = 0;
    this.fa1ConfirmedPeakLeft = 0;
    this.fa1ConfirmedPeakRight = 0;
    this.fa1LeftRepMaxXDrift = 0;
    this.fa1RightRepMaxXDrift = 0;
    this.fa1LeftRepMinZDiff = 99;
    this.fa1RightRepMinZDiff = 99;
    this.fa1LeftEnteredClean = false;
    this.fa1RightEnteredClean = false;
  }

  /** Validate forward raise vs sideways raise */
  private isForwardRaise(shoulder: NormalizedLandmark, elbow: NormalizedLandmark, angle: number): boolean {
    const xAligned = Math.abs(elbow.x - shoulder.x) < FA1_LATERAL_DRIFT_MAX;
    const elbowRising = angle < 55 || (elbow.y < shoulder.y - FA1_ELBOW_RISE_MIN);
    const forwardDepth = angle < 55 || (shoulder.z - elbow.z > 0.04);
    return xAligned && elbowRising && forwardDepth;
  }

  private processFA1(lm: NormalizedLandmark[], now: number): void {
    // Check visibility
    const checks = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ELBOW, LM.RIGHT_ELBOW];
    const allVisible = checks.every(idx => lm[idx] && (lm[idx].visibility ?? 0) > VISIBILITY_THRESHOLD);

    if (!allVisible) return;

    // V2 parity — cache shoulder positions for the per-arm arc renderer.
    const _ls = lm[LM.LEFT_SHOULDER];
    const _rs = lm[LM.RIGHT_SHOULDER];
    if (_ls && _rs) {
      this.fa1LastLeftShoulderX = _ls.x;
      this.fa1LastLeftShoulderY = _ls.y;
      this.fa1LastRightShoulderX = _rs.x;
      this.fa1LastRightShoulderY = _rs.y;
    }
    this.fa1PeakAngleLeftForArc = Math.max(this.fa1PeakAngleLeftForArc, this.fa1SmoothedLeft);
    this.fa1PeakAngleRightForArc = Math.max(this.fa1PeakAngleRightForArc, this.fa1SmoothedRight);

    // ── V2 per-frame deviation detection (ported 2026-05-14) ──
    // Trunk height = vertical distance between shoulder midpoint and hip midpoint
    // in normalised landmark space. V2 threshold: <0.18 too far, >0.45 too close.
    const _shoulderY = (_ls.y + _rs.y) / 2;
    const _lh = lm[LM.LEFT_HIP];
    const _rh = lm[LM.RIGHT_HIP];
    if (_lh && _rh) {
      const _hipY = (_lh.y + _rh.y) / 2;
      const trunkHeight = Math.abs(_hipY - _shoulderY);
      const now = performance.now();
      // TOO FAR (trunk small in frame) — V2 1.5s sustained threshold
      if (trunkHeight < 0.18) {
        if (!this.fa1TooFarSince) {

          this.fa1TooFarSince = now;

          this.devCounts.fa1TooFar = (this.devCounts.fa1TooFar ?? 0) + 1;

        }
      } else {
        this.fa1TooFarSince = 0;
      }
      // TOO CLOSE
      if (trunkHeight > 0.45) {
        if (!this.fa1TooCloseSince) {

          this.fa1TooCloseSince = now;

          this.devCounts.fa1TooClose = (this.devCounts.fa1TooClose ?? 0) + 1;

        }
      } else {
        this.fa1TooCloseSince = 0;
      }
      // TRUNK LEAN — shoulder midpoint vs hip midpoint lateral offset
      const _shoulderX = (_ls.x + _rs.x) / 2;
      const _hipX = (_lh.x + _rh.x) / 2;
      if (Math.abs(_shoulderX - _hipX) > 0.06) {
        if (!this.fa1TrunkLeanSince) {

          this.fa1TrunkLeanSince = now;

          this.devCounts.fa1TrunkLean = (this.devCounts.fa1TrunkLean ?? 0) + 1;

        }
      } else {
        this.fa1TrunkLeanSince = 0;
      }
      // IDLE — both arms still near 0° for 5+ seconds = no movement detected
      if (this.fa1SmoothedLeft < 15 && this.fa1SmoothedRight < 15) {
        if (!this.fa1IdleSince) {

          this.fa1IdleSince = now;

          this.devCounts.fa1Idle = (this.devCounts.fa1Idle ?? 0) + 1;

        }
      } else {
        this.fa1IdleSince = 0;
      }
      // WRIST OFF FRAME — either wrist clipped vertical edges of frame
      const _lw = lm[LM.LEFT_WRIST];
      const _rw = lm[LM.RIGHT_WRIST];
      const wristClipped =
        (_lw && (_lw.y < 0.04 || _lw.y > 0.96)) ||
        (_rw && (_rw.y < 0.04 || _rw.y > 0.96));
      if (wristClipped) {
        if (!this.fa1WristOffFrameSince) {

          this.fa1WristOffFrameSince = now;

          this.devCounts.fa1WristOffFrame = (this.devCounts.fa1WristOffFrame ?? 0) + 1;

        }
      } else {
        this.fa1WristOffFrameSince = 0;
      }
    }

    const leftValid = this.isForwardRaise(lm[LM.LEFT_SHOULDER], lm[LM.LEFT_ELBOW], this.fa1SmoothedLeft);
    const rightValid = this.isForwardRaise(lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_ELBOW], this.fa1SmoothedRight);

    // Update smoothed angles
    if (leftValid) {
      const raw = computeArmAngleDeg(lm[LM.LEFT_SHOULDER], lm[LM.LEFT_HIP], lm[LM.LEFT_ELBOW]);
      this.fa1SmoothedLeft = ema(raw, this.fa1SmoothedLeft, FA1_EMA_ALPHA);
    } else {
      this.fa1SmoothedLeft = 0;
    }

    if (rightValid) {
      const raw = computeArmAngleDeg(lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_HIP], lm[LM.RIGHT_ELBOW]);
      this.fa1SmoothedRight = ema(raw, this.fa1SmoothedRight, FA1_EMA_ALPHA);
    } else {
      this.fa1SmoothedRight = 0;
    }

    this.fa1SmoothedLeft = clamp(this.fa1SmoothedLeft, 0, 180);
    this.fa1SmoothedRight = clamp(this.fa1SmoothedRight, 0, 180);

    // Peak confirmation
    if (leftValid) this.updatePeakConfirmation('left');
    if (rightValid) this.updatePeakConfirmation('right');

    // Rep detection with accumulated drift tracking
    if (!this.fa1LeftAboveThreshold &&
        this.fa1SmoothedLeft > FA1_REP_HIGH && this.fa1SmoothedRight > FA1_REP_HIGH) {
      this.fa1LeftAboveThreshold = true;
      this.fa1LeftRepMaxXDrift = 0;
      this.fa1RightRepMaxXDrift = 0;
      this.fa1LeftRepMinZDiff = 99;
      this.fa1RightRepMinZDiff = 99;
      this.fa1LeftEnteredClean = this.isForwardRaise(lm[LM.LEFT_SHOULDER], lm[LM.LEFT_ELBOW], this.fa1SmoothedLeft);
      this.fa1RightEnteredClean = this.isForwardRaise(lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_ELBOW], this.fa1SmoothedRight);
    }

    if (this.fa1LeftAboveThreshold) {
      this.fa1LeftRepMaxXDrift = Math.max(this.fa1LeftRepMaxXDrift, Math.abs(lm[LM.LEFT_ELBOW].x - lm[LM.LEFT_SHOULDER].x));
      this.fa1LeftRepMinZDiff = Math.min(this.fa1LeftRepMinZDiff, lm[LM.LEFT_SHOULDER].z - lm[LM.LEFT_ELBOW].z);
      this.fa1RightRepMaxXDrift = Math.max(this.fa1RightRepMaxXDrift, Math.abs(lm[LM.RIGHT_ELBOW].x - lm[LM.RIGHT_SHOULDER].x));
      this.fa1RightRepMinZDiff = Math.min(this.fa1RightRepMinZDiff, lm[LM.RIGHT_SHOULDER].z - lm[LM.RIGHT_ELBOW].z);
    }

    if (this.fa1LeftAboveThreshold &&
        this.fa1SmoothedLeft < FA1_REP_LOW && this.fa1SmoothedRight < FA1_REP_LOW) {
      this.fa1LeftAboveThreshold = false;
      const leftClean = this.fa1LeftEnteredClean && this.fa1LeftRepMaxXDrift < 0.10 && this.fa1LeftRepMinZDiff > 0.03;
      const rightClean = this.fa1RightEnteredClean && this.fa1RightRepMaxXDrift < 0.10 && this.fa1RightRepMinZDiff > 0.03;
      if (leftClean && rightClean) {
        this.fa1Reps++;
      }
      this.fa1LeftRepMaxXDrift = 0;
      this.fa1RightRepMaxXDrift = 0;
      this.fa1LeftRepMinZDiff = 99;
      this.fa1RightRepMinZDiff = 99;
    }

    // Wrong movement warning
    const eitherArmWrong = (!leftValid || !rightValid) && (this.fa1SmoothedLeft > 50 || this.fa1SmoothedRight > 50);
    if (eitherArmWrong) {
      if (!this.fa1WrongMovementSince) {

        this.fa1WrongMovementSince = now;

        this.devCounts.fa1WrongMovement = (this.devCounts.fa1WrongMovement ?? 0) + 1;

      }
      this.fa1WrongMovementActive = now - this.fa1WrongMovementSince > FA1_WRONG_WARN_DELAY_MS;
    } else {
      this.fa1WrongMovementSince = null;
      this.fa1WrongMovementActive = false;
    }

    // Instruction text
    const avgAngle = (this.fa1SmoothedLeft + this.fa1SmoothedRight) / 2;
    if (this.fa1WrongMovementActive) {
      this.instructionText = 'Raise arms FORWARD — not sideways';
      this.instructionColor = '#FFB547';
    } else if (avgAngle > FA1_REP_HIGH) {
      this.instructionText = 'GREAT! Hold at the top';
      this.instructionColor = '#22c55e';
    } else if (avgAngle > 30) {
      this.instructionText = 'Keep raising!';
      this.instructionColor = '#3b82f6';
    } else {
      this.instructionText = 'Raise both arms forward slowly';
      this.instructionColor = '#94a3b8';
    }
  }

  private updatePeakConfirmation(side: 'left' | 'right'): void {
    const smoothed = side === 'left' ? this.fa1SmoothedLeft : this.fa1SmoothedRight;
    let candidate = side === 'left' ? this.fa1CandidateLeft : this.fa1CandidateRight;
    let count = side === 'left' ? this.fa1ConfirmCountLeft : this.fa1ConfirmCountRight;
    let confirmed = side === 'left' ? this.fa1ConfirmedPeakLeft : this.fa1ConfirmedPeakRight;

    if (smoothed > candidate) {
      candidate = smoothed;
      count = 1;
    } else if (smoothed >= candidate - FA1_PEAK_TOLERANCE) {
      count++;
    } else {
      candidate = smoothed;
      count = 1;
    }

    if (count >= FA1_CONFIRM_FRAMES) {
      confirmed = Math.max(confirmed, candidate);
    }

    if (side === 'left') {
      this.fa1CandidateLeft = candidate;
      this.fa1ConfirmCountLeft = count;
      this.fa1ConfirmedPeakLeft = confirmed;
    } else {
      this.fa1CandidateRight = candidate;
      this.fa1ConfirmCountRight = count;
      this.fa1ConfirmedPeakRight = confirmed;
    }
  }

  private renderFA1(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // V2 shoulder arcs (ported 2026-05-14) — one arc per shoulder showing
    // current arm angle. Fill teal, peak marker amber, angle text label.
    // The game-layer mirrors the canvas, so we mirror X back to draw at the
    // user's actual shoulders, and counter-flip for text.
    const drawShoulderArc = (
      shoulderX: number,
      shoulderY: number,
      angleDeg: number,
      peakDeg: number,
    ): void => {
      if (shoulderX <= 0 || shoulderY <= 0) return;
      const cx = (1 - shoulderX) * w;
      const cy = shoulderY * h;
      const radius = 50;
      const angleRad = (angleDeg * Math.PI) / 180;
      const peakRad = (peakDeg * Math.PI) / 180;

      // Background reference arc (0..180° fan)
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI / 2, Math.PI / 2 + Math.PI, false);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Current-angle filled wedge
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, Math.PI / 2, Math.PI / 2 + angleRad, false);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,229,204,0.28)';
      ctx.fill();

      // Current-angle outline
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI / 2, Math.PI / 2 + angleRad, false);
      ctx.strokeStyle = '#00E5CC';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Peak marker — amber dashed line
      if (peakDeg > 5) {
        const peakAng = Math.PI / 2 + peakRad;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#FFB547';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(peakAng) * radius, cy + Math.sin(peakAng) * radius);
        ctx.stroke();
        ctx.restore();
      }

      // Angle text above shoulder (counter-flip so it reads correctly)
      ctx.save();
      ctx.scale(-1, 1);
      ctx.font = 'bold 14px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#00E5CC';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(angleDeg)}°`, -cx, cy - radius - 8);
      ctx.restore();
    };

    drawShoulderArc(this.fa1LastLeftShoulderX, this.fa1LastLeftShoulderY, this.fa1SmoothedLeft, this.fa1PeakAngleLeftForArc);
    drawShoulderArc(this.fa1LastRightShoulderX, this.fa1LastRightShoulderY, this.fa1SmoothedRight, this.fa1PeakAngleRightForArc);

    // Wrong movement warning banner (counter-flip for mirrored canvas)
    if (this.fa1WrongMovementActive) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-w, 0);
      const text = '\u26A0 Raise arms FORWARD — not sideways';
      ctx.font = 'bold 16px sans-serif';
      const textW = ctx.measureText(text).width;
      const boxW = textW + 40;
      const boxH = 40;
      const boxX = (w - boxW) / 2;
      const boxY = h * 0.08;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 10);
      ctx.fill();
      ctx.strokeStyle = '#FFB547';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#FFB547';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, boxY + boxH / 2);
      ctx.restore();
    }

    // Reps are now shown in the HTML HUD (secondary metric) — no canvas drawing needed
  }

  private calculateFA1SI(): number {
    const avg = (this.fa1ConfirmedPeakLeft + this.fa1ConfirmedPeakRight) / 2;
    if (avg <= 0) return 0;
    return (Math.abs(this.fa1ConfirmedPeakLeft - this.fa1ConfirmedPeakRight) / avg) * 100;
  }

  /**
   * V2-parity per-key throttled speech. Each warning key has its own cooldown;
   * the global 2.5s cooldown inside speakInstruction handles overlapping
   * messages across keys.
   */
  private fa1MaybeSpeak(key: string, text: string, cooldownMs: number): void {
    const now = performance.now();
    if (this.fa1LastWarningKey === key && now - this.fa1LastWarningAt < cooldownMs) return;
    // Only update per-key cooldown when speech actually fires — otherwise
    // a dropped second-slot warning ghost-silences itself for cooldownMs.
    const spoke = speakInstruction(text);
    if (spoke) {
      this.fa1LastWarningKey = key;
      this.fa1LastWarningAt = now;
    }
  }

  private getFA1Hud(): HudMetrics {
    const si = this.calculateFA1SI();
    // ── V2 dual-slot warning derivation (per-frame, sustained thresholds) ──
    let warningSlot1: string | undefined;
    let warningSlot2: string | undefined;
    let warningSlot1Color: string | undefined;
    let warningSlot2Color: string | undefined;
    const avgAngle = (this.fa1SmoothedLeft + this.fa1SmoothedRight) / 2;
    const now = performance.now();

    // SLOT 1 (RED) — priority: too far > too close > sideways > idle > arms not symmetric
    if (this.fa1TooFarSince > 0 && now - this.fa1TooFarSince > 1500) {
      warningSlot1 = '⚠ Move closer to the camera';
      warningSlot1Color = '#FF4D6A';
      this.fa1MaybeSpeak('too_far', 'Move closer to the camera', 6000);
    } else if (this.fa1TooCloseSince > 0 && now - this.fa1TooCloseSince > 1500) {
      warningSlot1 = '⚠ Move back from the camera — full body must be visible';
      warningSlot1Color = '#FF4D6A';
      this.fa1MaybeSpeak('too_close', 'Move back from the camera', 6000);
    } else if (this.fa1WrongMovementActive) {
      warningSlot1 = '⚠ Raise arms FORWARD — not sideways';
      warningSlot1Color = '#FF4D6A';
      this.fa1MaybeSpeak('sideways', 'Raise your arms forward and up, not sideways', 5000);
    } else if (this.fa1IdleSince > 0 && now - this.fa1IdleSince > 5000) {
      warningSlot1 = '⚠ Raise both arms forward and overhead';
      warningSlot1Color = '#FF4D6A';
      this.fa1MaybeSpeak('idle', 'Raise both arms up overhead and back down', 6000);
    } else if (avgAngle > 50 && avgAngle < FA1_REP_HIGH) {
      warningSlot1 = '⚠ Lift both elbows higher';
      warningSlot1Color = '#FF4D6A';
      this.fa1MaybeSpeak('elbow_low', 'Lift both elbows higher', 4000);
    }

    // SLOT 2 (AMBER) — priority: wrist off-frame > trunk lean > asymmetric arms
    if (this.fa1WristOffFrameSince > 0 && now - this.fa1WristOffFrameSince > 500) {
      warningSlot2 = '● Step back — keep hands visible';
      warningSlot2Color = '#FFB547';
      this.fa1MaybeSpeak('wrist_off', 'Step back so your hands stay in view', 5000);
    } else if (this.fa1TrunkLeanSince > 0 && now - this.fa1TrunkLeanSince > 800) {
      warningSlot2 = '● Stand tall — keep your body upright';
      warningSlot2Color = '#FFB547';
      this.fa1MaybeSpeak('trunk_lean', 'Stand tall, keep your body upright', 7000);
    } else if (Math.abs(this.fa1SmoothedLeft - this.fa1SmoothedRight) > 25 && avgAngle > 40) {
      warningSlot2 = '● Both arms should rise together';
      warningSlot2Color = '#FFB547';
      this.fa1MaybeSpeak('asym_arms', 'Raise both arms together', 5000);
    }
    // SYMMETRY bar position 0..1 (0.5 = perfectly symmetric)
    const peakAvg = (this.fa1ConfirmedPeakLeft + this.fa1ConfirmedPeakRight) / 2;
    const symmetryPos = peakAvg > 0
      ? 0.5 + (this.fa1ConfirmedPeakRight - this.fa1ConfirmedPeakLeft) / (2 * peakAvg)
      : 0.5;
    // MQS fill 0..100 — derived from avg peak / 180 (V2 uses similar normalisation)
    const mqsFillPct = Math.min(100, (peakAvg / 180) * 100);

    return {
      primary: { label: 'L', value: `${Math.round(this.fa1SmoothedLeft)}°`, color: '#00E5CC' },
      secondary: { label: 'Reps', value: this.fa1Reps },
      timer: { elapsed: Math.floor(this.elapsed), total: FA1_DURATION_S },
      timerLabel: '',
      instructionText: this.instructionText,
      instructionColor: this.instructionColor,
      reps: this.fa1Reps,
      wrongMovement: this.fa1WrongMovementActive,
      leftAngle: Math.round(this.fa1SmoothedLeft),
      rightAngle: Math.round(this.fa1SmoothedRight),
      symmetryIndex: Math.round(si),
      symmetryColor: si > 20 ? '#FFB547' : '#22c55e',
      bigRepChip: this.fa1Reps,
      warningSlot1,
      warningSlot1Color,
      warningSlot2,
      warningSlot2Color,
      symmetryPos: Math.max(0, Math.min(1, symmetryPos)),
      mqsFillPct: Math.round(mqsFillPct),
    };
  }

  private getFA1RawData(): Record<string, unknown> {
    const paaAvg = (this.fa1ConfirmedPeakLeft + this.fa1ConfirmedPeakRight) / 2;
    const si = this.calculateFA1SI();
    return {
      testId: 'FA1',
      peakLeft: Math.round(this.fa1ConfirmedPeakLeft * 10) / 10,
      peakRight: Math.round(this.fa1ConfirmedPeakRight * 10) / 10,
      paaAverage: Math.round(paaAvg * 10) / 10,
      symmetryIndex: Math.round(si * 10) / 10,
      reps: this.fa1Reps,
      elapsed: Math.floor(this.elapsed),
      deviationCounts: { ...this.devCounts },
      timeSeries: this.timeSeries,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FA2: Backstitch
  // ═══════════════════════════════════════════════════════════════════════════

  private resetFA2(): void {
    this.fa2Phase = 'left';
    this.fa2PhaseStartTime = 0;
    this.fa2SmoothedReach = 0;
    this.fa2PeakLeft = 0;
    this.fa2PeakRight = 0;
    this.fa2RepsLeft = 0;
    this.fa2RepsRight = 0;
    this.fa2RepState = 'down';
    this.fa2CalRef = { spineTopY: 0, spineBottomY: 0, spineLength: 0, spineMidX: 0 };
  }

  private processFA2(lm: NormalizedLandmark[], now: number): void {
    const phaseElapsed = (now - this.fa2PhaseStartTime) / 1000;

    // Phase transitions
    if (this.fa2Phase === 'left' && phaseElapsed >= FA2_PHASE_DURATION_S) {
      this.fa2Phase = 'transition';
      this.fa2PhaseStartTime = now;
      this.fa2SmoothedReach = 0;
      this.fa2RepState = 'down';
      this.instructionText = 'Switch to your right arm';
      this.instructionColor = '#3b82f6';
      return;
    }
    if (this.fa2Phase === 'transition' && phaseElapsed >= FA2_TRANSITION_S) {
      this.fa2Phase = 'right';
      this.fa2PhaseStartTime = now;
      this.fa2SmoothedReach = 0;
      this.fa2RepState = 'down';
    }

    if (this.fa2Phase === 'transition') return;

    // Compute reach percentage
    const wristIdx = this.fa2Phase === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
    const wrist = lm[wristIdx];
    if (!wrist || (wrist.visibility ?? 0) < 0.25) {
      // Decay when invisible
      this.fa2SmoothedReach *= this.fa2SmoothedReach > 15 ? 0.97 : 0.90;
      return;
    }

    const distFromSpine = Math.abs(wrist.x - this.fa2CalRef.spineMidX);
    if (distFromSpine >= FA2_WRIST_SPINE_MAX) return;

    const reachFraction = clamp((this.fa2CalRef.spineBottomY - wrist.y) / this.fa2CalRef.spineLength, 0, 1);
    const rawReach = reachFraction * 100;

    // Asymmetric EMA
    const riseAlpha = 0.60;
    const fallAlpha = 0.35;
    const alpha = rawReach > this.fa2SmoothedReach ? riseAlpha : fallAlpha;
    this.fa2SmoothedReach = ema(rawReach, this.fa2SmoothedReach, alpha);

    // Peak tracking
    if (this.fa2Phase === 'left') {
      this.fa2PeakLeft = Math.max(this.fa2PeakLeft, this.fa2SmoothedReach);
    } else {
      this.fa2PeakRight = Math.max(this.fa2PeakRight, this.fa2SmoothedReach);
    }

    // Rep counting
    if (this.fa2RepState === 'down' && this.fa2SmoothedReach > FA2_REP_UP) {
      this.fa2RepState = 'up';
    } else if (this.fa2RepState === 'up' && this.fa2SmoothedReach < FA2_REP_DOWN) {
      this.fa2RepState = 'down';
      if (this.fa2Phase === 'left') this.fa2RepsLeft++;
      else this.fa2RepsRight++;
    }

    this.instructionText = this.fa2Phase === 'left'
      ? `Left arm — reach behind your back`
      : `Right arm — reach behind your back`;
    this.instructionColor = '#00E5CC';
  }

  private renderFA2(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Reach percentage bar on side
    const barW = 20;
    const barH = h * 0.5;
    const barX = w - barW - 15;
    const barY = h * 0.25;
    const fillH = (this.fa2SmoothedReach / 100) * barH;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-w, 0);
    const drawBarX = w - barX - barW;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(drawBarX, barY, barW, barH, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,229,204,0.6)';
    ctx.fillRect(drawBarX, barY + barH - fillH, barW, fillH);
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#00E5CC';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(this.fa2SmoothedReach)}%`, drawBarX + barW / 2, barY - 8);
    ctx.restore();
  }

  private getFA2Hud(): HudMetrics {
    const totalDuration = FA2_PHASE_DURATION_S * 2 + FA2_TRANSITION_S;
    const phaseName = this.fa2Phase === 'left' ? 'Left Arm'
      : this.fa2Phase === 'transition' ? 'Switch!'
      : 'Right Arm';
    return {
      primary: { label: 'Reach', value: `${Math.round(this.fa2SmoothedReach)}%`, color: '#00E5CC' },
      secondary: { label: 'Reps', value: this.fa2Phase === 'left' ? this.fa2RepsLeft : this.fa2RepsRight },
      timer: { elapsed: Math.floor(this.elapsed), total: totalDuration },
      timerLabel: phaseName,
      instructionText: this.instructionText,
      instructionColor: this.instructionColor,
    };
  }

  private getFA2RawData(): Record<string, unknown> {
    const paaAvg = (this.fa2PeakLeft + this.fa2PeakRight) / 2;
    const si = paaAvg > 0 ? (Math.abs(this.fa2PeakLeft - this.fa2PeakRight) / paaAvg) * 100 : 0;
    return {
      testId: 'FA2',
      peakLeft: Math.round(this.fa2PeakLeft * 10) / 10,
      peakRight: Math.round(this.fa2PeakRight * 10) / 10,
      paaAverage: Math.round(paaAvg * 10) / 10,
      symmetryIndex: Math.round(si * 10) / 10,
      repsLeft: this.fa2RepsLeft,
      repsRight: this.fa2RepsRight,
      elapsed: Math.floor(this.elapsed),
      timeSeries: this.timeSeries,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FA3: Neck Compass
  // ═══════════════════════════════════════════════════════════════════════════

  private resetFA3(): void {
    this.fa3Phase = 'left';
    this.fa3PhaseStartTime = 0;
    this.fa3SmoothedAngle = 0;
    this.fa3PeakLeft = 0;
    this.fa3PeakRight = 0;
    this.fa3RepsLeft = 0;
    this.fa3RepsRight = 0;
    this.fa3RepState = 'center';
    this.fa3BaselineEarSpan = 0;
    this.fa3WrongDirSince = null;
    this.fa3WrongDirActive = false;
    this.fa3ShoulderRotationSince = 0;
    this.fa3HeadTiltSince = 0;
    this.fa3BodyLeanSince = 0;
    this.fa3IdleSince = 0;
    this.fa3PartialMoveSince = 0;
    this.fa3LastWarningKey = '';
    this.fa3LastWarningAt = 0;
    this.fa3BaselineShoulderTilt = 0;
    this.fa3LastNoseX = 0.5;
    this.fa3LastNoseY = 0.3;
  }

  /** V2-parity per-key throttled speech for FA3 deviations */
  private fa3MaybeSpeak(key: string, text: string, cooldownMs: number): void {
    const now = performance.now();
    if (this.fa3LastWarningKey === key && now - this.fa3LastWarningAt < cooldownMs) return;
    // Only update per-key cooldown when speech actually fires — otherwise
    // a dropped second-slot warning ghost-silences itself for cooldownMs.
    const spoke = speakInstruction(text);
    if (spoke) {
      this.fa3LastWarningKey = key;
      this.fa3LastWarningAt = now;
    }
  }

  private processFA3(lm: NormalizedLandmark[], now: number): void {
    const phaseElapsed = (now - this.fa3PhaseStartTime) / 1000;

    if (this.fa3Phase === 'left' && phaseElapsed >= FA3_PHASE_DURATION_S) {
      this.fa3Phase = 'transition';
      this.fa3PhaseStartTime = now;
      this.fa3SmoothedAngle = 0;
      this.fa3RepState = 'center';
      this.instructionText = 'Now turn to the RIGHT';
      this.instructionColor = '#3b82f6';
      return;
    }
    if (this.fa3Phase === 'transition' && phaseElapsed >= FA3_TRANSITION_S) {
      this.fa3Phase = 'right';
      this.fa3PhaseStartTime = now;
      this.fa3SmoothedAngle = 0;
      this.fa3RepState = 'center';
    }

    if (this.fa3Phase === 'transition') return;

    // ── V2 deviation detection (ported 2026-05-15) ──
    const _ls = lm[LM.LEFT_SHOULDER];
    const _rs = lm[LM.RIGHT_SHOULDER];
    const _lh = lm[LM.LEFT_HIP];
    const _rh = lm[LM.RIGHT_HIP];
    if (_ls && _rs && _lh && _rh) {
      // SHOULDER ROTATION — shoulders should remain square. Compare current Z-diff to baseline.
      const shoulderZDiff = Math.abs((_ls.z ?? 0) - (_rs.z ?? 0));
      if (shoulderZDiff > 0.12) {
        if (!this.fa3ShoulderRotationSince) {

          this.fa3ShoulderRotationSince = now;

          this.devCounts.fa3ShoulderRotation = (this.devCounts.fa3ShoulderRotation ?? 0) + 1;

        }
      } else {
        this.fa3ShoulderRotationSince = 0;
      }
      // HEAD TILT — measured via EAR Y-diff (not shoulder, which only tells
      // us about trunk tilt). Real head tilt = chin/eyes tipping sideways,
      // observable as the ear Y values diverging from each other.
      const _le = lm[LM.LEFT_EAR];
      const _re = lm[LM.RIGHT_EAR];
      if (_le && _re && (_le.visibility ?? 0) > 0.3 && (_re.visibility ?? 0) > 0.3) {
        const earYDiff = Math.abs(_le.y - _re.y);
        if (earYDiff > 0.04) {
          if (!this.fa3HeadTiltSince) {

            this.fa3HeadTiltSince = now;

            this.devCounts.fa3HeadTilt = (this.devCounts.fa3HeadTilt ?? 0) + 1;

          }
        } else {
          this.fa3HeadTiltSince = 0;
        }
      } else {
        this.fa3HeadTiltSince = 0;
      }
      // BODY LEAN — shoulder-midpoint vs hip-midpoint lateral offset
      const _shoulderMidX = (_ls.x + _rs.x) / 2;
      const _hipMidX = (_lh.x + _rh.x) / 2;
      if (Math.abs(_shoulderMidX - _hipMidX) > 0.06) {
        if (!this.fa3BodyLeanSince) {

          this.fa3BodyLeanSince = now;

          this.devCounts.fa3BodyLean = (this.devCounts.fa3BodyLean ?? 0) + 1;

        }
      } else {
        this.fa3BodyLeanSince = 0;
      }
      // IDLE — angle stays near 0 for sustained period
      if (this.fa3SmoothedAngle < 10) {
        if (!this.fa3IdleSince) {

          this.fa3IdleSince = now;

          this.devCounts.fa3Idle = (this.devCounts.fa3Idle ?? 0) + 1;

        }
      } else {
        this.fa3IdleSince = 0;
      }
      // PARTIAL MOVE — angle plateaus between 10° and REP_HIGH
      if (this.fa3SmoothedAngle > 10 && this.fa3SmoothedAngle < FA3_REP_HIGH - 5) {
        if (!this.fa3PartialMoveSince) {

          this.fa3PartialMoveSince = now;

          this.devCounts.fa3PartialMove = (this.devCounts.fa3PartialMove ?? 0) + 1;

        }
      } else {
        this.fa3PartialMoveSince = 0;
      }
    }

    // Compute rotation angle from ear span
    const nose = lm[LM.NOSE];
    const le = lm[LM.LEFT_EAR];
    const re = lm[LM.RIGHT_EAR];
    if (!nose || !le || !re) return;
    if ((nose.visibility ?? 0) < 0.3) return;

    const earSpan = Math.abs(le.x - re.x);
    this.fa3LastNoseX = nose.x;
    this.fa3LastNoseY = nose.y;
    if (this.fa3BaselineEarSpan <= 0) return;

    // Rotation reduces the apparent ear span
    const ratio = clamp(earSpan / this.fa3BaselineEarSpan, 0, 1);
    const rawAngle = Math.acos(ratio) * (180 / Math.PI);

    // Determine direction from nose relative to ear midpoint
    const earMidX = (le.x + re.x) / 2;
    const leftTurn = nose.x > earMidX; // In mirrored view
    const correctDirection = (this.fa3Phase === 'left' && leftTurn) || (this.fa3Phase === 'right' && !leftTurn);

    const effectiveAngle = correctDirection ? rawAngle : 0;
    this.fa3SmoothedAngle = ema(effectiveAngle, this.fa3SmoothedAngle, FA3_EMA_ALPHA);

    // Wrong direction detection
    if (!correctDirection && rawAngle > 10) {
      if (!this.fa3WrongDirSince) {

        this.fa3WrongDirSince = now;

        this.devCounts.fa3WrongDir = (this.devCounts.fa3WrongDir ?? 0) + 1;

      }
      this.fa3WrongDirActive = now - this.fa3WrongDirSince > FA3_WRONG_DIR_DELAY_MS;
    } else {
      this.fa3WrongDirSince = null;
      this.fa3WrongDirActive = false;
    }

    // Peak tracking
    if (this.fa3Phase === 'left') {
      this.fa3PeakLeft = Math.max(this.fa3PeakLeft, this.fa3SmoothedAngle);
    } else {
      this.fa3PeakRight = Math.max(this.fa3PeakRight, this.fa3SmoothedAngle);
    }

    // Rep counting
    if (this.fa3RepState === 'center' && this.fa3SmoothedAngle > FA3_REP_HIGH) {
      this.fa3RepState = 'turned';
    } else if (this.fa3RepState === 'turned' && this.fa3SmoothedAngle < FA3_REP_LOW) {
      this.fa3RepState = 'center';
      if (this.fa3Phase === 'left') this.fa3RepsLeft++;
      else this.fa3RepsRight++;
    }

    // Instruction
    const dirLabel = this.fa3Phase === 'left' ? 'LEFT' : 'RIGHT';
    if (this.fa3WrongDirActive) {
      this.instructionText = `Turn ${dirLabel} — not the other way`;
      this.instructionColor = '#FFB547';
    } else if (this.fa3SmoothedAngle > FA3_REP_HIGH) {
      this.instructionText = `Great! Return to center`;
      this.instructionColor = '#22c55e';
    } else {
      this.instructionText = `Turn your head ${dirLabel}`;
      this.instructionColor = '#94a3b8';
    }
  }

  private renderFA3(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // V2-parity compass arc rendered at nose landmark + direction indicator arrow
    {
      {
        const cx = (1 - this.fa3LastNoseX) * w;
        const cy = this.fa3LastNoseY * h;
        const radius = 60;
        const peakLeft = this.fa3PeakLeft;
        const peakRight = this.fa3PeakRight;
        const livePeak = this.fa3Phase === 'left' ? peakLeft : peakRight;
        const liveColor = this.fa3Phase === 'left' ? '#00E5CC' : '#FF6B9D';
        // Background arc — full range -85° to +85° around nose
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, Math.PI * 1.25, Math.PI * 1.75);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 4;
        ctx.stroke();
        // Live angle arc
        if (this.fa3SmoothedAngle > 0) {
          const sweep = Math.min(this.fa3SmoothedAngle / FA3_PHYSIO_MAX, 1) * (Math.PI * 0.5);
          const startA = this.fa3Phase === 'left' ? Math.PI * 1.5 - sweep : Math.PI * 1.5;
          const endA = this.fa3Phase === 'left' ? Math.PI * 1.5 : Math.PI * 1.5 + sweep;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, startA, endA);
          ctx.strokeStyle = liveColor;
          ctx.lineWidth = 6;
          ctx.shadowColor = liveColor;
          ctx.shadowBlur = 8;
          ctx.stroke();
        }
        // Peak markers (left & right)
        ctx.shadowBlur = 0;
        ctx.lineWidth = 3;
        if (peakLeft > 5) {
          const a = Math.PI * 1.5 - Math.min(peakLeft / FA3_PHYSIO_MAX, 1) * (Math.PI * 0.5);
          const px = cx + radius * Math.cos(a);
          const py = cy + radius * Math.sin(a);
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#00E5CC';
          ctx.fill();
        }
        if (peakRight > 5) {
          const a = Math.PI * 1.5 + Math.min(peakRight / FA3_PHYSIO_MAX, 1) * (Math.PI * 0.5);
          const px = cx + radius * Math.cos(a);
          const py = cy + radius * Math.sin(a);
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#FF6B9D';
          ctx.fill();
        }
        ctx.restore();
      }
    }
    // Direction indicator arrow (counter-flip text)
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-w, 0);
    const arrowY = h * 0.15;
    const arrowX = this.fa3Phase === 'left' ? w * 0.2 : w * 0.8;
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = '#00E5CC';
    ctx.textAlign = 'center';
    ctx.fillText(this.fa3Phase === 'left' ? '\u2190' : '\u2192', arrowX, arrowY);
    ctx.restore();
  }

  private getFA3Hud(): HudMetrics {
    const totalDuration = FA3_PHASE_DURATION_S * 2 + FA3_TRANSITION_S;
    const phaseName = this.fa3Phase === 'left' ? 'Turn Left'
      : this.fa3Phase === 'transition' ? 'Switch!'
      : 'Turn Right';
    const now = performance.now();
    let warningSlot1: string | undefined;
    let warningSlot2: string | undefined;
    const dirLabel = this.fa3Phase === 'left' ? 'LEFT' : 'RIGHT';

    // SLOT 1 (RED) — priority: wrong direction > shoulder rotation > idle
    if (this.fa3WrongDirActive) {
      warningSlot1 = `⚠ Turn ${dirLabel} — not the other way`;
      this.fa3MaybeSpeak('wrong_dir', `Turn your head to the ${dirLabel.toLowerCase()}`, 5000);
    } else if (this.fa3ShoulderRotationSince > 0 && now - this.fa3ShoulderRotationSince > 1500) {
      warningSlot1 = '⚠ Keep your shoulders square — only turn your head';
      this.fa3MaybeSpeak('shoulder_rotation', 'Keep your shoulders square, only turn your head', 7000);
    } else if (this.fa3IdleSince > 0 && now - this.fa3IdleSince > 5000) {
      warningSlot1 = `⚠ Turn your head ${dirLabel}`;
      this.fa3MaybeSpeak('idle', `Turn your head to the ${dirLabel.toLowerCase()}`, 6000);
    } else if (this.fa3PartialMoveSince > 0 && now - this.fa3PartialMoveSince > 2500) {
      warningSlot1 = '⚠ Turn further — chin over your shoulder';
      this.fa3MaybeSpeak('partial_move', 'Turn further, try to look over your shoulder', 5000);
    }

    // SLOT 2 (AMBER) — priority: head tilt > body lean
    if (this.fa3HeadTiltSince > 0 && now - this.fa3HeadTiltSince > 1200) {
      warningSlot2 = '● Keep your head level — no tilting';
      this.fa3MaybeSpeak('head_tilt', 'Keep your head level, do not tilt', 6000);
    } else if (this.fa3BodyLeanSince > 0 && now - this.fa3BodyLeanSince > 1200) {
      warningSlot2 = '● Stand tall — body upright';
      this.fa3MaybeSpeak('body_lean', 'Stand tall, body upright', 7000);
    }

    const peakAvg = (this.fa3PeakLeft + this.fa3PeakRight) / 2;
    const si = peakAvg > 0 ? (Math.abs(this.fa3PeakLeft - this.fa3PeakRight) / peakAvg) * 100 : 0;

    return {
      primary: { label: 'Angle', value: `${Math.round(this.fa3SmoothedAngle)}°`, color: '#00E5CC' },
      secondary: { label: 'Reps', value: this.fa3Phase === 'left' ? this.fa3RepsLeft : this.fa3RepsRight },
      timer: { elapsed: Math.floor(this.elapsed), total: totalDuration },
      timerLabel: phaseName,
      instructionText: this.instructionText,
      instructionColor: this.instructionColor,
      wrongDirection: this.fa3WrongDirActive,
      warningSlot1,
      warningSlot2,
      leftAngle: Math.round(this.fa3PeakLeft),
      rightAngle: Math.round(this.fa3PeakRight),
      symmetryIndex: Math.round(si),
      bigRepChip: this.fa3RepsLeft + this.fa3RepsRight,
    };
  }

  private getFA3RawData(): Record<string, unknown> {
    const paaAvg = (this.fa3PeakLeft + this.fa3PeakRight) / 2;
    const si = paaAvg > 0 ? (Math.abs(this.fa3PeakLeft - this.fa3PeakRight) / paaAvg) * 100 : 0;
    return {
      testId: 'FA3',
      peakLeft: Math.round(this.fa3PeakLeft * 10) / 10,
      peakRight: Math.round(this.fa3PeakRight * 10) / 10,
      paaAverage: Math.round(paaAvg * 10) / 10,
      symmetryIndex: Math.round(si * 10) / 10,
      repsLeft: this.fa3RepsLeft,
      repsRight: this.fa3RepsRight,
      elapsed: Math.floor(this.elapsed),
      deviationCounts: { ...this.devCounts },
      timeSeries: this.timeSeries,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FA4: Hip Hinge Arc
  // ═══════════════════════════════════════════════════════════════════════════

  private resetFA4(): void {
    this.fa4SmoothedTrunk = 0;
    this.fa4PeakAngle = 0;
    this.fa4Reps = 0;
    this.fa4RepState = 'standing';
    this.fa4SmoothnessSum = 0;
    this.fa4SmoothnessCount = 0;
    this.fa4PrevTrunk = 0;
    this.fa4MaxKneeFlexion = 0;
    this.fa4SafetyTriggered = false;
    this.fa4OverextendSince = 0;
    this.fa4KneeBentSince = 0;
    this.fa4LateralShiftSince = 0;
    this.fa4IdleSince = 0;
    this.fa4PartialBendSince = 0;
    this.fa4TooCloseSince = 0;
    this.fa4TooFarSince = 0;
    this.fa4LastWarningKey = '';
    this.fa4LastWarningAt = 0;
    this.fa4ProfileLostSince = 0;
  }

  /** V2-parity per-key throttled speech for FA4 deviations */
  private fa4MaybeSpeak(key: string, text: string, cooldownMs: number): void {
    const now = performance.now();
    if (this.fa4LastWarningKey === key && now - this.fa4LastWarningAt < cooldownMs) return;
    // Only update per-key cooldown when speech actually fires — otherwise
    // a dropped second-slot warning ghost-silences itself for cooldownMs.
    const spoke = speakInstruction(text);
    if (spoke) {
      this.fa4LastWarningKey = key;
      this.fa4LastWarningAt = now;
    }
  }

  private processFA4(lm: NormalizedLandmark[], _now: number): void {
    // V2-parity (2026-05-14): cache hip midpoint each frame so renderFA4 can
    // anchor the trunk-angle arc at the actual hip joint (V2 spec) instead of
    // the screen centre.
    const _lh = lm[LM.LEFT_HIP];
    const _rh = lm[LM.RIGHT_HIP];
    if (_lh && _rh) {
      this.fa4LastHipX = (_lh.x + _rh.x) / 2;
      this.fa4LastHipY = (_lh.y + _rh.y) / 2;
      // Auto-detect facing side: whichever shoulder has higher z (closer to camera)
      // determines the side. We don't always have z, so fall back to visibility.
      const ls = lm[LM.LEFT_SHOULDER];
      const rs = lm[LM.RIGHT_SHOULDER];
      if (ls && rs) {
        const lvis = ls.visibility ?? 0;
        const rvis = rs.visibility ?? 0;
        this.fa4FacingSide = lvis >= rvis ? 'left' : 'right';
      }
    }
    const rawTrunk = computeTrunkAngle(lm);
    this.fa4SmoothedTrunk = ema(rawTrunk, this.fa4SmoothedTrunk, FA4_EMA_ALPHA);

    // ── V2 deviation detection (ported 2026-05-15) ──
    const now = performance.now();
    const _ls = lm[LM.LEFT_SHOULDER];
    const _rs = lm[LM.RIGHT_SHOULDER];
    if (_lh && _rh && _ls && _rs) {
      // TOO FAR / TOO CLOSE — trunk vertical extent
      const _shoulderY = (_ls.y + _rs.y) / 2;
      const _hipY = (_lh.y + _rh.y) / 2;
      const trunkHeight = Math.abs(_hipY - _shoulderY);
      if (trunkHeight < 0.18) {
        if (!this.fa4TooFarSince) {

          this.fa4TooFarSince = now;

          this.devCounts.fa4TooFar = (this.devCounts.fa4TooFar ?? 0) + 1;

        }
      } else {
        this.fa4TooFarSince = 0;
      }
      if (trunkHeight > 0.45) {
        if (!this.fa4TooCloseSince) {

          this.fa4TooCloseSince = now;

          this.devCounts.fa4TooClose = (this.devCounts.fa4TooClose ?? 0) + 1;

        }
      } else {
        this.fa4TooCloseSince = 0;
      }
      // LATERAL SHIFT — hip midpoint vs ankle midpoint lateral offset
      const _la2 = lm[LM.LEFT_ANKLE];
      const _ra2 = lm[LM.RIGHT_ANKLE];
      if (_la2 && _ra2) {
        const _hipMidX = (_lh.x + _rh.x) / 2;
        const _ankleMidX = (_la2.x + _ra2.x) / 2;
        if (Math.abs(_hipMidX - _ankleMidX) > 0.07) {
          if (!this.fa4LateralShiftSince) {

            this.fa4LateralShiftSince = now;

            this.devCounts.fa4LateralShift = (this.devCounts.fa4LateralShift ?? 0) + 1;

          }
        } else {
          this.fa4LateralShiftSince = 0;
        }
      }
      // SIDE PROFILE CHECK — user turned to face camera (loses 90° profile)
      const shoulderSpan = Math.abs(_ls.x - _rs.x);
      const hipSpan = Math.abs(_lh.x - _rh.x);
      const spanRatio = hipSpan > 0 ? shoulderSpan / hipSpan : 1;
      const zDiff = Math.abs((_ls.z ?? 0) - (_rs.z ?? 0));
      const profileLost = spanRatio > 0.6 && zDiff < 0.12;
      if (profileLost) {
        if (!this.fa4ProfileLostSince) {

          this.fa4ProfileLostSince = now;

          this.devCounts.fa4ProfileLost = (this.devCounts.fa4ProfileLost ?? 0) + 1;

        }
      } else {
        this.fa4ProfileLostSince = 0;
      }
    }
    // OVEREXTEND — trunk angle past safety threshold (warn before safetyTriggered)
    if (this.fa4SmoothedTrunk > 95 && this.fa4SmoothedTrunk < FA4_SAFETY_ANGLE) {
      if (!this.fa4OverextendSince) {

        this.fa4OverextendSince = now;

        this.devCounts.fa4Overextend = (this.devCounts.fa4Overextend ?? 0) + 1;

      }
    } else {
      this.fa4OverextendSince = 0;
    }
    // KNEE BENT — knee flexion above warn threshold
    if (this.fa4MaxKneeFlexion > FA4_KNEE_WARN_THRESHOLD) {
      if (!this.fa4KneeBentSince) {

        this.fa4KneeBentSince = now;

        this.devCounts.fa4KneeBent = (this.devCounts.fa4KneeBent ?? 0) + 1;

      }
    } else {
      this.fa4KneeBentSince = 0;
    }
    // IDLE — trunk angle stays near 0
    if (this.fa4SmoothedTrunk < 8) {
      if (!this.fa4IdleSince) {

        this.fa4IdleSince = now;

        this.devCounts.fa4Idle = (this.devCounts.fa4Idle ?? 0) + 1;

      }
    } else {
      this.fa4IdleSince = 0;
    }
    // PARTIAL BEND — trunk plateaus between PARTIAL_BEND and REP_HIGH
    if (this.fa4SmoothedTrunk > FA4_PARTIAL_BEND_THRESHOLD && this.fa4SmoothedTrunk < FA4_REP_HIGH - 3) {
      if (!this.fa4PartialBendSince) {

        this.fa4PartialBendSince = now;

        this.devCounts.fa4PartialBend = (this.devCounts.fa4PartialBend ?? 0) + 1;

      }
    } else {
      this.fa4PartialBendSince = 0;
    }

    // Safety check
    if (this.fa4SmoothedTrunk > FA4_SAFETY_ANGLE) {
      this.fa4SafetyTriggered = true;
      this.instructionText = 'Too far! Stand up slowly';
      this.instructionColor = '#ef4444';
      return;
    }

    // Peak tracking
    this.fa4PeakAngle = Math.max(this.fa4PeakAngle, this.fa4SmoothedTrunk);

    // Smoothness tracking (velocity variance)
    const velocity = Math.abs(this.fa4SmoothedTrunk - this.fa4PrevTrunk);
    this.fa4SmoothnessSum += velocity;
    this.fa4SmoothnessCount++;
    this.fa4PrevTrunk = this.fa4SmoothedTrunk;

    // Knee flexion monitoring
    const lk = lm[LM.LEFT_KNEE];
    const lh = lm[LM.LEFT_HIP];
    const la = lm[LM.LEFT_ANKLE];
    if (lk && lh && la && (lk.visibility ?? 0) > 0.4) {
      const kneeAngle = computeArmAngleDeg(lk, lh, la); // Reusing helper — angle at knee
      const flexion = 180 - kneeAngle;
      this.fa4MaxKneeFlexion = Math.max(this.fa4MaxKneeFlexion, flexion);
    }

    // Rep counting
    if (this.fa4RepState === 'standing' && this.fa4SmoothedTrunk > FA4_REP_HIGH) {
      this.fa4RepState = 'bent';
    } else if (this.fa4RepState === 'bent' && this.fa4SmoothedTrunk < FA4_REP_LOW) {
      this.fa4RepState = 'standing';
      this.fa4Reps++;
    }

    // Instructions
    if (this.fa4SmoothedTrunk > FA4_REP_HIGH) {
      this.instructionText = 'Great! Slowly return to standing';
      this.instructionColor = '#22c55e';
    } else if (this.fa4SmoothedTrunk > 15) {
      this.instructionText = 'Keep bending forward';
      this.instructionColor = '#3b82f6';
    } else {
      this.instructionText = 'Hinge at your hips, bend forward';
      this.instructionColor = '#94a3b8';
    }

    if (this.fa4MaxKneeFlexion > FA4_KNEE_FLEXION_MAX) {
      this.instructionText = 'Keep your knees straight';
      this.instructionColor = '#FFB547';
    }
  }

  private renderFA4(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // V2-parity trunk-angle arc (BUG-RR3): centered at the actual hip joint,
    // sweeping forward by the smoothed flexion angle, with a peak marker and a
    // 100 deg safety limit. The render context is already mirrored by the
    // game-layer, so we mirror the X coordinate to draw at the user's hip.
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-w, 0);

    // Anchor at hip joint (fallback to screen centre if we have no landmark yet)
    const cx = this.fa4LastHipX > 0 ? (1 - this.fa4LastHipX) * w : w / 2;
    const cy = this.fa4LastHipY > 0 ? this.fa4LastHipY * h : h * 0.5;
    const radius = 60;
    const trunkRad = (this.fa4SmoothedTrunk * Math.PI) / 180;
    const peakRad = (this.fa4PeakAngle * Math.PI) / 180;
    const safetyRad = (FA4_SAFETY_ANGLE * Math.PI) / 180;

    // Determine arc sweep direction based on which side is facing camera
    // (V2: counter-clockwise when LEFT side facing, clockwise when RIGHT)
    const dir = this.fa4FacingSide === 'left' ? 1 : -1;

    // 1. Background arc — full 0..100 deg range, neutral white
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + dir * safetyRad, dir < 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 2. Current-angle fill — teal semi-transparent wedge
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + dir * trunkRad, dir < 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,229,204,0.28)';
    ctx.fill();

    // 3. Current-angle outline — teal bright stroke
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + dir * trunkRad, dir < 0);
    ctx.strokeStyle = '#00E5CC';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 4. Peak marker — amber dashed line from hip to arc end at peak angle
    if (this.fa4PeakAngle > 1) {
      const peakAng = -Math.PI / 2 + dir * peakRad;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#FFB547';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(peakAng) * radius, cy + Math.sin(peakAng) * radius);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Safety limit line — danger red dashed at 100 deg
    {
      const safAng = -Math.PI / 2 + dir * safetyRad;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#FF4D6A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(safAng) * radius, cy + Math.sin(safAng) * radius);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Angle text — bold teal, positioned outside the arc
    ctx.font = 'bold 16px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#00E5CC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textAng = -Math.PI / 2 + dir * (trunkRad / 2);
    const tx = cx + Math.cos(textAng) * (radius + 20);
    const ty = cy + Math.sin(textAng) * (radius + 20);
    ctx.fillText(`${Math.round(this.fa4SmoothedTrunk)}°`, tx, ty);

    ctx.restore();
  }

  private getFA4Hud(): HudMetrics {
    const now = performance.now();
    let warningSlot1: string | undefined;
    let warningSlot2: string | undefined;

    // SLOT 1 (RED) — profile_lost > overextend > too_far > too_close > knee_bent > idle > partial_bend
    if (this.fa4ProfileLostSince > 0 && now - this.fa4ProfileLostSince > 1000) {
      warningSlot1 = '⚠ Turn 90° to the camera — side profile';
      this.fa4MaybeSpeak('profile_lost', 'Turn sideways to the camera', 5000);
    } else if (this.fa4OverextendSince > 0 && now - this.fa4OverextendSince > 800) {
      warningSlot1 = '⚠ Slow down — too deep, return to standing';
      this.fa4MaybeSpeak('overextend', 'Slow down, return to standing', 4000);
    } else if (this.fa4TooFarSince > 0 && now - this.fa4TooFarSince > 1500) {
      warningSlot1 = '⚠ Move closer to the camera';
      this.fa4MaybeSpeak('too_far', 'Move closer to the camera', 6000);
    } else if (this.fa4TooCloseSince > 0 && now - this.fa4TooCloseSince > 1500) {
      warningSlot1 = '⚠ Move back — full body must be visible';
      this.fa4MaybeSpeak('too_close', 'Move back from the camera', 6000);
    } else if (this.fa4KneeBentSince > 0 && now - this.fa4KneeBentSince > 1000) {
      warningSlot1 = '⚠ Keep your knees straight';
      this.fa4MaybeSpeak('knee_bent', 'Keep your knees straight', 5000);
    } else if (this.fa4IdleSince > 0 && now - this.fa4IdleSince > 5000) {
      warningSlot1 = '⚠ Hinge at hips — bend forward';
      this.fa4MaybeSpeak('idle', 'Hinge at your hips, bend forward', 6000);
    } else if (this.fa4PartialBendSince > 0 && now - this.fa4PartialBendSince > 2500) {
      warningSlot1 = '⚠ Bend further down';
      this.fa4MaybeSpeak('partial_bend', 'Bend further down', 5000);
    }

    // SLOT 2 (AMBER) — lateral shift
    if (this.fa4LateralShiftSince > 0 && now - this.fa4LateralShiftSince > 1200) {
      warningSlot2 = '● Keep weight even on both feet';
      this.fa4MaybeSpeak('lateral_shift', 'Keep your weight even on both feet', 7000);
    }

    return {
      primary: { label: 'Trunk', value: `${Math.round(this.fa4SmoothedTrunk)}°`, color: '#00E5CC' },
      secondary: { label: 'Reps', value: this.fa4Reps },
      timer: { elapsed: Math.floor(this.elapsed), total: FA4_DURATION_S },
      timerLabel: 'Time',
      instructionText: this.instructionText,
      instructionColor: this.instructionColor,
      safetyTriggered: this.fa4SafetyTriggered,
      warningSlot1,
      warningSlot2,
      bigRepChip: this.fa4Reps,
    };
  }

  private getFA4RawData(): Record<string, unknown> {
    const avgVelocity = this.fa4SmoothnessCount > 0 ? this.fa4SmoothnessSum / this.fa4SmoothnessCount : 0;
    const smoothnessScore = clamp(1 - (avgVelocity / 5), 0, 1);
    const kneeScore = clamp(1 - (this.fa4MaxKneeFlexion / FA4_KNEE_FLEXION_MAX), 0, 1);
    const qualityIndex = smoothnessScore * 0.5 + kneeScore * 0.5;
    return {
      testId: 'FA4',
      peakAngle: Math.round(this.fa4PeakAngle * 10) / 10,
      paaAverage: Math.round(this.fa4PeakAngle * 10) / 10,
      qualityIndex: Math.round(qualityIndex * 100) / 100,
      smoothnessScore: Math.round(smoothnessScore * 100) / 100,
      kneeScore: Math.round(kneeScore * 100) / 100,
      maxKneeFlexion: Math.round(this.fa4MaxKneeFlexion * 10) / 10,
      reps: this.fa4Reps,
      elapsed: Math.floor(this.elapsed),
      deviationCounts: { ...this.devCounts },
      timeSeries: this.timeSeries,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FA5: Windmill Reach
  // ═══════════════════════════════════════════════════════════════════════════

  private resetFA5(): void {
    this.fa5Phase = 'left';
    this.fa5PhaseStartTime = 0;
    this.fa5SmoothedTRA = 0;
    this.fa5SmoothedOAEA = 0;
    this.fa5PeakCRSLeft = 0;
    this.fa5PeakCRSRight = 0;
    this.fa5PeakTRALeft = 0;
    this.fa5PeakTRARight = 0;
    this.fa5PeakOAEALeft = 0;
    this.fa5PeakOAEARight = 0;
    this.fa5Reps = 0;
    this.fa5RepState = 'center';
    this.fa5BaselineShoulderSpan = 0;
    this.fa5ValidPeakedFrames = 0;
    this.fa5ValidHighTRAFrames = 0;
    this.fa5MaxOAEAPeaked = 0;
    this.fa5MaxTRAPeaked = 0;
    this.fa5RepsDiscarded = 0;
    this.fa5WrongDirSince = 0;
    this.fa5FootPivotSince = 0;
    this.fa5BothArmsSince = 0;
    this.fa5LateralTiltSince = 0;
    this.fa5TooFarSince = 0;
    this.fa5TooCloseSince = 0;
    this.fa5IdleSince = 0;
    this.fa5ReachMoreSince = 0;
    this.fa5LastWarningKey = '';
    this.fa5LastWarningAt = 0;
    this.fa5LastHipMidX = 0.5;
    this.fa5LastHipMidY = 0.6;
    this.fa5LastShoulderMidX = 0.5;
    this.fa5LastShoulderMidY = 0.4;
  }

  /** V2-parity per-key throttled speech for FA5 deviations */
  private fa5MaybeSpeak(key: string, text: string, cooldownMs: number): void {
    const now = performance.now();
    if (this.fa5LastWarningKey === key && now - this.fa5LastWarningAt < cooldownMs) return;
    // Only update per-key cooldown when speech actually fires — otherwise
    // a dropped second-slot warning ghost-silences itself for cooldownMs.
    const spoke = speakInstruction(text);
    if (spoke) {
      this.fa5LastWarningKey = key;
      this.fa5LastWarningAt = now;
    }
  }

  private processFA5(lm: NormalizedLandmark[], now: number): void {
    const phaseElapsed = (now - this.fa5PhaseStartTime) / 1000;

    if (this.fa5Phase === 'left' && phaseElapsed >= FA5_PHASE_DURATION_S) {
      this.fa5Phase = 'transition';
      this.fa5PhaseStartTime = now;
      this.fa5SmoothedTRA = 0;
      this.fa5SmoothedOAEA = 0;
      this.fa5RepState = 'center';
      this.instructionText = 'Now rotate to the RIGHT';
      this.instructionColor = '#3b82f6';
      return;
    }
    if (this.fa5Phase === 'transition' && phaseElapsed >= FA5_TRANSITION_S) {
      this.fa5Phase = 'right';
      this.fa5PhaseStartTime = now;
      this.fa5SmoothedTRA = 0;
      this.fa5SmoothedOAEA = 0;
      this.fa5RepState = 'center';
    }

    if (this.fa5Phase === 'transition') return;

    // ── V2 deviation detection (ported 2026-05-15) ──
    const _ls = lm[LM.LEFT_SHOULDER];
    const _rs = lm[LM.RIGHT_SHOULDER];
    const _lh = lm[LM.LEFT_HIP];
    const _rh = lm[LM.RIGHT_HIP];
    if (_ls && _rs && _lh && _rh) {
      const _shoulderMidX = (_ls.x + _rs.x) / 2;
      const _shoulderMidY = (_ls.y + _rs.y) / 2;
      const _hipMidX = (_lh.x + _rh.x) / 2;
      const _hipMidY = (_lh.y + _rh.y) / 2;
      this.fa5LastHipMidX = _hipMidX;
      this.fa5LastHipMidY = _hipMidY;
      this.fa5LastShoulderMidX = _shoulderMidX;
      this.fa5LastShoulderMidY = _shoulderMidY;
      const trunkHeight = Math.abs(_hipMidY - _shoulderMidY);

      // TOO FAR / TOO CLOSE
      if (trunkHeight < 0.18) {
        if (!this.fa5TooFarSince) {

          this.fa5TooFarSince = now;

          this.devCounts.fa5TooFar = (this.devCounts.fa5TooFar ?? 0) + 1;

        }
      } else {
        this.fa5TooFarSince = 0;
      }
      if (trunkHeight > 0.45) {
        if (!this.fa5TooCloseSince) {

          this.fa5TooCloseSince = now;

          this.devCounts.fa5TooClose = (this.devCounts.fa5TooClose ?? 0) + 1;

        }
      } else {
        this.fa5TooCloseSince = 0;
      }
      // LATERAL TILT — shoulder Y-diff vs baseline (sideways lean)
      if (Math.abs(_ls.y - _rs.y) > 0.06) {
        if (!this.fa5LateralTiltSince) {

          this.fa5LateralTiltSince = now;

          this.devCounts.fa5LateralTilt = (this.devCounts.fa5LateralTilt ?? 0) + 1;

        }
      } else {
        this.fa5LateralTiltSince = 0;
      }
      // FOOT PIVOT — ankle midpoint moves significantly relative to hip midpoint
      const _la = lm[LM.LEFT_ANKLE];
      const _ra = lm[LM.RIGHT_ANKLE];
      if (_la && _ra) {
        const _ankleMidX = (_la.x + _ra.x) / 2;
        if (Math.abs(_ankleMidX - _hipMidX) > 0.08) {
          if (!this.fa5FootPivotSince) {

            this.fa5FootPivotSince = now;

            this.devCounts.fa5FootPivot = (this.devCounts.fa5FootPivot ?? 0) + 1;

          }
        } else {
          this.fa5FootPivotSince = 0;
        }
      }
    }
    // BOTH ARMS — opposite arm should stay down; if both wrists raised, flag it
    const _lw = lm[LM.LEFT_WRIST];
    const _rw = lm[LM.RIGHT_WRIST];
    if (_lw && _rw && _ls && _rs) {
      const leftRaised = _lw.y < _ls.y - 0.08;
      const rightRaised = _rw.y < _rs.y - 0.08;
      if (leftRaised && rightRaised) {
        if (!this.fa5BothArmsSince) {

          this.fa5BothArmsSince = now;

          this.devCounts.fa5BothArms = (this.devCounts.fa5BothArms ?? 0) + 1;

        }
      } else {
        this.fa5BothArmsSince = 0;
      }
    }

    // Trunk Rotation Angle (TRA) — shoulder span compression
    const shoulderSpan = Math.abs(lm[LM.LEFT_SHOULDER].x - lm[LM.RIGHT_SHOULDER].x);
    if (this.fa5BaselineShoulderSpan > 0) {
      const ratio = clamp(shoulderSpan / this.fa5BaselineShoulderSpan, 0, 1);
      const rawTRA = Math.acos(ratio) * (180 / Math.PI);
      this.fa5SmoothedTRA = ema(rawTRA, this.fa5SmoothedTRA, FA5_EMA_ALPHA);
    }

    // Overhead Arm Elevation Angle (OAEA)
    const wristIdx = this.fa5Phase === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
    const shoulderIdx = this.fa5Phase === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;
    const hipIdx = this.fa5Phase === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP;
    const elbowIdx = this.fa5Phase === 'left' ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW;

    const wrist = lm[wristIdx];
    const shoulder = lm[shoulderIdx];
    if (wrist && shoulder && (wrist.visibility ?? 0) > 0.3) {
      const rawOAEA = computeArmAngleDeg(shoulder, lm[hipIdx], lm[elbowIdx]);
      this.fa5SmoothedOAEA = ema(rawOAEA, this.fa5SmoothedOAEA, FA5_EMA_ALPHA);
    }

    // Combined Reach Score
    // V2 OAEA gate (ported 2026-05-14): when TRA < FA5_OAEA_GATE_MIN_TRA, the OAEA
    // contribution is rejected — this prevents isolated arm lifts (no trunk rotation)
    // from inflating CRS via the OAEA weight alone.
    const traNorm = clamp(this.fa5SmoothedTRA / 90, 0, 1);
    const oaeaGateOpen = this.fa5SmoothedTRA >= FA5_OAEA_GATE_MIN_TRA;
    const oaeaNorm = oaeaGateOpen ? clamp(this.fa5SmoothedOAEA / 180, 0, 1) : 0;
    const crs = FA5_TRA_WEIGHT * traNorm + FA5_OAEA_WEIGHT * oaeaNorm;

    // Peak tracking
    if (this.fa5Phase === 'left') {
      this.fa5PeakCRSLeft = Math.max(this.fa5PeakCRSLeft, crs);
      this.fa5PeakTRALeft = Math.max(this.fa5PeakTRALeft, this.fa5SmoothedTRA);
      this.fa5PeakOAEALeft = Math.max(this.fa5PeakOAEALeft, this.fa5SmoothedOAEA);
    } else {
      this.fa5PeakCRSRight = Math.max(this.fa5PeakCRSRight, crs);
      this.fa5PeakTRARight = Math.max(this.fa5PeakTRARight, this.fa5SmoothedTRA);
      this.fa5PeakOAEARight = Math.max(this.fa5PeakOAEARight, this.fa5SmoothedOAEA);
    }

    // Rep counting — V2 multi-gate state machine (ported 2026-05-14)
    // ───────────────────────────────────────────────────────────────────
    // State transitions:
    //   center → rotated   when CRS rises above REP_UP_THRESHOLD
    //   rotated → center   ONLY when OAEA and TRA both return below their MAX gates
    //                      AND all four validity gates pass; else rep is discarded.
    //
    // Gates applied on candidate return (all must pass to count rep):
    //   1. validPeakedFrames    ≥ FA5_MIN_VALID_PEAKED_FRAMES       (rejects spike-and-return)
    //   2. validHighTRAFrames   ≥ FA5_MIN_SUSTAINED_TRA_FRAMES      (rejects EMA-echo single spikes)
    //   3. highTRARatio         ≥ FA5_MIN_HIGH_TRA_RATIO            (rejects arm-swing-with-brief-rotation)
    //   4. maxOAEADuringPeaked  ≥ FA5_MIN_OAEA_FOR_VALID_REP        (rejects arm-not-elevated reps)
    const REP_UP_THRESHOLD = 0.35;

    if (this.fa5RepState === 'center') {
      if (crs >= REP_UP_THRESHOLD) {
        // Enter 'rotated' — reset per-rep counters
        this.fa5RepState = 'rotated';
        this.fa5ValidPeakedFrames = 0;
        this.fa5ValidHighTRAFrames = 0;
        this.fa5MaxOAEAPeaked = 0;
        this.fa5MaxTRAPeaked = 0;
      }
    } else {
      // In 'rotated' — accumulate per-frame stats every frame we remain peaked
      this.fa5ValidPeakedFrames++;
      if (this.fa5SmoothedOAEA > this.fa5MaxOAEAPeaked) this.fa5MaxOAEAPeaked = this.fa5SmoothedOAEA;
      if (this.fa5SmoothedTRA > this.fa5MaxTRAPeaked) this.fa5MaxTRAPeaked = this.fa5SmoothedTRA;
      if (this.fa5SmoothedTRA >= FA5_MIN_TRA_FOR_VALID_REP) this.fa5ValidHighTRAFrames++;

      // Return-to-T detection: BOTH OAEA and TRA must drop below their gates
      const returnedToT =
        this.fa5SmoothedOAEA < FA5_REP_RETURN_OAEA_MAX &&
        this.fa5SmoothedTRA < FA5_REP_RETURN_TRA_MAX;

      if (returnedToT) {
        // Apply gates in order — first failure discards the rep silently
        const highTRARatio = this.fa5ValidPeakedFrames > 0
          ? this.fa5ValidHighTRAFrames / this.fa5ValidPeakedFrames
          : 0;

        const gatesPassed =
          this.fa5ValidPeakedFrames >= FA5_MIN_VALID_PEAKED_FRAMES &&
          this.fa5ValidHighTRAFrames >= FA5_MIN_SUSTAINED_TRA_FRAMES &&
          highTRARatio >= FA5_MIN_HIGH_TRA_RATIO &&
          this.fa5MaxOAEAPeaked >= FA5_MIN_OAEA_FOR_VALID_REP;

        if (gatesPassed) {
          this.fa5Reps++;
        } else {
          this.fa5RepsDiscarded++;
          // V2 BUG-RR5 — speak the specific reason the rep was rejected (2.5s
          // cooldown is enforced inside speakInstruction).
          if (this.fa5ValidPeakedFrames < FA5_MIN_VALID_PEAKED_FRAMES) {
            speakInstruction('Hold the windmill position briefly');
          } else if (this.fa5ValidHighTRAFrames < FA5_MIN_SUSTAINED_TRA_FRAMES || highTRARatio < FA5_MIN_HIGH_TRA_RATIO) {
            speakInstruction('Rotate your trunk more and hold');
          } else if (this.fa5MaxOAEAPeaked < FA5_MIN_OAEA_FOR_VALID_REP) {
            speakInstruction('Raise your arm higher');
          }
        }

        // Reset state regardless of outcome
        this.fa5RepState = 'center';
        this.fa5ValidPeakedFrames = 0;
        this.fa5ValidHighTRAFrames = 0;
        this.fa5MaxOAEAPeaked = 0;
        this.fa5MaxTRAPeaked = 0;
      }
    }

    // WRONG DIRECTION (V3 fix 2026-05-15)
    // When user rotates LEFT, RIGHT shoulder comes forward (lower Z) and
    // LEFT shoulder rotates back (higher Z). So during 'left' phase we
    // expect (ls.z − rs.z) > +threshold; during 'right' phase the sign
    // flips. If TRA is large but the sign is the OPPOSITE of expected,
    // the user is rotating the wrong way.
    if (_ls && _rs && this.fa5SmoothedTRA > 25) {
      const zDelta = (_ls.z ?? 0) - (_rs.z ?? 0);
      const expectedSignPositive = this.fa5Phase === 'left';
      const actualPositive = zDelta > 0.04;
      const actualNegative = zDelta < -0.04;
      const wrongWay = expectedSignPositive ? actualNegative : actualPositive;
      if (wrongWay) {
        if (!this.fa5WrongDirSince) {

          this.fa5WrongDirSince = now;

          this.devCounts.fa5WrongDir = (this.devCounts.fa5WrongDir ?? 0) + 1;

        }
      } else {
        this.fa5WrongDirSince = 0;
      }
    } else {
      this.fa5WrongDirSince = 0;
    }

    // IDLE — TRA stays near 0 for sustained period (2.5s — phase is only 20s)
    if (this.fa5SmoothedTRA < 8 && this.fa5SmoothedOAEA < 15) {
      if (!this.fa5IdleSince) {

        this.fa5IdleSince = now;

        this.devCounts.fa5Idle = (this.devCounts.fa5Idle ?? 0) + 1;

      }
    } else {
      this.fa5IdleSince = 0;
    }
    // REACH MORE — TRA plateaus between 20 and FA5_MIN_TRA_FOR_VALID_REP
    if (this.fa5SmoothedTRA > 20 && this.fa5SmoothedTRA < FA5_MIN_TRA_FOR_VALID_REP - 5) {
      if (!this.fa5ReachMoreSince) {

        this.fa5ReachMoreSince = now;

        this.devCounts.fa5ReachMore = (this.devCounts.fa5ReachMore ?? 0) + 1;

      }
    } else {
      this.fa5ReachMoreSince = 0;
    }

    const dirLabel = this.fa5Phase === 'left' ? 'LEFT' : 'RIGHT';
    if (this.fa5RepState === 'rotated') {
      this.instructionText = 'Great! Hold, then return to center';
      this.instructionColor = '#22c55e';
    } else {
      this.instructionText = `Rotate & reach ${dirLabel}`;
      this.instructionColor = '#94a3b8';
    }
  }

  private renderFA5(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // V2-parity dual arcs: TRA anchored at HIP midpoint, OAEA anchored at SHOULDER midpoint
    const hipX = (1 - this.fa5LastHipMidX) * w;
    const hipY = this.fa5LastHipMidY * h;
    const shX = (1 - this.fa5LastShoulderMidX) * w;
    const shY = this.fa5LastShoulderMidY * h;
    const radius = 50;
    const dir = this.fa5Phase === 'left' ? -1 : 1;

    // TRA arc at hip midpoint
    ctx.save();
    ctx.beginPath();
    ctx.arc(hipX, hipY, radius, -Math.PI / 2, -Math.PI / 2 + dir * (Math.PI / 2.2), dir < 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 3;
    ctx.stroke();
    const traSweep = Math.min(this.fa5SmoothedTRA / FA5_TRA_PHYSIO_MAX, 1) * (Math.PI / 2.2);
    if (traSweep > 0.02) {
      ctx.beginPath();
      ctx.arc(hipX, hipY, radius, -Math.PI / 2, -Math.PI / 2 + dir * traSweep, dir < 0);
      ctx.strokeStyle = '#00E5CC';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#00E5CC';
      ctx.shadowBlur = 8;
      ctx.stroke();
    }
    ctx.restore();

    // OAEA arc at shoulder midpoint
    ctx.save();
    ctx.beginPath();
    ctx.arc(shX, shY, radius * 0.85, -Math.PI / 2, -Math.PI / 2 + dir * (Math.PI / 2), dir < 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 3;
    ctx.stroke();
    const oaeaSweep = Math.min(this.fa5SmoothedOAEA / FA5_OAEA_PHYSIO_MAX, 1) * (Math.PI / 2);
    if (oaeaSweep > 0.02) {
      ctx.beginPath();
      ctx.arc(shX, shY, radius * 0.85, -Math.PI / 2, -Math.PI / 2 + dir * oaeaSweep, dir < 0);
      ctx.strokeStyle = '#FF6B9D';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#FF6B9D';
      ctx.shadowBlur = 8;
      ctx.stroke();
    }
    ctx.restore();

    // Counter-flipped text labels
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-w, 0);
    ctx.font = 'bold 12px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#00E5CC';
    ctx.textAlign = 'center';
    ctx.fillText(`TRA ${Math.round(this.fa5SmoothedTRA)}°`, w - hipX, hipY - radius - 10);
    ctx.fillStyle = '#FF6B9D';
    ctx.fillText(`ARM ${Math.round(this.fa5SmoothedOAEA)}°`, w - shX, shY - radius - 10);
    ctx.restore();
  }

  private getFA5Hud(): HudMetrics {
    const totalDuration = FA5_PHASE_DURATION_S * 2 + FA5_TRANSITION_S;
    const traNorm = clamp(this.fa5SmoothedTRA / 90, 0, 1);
    const oaeaGateOpen = this.fa5SmoothedTRA >= FA5_OAEA_GATE_MIN_TRA;
    const oaeaNorm = oaeaGateOpen ? clamp(this.fa5SmoothedOAEA / 180, 0, 1) : 0;
    const crs = FA5_TRA_WEIGHT * traNorm + FA5_OAEA_WEIGHT * oaeaNorm;
    const phaseName = this.fa5Phase === 'left' ? 'Rotate Left'
      : this.fa5Phase === 'transition' ? 'Switch!'
      : 'Rotate Right';
    const now = performance.now();
    const dirLabel = this.fa5Phase === 'left' ? 'LEFT' : 'RIGHT';
    let warningSlot1: string | undefined;
    let warningSlot2: string | undefined;

    // SLOT 1 (RED) — priority: wrong_dir > too_far > too_close > both_arms > idle > reach_more
    if (this.fa5WrongDirSince > 0 && now - this.fa5WrongDirSince > 500) {
      warningSlot1 = `⚠ Rotate ${dirLabel} — not the other way`;
      this.fa5MaybeSpeak('wrong_dir', `Rotate your trunk to the ${dirLabel.toLowerCase()}`, 4000);
    } else if (this.fa5TooFarSince > 0 && now - this.fa5TooFarSince > 1500) {
      warningSlot1 = '⚠ Move closer to the camera';
      this.fa5MaybeSpeak('too_far', 'Move closer to the camera', 6000);
    } else if (this.fa5TooCloseSince > 0 && now - this.fa5TooCloseSince > 1500) {
      warningSlot1 = '⚠ Move back — full body must be visible';
      this.fa5MaybeSpeak('too_close', 'Move back from the camera', 6000);
    } else if (this.fa5BothArmsSince > 0 && now - this.fa5BothArmsSince > 800) {
      warningSlot1 = '⚠ Only one arm should reach overhead';
      this.fa5MaybeSpeak('both_arms', 'Only one arm should reach overhead', 5000);
    } else if (this.fa5IdleSince > 0 && now - this.fa5IdleSince > 2500) {
      warningSlot1 = `⚠ Rotate and reach ${dirLabel}`;
      this.fa5MaybeSpeak('idle', `Rotate your trunk and reach ${dirLabel.toLowerCase()}`, 5000);
    } else if (this.fa5ReachMoreSince > 0 && now - this.fa5ReachMoreSince > 1500) {
      warningSlot1 = '⚠ Rotate trunk more — windmill bigger';
      this.fa5MaybeSpeak('reach_more', 'Rotate your trunk more, reach further', 4000);
    }

    // SLOT 2 (AMBER)
    if (this.fa5FootPivotSince > 0 && now - this.fa5FootPivotSince > 1200) {
      warningSlot2 = '● Keep feet planted — rotate hips only';
      this.fa5MaybeSpeak('foot_pivot', 'Keep your feet planted on the floor', 7000);
    } else if (this.fa5LateralTiltSince > 0 && now - this.fa5LateralTiltSince > 1200) {
      warningSlot2 = '● Stand tall — no sideways lean';
      this.fa5MaybeSpeak('lateral_tilt', 'Stand tall, do not lean sideways', 7000);
    }

    const peakLeft = Math.round(this.fa5PeakCRSLeft * 100);
    const peakRight = Math.round(this.fa5PeakCRSRight * 100);
    const peakAvg = (peakLeft + peakRight) / 2;
    const si = peakAvg > 0 ? Math.abs(peakLeft - peakRight) / peakAvg * 100 : 0;

    return {
      primary: { label: 'CRS', value: `${Math.round(crs * 100)}%`, color: '#00E5CC' },
      secondary: { label: 'Reps', value: this.fa5Reps },
      timer: { elapsed: Math.floor(this.elapsed), total: totalDuration },
      timerLabel: phaseName,
      instructionText: this.instructionText,
      instructionColor: this.instructionColor,
      warningSlot1,
      warningSlot2,
      leftAngle: peakLeft,
      rightAngle: peakRight,
      symmetryIndex: Math.round(si),
      bigRepChip: this.fa5Reps,
    };
  }

  private getFA5RawData(): Record<string, unknown> {
    const paaAvg = (this.fa5PeakCRSLeft + this.fa5PeakCRSRight) / 2 * 100;
    const si = paaAvg > 0
      ? (Math.abs(this.fa5PeakCRSLeft - this.fa5PeakCRSRight) / ((this.fa5PeakCRSLeft + this.fa5PeakCRSRight) / 2)) * 100
      : 0;
    return {
      testId: 'FA5',
      peakCRSLeft: Math.round(this.fa5PeakCRSLeft * 1000) / 10,
      peakCRSRight: Math.round(this.fa5PeakCRSRight * 1000) / 10,
      peakTRALeft: Math.round(this.fa5PeakTRALeft * 10) / 10,
      peakTRARight: Math.round(this.fa5PeakTRARight * 10) / 10,
      peakOAEALeft: Math.round(this.fa5PeakOAEALeft * 10) / 10,
      peakOAEARight: Math.round(this.fa5PeakOAEARight * 10) / 10,
      paaAverage: Math.round(paaAvg * 10) / 10,
      symmetryIndex: Math.round(si * 10) / 10,
      reps: this.fa5Reps,
      repsDiscarded: this.fa5RepsDiscarded,
      elapsed: Math.floor(this.elapsed),
      deviationCounts: { ...this.devCounts },
      timeSeries: this.timeSeries,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Time Series Recording
  // ═══════════════════════════════════════════════════════════════════════════

  private recordTimeSeries(): void {
    switch (this.testId) {
      case 'FA1':
        this.timeSeries.push({
          timestamp: this.elapsed,
          leftAngle: this.fa1SmoothedLeft,
          rightAngle: this.fa1SmoothedRight,
        });
        break;
      case 'FA2':
        this.timeSeries.push({
          timestamp: this.elapsed,
          reachPercent: this.fa2SmoothedReach,
          arm: this.fa2Phase,
        });
        break;
      case 'FA3':
        this.timeSeries.push({
          timestamp: this.elapsed,
          leftAngle: this.fa3Phase === 'left' ? this.fa3SmoothedAngle : undefined,
          rightAngle: this.fa3Phase === 'right' ? this.fa3SmoothedAngle : undefined,
          side: this.fa3Phase,
        });
        break;
      case 'FA4':
        this.timeSeries.push({
          timestamp: this.elapsed,
          trunkAngle: this.fa4SmoothedTrunk,
        });
        break;
      case 'FA5':
        this.timeSeries.push({
          timestamp: this.elapsed,
          trunkAngle: this.fa5SmoothedTRA,
          armElevation: this.fa5SmoothedOAEA,
          side: this.fa5Phase,
        });
        break;
    }
  }
}
