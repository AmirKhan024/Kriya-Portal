/**
 * Hand Swings Engine — FA6: Side-facing single-arm raise with semi-arc + green buttons.
 *
 * Activity: User stands sideways to camera. One arm raises along a semi-arc
 * from natural down position to overhead, hitting green buttons at each end.
 * Two calibration phases: first arm, then turn around for second arm.
 *
 * Scoring: NGB (number of green button hits, max 40) × DAC (duration of activity completion)
 * Uses MATRIX_70_30 (70% NGB, 30% DAC).
 *
 * Source: Range of Motion.docx — Flowfield Arc: Hand Swings (FA1 in doc, FA6 in codebase)
 */

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics, type NormalizedLandmark } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Total activity period: 15s × 2 phases = 30s of active play */
const PHASE_DURATION_S = 15;
/** Duration of transition between phases */
const TRANSITION_DURATION_S = 5;
/** Total duration = phase1 + transition + phase2 */
const TOTAL_DURATION_S = PHASE_DURATION_S * 2 + TRANSITION_DURATION_S;

/** Max green button hits per phase (10 up + 10 down = 20 per arm) */
const MAX_HITS_PER_PHASE = 20;
/** Total max hits across both phases */
const MAX_TOTAL_HITS = 40;

/** Calibration posture hold time (ms) */
const CAL_CONFIRM_MS = 2000;
/** Calibration bad-posture tolerance buffer (ms) */
const CAL_BAD_BUFFER_MS = 300;
/** Calibration timeout — game terminates if exceeded (ms) */
const CAL_TIMEOUT_MS = 20000;

/** Max arm angle for "arms at sides" check during calibration */
const CAL_ARM_ANGLE_MAX = 30;
/** Side-facing detection: max x-spread between shoulders */
const SIDE_FACING_SHOULDER_SPREAD = 0.12;
/** Minimum visibility threshold for calibration landmarks */
const CAL_VIS_THRESHOLD = 0.3;
/** Minimum visibility for gameplay landmarks */
const VIS_THRESHOLD = 0.5;

/** Green button hit radius — normalized distance threshold */
const HIT_RADIUS = 0.06;
/** Semi-arc transparency (85% transparent = 15% opaque) */
const ARC_OPACITY = 0.15;
/** Green button dot radius (pixels) */
const BUTTON_RADIUS_PX = 18;

/** Countdown voice threshold — speak last N seconds */
const COUNTDOWN_VOICE_THRESHOLD = 5;

// ─── Side-facing calibration landmarks ───────────────────────────────────────

const CAL_REQUIRED_LMS = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
];

// ─── Helper Functions ────────────────────────────────────────────────────────

/** Euclidean distance between two points in normalized coords */
function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Compute arm angle (degrees) — shoulder-hip vs shoulder-elbow */
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

/** Determine which side is facing the camera based on shoulder z-values */
function getCameraFacingSide(lm: NormalizedLandmark[]): 'left' | 'right' {
  const ls = lm[LM.LEFT_SHOULDER];
  const rs = lm[LM.RIGHT_SHOULDER];
  if (!ls || !rs) return 'left';
  // Lower z = closer to camera in MediaPipe
  return ls.z < rs.z ? 'left' : 'right';
}

// ─── Audio helpers (Web Audio API) ───────────────────────────────────────────

const AudioCtxClass = typeof window !== 'undefined'
  ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  : null;

let audioCtx: AudioContext | null = null;

function ensureAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!AudioCtxClass) return null;
  if (!audioCtx) audioCtx = new AudioCtxClass();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => { /* ignore */ });
  }
  return audioCtx;
}

/** Play a green button hit beep — ascending sine 880→1200 Hz */
function playGreenHitBeep(): void {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.08);
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
}

/** TTS voice instruction with cooldown */
let lastSpokeAt = 0;
const SPEAK_COOLDOWN_MS = 2000;

function speak(text: string, force = false): void {
  if (typeof window === 'undefined') return;
  if (!('speechSynthesis' in window)) return;
  const now = performance.now();
  if (!force && now - lastSpokeAt < SPEAK_COOLDOWN_MS) return;
  lastSpokeAt = now;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.1;
  utt.pitch = 1.0;
  utt.volume = 0.9;
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => v.lang.startsWith('en') && v.name.includes('Female')) ??
    voices.find((v) => v.lang.startsWith('en'));
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
}

