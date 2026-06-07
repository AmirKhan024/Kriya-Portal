// [NEW] Kriya Critical Gap Correction - ROM Engine (FA1-FA5)
// Ported from rom.html lines 1360-1596

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics } from './types';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

type ROMTestId = 'FA1' | 'FA2' | 'FA3' | 'FA4' | 'FA5';

const DURATION = 30;
const CAL_FRAMES = 30;

export class ROMEngine implements GameEngine {
  private testId: ROMTestId;
  private calFrames = 0;
  private calReady = false;
  private startTime = 0;
  private elapsedSec = 0;
  private complete = false;
  private timerId: ReturnType<typeof setInterval> | null = null;

  // Baseline from calibration
  private baselineNoseY = 0;
  private baselineNoseX = 0;
  private baselineHipY = 0;

  // FA1: Hand swings - wrist above head / below hip alternating
  private fa1GreenHits = 0;
  private fa1State: 'neutral' | 'up' | 'down' = 'neutral';

  // FA2: Head rotation - Phase 1: lateral tilt, Phase 2: sagittal tilt
  private fa2Activity1Hits = 0;
  private fa2Activity2Hits = 0;
  private fa2Phase: 1 | 2 = 1;
  private fa2PhaseTimer: ReturnType<typeof setTimeout> | null = null;
  private fa2State: 'center' | 'left' | 'right' | 'up' | 'down' = 'center';

  // FA3: Circle of reach - shoulder rotation detection
  private fa3GreenHits = 0;
  private fa3State: 'center' | 'left' | 'right' = 'center';

  // FA4: Hip hinge reach - wrist below knee / above hip state machine
  private fa4GreenHits = 0;
  private fa4State: 'standing' | 'down' = 'standing';

  // FA5: Knee arc glide - knee/ankle above hip state machine
  private fa5GreenHits = 0;
  private fa5State: 'standing' | 'front' | 'back' = 'standing';

  constructor(testId: ROMTestId) {
    this.testId = testId;
  }

