// [NEW] Kriya Critical Gap Correction - Mobility Engine (KS1-KS3)
// Ported from kriya_nn_ks.html lines 1104-1335

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics } from './types';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

type MobilityTestId = 'KS1' | 'KS2' | 'KS3';

const DURATION = 30;
const CAL_FRAMES = 30;
const HOLD_DURATION = 5; // seconds to hold each position

export class MobilityEngine implements GameEngine {
  private testId: MobilityTestId;
  private calFrames = 0;
  private calReady = false;
  private startTime = 0;
  private elapsedSec = 0;
  private complete = false;
  private timerId: ReturnType<typeof setInterval> | null = null;

  // KS1: Standing reach - foot near target zone + knee straight + 5s hold
  private ks1GreenHits = 0;
  private ks1Completions = 0;
  private ks1HoldStart: number | null = null;
  private ks1IsInZone = false;

  // KS2: Toe touch - wrist-to-foot proximity + knee bend tracking + 5s hold
  private ks2Completions = 0;
  private ks2MaxKneeBend = 0;
  private ks2HoldStart: number | null = null;
  private ks2IsInZone = false;

  // KS3: Behind-back reach - fingers touching behind back + 5s hold
  private ks3Combo1 = 0;
  private ks3Combo2 = 0;
  private ks3HoldStart: number | null = null;
  private ks3IsInZone = false;
  private ks3Phase: 1 | 2 = 1;

  constructor(testId: MobilityTestId) {
    this.testId = testId;
  }