/** Speak a countdown number */
function speakCountdown(n: number): void {
  speak(String(n), true);
}

// ─── Engine Class ────────────────────────────────────────────────────────────

type GamePhase = 'phase1' | 'transition' | 'phase2';

export class HandSwingsEngine implements GameEngine {
  // ── Calibration state ──
  private calGoodStart = 0;
  private calBadStart = 0;
  private calStartTime = 0;
  private calReady = false;

  // ── Calibration reference data ──
  private armLength = 0;          // Normalized arm length (shoulder → wrist at rest)
  private shoulderPos = { x: 0, y: 0 };  // Shoulder position of active arm
  private activeSide: 'left' | 'right' = 'left'; // Which arm is facing camera first

  // ── Semi-arc button positions (normalized) ──
  private topButtonPos = { x: 0, y: 0 };
  private bottomButtonPos = { x: 0, y: 0 };

  // ── Game state ──
  private startTime = 0;
  private elapsed = 0;
  private gameComplete = false;
  private phase: GamePhase = 'phase1';
  private phaseStartTime = 0;

  // ── Hit tracking ──
  private phase1Hits = 0;
  private phase2Hits = 0;
  private totalHits = 0;
  /** Tracks whether wrist is near top or bottom button — prevents double-counting */
  private lastHitZone: 'top' | 'bottom' | 'none' = 'none';

  // ── Duration tracking (cumulative active time, excluding transition) ──
  private activeDuration = 0;
  private phase1Duration = 0;

  // ── Second calibration (for phase2) ──
  private phase2CalReady = false;
  private phase2CalGoodStart = 0;
  private phase2CalBadStart = 0;

  // ── Instruction text ──
  private instructionText = '';
  private instructionColor = '#22c55e';

  // ── Last-spoken countdown second (to avoid repeat) ──
  private lastCountdownSpoken = -1;

  // ── Render flash state for green button hit feedback ──
  private topHitFlashUntil = 0;
  private bottomHitFlashUntil = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // GameEngine Interface
  // ═══════════════════════════════════════════════════════════════════════════

