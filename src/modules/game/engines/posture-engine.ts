// [NEW] Kriya - Posture Engine (Plumb Line Assessment)
// Measures vertical alignment deviation of ear-shoulder-hip-ankle landmarks

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics } from './types';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const DURATION = 30;
const CAL_FRAMES = 30;

/** Number of measurement samples to collect during the assessment */
const SAMPLE_INTERVAL_MS = 200;

interface AlignmentSample {
  /** Average lateral deviation in normalized coords */
  deviation: number;
  /** Deviation in degrees from vertical */
  deviationDeg: number;
  /** Timestamp */
  time: number;
}

export class PostureEngine implements GameEngine {
  private calFrames = 0;
  private calReady = false;
  private startTime = 0;
  private elapsedSec = 0;
  private complete = false;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private lastSampleTime = 0;

  // Baseline from calibration
  private baselineAnkleX = 0;

  // Measurement data
  private samples: AlignmentSample[] = [];
  private currentDeviation = 0;
  private maxDeviationDeg = 0;
  private avgDeviationDeg = 0;

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(_testId?: string) {
    // Single posture test — no testId routing needed
  }

  reset(): void {
    this.calFrames = 0;
    this.calReady = false;
    this.startTime = 0;
    this.elapsedSec = 0;
    this.complete = false;
    this.baselineAnkleX = 0;
    this.samples = [];
    this.currentDeviation = 0;
    this.maxDeviationDeg = 0;
    this.avgDeviationDeg = 0;
    this.lastSampleTime = 0;
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
  }

  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) return { isReady: true, framesReady: CAL_FRAMES, requiredFrames: CAL_FRAMES, message: '' };

    const nose = landmarks[LM.NOSE];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    if (!nose || !ls || !rs || !lh || !rh || !la || !ra ||
        nose.visibility < 0.5 || ls.visibility < 0.4 || la.visibility < 0.3) {
      this.calFrames = 0;
      return { isReady: false, framesReady: 0, requiredFrames: CAL_FRAMES, message: 'Stand with full body visible' };
    }

    // Accumulate baseline ankle midpoint via EMA
    const ankleX = (la.x + ra.x) / 2;
    if (this.calFrames === 0) {
      this.baselineAnkleX = ankleX;
    } else {
      this.baselineAnkleX = this.baselineAnkleX * 0.8 + ankleX * 0.2;
    }

    this.calFrames++;
    if (this.calFrames >= CAL_FRAMES) {
      this.calReady = true;
      this.startTime = performance.now();
      this.lastSampleTime = this.startTime;
      this.startTimer();
    }

    return {
      isReady: this.calReady,
      framesReady: this.calFrames,
      requiredFrames: CAL_FRAMES,
      message: 'Stand naturally — calibrating...',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processFrame(landmarks: NormalizedLandmark[], _timestamp: number): void {
    if (!this.calReady || this.complete) return;

    const now = performance.now();
    this.elapsedSec = Math.floor((now - this.startTime) / 1000);

    const nose = landmarks[LM.NOSE];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    if (!nose || !ls || !rs || !lh || !rh || !la || !ra) return;

    // Calculate plumb line deviation:
    // Ideal: ear, shoulder, hip, ankle all at the same X coordinate
    // Deviation = average horizontal offset of each segment from ankle midpoint
    const ankleX = (la.x + ra.x) / 2;
    const shoulderX = (ls.x + rs.x) / 2;
    const hipX = (lh.x + rh.x) / 2;
    const earX = nose.x; // Nose as proxy for ear midpoint in frontal view

    // Lateral deviations from the ankle base
    const earDev = Math.abs(earX - ankleX);
    const shoulderDev = Math.abs(shoulderX - ankleX);
    const hipDev = Math.abs(hipX - ankleX);

    // Weighted average deviation (head matters more for perceived posture)
    const avgDev = earDev * 0.4 + shoulderDev * 0.35 + hipDev * 0.25;
    this.currentDeviation = avgDev;

    // Convert to degrees: estimate based on body height
    // Using the distance from ankle to nose as reference height
    const bodyHeight = Math.abs(nose.y - ankleX);
    const deviationDeg = bodyHeight > 0.01
      ? Math.atan2(avgDev, bodyHeight) * (180 / Math.PI)
      : 0;

    // Sample at regular intervals
    if (now - this.lastSampleTime >= SAMPLE_INTERVAL_MS) {
      this.samples.push({ deviation: avgDev, deviationDeg, time: now });
      this.lastSampleTime = now;

      // Update running stats
      if (deviationDeg > this.maxDeviationDeg) {
        this.maxDeviationDeg = deviationDeg;
      }
      const totalDeg = this.samples.reduce((sum, s) => sum + s.deviationDeg, 0);
      this.avgDeviationDeg = totalDeg / this.samples.length;
    }
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Draw plumb line (vertical reference)
    const lineX = this.baselineAnkleX * w;

    ctx.save();

    // Plumb line
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Deviation indicator band
    const bandWidth = this.currentDeviation * w * 2;
    if (bandWidth > 2) {
      const color = this.avgDeviationDeg < 6 ? 'rgba(34,197,94,0.1)' :
                    this.avgDeviationDeg < 12 ? 'rgba(245,158,11,0.1)' :
                    'rgba(239,68,68,0.1)';
      ctx.fillStyle = color;
      ctx.fillRect(lineX - bandWidth, 0, bandWidth * 2, h);
    }

    ctx.restore();
  }

  getHudMetrics(): HudMetrics {
    const color = this.avgDeviationDeg < 6 ? '#22c55e' :
                  this.avgDeviationDeg < 12 ? '#f59e0b' :
                  '#ef4444';
    return {
      primary: { label: 'Avg Deviation', value: `${this.avgDeviationDeg.toFixed(1)}°`, color },
      secondary: { label: 'Max Deviation', value: `${this.maxDeviationDeg.toFixed(1)}°`, color: '#94a3b8' },
      timer: { elapsed: this.elapsedSec, total: DURATION },
    };
  }

  isComplete(): boolean { return this.complete; }

  getRawData(): Record<string, unknown> {
    return {
      testId: 'POSTURE1',
      avgDeviationDeg: Math.round(this.avgDeviationDeg * 10) / 10,
      maxDeviationDeg: Math.round(this.maxDeviationDeg * 10) / 10,
      sampleCount: this.samples.length,
      elapsed: this.elapsedSec,
    };
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
}
