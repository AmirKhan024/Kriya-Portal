/**
 * Standing Lateral Flexion (KS4/MM4) Engine — Bilateral trunk mobility assessment
 *
 * Game structure: Calibration (upright posture) → Phase 1 (left bend, 20s) →
 * Transition (5s) → Phase 2 (right bend, 20s) → Complete (45s total)
 *
 * Movement quality: Smooth lateral trunk bending with proper form (no rotation,
 * no hip lean, feet planted, overhead arm extended). Rep detection via state machine.
 *
 * Scoring: MQS per phase (smoothness*0.35 + formAdherence*0.40 + completion*0.25),
 * TCI as left/right symmetry, musculage computed from age-normalized conditioned score.
 */

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics, type NormalizedLandmark } from './types';
import { speakInstruction } from '@/lib/game/audio-feedback';

// ─── Type Definitions ─────────────────────────────────────────────────────────

interface RepData {
  peakAngle: number;
  startFrame: number;
  endFrame: number;
  duration: number;
  smoothness: number;
  formAdherence: number;
  completion: number;
  mqs: number;
}

interface CalibrationData {
  shoulderMidX: number;
  shoulderMidY: number;
  hipMidX: number;
  hipMidY: number;
  shoulderWidth: number;
  trunkLength: number;
  refAnkleL: NormalizedLandmark;
  refAnkleR: NormalizedLandmark;
  baselineAngle: number;
}

interface FormCriteriaResult {
  rotationOk: boolean;
  rotationRatio: number;
  leanOk: boolean;
  hipDeviation: number;
  feetOk: boolean;
  maxAnkleDrift: number;
  armOk: boolean;
  score: number;
}

// ─── Calibration Constants ────────────────────────────────────────────────────

const CAL_VISIBILITY_THRESHOLD = 0.3;
const CAL_CONFIRM_DURATION = 2000; // ms — 2.0s hold (consistent with KS5/KS6)
const CAL_TIMEOUT_MS = 20000;
const MIN_LANDMARK_CONFIDENCE = 0.5;

// ─── Game Logic Constants ─────────────────────────────────────────────────────

const PHASE_DURATION = 20; // seconds per side
const TRANSITION_DURATION = 5; // seconds between sides
const POSE_LOSS_DEBOUNCE = 800;
const EMA_ALPHA = 0.35;
const BEND_START_THRESHOLD = 8; // degrees
const PEAK_HOLD_THRESHOLD = 2; // degrees
const PEAK_HOLD_FRAMES = 8; // V2-ported 2026-05-14 — V2 PEAK_HOLD_FRAMES=8 (was 3, too sensitive)
const RETURN_THRESHOLD = 8; // degrees
const MIN_VALID_PEAK = 20; // V2-ported 2026-05-14 — V2 MIN_VALID_PEAK=20° (was 15°)
const MIN_BENDING_DURATION_MS = 600; // V2-ported 2026-05-14 — V2 prevents rapid-bounce reps
const SMOOTHNESS_SCALING_FACTOR = 0.20;
const FORM_ROTATION_MIN = 0.80;
const FORM_ROTATION_MAX = 1.10;
const FORM_HIP_DEVIATION_MAX = 0.08; // 8% of trunk length
const FORM_ANKLE_DRIFT_MAX = 0.12; // 12% of shoulder width
const SMOOTHNESS_WEIGHT = 0.35;
const FORM_ADHERENCE_WEIGHT = 0.40;
const COMPLETION_WEIGHT = 0.25;

// ─── Rendering Constants ─────────────────────────────────────────────────────

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
 * Compute lateral trunk angle: angle between shoulder-mid and hip-mid vectors
 */
function computeLateralAngleDeg(lm: NormalizedLandmark[]): number {
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
  const dy = hipMidY - shoulderMidY; // y increases downward

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
 * Compute sample variance of array
 */
function sampleVariance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const sumSquares = arr.reduce((sum, v) => sum + Math.pow(v - m, 2), 0);
  return sumSquares / (arr.length - 1);
}

/**
 * Compute completion score based on peak angle
 */
function getCompletionScore(peakAngleDeg: number): number {
  if (peakAngleDeg >= 30) return 100;
  if (peakAngleDeg >= 20) return 75;
  if (peakAngleDeg >= 10) return 50;
  if (peakAngleDeg >= 5) return 25;
  return 0;
}

/**
 * Compute smoothness score from angular velocities
 */
function computeSmoothness(velocities: number[], measuredFPS: number): number {
  if (velocities.length < 10) {
    return 0;
  }

  const absVelocities = velocities.map(v => Math.abs(v));
  const variance = sampleVariance(absVelocities);
  const fpsRatio = 30 / Math.max(1, measuredFPS);
  const adjustedScale = SMOOTHNESS_SCALING_FACTOR * (fpsRatio * fpsRatio);
  const rawScore = 100 - variance * adjustedScale;
  return Math.max(0, Math.min(100, rawScore));
}

// ─── Engine Class ─────────────────────────────────────────────────────────────

