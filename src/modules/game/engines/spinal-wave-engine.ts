/**
 * Kriya Spinal Wave Engine (KS3) — Clinical-grade flexion tracking with form assessment.
 *
 * Implements a 5-layer rep state machine (NEUTRAL → FLEXING → AT_PEAK → EXTENDING → NEUTRAL)
 * with sagittal plane spinal angle tracking, segment angle symmetry index (SSI), and
 * movement quality scoring (MQS).
 *
 * Key algorithms:
 *   - Calibration: 3-gate validation (side-profile, neutral spine, feet flat) with 2s hold
 *   - Per-frame: EMA trunk angle smoothing, velocity tracking, pre-flexion buffering
 *   - Rep state: Raw peak >= 30°, ear-drop >= 12% of torsoHeight, chin-tuck gating
 *   - SSI: Segment-angle-onset comparison (upper vs lower spine timing via frame history)
 *   - MQS: Weighted blend of smoothness (CV-based), form adherence (thoracic curve), completion
 *   - Rendering: Catmull-Rom spinal curve, spine dots, MQS/SSI bars, rep counter with pop
 */

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics } from './types';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// ── Types ──
type RepState = 'NEUTRAL' | 'FLEXING' | 'AT_PEAK' | 'EXTENDING';
type ProfileSide = 'left' | 'right';

interface SpinalPoint {
  x: number;
  y: number;
}

interface FlexionFrame {
  time: number;
  points: SpinalPoint[];
}

interface TimeSeriesPoint {
  timestamp: number;
  mqs: number;
}

// ── Constants ──
const SAP_DURATION = 45; // seconds
const NEUTRAL_THRESHOLD = 12;
const FLEXION_START_THRESHOLD = 18;
const PEAK_STABLE_FRAMES = 8;
const PEAK_THRESHOLD_DEG = 3;
const COMPLETION_FULL = 60;
const COMPLETION_PARTIAL = 30;
const MIN_PEAK_ANGLE = 28; // EMA
const MIN_VALID_REP_ANGLE = 30; // raw
const MIN_CHIN_TUCK = 0.035;
const MIN_CHIN_TUCK_ASSISTED = 0.025;
const MIN_WAVE_EXCESS_ASSIST = 35;
const MIN_EAR_DROP_RATIO = 0.12;
const POSE_LOSS_DEBOUNCE = 800; // ms
const EMA_ALPHA = 0.2;
const CAL_FRAMES = 30;
const CAL_HOLD_FRAMES = 40; // ~2 seconds at 20fps, plus 300ms grace
const CAL_TIMEOUT_MS = 20000;
const GLITCH_THRESHOLD = 0.35; // ear x-position jump threshold

/** Minimum visibility thresholds for landmark tracking */
const LANDMARK_VIS_THRESHOLD = 0.3;

/** SSI onset detection: degrees above neutral to mark segment movement */
const SSI_ONSET_DEG = 5;

/**
 * Compute trunk angle (ear→hip relative to vertical in degrees).
 * @param p0 Ear landmark
 * @param p4 Hip landmark
 * @returns Angle in degrees [0-180)
 */