  reset(): void {
    this.calFrames = 0; this.calReady = false;
    this.startTime = 0; this.elapsedSec = 0; this.complete = false;
    this.ks1GreenHits = 0; this.ks1Completions = 0; this.ks1HoldStart = null; this.ks1IsInZone = false;
    this.ks2Completions = 0; this.ks2MaxKneeBend = 0; this.ks2HoldStart = null; this.ks2IsInZone = false;
    this.ks3Combo1 = 0; this.ks3Combo2 = 0; this.ks3HoldStart = null; this.ks3IsInZone = false; this.ks3Phase = 1;
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
  }

  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) return { isReady: true, framesReady: CAL_FRAMES, requiredFrames: CAL_FRAMES, message: '' };

    // Need full body visible
    const ls = landmarks[LM.LEFT_SHOULDER];
    const la = landmarks[LM.LEFT_ANKLE];
    if (!ls || !la || ls.visibility < 0.4 || la.visibility < 0.3) {
      this.calFrames = 0;
      return { isReady: false, framesReady: 0, requiredFrames: CAL_FRAMES, message: 'Stand with full body visible' };
    }

    this.calFrames++;
    if (this.calFrames >= CAL_FRAMES) {
      this.calReady = true;
      this.startTime = performance.now();
      this.startTimer();
    }
    return { isReady: this.calReady, framesReady: this.calFrames, requiredFrames: CAL_FRAMES, message: 'Hold still...' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processFrame(landmarks: NormalizedLandmark[], _timestamp: number): void {
    if (!this.calReady || this.complete) return;

    this.elapsedSec = Math.floor((performance.now() - this.startTime) / 1000);

    if (this.testId === 'KS1') this.processKS1(landmarks);
    else if (this.testId === 'KS2') this.processKS2(landmarks);
    else if (this.testId === 'KS3') this.processKS3(landmarks);
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Draw hold progress indicator
    let holdStart: number | null = null;
    let isInZone = false;

    if (this.testId === 'KS1') { holdStart = this.ks1HoldStart; isInZone = this.ks1IsInZone; }
    else if (this.testId === 'KS2') { holdStart = this.ks2HoldStart; isInZone = this.ks2IsInZone; }
    else if (this.testId === 'KS3') { holdStart = this.ks3HoldStart; isInZone = this.ks3IsInZone; }

    if (isInZone && holdStart !== null) {
      const holdElapsed = (performance.now() - holdStart) / 1000;
      const progress = Math.min(holdElapsed / HOLD_DURATION, 1);

      // Draw circular hold progress
      const cx = w / 2, cy = h * 0.7;
      const radius = 40;

      ctx.save();
      // Background circle
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 6;
      ctx.stroke();

      // Progress arc
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = progress >= 1 ? '#22c55e' : '#3b82f6';
      ctx.lineWidth = 6;
      ctx.stroke();

      // Hold text
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(HOLD_DURATION - holdElapsed)}s`, cx, cy + 6);
      ctx.restore();
    }

    // Draw target zone indicator
    if (isInZone) {
      ctx.save();
      ctx.fillStyle = 'rgba(34,197,94,0.15)';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  getHudMetrics(): HudMetrics {
    if (this.testId === 'KS1') {
      return {
        primary: { label: 'Hits', value: this.ks1GreenHits, color: '#22c55e' },
        secondary: { label: 'Holds', value: this.ks1Completions, color: '#22d3ee' },
        timer: { elapsed: this.elapsedSec, total: DURATION },
      };
    }
    if (this.testId === 'KS2') {
      return {
        primary: { label: 'Holds', value: this.ks2Completions, color: '#22c55e' },
        secondary: { label: 'Max Bend', value: `${this.ks2MaxKneeBend.toFixed(0)}°`, color: '#22d3ee' },
        timer: { elapsed: this.elapsedSec, total: DURATION },
      };
    }
    return {
      primary: { label: 'Combo 1', value: this.ks3Combo1, color: '#22c55e' },
      secondary: { label: 'Combo 2', value: this.ks3Combo2, color: '#3b82f6' },
      timer: { elapsed: this.elapsedSec, total: DURATION },
    };
  }

  isComplete(): boolean { return this.complete; }

  getRawData(): Record<string, unknown> {
    if (this.testId === 'KS1') {
      return { testId: 'KS1', greenHits: this.ks1GreenHits, completions: this.ks1Completions, elapsed: this.elapsedSec };
    }
    if (this.testId === 'KS2') {
      return { testId: 'KS2', completions: this.ks2Completions, maxKneeBend: Math.round(this.ks2MaxKneeBend * 10) / 10, elapsed: this.elapsedSec };
    }
    return { testId: 'KS3', combo1: this.ks3Combo1, combo2: this.ks3Combo2, combo1Completions: this.ks3Combo1, combo2Completions: this.ks3Combo2, elapsed: this.elapsedSec };
  }

  destroy(): void {
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
  }

  // ------ Private ------

  private startTimer(): void {
    this.timerId = setInterval(() => {
      this.elapsedSec = Math.floor((performance.now() - this.startTime) / 1000);
      if (this.elapsedSec >= DURATION) {
        this.complete = true;
        if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
      }
    }, 250);
  }

  /** KS1: Standing reach - foot near target zone + knee straight + 5s hold
   *  Ported from kriya_nn_ks.html lines 1117-1187 */
  private processKS1(lm: NormalizedLandmark[]): void {
    const lw = lm[LM.LEFT_WRIST], rw = lm[LM.RIGHT_WRIST];
    const lh = lm[LM.LEFT_HIP], rh = lm[LM.RIGHT_HIP];
    const lk = lm[LM.LEFT_KNEE], rk = lm[LM.RIGHT_KNEE];
    const la = lm[LM.LEFT_ANKLE];

    if (!lw || !rw || !lh || !rh || !lk || !la) return;

    // Check if either wrist is below knee level (reaching down)
    const wristBelowKnee = lw.y > lk.y || rw.y > rk.y;

    // Check knee straightness: angle between hip-knee-ankle should be > 150°
    const kneeAngle = this.calcAngle(lh, lk, la);
    const kneeStraight = kneeAngle > 150;

    const inZone = wristBelowKnee && kneeStraight;

    if (inZone && !this.ks1IsInZone) {
      // Just entered zone
      this.ks1IsInZone = true;
      this.ks1HoldStart = performance.now();
      this.ks1GreenHits++;
    } else if (!inZone && this.ks1IsInZone) {
      // Left zone
      this.ks1IsInZone = false;
      this.ks1HoldStart = null;
    }

    // Check if held for required duration
    if (this.ks1IsInZone && this.ks1HoldStart) {
      const holdTime = (performance.now() - this.ks1HoldStart) / 1000;
      if (holdTime >= HOLD_DURATION) {
        this.ks1Completions++;
        this.ks1IsInZone = false;
        this.ks1HoldStart = null;
      }
    }
  }

  /** KS2: Toe touch - wrist-to-foot proximity + knee bend tracking + 5s hold
   *  Ported from kriya_nn_ks.html lines 1189-1257 */
  private processKS2(lm: NormalizedLandmark[]): void {
    const lw = lm[LM.LEFT_WRIST], rw = lm[LM.RIGHT_WRIST];
    const la = lm[LM.LEFT_ANKLE], ra = lm[LM.RIGHT_ANKLE];
    const lh = lm[LM.LEFT_HIP], lk = lm[LM.LEFT_KNEE];

    if (!lw || !rw || !la || !ra || !lh || !lk) return;

    // Touch threshold: wrist near foot (normalized distance)
    const distL = Math.hypot(lw.x - la.x, lw.y - la.y);
    const distR = Math.hypot(rw.x - ra.x, rw.y - ra.y);
    const touchThreshold = 0.07;
    const touching = distL < touchThreshold || distR < touchThreshold;

    // Knee bend angle tracking
    const kneeAngle = this.calcAngle(lh, lk, la);
    const kneeBend = 180 - kneeAngle;
    if (kneeBend > this.ks2MaxKneeBend) this.ks2MaxKneeBend = kneeBend;

    if (touching && !this.ks2IsInZone) {
      this.ks2IsInZone = true;
      this.ks2HoldStart = performance.now();
    } else if (!touching && this.ks2IsInZone) {
      this.ks2IsInZone = false;
      this.ks2HoldStart = null;
    }

    if (this.ks2IsInZone && this.ks2HoldStart) {
      const holdTime = (performance.now() - this.ks2HoldStart) / 1000;
      if (holdTime >= HOLD_DURATION) {
        this.ks2Completions++;
        this.ks2IsInZone = false;
        this.ks2HoldStart = null;
      }
    }
  }

  /** KS3: Behind-back reach - fingers touching behind back + 5s hold
   *  Ported from kriya_nn_ks.html lines 1259-1335 */
  private processKS3(lm: NormalizedLandmark[]): void {
    const lw = lm[LM.LEFT_WRIST], rw = lm[LM.RIGHT_WRIST];
    const nose = lm[LM.NOSE];

    if (!lw || !rw) return;

    // Nose visibility gate: must face AWAY from camera (low visibility)
    const facingAway = !nose || nose.visibility < 0.3;

    // Wrist distance check: fingers touching behind back
    const wristDist = Math.hypot(lw.x - rw.x, lw.y - rw.y);
    const touching = wristDist < 0.08 && facingAway;

    if (touching && !this.ks3IsInZone) {
      this.ks3IsInZone = true;
      this.ks3HoldStart = performance.now();
    } else if (!touching && this.ks3IsInZone) {
      this.ks3IsInZone = false;
      this.ks3HoldStart = null;
    }

    if (this.ks3IsInZone && this.ks3HoldStart) {
      const holdTime = (performance.now() - this.ks3HoldStart) / 1000;
      if (holdTime >= HOLD_DURATION) {
        if (this.ks3Phase === 1) {
          this.ks3Combo1++;
          this.ks3Phase = 2;
        } else {
          this.ks3Combo2++;
          this.ks3Phase = 1;
        }
        this.ks3IsInZone = false;
        this.ks3HoldStart = null;
      }
    }
  }

  /** Calculate angle at point B given three points A-B-C */
  private calcAngle(a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark): number {
    const ba = { x: a.x - b.x, y: a.y - b.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const dot = ba.x * bc.x + ba.y * bc.y;
    const magBA = Math.hypot(ba.x, ba.y);
    const magBC = Math.hypot(bc.x, bc.y);
    if (magBA === 0 || magBC === 0) return 0;
    const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
    return Math.acos(cosAngle) * (180 / Math.PI);
  }
}