export class LateralFlexionEngine implements GameEngine {
  // ── Calibration State ──
  private calGoodStart = 0;
  private calStartTime = 0;
  private calReady = false;

  // ── Calibration References ──
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

  // ── Lateral flexion angle tracking ──
  private smoothedAngle = 0;
  private prevSmoothedAngle = 0;
  private isFirstAngleFrame = true;
  private frameIndex = 0;

  // ── Rep detection state machine ──
  private repState: 'NEUTRAL' | 'BENDING' | 'PEAK' | 'RETURNING' = 'NEUTRAL';
  private maxAngleInRep = 0;
  private peakAngle = 0;
  private peakStableCount = 0;
  private repStartFrame = 0;

  // ── Per-rep data collection ──
  private repAngularVelocities: number[] = [];
  private repFormScores: number[] = [];
  private lastAngleForVelocity = 0;
  private lastVelocityTime = 0;

  // ── Per-phase results ──
  private repsL: RepData[] = [];
  private repsR: RepData[] = [];
  private phaseMqsL = 0;
  private phaseMqsR = 0;

  // ── Phase-level form tracking (for fallback MQS when 0 reps) ──
  private phaseFormScores: number[] = [];
  private phaseAngularVelocities: number[] = [];
  private phaseBestPeakAngle = 0;

  // ── Pose and confidence tracking ──
  private lowConfidenceFrames = 0;
  private totalFrames = 0;
  private measuredFPS = 30;
  private fpsFrameCount = 0;
  private fpsStartTime = 0;

  // ── Direction verification ──
  private directionVerifyCount = 0;

  // ── Rendering ──
  private lastLandmarks: NormalizedLandmark[] | null = null;

  // ── Instruction text ──
  private instructionText = '';
  /** Per-deviation activation counters (transition 0 → now triggers ++). */
  private devCounts: Record<string, number> = {};
  // Time series for Movement Over Time chart
  private timeSeries: Array<{ timestamp: number; tiltAngle: number; side: string }> = [];
  private lastTimeSeriesAt = 0;
  // V2 deviation catalog (ported 2026-05-15)
  private wrongDirSince = 0;
  private tooFarSince = 0;
  private tooCloseSince = 0;
  private idleSince = 0;
  private partialBendSince = 0;
  private armNotOverheadSince = 0;
  private hipShiftSince = 0;
  private kneeBendSince = 0;
  private trunkRotationSince = 0;
  private latFlexLastWarningKey = '';
  private latFlexLastWarningAt = 0;

  constructor() {
    this.reset();
  }