  reset(): void {
    this.calGoodStart = 0;
    this.calBadStart = 0;
    this.calStartTime = 0;
    this.calReady = false;
    this.armLength = 0;
    this.shoulderPos = { x: 0, y: 0 };
    this.activeSide = 'left';
    this.topButtonPos = { x: 0, y: 0 };
    this.bottomButtonPos = { x: 0, y: 0 };
    this.startTime = 0;
    this.elapsed = 0;
    this.gameComplete = false;
    this.phase = 'phase1';
    this.phaseStartTime = 0;
    this.phase1Hits = 0;
    this.phase2Hits = 0;
    this.totalHits = 0;
    this.lastHitZone = 'none';
    this.activeDuration = 0;
    this.phase1Duration = 0;
    this.phase2CalReady = false;
    this.phase2CalGoodStart = 0;
    this.phase2CalBadStart = 0;
    this.instructionText = '';
    this.instructionColor = '#22c55e';
    this.lastCountdownSpoken = -1;
    this.topHitFlashUntil = 0;
    this.bottomHitFlashUntil = 0;
  }

  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) {
      return { isReady: true, progress: 1, message: 'Ready!' };
    }

    const now = performance.now();
    if (this.calStartTime === 0) this.calStartTime = now;

    // Timeout
    if (now - this.calStartTime > CAL_TIMEOUT_MS) {
      speak('Unfortunately, you were not able to calibrate. Please retry after a few hours.');
      return {
        isReady: false,
        progress: 0,
        message: 'Calibration timed out — please retry later',
      };
    }

    const result = this.checkSideFacingCalibration(landmarks);

    if (result.pass) {
      this.calBadStart = 0;
      if (this.calGoodStart === 0) this.calGoodStart = now;
      const held = now - this.calGoodStart;
      const progress = Math.min(1, held / CAL_CONFIRM_MS);

      if (held >= CAL_CONFIRM_MS) {
        this.calReady = true;
        this.onFirstCalibrationSuccess(landmarks);
        return { isReady: true, progress: 1, message: 'Ready!' };
      }
      return { isReady: false, progress, message: 'Hold still — calibrating...' };
    }

    // Bad posture
    if (this.calBadStart === 0) this.calBadStart = now;
    if (now - this.calBadStart > CAL_BAD_BUFFER_MS) {
      this.calGoodStart = 0;
    }

    // Voice guidance for side-facing (user may not be looking at screen)
    speak(result.message);

    return { isReady: false, progress: 0, message: result.message };
  }

  /**
   * Reset timers for the start of active gameplay.
   * Called AFTER the countdown finishes, just before the first processFrame.
   */
  startPlaying(): void {
    const now = performance.now();
    this.startTime = now;
    this.elapsed = 0;
    this.phaseStartTime = now;
    this.phase = 'phase1';
    this.activeDuration = 0;
    this.lastCountdownSpoken = -1;
  }

  processFrame(landmarks: NormalizedLandmark[], _timestampMs: number): void {
    if (!this.calReady || this.gameComplete) return;

    const now = performance.now();
    this.elapsed = (now - this.startTime) / 1000;
    const phaseElapsed = (now - this.phaseStartTime) / 1000;

    // ── Phase 1: First arm ──
    if (this.phase === 'phase1') {
      this.activeDuration = phaseElapsed;

      // Check if phase1 should end (time or max hits)
      if (phaseElapsed >= PHASE_DURATION_S || this.phase1Hits >= MAX_HITS_PER_PHASE) {
        this.phase1Duration = Math.min(phaseElapsed, PHASE_DURATION_S);
        this.activeDuration = this.phase1Duration;
        this.phase = 'transition';
        this.phaseStartTime = now;
        this.lastHitZone = 'none';
        this.phase2CalReady = false;
        this.phase2CalGoodStart = 0;
        this.phase2CalBadStart = 0;
        this.lastCountdownSpoken = -1;

        speak('Turn around so your other arm faces the camera');
        this.instructionText = 'Turn around for second arm';
        this.instructionColor = '#3b82f6';
        return;
      }

      this.processActivePhase(landmarks, now, phaseElapsed, 1);
      return;
    }

    // ── Transition: Second calibration ──
    if (this.phase === 'transition') {
      if (phaseElapsed >= TRANSITION_DURATION_S && !this.phase2CalReady) {
        // Allow extra time for recalibration — but cap total transition
        if (phaseElapsed >= TRANSITION_DURATION_S + 10) {
          // Force start phase 2 even without perfect calibration
          this.phase2CalReady = true;
        }
      }

      // Try to calibrate for second arm
      if (!this.phase2CalReady) {
        const calResult = this.checkSideFacingCalibration(landmarks);
        if (calResult.pass) {
          this.phase2CalBadStart = 0;
          if (this.phase2CalGoodStart === 0) this.phase2CalGoodStart = now;
          if (now - this.phase2CalGoodStart >= CAL_CONFIRM_MS) {
            this.phase2CalReady = true;
            this.onSecondCalibrationSuccess(landmarks);
          } else {
            this.instructionText = 'Hold still — calibrating second arm...';
            this.instructionColor = '#22c55e';
          }
        } else {
          if (this.phase2CalBadStart === 0) this.phase2CalBadStart = now;
          if (now - this.phase2CalBadStart > CAL_BAD_BUFFER_MS) {
            this.phase2CalGoodStart = 0;
          }
          speak(calResult.message);
          this.instructionText = calResult.message;
          this.instructionColor = '#FFB547';
        }
        return;
      }

      // Calibrated — start phase 2 after brief cool-off
      if (this.phase2CalReady && phaseElapsed >= 2) {
        this.phase = 'phase2';
        this.phaseStartTime = now;
        this.lastHitZone = 'none';
        this.lastCountdownSpoken = -1;
        speak('Begin. Raise your arm up and down.');
        this.instructionText = 'Raise your arm along the arc';
        this.instructionColor = '#22c55e';
      }
      return;
    }

    // ── Phase 2: Second arm ──
    if (this.phase === 'phase2') {
      // Check if phase2 should end
      if (phaseElapsed >= PHASE_DURATION_S || this.phase2Hits >= MAX_HITS_PER_PHASE) {
        this.activeDuration = this.phase1Duration + Math.min(phaseElapsed, PHASE_DURATION_S);
        this.gameComplete = true;
        return;
      }

      this.activeDuration = this.phase1Duration + phaseElapsed;
      this.processActivePhase(landmarks, now, phaseElapsed, 2);
    }
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Counter-flip for mirrored canvas (caller applies mirror first)
    ctx.save();

    const now = performance.now();

    // Draw semi-arc
    if (this.calReady && (this.phase === 'phase1' || this.phase === 'phase2')) {
      this.renderSemiArc(ctx, w, h);
      this.renderGreenButtons(ctx, w, h, now);
    }

    // Draw transition message
    if (this.phase === 'transition') {
      this.renderTransitionOverlay(ctx, w, h);
    }

    // Draw center countdown in last 5 seconds of each phase
    if (this.phase === 'phase1' || this.phase === 'phase2') {
      const phaseElapsed = (now - this.phaseStartTime) / 1000;
      const phaseRemaining = PHASE_DURATION_S - phaseElapsed;
      if (phaseRemaining <= COUNTDOWN_VOICE_THRESHOLD && phaseRemaining > 0) {
        this.renderCenterCountdown(ctx, w, h, Math.ceil(phaseRemaining));
      }
    }

    ctx.restore();
  }

  getHudMetrics(): HudMetrics {
    const phaseHits = this.phase === 'phase1' ? this.phase1Hits : this.phase2Hits;
    const phaseMax = MAX_HITS_PER_PHASE;
    const phaseLabel = this.phase === 'phase1'
      ? 'Arm 1'
      : this.phase === 'transition'
        ? 'Switch!'
        : 'Arm 2';

    return {
      primary: {
        label: 'NGB',
        value: `${phaseHits}/${phaseMax}`,
        color: '#22c55e',
      },
      secondary: {
        label: 'Total',
        value: `${this.totalHits}/${MAX_TOTAL_HITS}`,
        color: '#22c55e',
      },
      timer: {
        elapsed: Math.floor(this.elapsed),
        total: TOTAL_DURATION_S,
      },
      timerLabel: phaseLabel,
      instructionText: this.instructionText,
      instructionColor: this.instructionColor,
      extra: {
        label: 'DAC',
        value: `${Math.floor(this.activeDuration)}s`,
        color: '#00E5CC',
      },
    };
  }

  isComplete(): boolean {
    return this.gameComplete;
  }

  getRawData(): Record<string, unknown> {
    return {
      testId: 'FA6',
      greenHits: this.totalHits,
      phase1Hits: this.phase1Hits,
      phase2Hits: this.phase2Hits,
      elapsed: Math.floor(this.activeDuration),
      totalElapsed: Math.floor(this.elapsed),
      phase1Duration: Math.floor(this.phase1Duration),
      activeSideFirst: this.activeSide,
    };
  }

  destroy(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Side-Facing Calibration
  // ═══════════════════════════════════════════════════════════════════════════

  private checkSideFacingCalibration(lm: NormalizedLandmark[]): { pass: boolean; message: string } {
    // Gate A: Required landmarks visible
    for (const idx of CAL_REQUIRED_LMS) {
      const p = lm[idx];
      if (!p || (p.visibility ?? 0) < CAL_VIS_THRESHOLD) {
        return { pass: false, message: 'Stand sideways so your full body is visible' };
      }
    }

    // Gate B: Side-facing check — shoulders should overlap horizontally
    const shoulderSpreadX = Math.abs(lm[LM.LEFT_SHOULDER].x - lm[LM.RIGHT_SHOULDER].x);
    if (shoulderSpreadX > SIDE_FACING_SHOULDER_SPREAD) {
      return { pass: false, message: 'Turn sideways — camera should see your side profile' };
    }

    // Gate C: Arms at sides
    const leftAngle = computeArmAngleDeg(lm[LM.LEFT_SHOULDER], lm[LM.LEFT_HIP], lm[LM.LEFT_ELBOW]);
    const rightAngle = computeArmAngleDeg(lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_HIP], lm[LM.RIGHT_ELBOW]);
    if (leftAngle > CAL_ARM_ANGLE_MAX || rightAngle > CAL_ARM_ANGLE_MAX) {
      return { pass: false, message: 'Keep your arms relaxed at your sides' };
    }

    // Gate D: Sufficient headroom for arm swing
    // Arm length = shoulder-to-wrist distance
    const facingSide = getCameraFacingSide(lm);
    const shoulderIdx = facingSide === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;
    const wristIdx = facingSide === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
    const shoulder = lm[shoulderIdx];
    const wrist = lm[wristIdx];

    const armLen = dist(shoulder, wrist);
    // Headroom: distance from shoulder to top of frame (y=0)
    const headroom = shoulder.y;
    if (headroom < armLen * 0.8) {
      return { pass: false, message: 'Step back — need room above your shoulder for arm swings' };
    }

    return { pass: true, message: 'Hold still — calibrating...' };
  }

  private onFirstCalibrationSuccess(lm: NormalizedLandmark[]): void {
    this.activeSide = getCameraFacingSide(lm);

    const shoulderIdx = this.activeSide === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;
    const wristIdx = this.activeSide === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
    const shoulder = lm[shoulderIdx];
    const wrist = lm[wristIdx];

    this.armLength = dist(shoulder, wrist);
    this.shoulderPos = { x: shoulder.x, y: shoulder.y };

    // Semi-arc: centered on shoulder, radius = arm length
    // Bottom button = wrist position at rest (straight down)
    this.bottomButtonPos = { x: shoulder.x, y: shoulder.y + this.armLength };
    // Top button = arm straight up
    this.topButtonPos = { x: shoulder.x, y: shoulder.y - this.armLength };

    speak('Raise your arm straight up along the arc and back down. Begin!');
  }

  private onSecondCalibrationSuccess(lm: NormalizedLandmark[]): void {
    // Re-detect which side is now facing the camera
    this.activeSide = getCameraFacingSide(lm);

    const shoulderIdx = this.activeSide === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;
    const wristIdx = this.activeSide === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
    const shoulder = lm[shoulderIdx];
    const wrist = lm[wristIdx];

    this.armLength = dist(shoulder, wrist);
    this.shoulderPos = { x: shoulder.x, y: shoulder.y };
    this.bottomButtonPos = { x: shoulder.x, y: shoulder.y + this.armLength };
    this.topButtonPos = { x: shoulder.x, y: shoulder.y - this.armLength };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Active Gameplay
  // ═══════════════════════════════════════════════════════════════════════════

  private processActivePhase(
    lm: NormalizedLandmark[],
    now: number,
    phaseElapsed: number,
    phaseNum: 1 | 2,
  ): void {
    // Get active wrist position
    const wristIdx = this.activeSide === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
    const wrist = lm[wristIdx];
    if (!wrist || (wrist.visibility ?? 0) < VIS_THRESHOLD) return;

    // Update shoulder position dynamically (user may shift slightly)
    const shoulderIdx = this.activeSide === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;
    const shoulder = lm[shoulderIdx];
    if (shoulder && (shoulder.visibility ?? 0) > VIS_THRESHOLD) {
      // Smooth update of shoulder position
      this.shoulderPos.x = this.shoulderPos.x * 0.7 + shoulder.x * 0.3;
      this.shoulderPos.y = this.shoulderPos.y * 0.7 + shoulder.y * 0.3;
      // Update button positions
      this.bottomButtonPos = { x: this.shoulderPos.x, y: this.shoulderPos.y + this.armLength };
      this.topButtonPos = { x: this.shoulderPos.x, y: this.shoulderPos.y - this.armLength };
    }

    // Check if wrist is near top or bottom button
    const distToTop = dist(wrist, this.topButtonPos as NormalizedLandmark);
    const distToBottom = dist(wrist, this.bottomButtonPos as NormalizedLandmark);

    if (distToTop < HIT_RADIUS && this.lastHitZone !== 'top') {
      this.lastHitZone = 'top';
      this.registerHit(phaseNum, now, 'top');
    } else if (distToBottom < HIT_RADIUS && this.lastHitZone !== 'bottom') {
      this.lastHitZone = 'bottom';
      this.registerHit(phaseNum, now, 'bottom');
    } else if (distToTop > HIT_RADIUS * 2 && distToBottom > HIT_RADIUS * 2) {
      // Clear zone when far from both buttons (prevents sticky hits)
      // Only clear if currently in a zone
    }

    // Instruction text
    const phaseRemaining = PHASE_DURATION_S - phaseElapsed;
    if (phaseRemaining <= COUNTDOWN_VOICE_THRESHOLD && phaseRemaining > 0) {
      const sec = Math.ceil(phaseRemaining);
      if (sec !== this.lastCountdownSpoken) {
        this.lastCountdownSpoken = sec;
        speakCountdown(sec);
      }
      this.instructionText = `${sec} seconds remaining`;
      this.instructionColor = '#ef4444';
    } else if (this.lastHitZone === 'top') {
      this.instructionText = 'Bring arm back down';
      this.instructionColor = '#22c55e';
    } else if (this.lastHitZone === 'bottom' || this.lastHitZone === 'none') {
      this.instructionText = 'Raise your arm up along the arc';
      this.instructionColor = '#22c55e';
    }
  }

  private registerHit(phaseNum: 1 | 2, now: number, zone: 'top' | 'bottom'): void {
    if (phaseNum === 1) {
      this.phase1Hits++;
    } else {
      this.phase2Hits++;
    }
    this.totalHits = this.phase1Hits + this.phase2Hits;

    // Play beep
    playGreenHitBeep();

    // Flash the button
    if (zone === 'top') {
      this.topHitFlashUntil = now + 300;
    } else {
      this.bottomHitFlashUntil = now + 300;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  private renderSemiArc(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = this.shoulderPos.x * w;
    const cy = this.shoulderPos.y * h;
    const radius = this.armLength * Math.min(w, h);

    // Draw semi-arc (180° from down to up, in sagittal plane)
    ctx.beginPath();
    // Semi-arc from bottom (PI/2 = straight down) around to top (-PI/2 = straight up)
    // Since screen y is inverted, we draw from PI/2 (down) to -PI/2 (up)
    ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI / 2);
    ctx.strokeStyle = `rgba(100, 200, 255, ${ARC_OPACITY})`;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Fill the arc area with very subtle overlay
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI / 2);
    ctx.fillStyle = `rgba(100, 200, 255, ${ARC_OPACITY * 0.3})`;
    ctx.fill();
  }

  private renderGreenButtons(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    now: number,
  ): void {
    const topX = this.topButtonPos.x * w;
    const topY = this.topButtonPos.y * h;
    const bottomX = this.bottomButtonPos.x * w;
    const bottomY = this.bottomButtonPos.y * h;

    // Top button
    const topFlashing = now < this.topHitFlashUntil;
    ctx.beginPath();
    ctx.arc(topX, topY, BUTTON_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = topFlashing ? '#FFD700' : '#22c55e';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top button glow when flashing
    if (topFlashing) {
      ctx.beginPath();
      ctx.arc(topX, topY, BUTTON_RADIUS_PX + 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Bottom button
    const bottomFlashing = now < this.bottomHitFlashUntil;
    ctx.beginPath();
    ctx.arc(bottomX, bottomY, BUTTON_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = bottomFlashing ? '#FFD700' : '#22c55e';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (bottomFlashing) {
      ctx.beginPath();
      ctx.arc(bottomX, bottomY, BUTTON_RADIUS_PX + 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  private renderCenterCountdown(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    seconds: number,
  ): void {
    const text = String(seconds);
    ctx.save();
    ctx.font = 'bold 80px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Background circle
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 60, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fill();
    // Number
    ctx.fillStyle = '#ef4444';
    ctx.fillText(text, w / 2, h / 2);
    ctx.restore();
  }

  private renderTransitionOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    ctx.save();
    // Semi-transparent overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, w, h);

    // Turn around message
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#3b82f6';
    ctx.fillText('Turn around for second arm', w / 2, h / 2 - 20);

    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Stand sideways with other arm facing camera', w / 2, h / 2 + 20);
    ctx.restore();
  }
}
