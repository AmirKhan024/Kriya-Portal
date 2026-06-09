/**
 * FlashEngine — Reflex games NN4 and NN5.
 * Ported from Reflex.html Sections 9, 11.
 *
 * NN4: Flash Tap Test — 4 quadrants (TR/TL/BR/BL), correct limb to torch.
 *   Top quadrants → hands (palm center), Bottom quadrants → legs (ankle).
 * NN5: Cross Body Strike — L/R halves, punch with OPPOSITE hand (cross-body).
 *   Flash on LEFT → RIGHT hand crosses to left half.
 *   Flash on RIGHT → LEFT hand crosses to right half.
 *
 * Speed: 1→2→3 flashes/sec every 10s. 30s duration.
 * Hit detection uses palm center (avg of wrist/index/pinky/thumb).
 */
import { LM, type GameEngine, type CalibrationStatus, type HudMetrics, type NormalizedLandmark } from './types';

export type FlashTestId = 'NN4' | 'NN5';
type Quad = 'TR' | 'TL' | 'BR' | 'BL';
type Side = 'L' | 'R';

interface FlashTarget {
  quad?: Quad;     // NN4
  side?: Side;     // NN5
  shape?: string;  // NN5: 'square' | 'triangle'
  spawnTime: number;
  torched: boolean;
}

interface PalmCenter {
  x: number;
  y: number;
  radius: number;
}

const DURATION = 30;
const CAL_FRAMES = 30;

export class FlashEngine implements GameEngine {
  private testId: FlashTestId;
  private calFrames = 0;
  private calReady = false;
  private startTime = 0;
  private elapsedSec = 0;
  private complete = false;
  private spawnTimer: ReturnType<typeof setInterval> | null = null;
  private currentRate = 0;
  private activeFlash: FlashTarget | null = null;

  // NN4 metrics
  private handTorches = 0;
  private legTorches = 0;

  // NN5 metrics
  private rightHandTorches = 0;
  private leftHandTorches = 0;

  // Time series for report chart
  private timeSeries: Array<{ t: number; torches: number }> = [];
  private lastTimeSeriesT = -1;

  onHit?: () => void;

  constructor(testId: FlashTestId) {
    this.testId = testId;
  }

  reset(): void {
    this.calFrames = 0;
    this.calReady = false;
    this.startTime = 0;
    this.elapsedSec = 0;
    this.complete = false;
    this.activeFlash = null;
    this.handTorches = 0;
    this.legTorches = 0;
    this.rightHandTorches = 0;
    this.leftHandTorches = 0;
    this.currentRate = 0;
    this.timeSeries = [];
    this.lastTimeSeriesT = -1;
    if (this.spawnTimer) { clearInterval(this.spawnTimer); this.spawnTimer = null; }
  }

