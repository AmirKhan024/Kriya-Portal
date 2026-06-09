/**
 * BallEngine — Reflex games NN1, NN2, NN3.
 * Ported from Reflex.html Sections 8, 11-12.
 *
 * NN1: Catch the Ball — gold balls, any hand, first20/last10 split
 * NN2: Choose the Right Colour — green→right hand, blue→left hand
 * NN3: Cross Tap the Right Colour — green→right, blue→left, grey=penalty
 *
 * Ball physics: frame-rate-independent velocity in normalised units/sec.
 * Hit detection uses palm center (avg of wrist/index/pinky/thumb) not just wrist.
 * Speed increases every 10s: 1→2→3 balls/sec.
 */
import { LM, type GameEngine, type CalibrationStatus, type HudMetrics, type NormalizedLandmark } from './types';

export type BallTestId = 'NN1' | 'NN2' | 'NN3';

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  alive: boolean;
  caught: boolean;
  spawnTime: number;
}

interface PalmCenter {
  x: number;
  y: number;
  radius: number;
}

const DURATION = 30;
const CAL_FRAMES = 30;

export class BallEngine implements GameEngine {
  private testId: BallTestId;

  // Calibration
  private calFrames = 0;
  private calReady = false;

  // Ball game state
  private balls: Ball[] = [];
  private spawnTimer: ReturnType<typeof setInterval> | null = null;
  private currentRate = 0;
  private startTime = 0;
  private elapsedSec = 0;
  private complete = false;
  private lastFrameTime = 0;

  // NN1 metrics
  private catches_first20 = 0;
  private catches_last10 = 0;
  private totalCatches = 0;

  // NN2/NN3 metrics
  private greenCatches = 0;
  private blueCatches = 0;

  // NN3 grey penalty
  private greyCatches = 0;
  private greyPenalties = 0;
  private catchSequence: ('green' | 'blue')[] = [];

  // Time series for report chart
  private timeSeries: Array<{ t: number; catches: number }> = [];
  private lastTimeSeriesT = -1;

  // Sound callbacks (injected by game layer)
  onHit?: () => void;
  onWrong?: () => void;
  onPenalty?: () => void;

  constructor(testId: BallTestId) {
    this.testId = testId;
  }

  reset(): void {
    this.calFrames = 0;
    this.calReady = false;
    this.balls = [];
    this.currentRate = 0;
    this.startTime = 0;
    this.elapsedSec = 0;
    this.complete = false;
    this.catches_first20 = 0;
    this.catches_last10 = 0;
    this.totalCatches = 0;
    this.greenCatches = 0;
    this.blueCatches = 0;
    this.greyCatches = 0;
    this.greyPenalties = 0;
    this.catchSequence = [];
    this.timeSeries = [];
    this.lastTimeSeriesT = -1;
    if (this.spawnTimer) { clearInterval(this.spawnTimer); this.spawnTimer = null; }
  }