  private latFlexMaybeSpeak(key: string, text: string, cooldownMs: number): void {
    const now = performance.now();
    if (this.latFlexLastWarningKey === key && now - this.latFlexLastWarningAt < cooldownMs) return;
    // Only update per-key cooldown when speech actually fires — otherwise
    // a dropped second-slot warning ghost-silences itself for cooldownMs.
    const spoke = speakInstruction(text);
    if (spoke) {
      this.latFlexLastWarningKey = key;
      this.latFlexLastWarningAt = now;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GameEngine Interface
  // ═══════════════════════════════════════════════════════════════════════════

  reset(): void {
    this.calGoodStart = 0;
    this.calStartTime = 0;
    this.calReady = false;

    this.calData = null;

    this.startTime = 0;
    this.elapsed = 0;
    this.gameComplete = false;

    this.phase = 0;
    this.phaseState = 'idle';
    this.phaseStartTime = 0;
    this.totalElapsed = 0;
    this.transitionStartTime = 0;

    this.poseLostSince = null;
    this.timerFrozenTime = 0;

    this.smoothedAngle = 0;
    this.prevSmoothedAngle = 0;
    this.isFirstAngleFrame = true;
    this.frameIndex = 0;

    this.repState = 'NEUTRAL';
    this.maxAngleInRep = 0;
    this.peakAngle = 0;
    this.peakStableCount = 0;
    this.repStartFrame = 0;

    this.repAngularVelocities = [];
    this.repFormScores = [];
    this.lastAngleForVelocity = 0;
    this.lastVelocityTime = 0;

    this.repsL = [];
    this.repsR = [];
    this.phaseMqsL = 0;
    this.phaseMqsR = 0;

    this.phaseFormScores = [];
    this.phaseAngularVelocities = [];
    this.phaseBestPeakAngle = 0;

    this.lowConfidenceFrames = 0;
    this.totalFrames = 0;
    this.measuredFPS = 30;
    this.fpsFrameCount = 0;
    this.fpsStartTime = 0;

    this.directionVerifyCount = 0;

    this.lastLandmarks = null;
    this.instructionText = '';
    this.timeSeries = [];
    this.lastTimeSeriesAt = 0;
    this.wrongDirSince = 0;
    this.tooFarSince = 0;
    this.tooCloseSince = 0;
    this.idleSince = 0;
    this.partialBendSince = 0;
    this.armNotOverheadSince = 0;
    this.hipShiftSince = 0;
    this.kneeBendSince = 0;
    this.trunkRotationSince = 0;
    this.latFlexLastWarningKey = '';
    this.latFlexLastWarningAt = 0;
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
      return {
        isReady: false,
        progress: 0,
        message: 'Calibration timed out — tap to retry',
      };
    }

    // Gate: Full body visible with confidence
    const requiredLandmarks = [
      LM.LEFT_SHOULDER,
      LM.RIGHT_SHOULDER,
      LM.LEFT_HIP,
      LM.RIGHT_HIP,
      LM.LEFT_KNEE,
      LM.RIGHT_KNEE,
      LM.LEFT_WRIST,
      LM.RIGHT_WRIST,
      LM.LEFT_ANKLE,
      LM.RIGHT_ANKLE,
    ];

    for (const idx of requiredLandmarks) {
      const lm = landmarks[idx];
      if (!lm || lm.visibility < CAL_VISIBILITY_THRESHOLD) {
        return {
          isReady: false,
          progress: 0,
          message: 'Full body not visible',
        };
      }
      // Check frame bounds
      if (lm.x < 0.05 || lm.x > 0.95 || lm.y < 0.05 || lm.y > 0.95) {
        return { isReady: false, progress: 0, message: 'Move closer to camera' };
      }
    }

    const ls = landmarks[LM.LEFT_SHOULDER]!;
    const rs = landmarks[LM.RIGHT_SHOULDER]!;
    const lh = landmarks[LM.LEFT_HIP]!;
    const rh = landmarks[LM.RIGHT_HIP]!;
    const lw = landmarks[LM.LEFT_WRIST]!;
    const rw = landmarks[LM.RIGHT_WRIST]!;
    const la = landmarks[LM.LEFT_ANKLE]!;
    const ra = landmarks[LM.RIGHT_ANKLE]!;

    // Gate A: Upright trunk (|angle| < 12°)
    const shoulderMidX = (ls.x + rs.x) / 2;
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidX = (lh.x + rh.x) / 2;
    const hipMidY = (lh.y + rh.y) / 2;

    const dx = shoulderMidX - hipMidX;
    const dy = hipMidY - shoulderMidY;
    const lateralAngle = Math.atan2(dx, dy) * (180 / Math.PI);

    if (Math.abs(lateralAngle) >= 12) {
      return { isReady: false, progress: 0, message: 'Stand upright' };
    }

    // Gate B: Feet planted (ankle distance ratio 0.5-2.0× shoulder width)
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const ankleDistance = Math.abs(la.x - ra.x);
    const ankleRatio = ankleDistance / shoulderWidth;

    if (ankleRatio < 0.5 || ankleRatio > 2.0) {
      return { isReady: false, progress: 0, message: 'Feet shoulder-width apart' };
    }

    // Gate C: Arms at sides (wrists at or below hips, 0.05 tolerance)
    if (lw.y < lh.y - 0.05 || rw.y < rh.y - 0.05) {
      return { isReady: false, progress: 0, message: 'Arms at your sides' };
    }

    // Gate D: Facing camera (shoulder width > 10% of frame)
    if (shoulderWidth < 0.10) {
      return { isReady: false, progress: 0, message: 'Face the camera' };
    }

    // All gates pass — confirm hold
    this.calGoodStart = this.calGoodStart === 0 ? now : this.calGoodStart;
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
   * Called after countdown finishes to begin game play
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
    this.isFirstAngleFrame = true;
    this.frameIndex = 0;
    this.repState = 'NEUTRAL';
    this.phaseFormScores = [];
    this.phaseAngularVelocities = [];
    this.phaseBestPeakAngle = 0;
    this.lowConfidenceFrames = 0;
    this.totalFrames = 0;
    this.fpsFrameCount = 0;
    this.fpsStartTime = now;
    this.directionVerifyCount = 0;
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
    const visibleHips =
      (landmarks[LM.LEFT_HIP]?.visibility ?? 0) > 0.3 &&
      (landmarks[LM.RIGHT_HIP]?.visibility ?? 0) > 0.3;

    if (!visibleHips) {
      if (!this.poseLostSince) {

        this.poseLostSince = now;

        this.devCounts.poseLost = (this.devCounts.poseLost ?? 0) + 1;

      }
      return;
    }

    // Pose recovered
    if (this.poseLostSince !== null) {
      this.poseLostSince = null;
    }

    // Handle transition and phase logic
    if (this.phaseState === 'transition') {
      const transElapsed = (now - this.transitionStartTime) / 1000;
      if (transElapsed >= TRANSITION_DURATION) {
        this.phaseState = 'active';
        this.phase = 2;
        this.phaseStartTime = now;
        this.isFirstAngleFrame = true;
        this.repState = 'NEUTRAL';
        this.phaseFormScores = [];
        this.phaseAngularVelocities = [];
        this.phaseBestPeakAngle = 0;
        this.lowConfidenceFrames = 0;
        this.totalFrames = 0;
        this.fpsFrameCount = 0;
        this.fpsStartTime = now;
        this.directionVerifyCount = 0;
      }
      return;
    }

    if (this.phaseState !== 'active') return;

    // Check if phase is complete
    const phaseElapsed = (now - this.phaseStartTime) / 1000;
    const phaseRemaining = Math.max(0, PHASE_DURATION - phaseElapsed);

    if (phaseRemaining <= 0) {
      // Salvage partial rep if needed
      if (this.repState !== 'NEUTRAL' && this.maxAngleInRep > BEND_START_THRESHOLD) {
        const salvagePeak = this.peakAngle > 0 ? this.peakAngle : this.maxAngleInRep;
        if (salvagePeak >= MIN_VALID_PEAK) {
          const repData = this.recordRep(salvagePeak);
          if (this.phase === 1) {
            this.repsL.push(repData);
          } else {
            this.repsR.push(repData);
          }
        }
        this.repState = 'NEUTRAL';
      }

      if (this.phase === 1) {
        this.phaseMqsL = this.computePhaseMQS(this.repsL, this.phaseFormScores, this.phaseAngularVelocities);
        this.phaseState = 'transition';
        this.transitionStartTime = now;
      } else {
        this.phaseMqsR = this.computePhaseMQS(this.repsR, this.phaseFormScores, this.phaseAngularVelocities);
        this.gameComplete = true;
      }
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Frame Processing
    // ════════════════════════════════════════════════════════════════════════

    // FPS measurement
    this.fpsFrameCount++;
    if (this.fpsFrameCount >= 30) {
      const elapsed = (now - this.fpsStartTime) / 1000;
      if (elapsed > 0) {
        this.measuredFPS = this.fpsFrameCount / elapsed;
      }
      this.fpsFrameCount = 0;
      this.fpsStartTime = now;
    }

    // Landmark confidence check
    this.totalFrames++;
    const primaryIndices = [11, 12, 23, 24]; // shoulders + hips
    const lowConf = primaryIndices.some((i) => {
      const lm = landmarks[i];
      return !lm || (lm.visibility ?? 0) < MIN_LANDMARK_CONFIDENCE;
    });

    if (lowConf) {
      this.lowConfidenceFrames++;
      return; // Skip scoring on low confidence frames
    }

    // Compute lateral flexion angle
    const rawAngleDeg = computeLateralAngleDeg(landmarks);

    // EMA smoothing
    if (this.isFirstAngleFrame) {
      this.smoothedAngle = rawAngleDeg;
      this.isFirstAngleFrame = false;
    } else {
      this.smoothedAngle = ema(rawAngleDeg, this.smoothedAngle, EMA_ALPHA);
    }

    // Effective angle for scoring (absolute value)
    const effectiveAngle = Math.abs(this.smoothedAngle);

    // ── V2 deviation detection (ported 2026-05-15) ──
    const _ls = landmarks[LM.LEFT_SHOULDER];
    const _rs = landmarks[LM.RIGHT_SHOULDER];
    const _lh = landmarks[LM.LEFT_HIP];
    const _rh = landmarks[LM.RIGHT_HIP];
    const _lw = landmarks[LM.LEFT_WRIST];
    const _rw = landmarks[LM.RIGHT_WRIST];
    const _lk = landmarks[LM.LEFT_KNEE];
    const _rk = landmarks[LM.RIGHT_KNEE];
    const _la = landmarks[LM.LEFT_ANKLE];
    const _ra = landmarks[LM.RIGHT_ANKLE];
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
      // TRUNK ROTATION — shoulder Z-diff vs baseline
      if (Math.abs((_ls.z ?? 0) - (_rs.z ?? 0)) > 0.12) {
        if (!this.trunkRotationSince) {

          this.trunkRotationSince = now;

          this.devCounts.trunkRotation = (this.devCounts.trunkRotation ?? 0) + 1;

        }
      } else { this.trunkRotationSince = 0; }
      // HIP SHIFT — hip midpoint vs ankle midpoint lateral offset
      if (_la && _ra) {
        const hipMidX = (_lh.x + _rh.x) / 2;
        const ankleMidX = (_la.x + _ra.x) / 2;
        if (Math.abs(hipMidX - ankleMidX) > 0.07) {
          if (!this.hipShiftSince) {

            this.hipShiftSince = now;

            this.devCounts.hipShift = (this.devCounts.hipShift ?? 0) + 1;

          }
        } else { this.hipShiftSince = 0; }
      }
    }
    // ARM NOT OVERHEAD — wrists should be above shoulders during bend
    if (_lw && _rw && _ls && _rs && effectiveAngle > BEND_START_THRESHOLD) {
      const wristAboveShoulder = _lw.y < _ls.y - 0.08 || _rw.y < _rs.y - 0.08;
      if (!wristAboveShoulder) {
        if (!this.armNotOverheadSince) {

          this.armNotOverheadSince = now;

          this.devCounts.armNotOverhead = (this.devCounts.armNotOverhead ?? 0) + 1;

        }
      } else { this.armNotOverheadSince = 0; }
    } else {
      this.armNotOverheadSince = 0;
    }
    // KNEE BEND — knee Y should be predictable from hip+ankle midpoint
    if (_lk && _rk && _lh && _rh && _la && _ra) {
      const expectedLY = (_lh.y + _la.y) / 2;
      const expectedRY = (_rh.y + _ra.y) / 2;
      if (Math.abs(_lk.y - expectedLY) > 0.05 || Math.abs(_rk.y - expectedRY) > 0.05) {
        if (!this.kneeBendSince) {

          this.kneeBendSince = now;

          this.devCounts.kneeBend = (this.devCounts.kneeBend ?? 0) + 1;

        }
      } else { this.kneeBendSince = 0; }
    }
    // IDLE — angle stays small for sustained period
    if (effectiveAngle < 6) {
      if (!this.idleSince) {

        this.idleSince = now;

        this.devCounts.idle = (this.devCounts.idle ?? 0) + 1;

      }
    } else { this.idleSince = 0; }
    // PARTIAL BEND — angle plateaus between BEND_START and MIN_VALID_PEAK
    if (effectiveAngle > BEND_START_THRESHOLD && effectiveAngle < MIN_VALID_PEAK - 2) {
      if (!this.partialBendSince) {

        this.partialBendSince = now;

        this.devCounts.partialBend = (this.devCounts.partialBend ?? 0) + 1;

      }
    } else { this.partialBendSince = 0; }
    // WRONG DIRECTION — sign of smoothedAngle conflicts with phase.
    // computeLateralAngleDeg returns atan2(shoulderMidX − hipMidX, hipMidY − shoulderMidY).
    // User bends to their LEFT → shoulders shift toward image-right (in raw,
    // non-mirrored landmark coords) → dx > 0 → angle POSITIVE.
    // So phase 1 (LEFT) expects angle > 0; phase 2 (RIGHT) expects angle < 0.
    const expectedSignPos = this.phase === 1;
    if (effectiveAngle > BEND_START_THRESHOLD) {
      const actualPos = this.smoothedAngle > 0;
      if (actualPos !== expectedSignPos) {
        if (!this.wrongDirSince) {

          this.wrongDirSince = now;

          this.devCounts.wrongDir = (this.devCounts.wrongDir ?? 0) + 1;

        }
      } else { this.wrongDirSince = 0; }
    } else { this.wrongDirSince = 0; }

    // Direction verification (first 5 frames)
    this.directionVerifyCount++;

    // Form criteria evaluation
    const formResult = this.evaluateFormCriteria(landmarks);

    // Collect phase-level form data
    this.phaseFormScores.push(formResult.score);

    // Angular velocity tracking
    if (this.lastVelocityTime > 0) {
      const dt = (now - this.lastVelocityTime) / 1000; // seconds
      if (dt > 0) {
        const angularVelocity = (this.smoothedAngle - this.lastAngleForVelocity) / dt; // degrees/s
        if (Math.abs(angularVelocity) > 1.0) {
          this.phaseAngularVelocities.push(angularVelocity);
          if (this.repState !== 'NEUTRAL') {
            this.repAngularVelocities.push(angularVelocity);
          }
        }
      }
    }
    this.lastAngleForVelocity = this.smoothedAngle;
    this.lastVelocityTime = now;

    // Rep detection state machine
    this.processRepDetection(effectiveAngle, formResult.score);

    // Track best peak angle for the phase
    if (effectiveAngle > this.phaseBestPeakAngle) {
      this.phaseBestPeakAngle = effectiveAngle;
    }

    this.prevSmoothedAngle = this.smoothedAngle;
    this.frameIndex++;

    // Record time-series point every 100ms (V2 parity)
    if (now - this.lastTimeSeriesAt >= 100) {
      this.timeSeries.push({
        timestamp: this.totalElapsed,
        tiltAngle: this.smoothedAngle,
        side: this.phase === 1 ? 'left' : 'right',
      });
      this.lastTimeSeriesAt = now;
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.lastLandmarks) return;

    // Draw skeleton
    this.drawSkeleton(ctx, width, height);

    // Draw trunk tilt arc
    if (this.phaseState === 'active') {
      this.drawTrunkTiltArc(ctx, width, height);
    }
  }

  getHudMetrics(): HudMetrics {
    if (!this.calReady || this.gameComplete) {
      return {};
    }

    const currentPhaseReps = this.phase === 1 ? this.repsL : this.repsR;
    const liveMqs = this.computeLiveMQS(currentPhaseReps, this.phaseFormScores);
    const phaseElapsed = (performance.now() - this.phaseStartTime) / 1000;
    const now = performance.now();

    const label =
      this.phase === 1
        ? '← LEFT SIDE'
        : this.phase === 2
          ? 'RIGHT SIDE →'
          : '';

    const dirLabel = this.phase === 1 ? 'LEFT' : 'RIGHT';
    let warningSlot1: string | undefined;
    let warningSlot2: string | undefined;
    let instructionText = `Bend to the ${dirLabel}`;
    let instructionColor = '#94a3b8';

    // SLOT 1 (RED) — wrong_dir > too_far > too_close > arm_not_overhead > idle > partial_bend
    if (this.wrongDirSince > 0 && now - this.wrongDirSince > 600) {
      warningSlot1 = `⚠ Bend to the ${dirLabel} — not the other way`;
      this.latFlexMaybeSpeak('wrong_dir', `Bend to the ${dirLabel.toLowerCase()}`, 4000);
    } else if (this.tooFarSince > 0 && now - this.tooFarSince > 1500) {
      warningSlot1 = '⚠ Move closer to the camera';
      this.latFlexMaybeSpeak('too_far', 'Move closer to the camera', 6000);
    } else if (this.tooCloseSince > 0 && now - this.tooCloseSince > 1500) {
      warningSlot1 = '⚠ Move back — full body must be visible';
      this.latFlexMaybeSpeak('too_close', 'Move back from the camera', 6000);
    } else if (this.armNotOverheadSince > 0 && now - this.armNotOverheadSince > 1000) {
      warningSlot1 = '⚠ Reach arms overhead first';
      this.latFlexMaybeSpeak('arm_overhead', 'Reach your arms overhead first', 5000);
    } else if (this.idleSince > 0 && now - this.idleSince > 5000) {
      warningSlot1 = `⚠ Bend sideways to the ${dirLabel}`;
      this.latFlexMaybeSpeak('idle', `Bend sideways to the ${dirLabel.toLowerCase()}`, 6000);
    } else if (this.partialBendSince > 0 && now - this.partialBendSince > 2000) {
      warningSlot1 = '⚠ Bend further to the side';
      this.latFlexMaybeSpeak('partial_bend', 'Bend further to the side', 5000);
    }

    // SLOT 2 (AMBER) — trunk_rotation > hip_shift > knee_bend
    if (this.trunkRotationSince > 0 && now - this.trunkRotationSince > 1200) {
      warningSlot2 = '● Square shoulders — no twisting';
      this.latFlexMaybeSpeak('trunk_rotation', 'Keep your shoulders square, do not twist', 7000);
    } else if (this.hipShiftSince > 0 && now - this.hipShiftSince > 1200) {
      warningSlot2 = '● Keep hips centered over feet';
      this.latFlexMaybeSpeak('hip_shift', 'Keep your hips centered over your feet', 7000);
    } else if (this.kneeBendSince > 0 && now - this.kneeBendSince > 1500) {
      warningSlot2 = '● Keep your knees straight';
      this.latFlexMaybeSpeak('knee_bend', 'Keep your knees straight', 7000);
    }

    if (warningSlot1) {
      instructionText = warningSlot1.replace(/^[⚠●]\s*/, '');
      instructionColor = '#FF4D6A';
    } else if (Math.abs(this.smoothedAngle) > BEND_START_THRESHOLD) {
      instructionText = 'GREAT — return to upright';
      instructionColor = '#22c55e';
    }

    const peakL = this.repsL.length > 0 ? Math.max(...this.repsL.map(r => r.peakAngle)) : 0;
    const peakR = this.repsR.length > 0 ? Math.max(...this.repsR.map(r => r.peakAngle)) : 0;
    const peakAvg = (peakL + peakR) / 2;
    const si = peakAvg > 0 ? (Math.abs(peakL - peakR) / peakAvg) * 100 : 0;

    return {
      score: liveMqs.toFixed(1),
      timer: { elapsed: phaseElapsed, total: PHASE_DURATION },
      label,
      primary: { label: 'Reps', value: currentPhaseReps.length },
      secondary: { label: 'MQS', value: liveMqs.toFixed(1) },
      instructionText,
      instructionColor,
      warningSlot1,
      warningSlot2,
      leftAngle: Math.round(peakL),
      rightAngle: Math.round(peakR),
      symmetryIndex: Math.round(si),
      bigRepChip: this.repsL.length + this.repsR.length,
    };
  }

  isComplete(): boolean {
    return this.gameComplete;
  }

  getRawData(): Record<string, unknown> {
    const mqsL = this.phaseMqsL;
    const mqsR = this.phaseMqsR;
    const mqsAvg = (mqsL + mqsR) / 2;
    const tci = clamp(100 - Math.abs(mqsL - mqsR), 0, 100);

    return {
      testId: 'KS4',
      mqsL: Math.round(mqsL * 10) / 10,
      mqsR: Math.round(mqsR * 10) / 10,
      mqsAvg: Math.round(mqsAvg * 10) / 10,
      tci: Math.round(tci * 10) / 10,
      repsL: this.repsL.length,
      repsR: this.repsR.length,
      duration: this.totalElapsed,
      deviationCounts: { ...this.devCounts },
      perRepLeft: this.repsL.map((r) => ({ peakAngle: Math.round(r.peakAngle * 10) / 10 })),
      perRepRight: this.repsR.map((r) => ({ peakAngle: Math.round(r.peakAngle * 10) / 10 })),
      timeSeries: this.timeSeries,
      customMetrics: {
        mqsAvg: Math.round(mqsAvg * 10) / 10,
        tci: Math.round(tci * 10) / 10,
        mqsL: Math.round(mqsL * 10) / 10,
        mqsR: Math.round(mqsR * 10) / 10,
        repsL: this.repsL.length,
        repsR: this.repsR.length,
        bestAngleL: this.repsL.length > 0 ? Math.max(...this.repsL.map((r) => r.peakAngle)) : 0,
        bestAngleR: this.repsR.length > 0 ? Math.max(...this.repsR.map((r) => r.peakAngle)) : 0,
      },
    };
  }

  destroy(): void {
    // Clean up resources if needed
    this.lastLandmarks = null;
    this.calData = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Store calibration data after successful calibration
   */
  private onCalibrationSuccess(landmarks: NormalizedLandmark[]): void {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    if (!ls || !rs || !lh || !rh || !la || !ra) {
      return;
    }

    const shoulderMidX = (ls.x + rs.x) / 2;
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidX = (lh.x + rh.x) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const trunkLength = Math.sqrt(
      Math.pow(shoulderMidX - hipMidX, 2) + Math.pow(shoulderMidY - hipMidY, 2),
    );

    this.calData = {
      shoulderMidX,
      shoulderMidY,
      hipMidX,
      hipMidY,
      shoulderWidth,
      trunkLength,
      refAnkleL: la,
      refAnkleR: ra,
      baselineAngle: 0,
    };
  }

  /**
   * Rep detection state machine
   */
  private processRepDetection(effectiveAngle: number, formScore: number): void {
    const currentPhaseReps = this.phase === 1 ? this.repsL : this.repsR;
    const correctDirection = this.phase === 1 ? this.smoothedAngle > 0 : this.smoothedAngle < 0;

    switch (this.repState) {
      case 'NEUTRAL':
        if (effectiveAngle > BEND_START_THRESHOLD && correctDirection) {
          this.repState = 'BENDING';
          this.repStartFrame = this.frameIndex;
          this.maxAngleInRep = effectiveAngle;
          this.peakStableCount = 0;
          this.repAngularVelocities = [];
          this.repFormScores = [];
          this.repFormScores.push(formScore);
        }
        break;

      case 'BENDING':
        this.repFormScores.push(formScore);
        if (effectiveAngle > this.maxAngleInRep) {
          this.maxAngleInRep = effectiveAngle;
          this.peakStableCount = 0;
        } else if (this.maxAngleInRep - effectiveAngle <= PEAK_HOLD_THRESHOLD) {
          this.peakStableCount++;
          if (this.peakStableCount >= PEAK_HOLD_FRAMES) {
            this.peakAngle = this.maxAngleInRep;
            this.repState = 'RETURNING';
          }
        } else {
          this.peakStableCount = 0;
        }
        break;

      case 'RETURNING':
        this.repFormScores.push(formScore);
        if (effectiveAngle < RETURN_THRESHOLD) {
          if (this.peakAngle >= MIN_VALID_PEAK) {
            const repData = this.recordRep(this.peakAngle);
            currentPhaseReps.push(repData);
          }
          this.repState = 'NEUTRAL';
        }
        break;
    }
  }

  /**
   * Record a completed rep with all metrics
   */
  private recordRep(peakAngle: number): RepData {
    const smoothness = computeSmoothness(this.repAngularVelocities, this.measuredFPS);

    const formAdherence =
      this.repFormScores.length > 0
        ? this.repFormScores.reduce((a, b) => a + b, 0) / this.repFormScores.length
        : 50;

    const completion = getCompletionScore(peakAngle);

    const mqs = smoothness * SMOOTHNESS_WEIGHT + formAdherence * FORM_ADHERENCE_WEIGHT + completion * COMPLETION_WEIGHT;

    return {
      peakAngle,
      startFrame: this.repStartFrame,
      endFrame: this.frameIndex,
      duration: this.frameIndex - this.repStartFrame,
      smoothness,
      formAdherence,
      completion,
      mqs,
    };
  }

  /**
   * Evaluate form criteria (4 weighted checks)
   */
  private evaluateFormCriteria(landmarks: NormalizedLandmark[]): FormCriteriaResult {
    if (!this.calData) {
      return {
        rotationOk: true,
        rotationRatio: 1.0,
        leanOk: true,
        hipDeviation: 0,
        feetOk: true,
        maxAnkleDrift: 0,
        armOk: true,
        score: 100,
      };
    }

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    if (!ls || !rs || !lw || !rw || !lh || !rh || !la || !ra) {
      return {
        rotationOk: true,
        rotationRatio: 1.0,
        leanOk: true,
        hipDeviation: 0,
        feetOk: true,
        maxAnkleDrift: 0,
        armOk: true,
        score: 100,
      };
    }

    // Criterion 1: No trunk rotation (35%)
    const currentShoulderWidth = Math.abs(ls.x - rs.x);
    const rotationRatio = currentShoulderWidth / this.calData.shoulderWidth;
    const currentAngleAbs = Math.abs(this.smoothedAngle);
    const rotationOk =
      currentAngleAbs >= 15 || (rotationRatio >= FORM_ROTATION_MIN && rotationRatio <= FORM_ROTATION_MAX);

    // Criterion 2: No forward/backward lean (25%)
    const currentHipMidY = (lh.y + rh.y) / 2;
    const hipDeviation = Math.abs(currentHipMidY - this.calData.hipMidY);
    const leanOk = hipDeviation < FORM_HIP_DEVIATION_MAX * this.calData.trunkLength;

    // Criterion 3: Feet stay planted (20%)
    const ankleLDrift = distance(la, this.calData.refAnkleL);
    const ankleRDrift = distance(ra, this.calData.refAnkleR);
    const maxAnkleDrift = Math.max(ankleLDrift, ankleRDrift);
    const driftThreshold = Math.max(this.calData.shoulderWidth * FORM_ANKLE_DRIFT_MAX, 0.04);
    const feetOk = maxAnkleDrift < driftThreshold;

    // Criterion 4: Correct arm overhead (20%)
    let armOk: boolean;
    if (this.phase === 1) {
      armOk = rw.y < rs.y; // Right arm overhead when bending left
    } else {
      armOk = lw.y < ls.y; // Left arm overhead when bending right
    }

    // Weighted form score
    const score =
      ((rotationOk ? 1 : 0) * 0.35 +
        (leanOk ? 1 : 0) * 0.25 +
        (feetOk ? 1 : 0) * 0.2 +
        (armOk ? 1 : 0) * 0.2) *
      100;

    return {
      rotationOk,
      rotationRatio,
      leanOk,
      hipDeviation,
      feetOk,
      maxAnkleDrift,
      armOk,
      score,
    };
  }

  /**
   * Compute phase-level MQS from reps or fallback
   */
  private computePhaseMQS(
    phaseReps: RepData[],
    phaseFormScores: number[],
    phaseAngularVelocities: number[],
  ): number {
    if (phaseReps.length > 0) {
      return phaseReps.reduce((sum, r) => sum + r.mqs, 0) / phaseReps.length;
    }

    // Fallback: compute from all frame-level data, cap at 15%
    const smoothness = computeSmoothness(phaseAngularVelocities, this.measuredFPS);
    const formAdherence = phaseFormScores.length > 0 ? mean(phaseFormScores) : 0;
    const completionScore = getCompletionScore(this.phaseBestPeakAngle);
    const rawFallbackMqs = smoothness * SMOOTHNESS_WEIGHT + formAdherence * FORM_ADHERENCE_WEIGHT + completionScore * COMPLETION_WEIGHT;

    return Math.min(rawFallbackMqs, 15.0);
  }

  /**
   * Compute live MQS estimate for HUD
   */
  private computeLiveMQS(currentPhaseReps: RepData[], formScores: number[]): number {
    if (currentPhaseReps.length > 0) {
      return currentPhaseReps.reduce((sum, r) => sum + r.mqs, 0) / currentPhaseReps.length;
    }

    const formProxy = formScores.length > 0 ? mean(formScores) : 50;
    const completionProxy = getCompletionScore(Math.abs(this.smoothedAngle));
    return Math.max(0, Math.min(100, formProxy * 0.6 + completionProxy * 0.4));
  }

  /**
   * Draw skeleton connections
   */
  private drawSkeleton(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.lastLandmarks) return;

    const lm = this.lastLandmarks;

    // Draw connections
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
    ctx.lineWidth = 2;

    for (const [start, end] of SKELETON_CONNECTIONS) {
      const p1 = lm[start];
      const p2 = lm[end];

      if (!p1 || !p2 || p1.visibility < 0.3 || p2.visibility < 0.3) continue;

      // Mirrored coordinates
      const x1 = (1 - p1.x) * width;
      const y1 = p1.y * height;
      const x2 = (1 - p2.x) * width;
      const y2 = p2.y * height;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw joints
    ctx.fillStyle = 'rgba(100, 200, 255, 0.8)';
    const jointRadius = 4;

    for (let i = 0; i < lm.length; i++) {
      const landmark = lm[i];
      if (!landmark || landmark.visibility < 0.3) continue;

      const mx = (1 - landmark.x) * width;
      const my = landmark.y * height;

      ctx.beginPath();
      ctx.arc(mx, my, jointRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  /**
   * Draw trunk tilt arc visualization
   */
  private drawTrunkTiltArc(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.lastLandmarks || !this.calData) return;

    const lm = this.lastLandmarks;
    const ls = lm[LM.LEFT_SHOULDER];
    const rs = lm[LM.RIGHT_SHOULDER];
    const lh = lm[LM.LEFT_HIP];
    const rh = lm[LM.RIGHT_HIP];

    if (!ls || !rs || !lh || !rh) return;

    const shoulderMidX = (ls.x + rs.x) / 2;
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidX = (lh.x + rh.x) / 2;
    const hipMidY = (lh.y + rh.y) / 2;

    const smx = (1 - shoulderMidX) * width;
    const smy = shoulderMidY * height;
    const hmx = (1 - hipMidX) * width;
    const hmy = hipMidY * height;

    // Draw tilt line (teal if form OK, amber if violation)
    const anyFormFail = this.phaseFormScores.length > 0 ? this.phaseFormScores[this.phaseFormScores.length - 1] < 75 : false;
    ctx.strokeStyle = anyFormFail ? 'rgba(255, 193, 7, 0.8)' : 'rgba(0, 200, 200, 0.8)';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(hmx, hmy);
    ctx.lineTo(smx, smy);
    ctx.stroke();
  }
}