  /** Called after countdown to reset timing */
  startPlaying(): void {
    this.startTime = performance.now();
    this.elapsedSec = 0;
    this.startSpawnScheduler();
  }

  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) {
      return { isReady: true, framesReady: CAL_FRAMES, requiredFrames: CAL_FRAMES, message: '' };
    }

    // NN4/NN5: standing, full body needed
    const minVis = 0.5;
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    if (!ls || !rs || ls.visibility < minVis || rs.visibility < minVis) {
      this.calFrames = 0;
      return { isReady: false, framesReady: 0, requiredFrames: CAL_FRAMES, message: 'Shoulders not visible' };
    }

    const needed = [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE];
    for (const idx of needed) {
      if (!landmarks[idx] || landmarks[idx].visibility < minVis) {
        this.calFrames = 0;
        return { isReady: false, framesReady: 0, requiredFrames: CAL_FRAMES, message: 'Full body must be visible (head to toe)' };
      }
    }

    this.calFrames++;
    if (this.calFrames >= CAL_FRAMES) {
      this.calReady = true;
    }

    return {
      isReady: this.calReady,
      framesReady: this.calFrames,
      requiredFrames: CAL_FRAMES,
      progress: this.calFrames / CAL_FRAMES,
      message: this.calReady ? '' : 'Hold still — calibrating...',
    };
  }

  processFrame(landmarks: NormalizedLandmark[], _timestamp: number): void {
    if (!this.calReady || this.complete) return;
    this.elapsedSec = (performance.now() - this.startTime) / 1000;

    if (this.elapsedSec >= DURATION) {
      this.complete = true;
      this.destroy();
      return;
    }

    this.updateSpawnRate();
    this.checkTorch(landmarks);

    // Record time series (1 sample per second)
    const tSec = Math.floor(this.elapsedSec);
    if (tSec > this.lastTimeSeriesT) {
      this.lastTimeSeriesT = tSec;
      const torches = this.testId === 'NN4'
        ? this.handTorches + this.legTorches
        : this.rightHandTorches + this.leftHandTorches;
      this.timeSeries.push({ t: tSec, torches });
    }
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const f = this.activeFlash;
    if (!f) return;

    const midX = w / 2;
    const midY = h / 2;
    // Cheaper pulse: uses sine animation
    const pulse = 1 + 0.08 * Math.sin(Date.now() * 0.0067);

    if (this.testId === 'NN4' && f.quad) {
      const boxSize = Math.max(w, h) * 0.13 * pulse;
      const offX = w * 0.25;
      const offY = h * 0.25;
      let fx: number, fy: number;
      if (f.quad === 'TR') { fx = midX + offX; fy = midY - offY; }
      else if (f.quad === 'TL') { fx = midX - offX; fy = midY - offY; }
      else if (f.quad === 'BR') { fx = midX + offX; fy = midY + offY; }
      else { fx = midX - offX; fy = midY + offY; }

      ctx.save();
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(251,191,36,0.7)';
      ctx.fillRect(fx - boxSize / 2, fy - boxSize / 2, boxSize, boxSize);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.strokeRect(fx - boxSize / 2, fy - boxSize / 2, boxSize, boxSize);
      const labels: Record<string, string> = {
        TR: 'R.Hand \u270B', TL: 'L.Hand \u270B',
        BR: 'R.Leg \u{1F9B5}', BL: 'L.Leg \u{1F9B5}',
      };
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[f.quad] ?? '', fx, fy + 6);
      ctx.restore();

      // Quadrant dividers
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, h);
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();
      ctx.restore();

    } else if (this.testId === 'NN5' && f.side) {
      const shapeSize = Math.max(w, h) * 0.11 * pulse;
      const offX = w * 0.3;
      const fx = f.side === 'L' ? midX - offX : midX + offX;
      const fy = midY;
      const isLeft = f.side === 'L';

      ctx.save();
      ctx.shadowColor = isLeft ? '#3b82f6' : '#fb923c';
      ctx.shadowBlur = 18;
      ctx.fillStyle = isLeft ? 'rgba(59,130,246,0.7)' : 'rgba(251,146,60,0.7)';

      if (f.shape === 'square') {
        ctx.fillRect(fx - shapeSize / 2, fy - shapeSize / 2, shapeSize, shapeSize);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(fx - shapeSize / 2, fy - shapeSize / 2, shapeSize, shapeSize);
      } else {
        ctx.beginPath();
        ctx.moveTo(fx, fy - shapeSize / 2);
        ctx.lineTo(fx - shapeSize / 2, fy + shapeSize / 2);
        ctx.lineTo(fx + shapeSize / 2, fy + shapeSize / 2);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        isLeft ? 'R.Hand \u2192\u25A0' : 'L.Hand \u2192\u25B2',
        fx,
        fy + shapeSize / 2 + 24,
      );
      ctx.restore();

      // Center divider
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, h);
      ctx.stroke();
      ctx.restore();
    }
  }

  getHudMetrics(): HudMetrics {
    const elapsed = Math.floor(this.elapsedSec);
    if (this.testId === 'NN4') {
      return {
        primary: { label: 'Hands', value: `${this.handTorches}/16`, color: '#fb923c' },
        secondary: { label: 'Legs', value: `${this.legTorches}/16`, color: '#22d3ee' },
        timer: { elapsed, total: DURATION },
      };
    }
    return {
      primary: { label: 'R.Hand\u2192L', value: this.rightHandTorches, color: '#fb923c' },
      secondary: { label: 'L.Hand\u2192R', value: this.leftHandTorches, color: '#22d3ee' },
      timer: { elapsed, total: DURATION },
    };
  }

  isComplete(): boolean {
    return this.complete;
  }

  getRawData(): Record<string, unknown> {
    const base = {
      testId: this.testId,
      elapsed: Math.floor(this.elapsedSec),
      timeSeries: this.timeSeries,
    };
    if (this.testId === 'NN4') {
      return { ...base, handTorches: this.handTorches, legTorches: this.legTorches };
    }
    return { ...base, rightHandTorches: this.rightHandTorches, leftHandTorches: this.leftHandTorches };
  }

  destroy(): void {
    if (this.spawnTimer) { clearInterval(this.spawnTimer); this.spawnTimer = null; }
  }

  // ────────────── Private Methods ──────────────

  /**
   * Palm center helper: average of wrist, index, pinky, thumb.
   * Matches Reflex.html getPalmCenter() exactly.
   */
  private getPalmCenter(lm: NormalizedLandmark[], side: 'left' | 'right'): PalmCenter | null {
    const wrist = side === 'left' ? lm[LM.LEFT_WRIST] : lm[LM.RIGHT_WRIST];
    const index = side === 'left' ? lm[LM.LEFT_INDEX] : lm[LM.RIGHT_INDEX];
    const pinky = side === 'left' ? lm[LM.LEFT_PINKY] : lm[LM.RIGHT_PINKY];
    const thumb = side === 'left' ? lm[LM.LEFT_THUMB] : lm[LM.RIGHT_THUMB];

    const pts = [wrist, index, pinky, thumb].filter(
      (p): p is NormalizedLandmark => p != null && p.visibility >= 0.3
    );
    if (pts.length === 0) return null;

    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    let maxDist = 0;
    for (const p of pts) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > maxDist) maxDist = d;
    }
    const palmRadius = Math.max(maxDist, 0.025);
    return { x: cx, y: cy, radius: palmRadius };
  }

  private updateSpawnRate(): void {
    const rate = this.elapsedSec < 10 ? 1 : this.elapsedSec < 20 ? 2 : 3;
    if (rate === this.currentRate) return;
    this.currentRate = rate;
    if (this.spawnTimer) clearInterval(this.spawnTimer);
    this.spawnTimer = setInterval(() => {
      if (!this.complete) this.spawnFlash();
    }, 1000 / rate);
    if (!this.complete) this.spawnFlash();
  }

  private startSpawnScheduler(): void {
    if (this.spawnTimer) { clearInterval(this.spawnTimer); this.spawnTimer = null; }
    this.currentRate = 0;
    this.updateSpawnRate();
  }

  private spawnFlash(): void {
    if (this.testId === 'NN4') {
      const quads: Quad[] = ['TR', 'TL', 'BR', 'BL'];
      this.activeFlash = {
        quad: quads[Math.floor(Math.random() * 4)],
        spawnTime: this.elapsedSec,
        torched: false,
      };
    } else {
      const side: Side = Math.random() < 0.5 ? 'L' : 'R';
      this.activeFlash = {
        side,
        shape: side === 'L' ? 'square' : 'triangle',
        spawnTime: this.elapsedSec,
        torched: false,
      };
    }
  }

  private checkTorch(lm: NormalizedLandmark[]): void {
    if (!this.activeFlash) return;
    const f = this.activeFlash;

    if (this.testId === 'NN4' && f.quad) {
      const midX = 0.5;
      const midY = 0.5;
      let torchOk = false;

      if (f.quad === 'TR' || f.quad === 'TL') {
        // Hand quadrants — use palm center
        const side = f.quad === 'TR' ? 'right' : 'left';
        const palm = this.getPalmCenter(lm, side);
        if (palm) {
          const inTop = palm.y < midY;
          const inRight = palm.x > midX;
          if (f.quad === 'TR' && inTop && inRight) torchOk = true;
          else if (f.quad === 'TL' && inTop && !inRight) torchOk = true;
        }
        // Fallback: check the other hand's palm
        if (!torchOk) {
          const otherSide = side === 'right' ? 'left' : 'right';
          const otherPalm = this.getPalmCenter(lm, otherSide);
          if (otherPalm) {
            const inTop = otherPalm.y < midY;
            const inRight = otherPalm.x > midX;
            if (f.quad === 'TR' && inTop && inRight) torchOk = true;
            else if (f.quad === 'TL' && inTop && !inRight) torchOk = true;
          }
        }
      } else {
        // Leg quadrants — use ankle
        const primaryLmIdx = f.quad === 'BR' ? LM.RIGHT_ANKLE : LM.LEFT_ANKLE;
        const lmPt = lm[primaryLmIdx];
        if (lmPt && lmPt.visibility >= 0.4) {
          const inBottom = lmPt.y >= midY;
          const inRight = lmPt.x > midX;
          if (f.quad === 'BR' && inBottom && inRight) torchOk = true;
          else if (f.quad === 'BL' && inBottom && !inRight) torchOk = true;
        }
        // Fallback: check both ankles
        if (!torchOk) {
          for (const li of [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) {
            const p = lm[li];
            if (!p || p.visibility < 0.4) continue;
            const qt = p.y < midY;
            const qr = p.x > midX;
            if (f.quad === 'BR' && !qt && qr) torchOk = true;
            else if (f.quad === 'BL' && !qt && !qr) torchOk = true;
            if (torchOk) break;
          }
        }
      }

      if (torchOk) {
        f.torched = true;
        if (f.quad.startsWith('T')) this.handTorches++;
        else this.legTorches++;
        this.onHit?.();
        this.activeFlash = null;
      }

    } else if (this.testId === 'NN5' && f.side) {
      // Cross-body: flash on L → RIGHT hand, flash on R → LEFT hand
      const correctSide = f.side === 'L' ? 'right' : 'left';
      const palm = this.getPalmCenter(lm, correctSide);
      if (!palm) return;

      const midX = 0.5;
      const inCorrectSide = (f.side === 'L' && palm.x < midX) || (f.side === 'R' && palm.x > midX);

      if (inCorrectSide) {
        f.torched = true;
        if (f.side === 'L') this.rightHandTorches++;
        else this.leftHandTorches++;
        this.onHit?.();
        this.activeFlash = null;
      }
    }
  }
}