  reset(): void {
    this.calFrames = 0; this.calReady = false;
    this.startTime = 0; this.elapsedSec = 0; this.complete = false;
    this.baselineNoseY = 0; this.baselineNoseX = 0; this.baselineHipY = 0;
    this.fa1GreenHits = 0; this.fa1State = 'neutral';
    this.fa2Activity1Hits = 0; this.fa2Activity2Hits = 0; this.fa2Phase = 1; this.fa2State = 'center';
    this.fa3GreenHits = 0; this.fa3State = 'center';
    this.fa4GreenHits = 0; this.fa4State = 'standing';
    this.fa5GreenHits = 0; this.fa5State = 'standing';
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    if (this.fa2PhaseTimer) { clearTimeout(this.fa2PhaseTimer); this.fa2PhaseTimer = null; }
  }

  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) return { isReady: true, framesReady: CAL_FRAMES, requiredFrames: CAL_FRAMES, message: '' };

    const ls = landmarks[LM.LEFT_SHOULDER];
    const la = landmarks[LM.LEFT_ANKLE];
    const nose = landmarks[LM.NOSE];
    const lh = landmarks[LM.LEFT_HIP];

    if (!ls || !la || !nose || !lh || ls.visibility < 0.4 || la.visibility < 0.3) {
      this.calFrames = 0;
      return { isReady: false, framesReady: 0, requiredFrames: CAL_FRAMES, message: 'Stand with full body visible' };
    }

    // Accumulate baseline via EMA
    if (this.calFrames === 0) {
      this.baselineNoseY = nose.y;
      this.baselineNoseX = nose.x;
      this.baselineHipY = lh.y;
    } else {
      this.baselineNoseY = this.baselineNoseY * 0.8 + nose.y * 0.2;
      this.baselineNoseX = this.baselineNoseX * 0.8 + nose.x * 0.2;
      this.baselineHipY = this.baselineHipY * 0.8 + lh.y * 0.2;
    }

    this.calFrames++;
    if (this.calFrames >= CAL_FRAMES) {
      this.calReady = true;
      this.startTime = performance.now();
      this.startTimer();

      // FA2: switch to phase 2 at 15s
      if (this.testId === 'FA2') {
        this.fa2PhaseTimer = setTimeout(() => {
          this.fa2Phase = 2;
          this.fa2State = 'center';
        }, 15000);
      }
    }
    return { isReady: this.calReady, framesReady: this.calFrames, requiredFrames: CAL_FRAMES, message: 'Hold still...' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processFrame(landmarks: NormalizedLandmark[], _timestamp: number): void {
    if (!this.calReady || this.complete) return;
    this.elapsedSec = Math.floor((performance.now() - this.startTime) / 1000);

    switch (this.testId) {
      case 'FA1': this.processHandSwings(landmarks); break;
      case 'FA2': this.processHeadRotation(landmarks); break;
      case 'FA3': this.processCircleOfReach(landmarks); break;
      case 'FA4': this.processHipHingeReach(landmarks); break;
      case 'FA5': this.processKneeArcGlide(landmarks); break;
    }
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Draw green hit zone indicators based on current test
    ctx.save();

    if (this.testId === 'FA1') {
      // Top and bottom target zones
      const headY = h * 0.15;
      const hipY = h * 0.7;
      ctx.fillStyle = this.fa1State === 'up' ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.1)';
      ctx.fillRect(0, 0, w, headY);
      ctx.fillStyle = this.fa1State === 'down' ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.1)';
      ctx.fillRect(0, hipY, w, h - hipY);
    } else if (this.testId === 'FA3') {
      // Left and right rotation zones
      const midX = w / 2;
      ctx.setLineDash([10, 10]); ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(midX, 0); ctx.lineTo(midX, h); ctx.stroke();
    }

    ctx.restore();
  }

  getHudMetrics(): HudMetrics {
    if (this.testId === 'FA2') {
      return {
        primary: { label: 'Lateral', value: this.fa2Activity1Hits, color: '#22c55e' },
        secondary: { label: 'Sagittal', value: this.fa2Activity2Hits, color: '#3b82f6' },
        timer: { elapsed: this.elapsedSec, total: DURATION },
      };
    }
    const hits = this.getHitCount();
    return {
      primary: { label: 'Hits', value: hits, color: '#22c55e' },
      secondary: { label: 'Rate', value: `${this.elapsedSec > 0 ? (hits / this.elapsedSec * 60).toFixed(0) : 0}/min` },
      timer: { elapsed: this.elapsedSec, total: DURATION },
    };
  }

  isComplete(): boolean { return this.complete; }

  getRawData(): Record<string, unknown> {
    if (this.testId === 'FA2') {
      return { testId: 'FA2', activity1Hits: this.fa2Activity1Hits, activity2Hits: this.fa2Activity2Hits, elapsed: this.elapsedSec };
    }
    return { testId: this.testId, greenHits: this.getHitCount(), elapsed: this.elapsedSec };
  }

  destroy(): void {
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    if (this.fa2PhaseTimer) { clearTimeout(this.fa2PhaseTimer); this.fa2PhaseTimer = null; }
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

  private getHitCount(): number {
    switch (this.testId) {
      case 'FA1': return this.fa1GreenHits;
      case 'FA3': return this.fa3GreenHits;
      case 'FA4': return this.fa4GreenHits;
      case 'FA5': return this.fa5GreenHits;
      default: return 0;
    }
  }

  /** FA1: Hand swings - wrist Y above head or below hip -> green hit
   *  Ported from rom.html lines 1360-1391 */
  private processHandSwings(lm: NormalizedLandmark[]): void {
    const lw = lm[LM.LEFT_WRIST], rw = lm[LM.RIGHT_WRIST];
    const nose = lm[LM.NOSE];
    const lh = lm[LM.LEFT_HIP], rh = lm[LM.RIGHT_HIP];

    if (!lw || !rw || !nose || !lh || !rh) return;

    const headY = nose.y - 0.08; // Above head threshold
    const hipY = (lh.y + rh.y) / 2 + 0.05; // Below hip threshold

    // Check if either wrist is above head
    const wristAboveHead = lw.y < headY || rw.y < headY;
    // Check if either wrist is below hip
    const wristBelowHip = lw.y > hipY || rw.y > hipY;

    if (wristAboveHead && this.fa1State !== 'up') {
      this.fa1State = 'up';
      this.fa1GreenHits++;
    } else if (wristBelowHip && this.fa1State !== 'down') {
      this.fa1State = 'down';
      this.fa1GreenHits++;
    } else if (!wristAboveHead && !wristBelowHip) {
      this.fa1State = 'neutral';
    }
  }

  /** FA2: Head rotation - Phase 1: lateral tilt, Phase 2: sagittal tilt
   *  Ported from rom.html lines 1393-1504 */
  private processHeadRotation(lm: NormalizedLandmark[]): void {
    const nose = lm[LM.NOSE];
    const ls = lm[LM.LEFT_SHOULDER], rs = lm[LM.RIGHT_SHOULDER];
    if (!nose || !ls || !rs) return;

    if (this.fa2Phase === 1) {
      // Phase 1: Lateral - nose X near left/right shoulder
      const shoulderMidX = (ls.x + rs.x) / 2;
      const shoulderSpan = Math.abs(ls.x - rs.x);
      const threshold = shoulderSpan * 0.35;

      if (nose.x < shoulderMidX - threshold && this.fa2State !== 'left') {
        this.fa2State = 'left';
        this.fa2Activity1Hits++;
      } else if (nose.x > shoulderMidX + threshold && this.fa2State !== 'right') {
        this.fa2State = 'right';
        this.fa2Activity1Hits++;
      } else if (nose.x >= shoulderMidX - threshold * 0.5 && nose.x <= shoulderMidX + threshold * 0.5) {
        this.fa2State = 'center';
      }
    } else {
      // Phase 2: Sagittal - nose Y displacement from baseline
      const displacement = nose.y - this.baselineNoseY;
      const threshold = 0.06;

      if (displacement < -threshold && this.fa2State !== 'up') {
        this.fa2State = 'up';
        this.fa2Activity2Hits++;
      } else if (displacement > threshold && this.fa2State !== 'down') {
        this.fa2State = 'down';
        this.fa2Activity2Hits++;
      } else if (Math.abs(displacement) < threshold * 0.5) {
        this.fa2State = 'center';
      }
    }
  }

  /** FA3: Circle of reach - shoulder rotation detection
   *  Ported from rom.html lines 1506-1530 */
  private processCircleOfReach(lm: NormalizedLandmark[]): void {
    const ls = lm[LM.LEFT_SHOULDER], rs = lm[LM.RIGHT_SHOULDER];
    if (!ls || !rs) return;

    const midX = 0.5;
    const threshold = 0.08;

    // Left rotation: left shoulder crosses past midX to the right
    if (ls.x > midX + threshold && this.fa3State !== 'left') {
      this.fa3State = 'left';
      this.fa3GreenHits++;
    }
    // Right rotation: right shoulder crosses past midX to the left
    else if (rs.x < midX - threshold && this.fa3State !== 'right') {
      this.fa3State = 'right';
      this.fa3GreenHits++;
    }
    // Return to center
    else if (ls.x < midX - 0.02 && rs.x > midX + 0.02) {
      this.fa3State = 'center';
    }
  }

  /** FA4: Hip hinge reach - wrist below knee / above hip state machine
   *  Ported from rom.html lines 1532-1558 */
  private processHipHingeReach(lm: NormalizedLandmark[]): void {
    const lw = lm[LM.LEFT_WRIST], rw = lm[LM.RIGHT_WRIST];
    const lk = lm[LM.LEFT_KNEE], rk = lm[LM.RIGHT_KNEE];
    const lh = lm[LM.LEFT_HIP], rh = lm[LM.RIGHT_HIP];

    if (!lw || !rw || !lk || !rk || !lh || !rh) return;

    const kneeY = (lk.y + rk.y) / 2;
    const hipY = (lh.y + rh.y) / 2;
    const wristY = Math.min(lw.y, rw.y); // Lowest wrist

    if (wristY > kneeY && this.fa4State === 'standing') {
      // Reached down past knee
      this.fa4State = 'down';
      this.fa4GreenHits++;
    } else if (wristY < hipY && this.fa4State === 'down') {
      // Stood back up (wrist above hip)
      this.fa4State = 'standing';
      this.fa4GreenHits++;
    }
  }

  /** FA5: Knee arc glide - knee above hip (front) / ankle above hip (back)
   *  Ported from rom.html lines 1560-1596 */
  private processKneeArcGlide(lm: NormalizedLandmark[]): void {
    const lk = lm[LM.LEFT_KNEE], rk = lm[LM.RIGHT_KNEE];
    const la = lm[LM.LEFT_ANKLE], ra = lm[LM.RIGHT_ANKLE];
    const lh = lm[LM.LEFT_HIP], rh = lm[LM.RIGHT_HIP];

    if (!lk || !rk || !la || !ra || !lh || !rh) return;

    const hipY = (lh.y + rh.y) / 2;

    // Front kick: either knee goes above hip level
    const kneeAboveHip = lk.y < hipY - 0.02 || rk.y < hipY - 0.02;
    // Back kick: either ankle goes above hip level (kicking back)
    const ankleAboveHip = la.y < hipY - 0.02 || ra.y < hipY - 0.02;

    if (kneeAboveHip && this.fa5State !== 'front') {
      this.fa5State = 'front';
      this.fa5GreenHits++;
    } else if (ankleAboveHip && !kneeAboveHip && this.fa5State !== 'back') {
      this.fa5State = 'back';
      this.fa5GreenHits++;
    } else if (!kneeAboveHip && !ankleAboveHip) {
      this.fa5State = 'standing';
    }
  }
}