function getTrunkAngle(p0: SpinalPoint, p4: SpinalPoint): number {
  const dx = Math.abs(p4.x - p0.x);
  const dy = p4.y - p0.y;
  if (dy <= 0) return 0; // Invalid posture
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/**
 * Compute segment angle (p0→p1 relative to vertical).
 */
function getSegmentAngle(p0: SpinalPoint, p1: SpinalPoint): number {
  const dx = Math.abs(p1.x - p0.x);
  const dy = p1.y - p0.y;
  if (dy <= 0) return 0;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/**
 * Linear interpolation between two points.
 */
function lerp(p1: SpinalPoint, p2: SpinalPoint, t: number): SpinalPoint {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

/**
 * Compute coefficient of variation from velocity samples.
 * Filters out near-zero velocities to avoid bias.
 */
function computeVelocityCV(velocities: number[]): number {
  const filtered = velocities.filter((v) => Math.abs(v) > 0.0001);
  if (filtered.length < 2) return 0;

  const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  if (mean === 0) return 0;

  const variance = filtered.reduce((sum, v) => sum + (v - mean) ** 2, 0) / filtered.length;
  const stdDev = Math.sqrt(variance);
  return stdDev / mean;
}

/**
 * Catmull-Rom spline interpolation for smooth curve rendering.
 */
function catmullRom(p0: SpinalPoint, p1: SpinalPoint, p2: SpinalPoint, p3: SpinalPoint, t: number): SpinalPoint {
  const t2 = t * t;
  const t3 = t2 * t;

  const v0 = (p2.x - p0.x) * 0.5;
  const v1 = (p3.x - p1.x) * 0.5;
  const x =
    p1.x +
    v0 * t +
    (3 * (p2.x - p1.x) - 2 * v0 - v1) * t2 +
    (2 * (p1.x - p2.x) + v0 + v1) * t3;

  const w0 = (p2.y - p0.y) * 0.5;
  const w1 = (p3.y - p1.y) * 0.5;
  const y =
    p1.y +
    w0 * t +
    (3 * (p2.y - p1.y) - 2 * w0 - w1) * t2 +
    (2 * (p1.y - p2.y) + w0 + w1) * t3;

  return { x, y };
}

/**
 * Check if upper segment (ear→shoulder) tilts MORE than lower segment (shoulder→hip)
 * relative to their neutral angles. This is the physical definition of a spinal wave.
 */
function checkThoracicCurve(
  p0: SpinalPoint,
  p1: SpinalPoint,
  p4: SpinalPoint,
  trunkAngle: number,
  neutralUpperAngle: number,
  neutralLowerAngle: number
): boolean {
  if (trunkAngle < 20) return true; // not enough flexion to evaluate — don't penalise

  // Clamp dy to prevent atan2 artifact when geometry inverts at deep bends
  const dyUpper = Math.max(0.01, p1.y - p0.y);
  const dyLower = Math.max(0.01, p4.y - p1.y);
  const upperAngle = Math.atan2(Math.abs(p1.x - p0.x), dyUpper) * (180 / Math.PI);
  const lowerAngle = Math.atan2(Math.abs(p4.x - p1.x), dyLower) * (180 / Math.PI);
  const upperExcess = upperAngle - neutralUpperAngle;
  const lowerExcess = lowerAngle - neutralLowerAngle;
  return upperExcess > lowerExcess; // wave = upper segment must lead lower
}

export class SpinalWaveEngine implements GameEngine {
  // ── Calibration state ──
  private calFrames = 0;
  private calReady = false;
  private calStartTime = 0;
  private profileSide: ProfileSide | null = null;
  private facingRight: boolean | null = null;
  private earIdx: number | null = null;
  private shoulderIdx: number | null = null;
  private hipIdx: number | null = null;
  private kneeIdx: number | null = null;
  private ankleIdx: number | null = null;

  // ── Calibration reference geometry ──
  private p0: SpinalPoint | null = null; // ear
  private p1: SpinalPoint | null = null; // shoulder
  private p4: SpinalPoint | null = null; // hip
  private torsoHeight: number | null = null;
  private neutralUpperAngle: number | null = null;
  private neutralLowerAngle: number | null = null;

  // ── Game state ──
  private startTime = 0;
  private phaseStartTime = 0;
  private complete = false;
  private repState: RepState = 'NEUTRAL';
  private timerId: ReturnType<typeof setInterval> | null = null;

  // ── Rep tracking ──
  private completedReps = 0;
  private repSSIValues: number[] = [];
  private repCompletions: number[] = [];
  private repMaxAngles: number[] = [];
  private currentRepFlexionFrames: FlexionFrame[] = [];
  private preFlexionBuffer: FlexionFrame[] = [];
  private stablePeakCount = 0;
  private peakRawAngle = 0;
  private peakEMAAngle = 0;
  private peakEarY = 0; // max ear.y during flexion (for ear-drop validation)

  // ── EMA and smoothing ──
  private smoothedTrunkAngle = 0;
  private prevSmoothedAngle = 0;
  private prevP1: SpinalPoint | null = null; // for velocity calc
  private shoulderVelocities: number[] = [];

  // ── Chin-tuck detection ──
  private neutralNoseEarSamples: number[] = []; // accumulate samples for baseline
  private neutralNoseEarRelY: number | null = null; // baseline (nose.y - ear.y)
  private neutralBaselineLocked = false; // once we have 15 samples, lock it
  private peakPreFlexNoseEarY = -Infinity; // max (nose.y - ear.y) seen while trunk <= 25°
  private preFlexNoseFrames = 0; // count of frames where nose was visible in pre-flex window

  // ── Form adherence tracking ──
  private flexionFrameCount = 0; // total frames during FLEXING/AT_PEAK
  private goodCurveFrameCount = 0; // frames where thoracic curve is convex (upper > lower)

  // ── Early-phase wave excess (for compound chin-tuck gate) ──
  private earlyPhaseWaveExcess = -Infinity; // max wave excess when trunk is 20-45°

  // ── Rendering and metrics ──
  private liveMQS = 0;
  private liveSSI = 0;
  private timeSeries: TimeSeriesPoint[] = [];
  private lastTimeSeriesUpdate = 0;
  private repPopAnimationStart = 0;
  private repPopAnimationDuration = 300; // ms

  // ── Pose loss handling ──
  private lastValidLandmarkTime = 0;
  private lastGoodEarX: number | null = null; // EMA of ear.x for glitch detection

  constructor() {
    // Empty constructor, reset() does initialization
  }

  /**
   * Reset all state for a new game session.
   */
  reset(): void {
    this.calFrames = 0;
    this.calReady = false;
    this.calStartTime = 0;
    this.profileSide = null;
    this.facingRight = null;
    this.earIdx = null;
    this.shoulderIdx = null;
    this.hipIdx = null;
    this.kneeIdx = null;
    this.ankleIdx = null;

    this.p0 = null;
    this.p1 = null;
    this.p4 = null;
    this.torsoHeight = null;
    this.neutralUpperAngle = null;
    this.neutralLowerAngle = null;

    this.startTime = 0;
    this.phaseStartTime = 0;
    this.complete = false;
    this.repState = 'NEUTRAL';

    this.completedReps = 0;
    this.repSSIValues = [];
    this.repCompletions = [];
    this.repMaxAngles = [];
    this.currentRepFlexionFrames = [];
    this.preFlexionBuffer = [];
    this.stablePeakCount = 0;
    this.peakRawAngle = 0;
    this.peakEMAAngle = 0;
    this.peakEarY = 0;

    this.smoothedTrunkAngle = 0;
    this.prevSmoothedAngle = 0;
    this.prevP1 = null;
    this.shoulderVelocities = [];

    this.neutralNoseEarSamples = [];
    this.neutralNoseEarRelY = null;
    this.neutralBaselineLocked = false;
    this.peakPreFlexNoseEarY = -Infinity;
    this.preFlexNoseFrames = 0;

    this.flexionFrameCount = 0;
    this.goodCurveFrameCount = 0;

    this.earlyPhaseWaveExcess = -Infinity;

    this.liveMQS = 0;
    this.liveSSI = 0;
    this.timeSeries = [];
    this.lastTimeSeriesUpdate = 0;
    this.repPopAnimationStart = 0;

    this.lastValidLandmarkTime = 0;
    this.lastGoodEarX = null;

    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Called after countdown to reset game timer (not calibration).
   */
  startPlaying(): void {
    this.startTime = performance.now();
    this.phaseStartTime = this.startTime;
    this.startTimer();
  }

  /**
   * Calibration (Gate A, B, C validation with 2s hold).
   */
  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) {
      return {
        isReady: true,
        isCalibrated: true,
        progress: 1,
        framesReady: CAL_FRAMES,
        requiredFrames: CAL_FRAMES,
        feedback: 'Ready to start!',
      };
    }

    // ── Gate A: Detect side profile and visibility ──
    const leftVis = [LM.LEFT_EAR, LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE]
      .map((i) => landmarks[i]?.visibility ?? 0)
      .reduce((a, b) => a + b, 0) / 5;

    const rightVis = [LM.RIGHT_EAR, LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE]
      .map((i) => landmarks[i]?.visibility ?? 0)
      .reduce((a, b) => a + b, 0) / 5;

    let visibleSide: ProfileSide | null = null;
    if (leftVis >= rightVis + 0.12 && leftVis > 0.4) {
      visibleSide = 'left';
    } else if (rightVis > leftVis + 0.12 && rightVis > 0.4) {
      visibleSide = 'right';
    }

    if (!visibleSide) {
      this.calFrames = 0;
      return {
        isReady: false,
        progress: 0,
        framesReady: 0,
        requiredFrames: CAL_FRAMES,
        feedback: 'Side profile not detected. Turn to the side.',
      };
    }

    this.profileSide = visibleSide;

    // Set landmark indices based on visible side
    const [earIdx, shoulderIdx, hipIdx, kneeIdx, ankleIdx] =
      visibleSide === 'left'
        ? [LM.LEFT_EAR, LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE]
        : [LM.RIGHT_EAR, LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE];

    this.earIdx = earIdx;
    this.shoulderIdx = shoulderIdx;
    this.hipIdx = hipIdx;
    this.kneeIdx = kneeIdx;
    this.ankleIdx = ankleIdx;

    const ear = landmarks[earIdx];
    const shoulder = landmarks[shoulderIdx];
    const hip = landmarks[hipIdx];
    const knee = landmarks[kneeIdx];
    const ankle = landmarks[ankleIdx];
    const nose = landmarks[LM.NOSE];

    if (
      !ear || !shoulder || !hip || !knee || !ankle || !nose ||
      ear.visibility < LANDMARK_VIS_THRESHOLD ||
      shoulder.visibility < LANDMARK_VIS_THRESHOLD ||
      hip.visibility < LANDMARK_VIS_THRESHOLD
    ) {
      this.calFrames = 0;
      return {
        isReady: false,
        progress: 0,
        framesReady: 0,
        requiredFrames: CAL_FRAMES,
        feedback: `Keep ${visibleSide} side visible. Better landmark detection needed.`,
      };
    }

    // ── Gate B: Check neutral spine (trunk angle <= 15°) ──
    const trunkAngle = getTrunkAngle(
      { x: ear.x, y: ear.y },
      { x: hip.x, y: hip.y }
    );

    if (trunkAngle > 15) {
      this.calFrames = 0;
      return {
        isReady: false,
        progress: 0,
        framesReady: 0,
        requiredFrames: CAL_FRAMES,
        feedback: 'Keep your spine straight. Avoid bending forward.',
      };
    }

    // ── Gate C: Feet flat (ankle or heel y > 0.60) ──
    const ankleY = ankle.y;
    const heel = landmarks[visibleSide === 'left' ? LM.LEFT_HEEL : LM.RIGHT_HEEL];
    const feetFlatY = heel ? Math.max(ankleY, heel.y) : ankleY;

    if (feetFlatY <= 0.60) {
      this.calFrames = 0;
      return {
        isReady: false,
        progress: 0,
        framesReady: 0,
        requiredFrames: CAL_FRAMES,
        feedback: 'Stand with feet flat on the ground.',
      };
    }

    // All gates passed — accumulate frames
    if (this.calFrames === 0) {
      this.calStartTime = performance.now();
    }

    // Detect facing direction (nose vs ear x-position)
    const noseEarDx = nose.x - ear.x;
    this.facingRight = noseEarDx > 0;

    // Capture reference geometry
    const p0 = { x: ear.x, y: ear.y };
    const p1 = { x: shoulder.x, y: shoulder.y };
    const p4 = { x: hip.x, y: hip.y };
    const p2 = lerp(p1, p4, 0.33);
    const p3 = lerp(p1, p4, 0.67);

    this.p0 = p0;
    this.p1 = p1;
    this.p4 = p4;
    this.torsoHeight = Math.abs(p4.y - p0.y);
    this.neutralUpperAngle = getSegmentAngle(p0, p1);
    this.neutralLowerAngle = getSegmentAngle(p1, p4);

    // Initialize chin-tuck baseline
    if (this.calFrames === 0) {
      this.neutralNoseEarRelY = nose.y - ear.y;
    }

    this.calFrames++;

    // Check 2-second hold (CAL_HOLD_FRAMES at 20fps ≈ 2 seconds + 300ms grace)
    const holdTime = performance.now() - this.calStartTime;
    const holdOk = holdTime >= 2000 && this.calFrames >= CAL_HOLD_FRAMES;

    // Timeout check
    if (holdTime > CAL_TIMEOUT_MS) {
      this.calFrames = 0;
      return {
        isReady: false,
        progress: 0,
        framesReady: 0,
        requiredFrames: CAL_FRAMES,
        feedback: 'Calibration timeout. Please try again.',
      };
    }

    if (holdOk) {
      this.calReady = true;
      return {
        isReady: true,
        isCalibrated: true,
        progress: 1,
        framesReady: CAL_FRAMES,
        requiredFrames: CAL_FRAMES,
        feedback: 'Calibrated! Get ready.',
      };
    }

    const progress = Math.min(holdTime / 2000, 1);
    return {
      isReady: false,
      progress,
      framesReady: this.calFrames,
      requiredFrames: CAL_FRAMES,
      feedback: 'Hold still...',
    };
  }

  /**
   * Main frame processing — rep state machine and metrics.
   */
  processFrame(landmarks: NormalizedLandmark[], _timestampMs: number): void {
    if (!this.calReady || this.complete) return;

    const now = performance.now();

    // Track pose loss (debounce 800ms)
    if (
      !landmarks[this.earIdx!] || !landmarks[this.shoulderIdx!] || !landmarks[this.hipIdx!] ||
      landmarks[this.earIdx!].visibility < 0.2 ||
      landmarks[this.shoulderIdx!].visibility < 0.2 ||
      landmarks[this.hipIdx!].visibility < 0.2
    ) {
      if (now - this.lastValidLandmarkTime > POSE_LOSS_DEBOUNCE) {
        // Pose lost — reset state
        if (this.repState === 'FLEXING' || this.repState === 'AT_PEAK' || this.repState === 'EXTENDING') {
          this.repState = 'NEUTRAL';
        }
      }
      return;
    }
    this.lastValidLandmarkTime = now;

    const ear = landmarks[this.earIdx!];
    const shoulder = landmarks[this.shoulderIdx!];
    const hip = landmarks[this.hipIdx!];
    const nose = landmarks[LM.NOSE];

    // Extract 5 spinal points
    const p0 = { x: ear.x, y: ear.y };
    const p1 = { x: shoulder.x, y: shoulder.y };
    const p4 = { x: hip.x, y: hip.y };
    const p2 = lerp(p1, p4, 0.33);
    const p3 = lerp(p1, p4, 0.67);

    // Glitch frame rejection: check ear x jump
    const earXRef = this.lastGoodEarX !== null ? this.lastGoodEarX : p0.x;
    if (Math.abs(p0.x - earXRef) > GLITCH_THRESHOLD) {
      return;
    }
    // EMA update for ear x-position (alpha=0.5 for responsive tracking)
    this.lastGoodEarX = this.lastGoodEarX === null ? p0.x : p0.x * 0.5 + this.lastGoodEarX * 0.5;

    // Compute raw trunk angle and EMA smooth
    const rawTrunkAngle = getTrunkAngle(p0, p4);
    this.prevSmoothedAngle = this.smoothedTrunkAngle;
    this.smoothedTrunkAngle = EMA_ALPHA * rawTrunkAngle + (1 - EMA_ALPHA) * this.prevSmoothedAngle;

    // Track shoulder velocity (p1) for smoothness metric — only during FLEXING/EXTENDING
    // AT_PEAK frames have near-zero velocity (user paused at peak) which inflates CV
    if (this.prevP1 && (this.repState === 'FLEXING' || this.repState === 'EXTENDING')) {
      const dt = 1 / 15; // approximate dt in seconds (assuming ~15fps)
      const dx = p1.x - this.prevP1.x;
      const dy = p1.y - this.prevP1.y;
      const vel = Math.sqrt(dx * dx + dy * dy) / dt;
      this.shoulderVelocities.push(vel);
    }
    this.prevP1 = { x: p1.x, y: p1.y };

    // Pre-flexion buffer: capture frames when 5° < trunk < 18° (for SSI)
    if (this.repState === 'NEUTRAL' && this.smoothedTrunkAngle > 5 && this.smoothedTrunkAngle < FLEXION_START_THRESHOLD) {
      this.preFlexionBuffer.push({ time: now, points: [p0, p1, p2, p3, p4] });
      if (this.preFlexionBuffer.length > 60) this.preFlexionBuffer.shift(); // cap growth
    }

    // ── CHIN-TUCK BASELINE ACCUMULATION ──
    // Capture neutral baseline: accumulate samples when user is upright and still
    if (
      nose && (nose.visibility ?? 0) >= 0.3 &&
      !this.neutralBaselineLocked &&
      this.repState === 'NEUTRAL' &&
      this.smoothedTrunkAngle < 5
    ) {
      this.neutralNoseEarSamples.push(nose.y - p0.y);
      if (this.neutralNoseEarSamples.length >= 15) {
        this.neutralNoseEarRelY =
          this.neutralNoseEarSamples.reduce((a, b) => a + b, 0) / this.neutralNoseEarSamples.length;
        this.neutralBaselineLocked = true;
      }
    }

    // ── CHIN-TUCK TRACKING (pre-flexion window: trunk <= 25°) ──
    // A proper chin tuck raises nose.y - ear.y BEFORE significant trunk bend.
    // Track the MAXIMUM (nose.y - ear.y) seen while trunk <= 25°
    if (
      nose && (nose.visibility ?? 0) >= 0.3 &&
      this.neutralNoseEarRelY !== null &&
      this.smoothedTrunkAngle <= 25
    ) {
      const noseEarDiff = nose.y - p0.y;
      if (noseEarDiff > this.peakPreFlexNoseEarY) {
        this.peakPreFlexNoseEarY = noseEarDiff;
      }
      this.preFlexNoseFrames++;
    }

    // ── FORM ADHERENCE (during flexion) ──
    // Count frames where thoracic curve is convex (upper segment > lower segment)
    const inFlexionState = this.repState === 'FLEXING' || this.repState === 'AT_PEAK';
    if (inFlexionState && this.smoothedTrunkAngle > 20) {
      this.flexionFrameCount++;
      const curveOK = checkThoracicCurve(
        p0,
        p1,
        p4,
        this.smoothedTrunkAngle,
        this.neutralUpperAngle!,
        this.neutralLowerAngle!
      );
      if (curveOK) this.goodCurveFrameCount++;
    }

    // ── RECORD FLEXION FRAME DATA (for SSI per rep) ──
    if (inFlexionState) {
      this.currentRepFlexionFrames.push({ time: now, points: [p0, p1, p2, p3, p4] });

      // Track peak trunk angles
      if (this.smoothedTrunkAngle > this.peakEMAAngle) {
        this.peakEMAAngle = this.smoothedTrunkAngle;
      }
      if (rawTrunkAngle > this.peakRawAngle) {
        this.peakRawAngle = rawTrunkAngle;
      }

      // Track how far the ear dropped
      if (p0.y > this.peakEarY) {
        this.peakEarY = p0.y;
      }

      // Track wave excess across ALL flexion frames
      const dyUpper = Math.max(0.01, p1.y - p0.y);
      const dyLower = Math.max(0.01, p4.y - p1.y);
      const wUpperAngle = Math.atan2(Math.abs(p1.x - p0.x), dyUpper) * (180 / Math.PI);
      const wLowerAngle = Math.atan2(Math.abs(p4.x - p1.x), dyLower) * (180 / Math.PI);
      const frameWaveExcess = wUpperAngle - this.neutralUpperAngle! - (wLowerAngle - this.neutralLowerAngle!);

      // Track early-phase wave excess (20-45° trunk window)
      if (this.smoothedTrunkAngle >= 20 && this.smoothedTrunkAngle <= 45) {
        if (frameWaveExcess > this.earlyPhaseWaveExcess) {
          this.earlyPhaseWaveExcess = frameWaveExcess;
        }
      }
    }

    // ── REP STATE MACHINE ──
    this.updateRepStateMachine(now, rawTrunkAngle, landmarks, p0, p1, p4);

    // ── UPDATE LIVE METRICS (every 200ms) ──
    if (now - this.lastTimeSeriesUpdate >= 200) {
      this.updateLiveMetrics();
      this.lastTimeSeriesUpdate = now;
    }

    // Update reference points for next frame
    this.p0 = p0;
    this.p1 = p1;
    this.p4 = p4;
  }

  /**
   * Rep state machine with validation gates.
   */
  private updateRepStateMachine(
    now: number,
    rawTrunkAngle: number,
    landmarks: NormalizedLandmark[],
    p0: SpinalPoint,
    p1: SpinalPoint,
    p4: SpinalPoint
  ): void {
    switch (this.repState) {
      case 'NEUTRAL':
        if (this.smoothedTrunkAngle >= FLEXION_START_THRESHOLD) {
          this.repState = 'FLEXING';
          this.stablePeakCount = 0;
          this.peakRawAngle = rawTrunkAngle;
          this.peakEMAAngle = this.smoothedTrunkAngle;
          this.shoulderVelocities = [];
          // Prepend early-movement frames so SSI sees the head-nod onset
          this.currentRepFlexionFrames = [...this.preFlexionBuffer];
          this.preFlexionBuffer = [];
        } else if (this.smoothedTrunkAngle <= 3) {
          // User returned to fully upright — discard pre-flexion buffer
          this.preFlexionBuffer = [];
        }
        break;

      case 'FLEXING':
        // ESCAPE: user returned to neutral before reaching MIN_PEAK_ANGLE
        if (this.smoothedTrunkAngle <= NEUTRAL_THRESHOLD) {
          this.resetRepState();
          this.repState = 'NEUTRAL';
          break;
        }

        // Track peak
        if (rawTrunkAngle > this.peakRawAngle) {
          this.peakRawAngle = rawTrunkAngle;
          this.stablePeakCount = 0;
        } else if (Math.abs(this.smoothedTrunkAngle - this.peakEMAAngle) <= PEAK_THRESHOLD_DEG) {
          this.stablePeakCount++;
          if (this.stablePeakCount >= PEAK_STABLE_FRAMES && this.peakEMAAngle >= MIN_PEAK_ANGLE) {
            this.repState = 'AT_PEAK';
          }
        } else if (this.smoothedTrunkAngle < this.peakEMAAngle - PEAK_THRESHOLD_DEG) {
          // Angle declined — transition to AT_PEAK if sufficient flexion
          if (this.peakEMAAngle >= MIN_PEAK_ANGLE) {
            this.repState = 'AT_PEAK';
          }
        }
        break;

      case 'AT_PEAK':
        if (this.smoothedTrunkAngle < this.peakEMAAngle - PEAK_THRESHOLD_DEG) {
          this.repState = 'EXTENDING';
        }
        break;

      case 'EXTENDING':
        if (this.smoothedTrunkAngle <= NEUTRAL_THRESHOLD) {
          // Rep complete — validate and count
          this.validateAndCountRep(landmarks, p0, p1, p4);
          this.repState = 'NEUTRAL';
          this.currentRepFlexionFrames = [];
          this.preFlexionBuffer = [];
          this.repPopAnimationStart = now;
        }
        break;
    }
  }

  /**
   * Reset per-rep tracking variables for next rep.
   */
  private resetRepState(): void {
    this.peakRawAngle = 0;
    this.peakEMAAngle = 0;
    this.peakEarY = 0;
    this.peakPreFlexNoseEarY = -Infinity;
    this.preFlexNoseFrames = 0;
    this.earlyPhaseWaveExcess = -Infinity;
    this.stablePeakCount = 0;
  }

  /**
   * Validate rep against all gates and count if valid.
   */
  private validateAndCountRep(
    landmarks: NormalizedLandmark[],
    p0: SpinalPoint,
    p1: SpinalPoint,
    p4: SpinalPoint
  ): void {
    // Gate 1: Raw peak >= 30°
    if (this.peakRawAngle < MIN_VALID_REP_ANGLE) {
      this.resetRepState();
      return;
    }

    // Gate 2: Ear-drop >= 12% of torsoHeight
    if (this.torsoHeight === null) {
      this.resetRepState();
      return;
    }
    // Ear must DROP (y increases downward in normalized coords)
    const earDrop = this.peakEarY - (this.p0?.y ?? 0);
    const minEarDrop = this.torsoHeight * MIN_EAR_DROP_RATIO;
    if (earDrop < minEarDrop) {
      this.resetRepState();
      return;
    }

    // Gate 3: Chin-tuck validation (primary and compound gates)
    const chinTuckDelta = this.peakPreFlexNoseEarY - this.neutralNoseEarRelY!;
    const chinTuckOk = this.neutralNoseEarRelY !== null && chinTuckDelta >= MIN_CHIN_TUCK;
    const compoundGateOk =
      this.neutralNoseEarRelY !== null &&
      chinTuckDelta >= MIN_CHIN_TUCK_ASSISTED &&
      this.earlyPhaseWaveExcess >= MIN_WAVE_EXCESS_ASSIST;

    if (!chinTuckOk && !compoundGateOk) {
      this.resetRepState();
      return;
    }

    // All gates passed — compute SSI and completion
    const ssi = this.computeSSI();
    const completion = this.peakRawAngle >= COMPLETION_FULL ? 100 : (this.peakRawAngle >= COMPLETION_PARTIAL ? 50 : 0);

    // Record rep
    this.completedReps++;
    this.repSSIValues.push(ssi);
    this.repCompletions.push(completion);
    this.repMaxAngles.push(this.peakRawAngle);

    // Reset for next rep
    this.resetRepState();
  }

  /**
   * Compute Segment Symmetry Index (SSI) — iterate through flexion frames
   * to find when upper and lower segments first exceed neutral+5°.
   */
  private computeSSI(): number {
    if (this.currentRepFlexionFrames.length < 3) {
      return 60; // insufficient frames — conservative fallback
    }

    let upperOnset: number | null = null;
    let lowerOnset: number | null = null;

    for (const frame of this.currentRepFlexionFrames) {
      const fp0 = frame.points[0];
      const fp1 = frame.points[1];
      const fp4 = frame.points[4];

      if (upperOnset === null) {
        const upperAngle = getSegmentAngle(fp0, fp1);
        if (upperAngle - this.neutralUpperAngle! > SSI_ONSET_DEG) {
          upperOnset = frame.time;
        }
      }

      if (lowerOnset === null) {
        const lowerAngle = getSegmentAngle(fp1, fp4);
        if (lowerAngle - this.neutralLowerAngle! > SSI_ONSET_DEG) {
          lowerOnset = frame.time;
        }
      }

      if (upperOnset !== null && lowerOnset !== null) break;
    }

    // If neither segment moved — very shallow rep
    if (upperOnset === null && lowerOnset === null) {
      return 60;
    }

    // Only one segment moved
    if (upperOnset === null) {
      return 60; // lower leads
    }
    if (lowerOnset === null) {
      return 100; // upper leads
    }

    // Both moved — determine sequence
    if (upperOnset < lowerOnset) return 100; // upper leads → perfect wave
    if (upperOnset === lowerOnset) return 80; // simultaneous → borderline
    return 60; // lower leads → block movement
  }

  /**
   * Update live MQS and SSI metrics.
   */
  private updateLiveMetrics(): void {
    if (this.completedReps === 0) {
      this.liveMQS = 0;
      this.liveSSI = 0;
      return;
    }

    // Smoothness: CV-based from shoulder velocities
    const smoothness = Math.max(0, 100 - computeVelocityCV(this.shoulderVelocities) * 100);

    // Form adherence: computed from thoracic curve quality
    const formAdherence = this.flexionFrameCount > 0 ? (this.goodCurveFrameCount / this.flexionFrameCount) * 100 : 100;

    // Completion: average of per-rep completions
    const completionAvg = this.repCompletions.length > 0
      ? this.repCompletions.reduce((a, b) => a + b, 0) / this.repCompletions.length
      : 0;

    // MQS = smoothness*0.35 + formAdherence*0.40 + completionAvg*0.25
    this.liveMQS = smoothness * 0.35 + formAdherence * 0.4 + completionAvg * 0.25;

    // SSI = average of per-rep SSI
    this.liveSSI = this.repSSIValues.length > 0
      ? this.repSSIValues.reduce((a, b) => a + b, 0) / this.repSSIValues.length
      : 100; // optimistic default before any reps

    // Record time series point
    const elapsed = this.startTime > 0 ? Math.round((performance.now() - this.startTime) / 1000) : 0;
    this.timeSeries.push({
      timestamp: elapsed,
      mqs: Math.round(this.liveMQS),
    });
  }

  /**
   * Render canvas overlays (skeleton, spinal curve, HUD bars, rep counter).
   */
  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.calReady || !this.p0 || !this.p1 || !this.p4) return;

    ctx.save();

    // ── Draw spinal curve (Catmull-Rom) ──
    const p0 = this.p0;
    const p1 = this.p1;
    const p4 = this.p4;
    const p2 = lerp(p1, p4, 0.33);
    const p3 = lerp(p1, p4, 0.67);

    const isGoodForm = checkThoracicCurve(
      p0,
      p1,
      p4,
      this.smoothedTrunkAngle,
      this.neutralUpperAngle!,
      this.neutralLowerAngle!
    );
    const curveColor = isGoodForm ? 'rgba(0, 229, 204, 0.8)' : 'rgba(255, 181, 71, 0.8)';

    ctx.strokeStyle = curveColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p0.x * w, p0.y * h);

    for (let t = 0; t <= 1; t += 0.05) {
      const point = catmullRom(p0, p1, p2, p3, t);
      ctx.lineTo(point.x * w, point.y * h);
    }
    ctx.stroke();

    // ── Draw spine reference dots ──
    const dots = [p0, p1, p2, p3, p4];
    dots.forEach((dot, idx) => {
      ctx.fillStyle = idx < 2 ? 'rgba(0, 229, 204, 0.6)' : 'rgba(100, 100, 100, 0.4)';
      ctx.beginPath();
      ctx.arc(dot.x * w, dot.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Draw MQS vertical bar (right edge) ──
    const barWidth = 8;
    const barHeight = h * 0.4;
    const barY = h * 0.3;
    const mqs = Math.min(100, Math.max(0, this.liveMQS));

    ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.fillRect(w - barWidth - 10, barY, barWidth, barHeight);

    ctx.fillStyle = 'rgba(0, 229, 204, 0.7)';
    ctx.fillRect(w - barWidth - 10, barY + barHeight * (1 - mqs / 100), barWidth, barHeight * (mqs / 100));

    // ── Draw SSI horizontal bar (bottom) ──
    const ssiBarWidth = w * 0.4;
    const ssiBarHeight = 6;
    const ssi = Math.min(100, Math.max(0, this.liveSSI));

    ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.fillRect((w - ssiBarWidth) / 2, h - ssiBarHeight - 20, ssiBarWidth, ssiBarHeight);

    ctx.fillStyle = 'rgba(255, 181, 71, 0.7)';
    ctx.fillRect((w - ssiBarWidth) / 2, h - ssiBarHeight - 20, (ssiBarWidth * ssi) / 100, ssiBarHeight);

    // ── Draw rep counter with pop animation ──
    const now = performance.now();
    const elapsed = now - this.repPopAnimationStart;
    let scale = 1;
    if (elapsed < this.repPopAnimationDuration && this.repPopAnimationStart > 0) {
      const progress = elapsed / this.repPopAnimationDuration;
      scale = 1 + Math.sin(progress * Math.PI) * 0.3; // Pop effect
    }

    ctx.font = `bold ${Math.round(28 * scale)}px sans-serif`;
    ctx.fillStyle = 'rgba(0, 229, 204, 0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(`Reps: ${this.completedReps}`, w * 0.5, h * 0.2);

    // ── Draw pose loss warning if needed ──
    if (performance.now() - this.lastValidLandmarkTime > POSE_LOSS_DEBOUNCE) {
      ctx.fillStyle = 'rgba(255, 100, 100, 0.8)';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('Pose Lost', w * 0.5, h * 0.5);
    }

    ctx.restore();
  }

  /**
   * Get HUD metrics for display.
   */
  getHudMetrics(): HudMetrics {
    const elapsed = this.startTime > 0 ? Math.round((performance.now() - this.startTime) / 1000) : 0;
    return {
      primary: { label: 'MQS', value: Math.round(this.liveMQS), color: '#00E5CC' },
      secondary: { label: 'SSI', value: Math.round(this.liveSSI), color: '#FFB547' },
      timer: { elapsed, total: SAP_DURATION },
      instruction: 'Slowly roll your spine forward like a wave',
      extra: { label: 'Reps', value: this.completedReps },
    };
  }

  /**
   * Check if game is complete (timer expired).
   */
  isComplete(): boolean {
    return this.complete;
  }

  /**
   * Get raw data for score submission.
   */
  getRawData(): Record<string, unknown> {
    const smoothness = Math.max(0, 100 - computeVelocityCV(this.shoulderVelocities) * 100);
    const formAdherence = this.flexionFrameCount > 0 ? (this.goodCurveFrameCount / this.flexionFrameCount) * 100 : 0;
    const completionAvg = this.repCompletions.length > 0
      ? this.repCompletions.reduce((a, b) => a + b, 0) / this.repCompletions.length
      : 0;
    const finalMQS = smoothness * 0.35 + formAdherence * 0.4 + completionAvg * 0.25;
    const finalSSI = this.repSSIValues.length > 0
      ? this.repSSIValues.reduce((a, b) => a + b, 0) / this.repSSIValues.length
      : 60;
    const activeElapsed = this.startTime > 0 ? Math.round((performance.now() - this.startTime) / 1000) : 0;

    return {
      testId: 'KS3',
      mqs: Math.round(finalMQS),
      mqsSmoothnessComponent: Math.round(smoothness),
      mqsFormComponent: Math.round(formAdherence),
      mqsCompletionComponent: Math.round(completionAvg),
      ssi: Math.round(finalSSI),
      repsCompleted: this.completedReps,
      repSSIValues: this.repSSIValues.map((v) => Math.round(v)),
      repCompletions: this.repCompletions,
      repMaxAngles: this.repMaxAngles.map((v) => Math.round(v)),
      maxTrunkAngle: this.repMaxAngles.length > 0 ? Math.max(...this.repMaxAngles) : 0,
      duration: activeElapsed,
      timeSeries: this.timeSeries,
    };
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  // ── Private helpers ──

  /**
   * Start interval timer to track elapsed time and auto-complete.
   */
  private startTimer(): void {
    this.timerId = setInterval(() => {
      const elapsed = Math.floor((performance.now() - this.startTime) / 1000);
      if (elapsed >= SAP_DURATION) {
        this.complete = true;
        this.updateLiveMetrics();
        if (this.timerId) {
          clearInterval(this.timerId);
          this.timerId = null;
        }
      }
    }, 250);
  }
}