  /** Called after countdown to reset timing — prevents countdown from stealing game time */
  startPlaying(): void {
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.elapsedSec = 0;
    this.startBallSpawnScheduler();
  }

  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) {
      return { isReady: true, framesReady: CAL_FRAMES, requiredFrames: CAL_FRAMES, message: '' };
    }

    // NN1-3 are seated: need shoulders + wrists visible
    const minVis = 0.5;
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    if (!ls || !rs || ls.visibility < minVis || rs.visibility < minVis) {
      this.calFrames = 0;
      return { isReady: false, framesReady: 0, requiredFrames: CAL_FRAMES, message: 'Shoulders not visible' };
    }
    if (!lw || !rw || lw.visibility < minVis || rw.visibility < minVis) {
      this.calFrames = 0;
      return { isReady: false, framesReady: 0, requiredFrames: CAL_FRAMES, message: 'Both wrists must be visible' };
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

    const now = performance.now();
    const dtSec = Math.min(0.1, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    this.elapsedSec = (now - this.startTime) / 1000;

    if (this.elapsedSec >= DURATION) {
      this.complete = true;
      this.destroy();
      return;
    }

    // Update spawn rate based on elapsed (handles 10s/20s transitions)
    this.updateSpawnRate();

    // Update ball positions (frame-rate independent)
    this.updateBalls(dtSec);

    // Check catches using palm center
    this.checkCatches(landmarks);

    // Record time series (1 sample per second)
    const tSec = Math.floor(this.elapsedSec);
    if (tSec > this.lastTimeSeriesT) {
      this.lastTimeSeriesT = tSec;
      const catches = this.testId === 'NN1'
        ? this.catches_first20 + this.catches_last10
        : this.greenCatches + this.blueCatches;
      this.timeSeries.push({ t: tSec, catches });
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.balls.length === 0) return;
    const minDim = Math.min(width, height);

    // Pass 1: Glow layer (batched by colour)
    ctx.save();
    ctx.globalAlpha = 0.6;
    const colorGroups: Record<string, Ball[]> = {};
    for (const b of this.balls) {
      if (!b.alive) continue;
      (colorGroups[b.color] || (colorGroups[b.color] = [])).push(b);
    }
    for (const color in colorGroups) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const b of colorGroups[color]) {
        const bx = b.x * width;
        const by = b.y * height;
        const br = b.radius * minDim;
        ctx.moveTo(bx + br, by);
        ctx.arc(bx, by, br, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();

    // Pass 2: Solid balls + outline (no shadow)
    ctx.save();
    for (const color in colorGroups) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const b of colorGroups[color]) {
        const bx = b.x * width;
        const by = b.y * height;
        const br = b.radius * minDim;
        ctx.moveTo(bx + br, by);
        ctx.arc(bx, by, br, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // Single stroke pass for all balls
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const b of this.balls) {
      if (!b.alive) continue;
      const bx = b.x * width;
      const by = b.y * height;
      const br = b.radius * minDim;
      ctx.moveTo(bx + br, by);
      ctx.arc(bx, by, br, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  getHudMetrics(): HudMetrics {
    const elapsed = Math.floor(this.elapsedSec);
    if (this.testId === 'NN1') {
      return {
        primary: { label: 'First 20s', value: this.catches_first20, color: '#22c55e' },
        secondary: { label: 'Last 10s', value: this.catches_last10, color: '#22d3ee' },
        timer: { elapsed, total: DURATION },
      };
    }
    const metrics: HudMetrics = {
      primary: { label: '🟢 Green', value: this.greenCatches, color: '#22c55e' },
      secondary: { label: '🔵 Blue', value: this.blueCatches, color: '#3b82f6' },
      timer: { elapsed, total: DURATION },
    };
    if (this.testId === 'NN3') {
      metrics.extra = { label: '⚪ Penalty', value: this.greyPenalties, color: '#ef4444' };
    }
    return metrics;
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

    if (this.testId === 'NN1') {
      return {
        ...base,
        catches_first20: this.catches_first20,
        catches_last10: this.catches_last10,
        totalCatches: this.totalCatches,
      };
    }
    if (this.testId === 'NN2') {
      return {
        ...base,
        greenCatches: this.greenCatches,
        blueCatches: this.blueCatches,
      };
    }
    // NN3
    return {
      ...base,
      greenCatches: this.greenCatches,
      blueCatches: this.blueCatches,
      greyCatches: this.greyCatches,
      greyPenalties: this.greyPenalties,
    };
  }

  destroy(): void {
    if (this.spawnTimer) { clearInterval(this.spawnTimer); this.spawnTimer = null; }
  }

  // ────────────── Private Methods ──────────────

  /**
   * Palm center helper: average of wrist, index, pinky, thumb.
   * Returns {x, y, radius} where radius is the estimated palm half-size.
   * Matches Reflex.html getPalmCenter() exactly.
   */
  private getPalmCenter(landmarks: NormalizedLandmark[], side: 'left' | 'right'): PalmCenter | null {
    const wrist = side === 'left' ? landmarks[LM.LEFT_WRIST] : landmarks[LM.RIGHT_WRIST];
    const index = side === 'left' ? landmarks[LM.LEFT_INDEX] : landmarks[LM.RIGHT_INDEX];
    const pinky = side === 'left' ? landmarks[LM.LEFT_PINKY] : landmarks[LM.RIGHT_PINKY];
    const thumb = side === 'left' ? landmarks[LM.LEFT_THUMB] : landmarks[LM.RIGHT_THUMB];

    const pts = [wrist, index, pinky, thumb].filter(
      (p): p is NormalizedLandmark => p != null && p.visibility >= 0.3
    );
    if (pts.length === 0) return null;

    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

    // Palm radius = half the max spread of the contributing points
    let maxDist = 0;
    for (const p of pts) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > maxDist) maxDist = d;
    }
    // Clamp minimum radius so detection still works even with poor landmark spread
    const palmRadius = Math.max(maxDist, 0.025);

    return { x: cx, y: cy, radius: palmRadius };
  }

  private updateSpawnRate(): void {
    const rate = this.elapsedSec < 10 ? 1 : this.elapsedSec < 20 ? 2 : 3;
    if (rate === this.currentRate) return;
    this.currentRate = rate;
    if (this.spawnTimer) clearInterval(this.spawnTimer);
    this.spawnTimer = setInterval(() => {
      if (this.complete) return;
      this.spawnBall();
    }, 1000 / rate);
    // Spawn one immediately on rate change
    this.spawnBall();
  }

  private startBallSpawnScheduler(): void {
    if (this.spawnTimer) { clearInterval(this.spawnTimer); this.spawnTimer = null; }
    this.currentRate = 0;
    this.updateSpawnRate();
  }

  private spawnBall(): void {
    let color: string;
    if (this.testId === 'NN1') {
      color = '#FFD700'; // Gold
    } else if (this.testId === 'NN3') {
      const r = Math.random();
      color = r < 0.4 ? '#22c55e' : r < 0.8 ? '#3b82f6' : '#9ca3af'; // Green/Blue/Grey
    } else {
      color = Math.random() < 0.5 ? '#22c55e' : '#3b82f6'; // Green/Blue
    }

    const speed = 0.08 + Math.random() * 0.06; // units/sec
    const angle = Math.random() * Math.PI * 2;

    this.balls.push({
      x: 0.12 + Math.random() * 0.76,
      y: 0.10 + Math.random() * 0.65,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      radius: 0.025,
      alive: true,
      caught: false,
      spawnTime: this.elapsedSec,
    });
  }

  private updateBalls(dtSec: number): void {
    for (const b of this.balls) {
      if (!b.alive) continue;
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      if (b.x < 0.05 || b.x > 0.95) { b.vx *= -1; b.x = Math.max(0.05, Math.min(0.95, b.x)); }
      if (b.y < 0.05 || b.y > 0.85) { b.vy *= -1; b.y = Math.max(0.05, Math.min(0.85, b.y)); }
      // Auto-expire after 5 seconds
      if (this.elapsedSec - b.spawnTime > 5) b.alive = false;
    }
    this.balls = this.balls.filter(b => b.alive);
  }

  private checkCatches(landmarks: NormalizedLandmark[]): void {
    // Use palm center (avg of wrist/index/pinky/thumb) instead of single wrist point
    const leftPalm = this.getPalmCenter(landmarks, 'left');
    const rightPalm = this.getPalmCenter(landmarks, 'right');

    for (const b of this.balls) {
      if (!b.alive || b.caught) continue;

      let caught = false;
      let hand: 'left' | 'right' | null = null;

      // Check right palm first
      if (rightPalm) {
        const dR = Math.hypot(b.x - rightPalm.x, b.y - rightPalm.y);
        if (dR < b.radius + rightPalm.radius) { caught = true; hand = 'right'; }
      }
      // Then left palm
      if (!caught && leftPalm) {
        const dL = Math.hypot(b.x - leftPalm.x, b.y - leftPalm.y);
        if (dL < b.radius + leftPalm.radius) { caught = true; hand = 'left'; }
      }
      if (!caught) continue;

      b.alive = false;
      b.caught = true;

      if (this.testId === 'NN1') {
        this.totalCatches++;
        const preciseNow = (performance.now() - this.startTime) / 1000;
        if (preciseNow < 20.0) this.catches_first20++;
        else this.catches_last10++;
        this.onHit?.();

      } else if (this.testId === 'NN2') {
        if (b.color === '#22c55e' && hand === 'right') { this.greenCatches++; this.onHit?.(); }
        else if (b.color === '#3b82f6' && hand === 'left') { this.blueCatches++; this.onHit?.(); }
        else { this.onWrong?.(); }

      } else if (this.testId === 'NN3') {
        if (b.color === '#9ca3af') {
          // Grey ball = penalty: nullify last valid catch
          this.greyCatches++;
          if (this.catchSequence.length > 0) {
            const last = this.catchSequence.pop()!;
            if (last === 'green') this.greenCatches = Math.max(0, this.greenCatches - 1);
            else this.blueCatches = Math.max(0, this.blueCatches - 1);
            this.greyPenalties++;
          }
          this.onPenalty?.();
        } else if (b.color === '#22c55e' && hand === 'right') {
          this.greenCatches++; this.catchSequence.push('green'); this.onHit?.();
        } else if (b.color === '#3b82f6' && hand === 'left') {
          this.blueCatches++; this.catchSequence.push('blue'); this.onHit?.();
        } else { this.onWrong?.(); }
      }
    }
  }
}
