/**
 * Kriya Balance Engine (BB1-BB4) — Clinical-grade implementation.
 *
 * Ported line-for-line from Balance.html reference (the ground truth).
 * Uses Center of Mass (CoM) tracking with 2D circle boundary, not nose-based lines.
 *
 * Key algorithms (all from Balance.html):
 *   - CoM = hip center × 0.6 + shoulder center × 0.4 (Section 1, line 761)
 *   - EMA smoothing: COM_SMOOTH = 0.35 (Section 1, line 773)
 *   - Calibration EMA: 0.9 × old + 0.1 × new (Section 5, line 1229)
 *   - Circle radius = shoulderWidth × SWAY_BOUNDARY_RATIO (0.22) (Section 5, line 1236)
 *   - Sway angle = atan2(displacement, torsoHeight) in degrees (Section 6, line 1488)
 *   - Breach = CoM displacement > circleRadius (Section 6, line 1494)
 *   - One-leg gate: scoring only when leg is up (Section 6, lines 1409-1464)
 *   - 3-strategy leg detection: ankle gap, knee height, ankle occlusion (line 1865)
 *   - Posture check: trunk angle < 20°, shoulder width 0.08-0.5 (Section 5, line 1304)
 *   - Timer: BB1/BB2 = 30s, BB3/BB4 = legDuration×2 + switchCalibration = 35s (Section 8, line 1929)
 *   - Leg switch at remaining === switchAt (line 1953), labels: Leg 1 → Switch! → Calibrate → Leg 2
 */

import { LM, type GameEngine, type CalibrationStatus, type HudMetrics } from './types';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// ── Types ──
type BalanceTestId = 'BB1' | 'BB2' | 'BB3' | 'BB4';
type Posture = 'pillar' | 'twin' | 'one_leg' | 'one_leg_blind';

// ── Constants (matching Balance.html Section 1) ──
const POSTURE_MAP: Record<BalanceTestId, Posture> = {
  BB1: 'pillar', BB2: 'twin', BB3: 'one_leg', BB4: 'one_leg_blind',
};

/** Sway boundary: percentage of shoulder width (Balance.html line 756) */
const SWAY_BOUNDARY_RATIO = 0.22;

/** EMA smoothing coefficient for real-time CoM tracking (Balance.html line 773) */
const COM_SMOOTH = 0.35;

/** Frames required for calibration baseline (Balance.html line 911) */
const CAL_FRAMES = 30;

/** Per-leg duration in seconds (BB3/BB4 only) */
const LEG_DURATION = 15;
/** Pause between legs for re-calibration (BB3/BB4 only) */
const SWITCH_CALIBRATION = 5;
/** switchAt = legDuration + switchCalibration = 20 (Balance.html line 1952) */
const SWITCH_AT = LEG_DURATION + SWITCH_CALIBRATION;

/**
 * Compute Center of Mass (CoM) from landmarks.
 * Weighted average: hip center 60% + shoulder center 40%.
 * Balance.html Section 1, lines 761-770.
 */
function getCoM(lm: NormalizedLandmark[]): { x: number; y: number } {
  const hipCx = (lm[LM.LEFT_HIP].x + lm[LM.RIGHT_HIP].x) / 2;
  const hipCy = (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2;
  const shCx = (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x) / 2;
  const shCy = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;
  return {
    x: hipCx * 0.6 + shCx * 0.4,
    y: hipCy * 0.6 + shCy * 0.4,
  };
}

/**
 * Multi-signal one-leg detection (Balance.html lines 1865-1900).
 * Returns true if one leg appears to be lifted.
 */
function isOneLegLifted(lm: NormalizedLandmark[]): boolean {
  const lAnk = lm[LM.LEFT_ANKLE];
  const rAnk = lm[LM.RIGHT_ANKLE];
  const lKnee = lm[LM.LEFT_KNEE];
  const rKnee = lm[LM.RIGHT_KNEE];
  const lHip = lm[LM.LEFT_HIP];
  const rHip = lm[LM.RIGHT_HIP];

  const lAnkVis = lAnk ? lAnk.visibility : 0;
  const rAnkVis = rAnk ? rAnk.visibility : 0;

  // Strategy 1: Both ankles visible — use ankle Y gap
  if (lAnkVis >= 0.4 && rAnkVis >= 0.4) {
    const leftIsLifted = lAnk.y < rAnk.y;
    const standingAnkleY = leftIsLifted ? rAnk.y : lAnk.y;
    const liftedAnkleY = leftIsLifted ? lAnk.y : rAnk.y;
    const standingKneeY = leftIsLifted ? rKnee.y : lKnee.y;
    const shinLength = Math.abs(standingAnkleY - standingKneeY);
    const ankleGap = standingAnkleY - liftedAnkleY;
    if (ankleGap > shinLength * 0.3) return true;
  }

  // Strategy 2: Knee height difference (works when ankle is behind body)
  if (lKnee && rKnee && lKnee.visibility >= 0.35 && rKnee.visibility >= 0.35) {
    const kneeGap = Math.abs(lKnee.y - rKnee.y);
    const hipToKnee = Math.abs(((lHip.y + rHip.y) / 2) - Math.min(lKnee.y, rKnee.y));
    if (kneeGap > hipToKnee * 0.2) return true;
  }

  // Strategy 3: One ankle completely occluded = leg behind body = lifted
  if ((lAnkVis < 0.25 && rAnkVis >= 0.4) || (rAnkVis < 0.25 && lAnkVis >= 0.4)) {
    return true;
  }

  return false;
}

export class BalanceEngine implements GameEngine {
  private testId: BalanceTestId;
  private posture: Posture;
  private isPerLeg: boolean;
  private totalDuration: number;

  // ── Calibration state (Balance.html Section 3, lines 873-882) ──
  private calFrames = 0;
  private baselineNoseX: number | null = null;
  private baselineShoulderWidth: number | null = null;
  private baselineCoMX: number | null = null;
  private baselineCoMY: number | null = null;
  private circleRadius: number | null = null;
  private calReady = false;

  // ── Measurement state (Balance.html Section 3, lines 862-871) ──
  private breachCount = 0;
  private maxSwayDeg = 0;
  private swayHistory: number[] = [];
  private startTime = 0;
  private elapsed = 0;
  private complete = false;

  // Per-leg data (BB3/BB4)
  private leg1Breaches = 0;
  private leg2Breaches = 0;
  private leg1MaxSway = 0;
  private leg2MaxSway = 0;
  private currentLeg: 1 | 2 = 1;

  // ── CoM smoothing (Balance.html Section 3, line 898) ──
  private smoothCoMX: number | null = null;
  private smoothCoMY: number | null = null;
  private lastInsideBoundary = true;

  // ── One-leg gate (BB3/BB4) — Balance.html Section 3, lines 901-903 ──
  private oneLegActive = false;
  private legWasUp = false;

  // ── Timer state ──
  private timerId: ReturnType<typeof setInterval> | null = null;
  private timerLabel = 'Time';
  private legSwitched = false;

  /** Whether scoring is paused (during leg switch calibration window) */
  private scoringPaused = false;

  /** Instruction text for on-screen display */
  private instructionText = '';
  private instructionColor = '#22c55e';

  constructor(testId: BalanceTestId) {
    this.testId = testId;
    this.posture = POSTURE_MAP[testId];
    this.isPerLeg = testId === 'BB3' || testId === 'BB4';
    // Balance.html line 1929: totalDuration = perLeg ? (legDuration*2 + switchCalibration) : duration
    this.totalDuration = this.isPerLeg ? (LEG_DURATION * 2 + SWITCH_CALIBRATION) : 30;
    this.timerLabel = this.isPerLeg ? 'Leg 1' : 'Time';
  }

  reset(): void {
    this.calFrames = 0;
    this.baselineNoseX = null;
    this.baselineShoulderWidth = null;
    this.baselineCoMX = null;
    this.baselineCoMY = null;
    this.circleRadius = null;
    this.calReady = false;

    this.breachCount = 0;
    this.maxSwayDeg = 0;
    this.swayHistory = [];
    this.startTime = 0;
    this.elapsed = 0;
    this.complete = false;

    this.leg1Breaches = 0;
    this.leg2Breaches = 0;
    this.leg1MaxSway = 0;
    this.leg2MaxSway = 0;
    this.currentLeg = 1;

    this.smoothCoMX = null;
    this.smoothCoMY = null;
    this.lastInsideBoundary = true;

    this.oneLegActive = false;
    this.legWasUp = false;

    this.timerLabel = this.isPerLeg ? 'Leg 1' : 'Time';
    this.legSwitched = false;
    this.scoringPaused = false;

    this.instructionText = '';
    this.instructionColor = '#22c55e';

    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
  }

  /**
   * Calibration — Balance.html Section 5, lines 1200-1246.
   * Checks required landmarks, posture, accumulates baseline with 0.9/0.1 EMA.
   */
  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.calReady) {
      return { isReady: true, framesReady: CAL_FRAMES, requiredFrames: CAL_FRAMES, message: '' };
    }

    // Check required landmarks (Balance.html lines 1280-1301)
    if (!this.checkRequiredLandmarks(landmarks)) {
      this.calFrames = 0;
      return { isReady: false, framesReady: 0, requiredFrames: CAL_FRAMES, message: 'Position your full body in frame' };
    }

    // Check posture (Balance.html lines 1304-1374)
    const postureCheck = this.checkPosture(landmarks);
    if (!postureCheck.ok) {
      this.calFrames = 0;
      return { isReady: false, framesReady: 0, requiredFrames: CAL_FRAMES, message: postureCheck.message };
    }

    // Accumulate baseline with EMA (Balance.html lines 1219-1236)
    const noseX = landmarks[LM.NOSE].x;
    const shoulderWidth = Math.abs(landmarks[LM.LEFT_SHOULDER].x - landmarks[LM.RIGHT_SHOULDER].x);
    const com = getCoM(landmarks);

    if (this.baselineNoseX === null) {
      this.baselineNoseX = noseX;
      this.baselineShoulderWidth = shoulderWidth;
      this.baselineCoMX = com.x;
      this.baselineCoMY = com.y;
    } else {
      // EMA: 0.9 × old + 0.1 × new (Balance.html line 1229-1232)
      this.baselineNoseX = this.baselineNoseX * 0.9 + noseX * 0.1;
      this.baselineShoulderWidth = this.baselineShoulderWidth! * 0.9 + shoulderWidth * 0.1;
      this.baselineCoMX = this.baselineCoMX! * 0.9 + com.x * 0.1;
      this.baselineCoMY = this.baselineCoMY! * 0.9 + com.y * 0.1;
    }

    // Circle radius = shoulder width × boundary ratio (Balance.html line 1236)
    this.circleRadius = this.baselineShoulderWidth! * SWAY_BOUNDARY_RATIO;

    this.calFrames++;

    if (this.calFrames >= CAL_FRAMES) {
      this.calReady = true;
      this.startTime = performance.now();

      // Set initial on-screen instruction (Balance.html lines 1916-1927)
      if (this.isOneLegTest()) {
        this.instructionText = 'LIFT ONE LEG';
        this.instructionColor = '#f59e0b';
      } else {
        this.instructionText = 'HOLD STEADY';
        this.instructionColor = '#22c55e';
      }

      this.startTimer();
    }

    return {
      isReady: this.calReady,
      framesReady: this.calFrames,
      requiredFrames: CAL_FRAMES,
      message: this.calReady ? '' : 'Hold still - calibrating...',
    };
  }

  /**
   * Process a single frame during gameplay.
   * Balance.html Section 6: processBalanceMeasurement (lines 1403-1521).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processFrame(landmarks: NormalizedLandmark[], _timestamp: number): void {
    if (!this.calReady || this.complete) return;

    // During switch calibration pause, skip measurement entirely
    if (this.scoringPaused) return;

    const isOneLegTest = this.posture === 'one_leg' || this.posture === 'one_leg_blind';

    // ── BB3/BB4: One-leg gate — only score when leg is actually lifted ──
    // Balance.html lines 1409-1464
    if (isOneLegTest) {
      const legUp = isOneLegLifted(landmarks);

      if (!legUp && !this.oneLegActive) {
        // Leg not up, scoring not started → prompt user, skip scoring
        this.instructionText = 'LIFT ONE LEG';
        this.instructionColor = '#f59e0b';
        return;
      }

      if (legUp && !this.oneLegActive) {
        // Leg just lifted! Activate scoring.
        this.oneLegActive = true;
        this.legWasUp = true;
        this.lastInsideBoundary = true;
        // Reset CoM smoothing so baseline is from the one-leg stance
        this.smoothCoMX = null;
        this.smoothCoMY = null;
        // Re-capture CoM baseline for one-leg stance (Balance.html line 1436-1438)
        const com = getCoM(landmarks);
        this.baselineCoMX = com.x;
        this.baselineCoMY = com.y;
        this.instructionText = 'GREAT! HOLD STEADY';
        this.instructionColor = '#22c55e';
      }

      if (!legUp && this.oneLegActive) {
        // Leg dropped during scoring → breach + deactivate (Balance.html line 1447-1463)
        this.breachCount++;
        this.oneLegActive = false;
        this.legWasUp = false;
        this.instructionText = 'LEG DOWN — LIFT AGAIN';
        this.instructionColor = '#ef4444';
        return;
      }
    }

    // ── Compute real-time Center of Mass (Balance.html line 1467) ──
    const com = getCoM(landmarks);

    // EMA smoothing to reduce jitter (Balance.html lines 1470-1475)
    if (this.smoothCoMX === null) {
      this.smoothCoMX = com.x;
      this.smoothCoMY = com.y;
    } else {
      this.smoothCoMX = this.smoothCoMX * COM_SMOOTH + com.x * (1 - COM_SMOOTH);
      this.smoothCoMY = this.smoothCoMY! * COM_SMOOTH + com.y * (1 - COM_SMOOTH);
    }

    // ── 2D displacement from baseline (normalized coords) — Balance.html lines 1479-1481 ──
    const dx = this.smoothCoMX - this.baselineCoMX!;
    const dy = this.smoothCoMY! - this.baselineCoMY!;
    const displacement = Math.sqrt(dx * dx + dy * dy);

    // ── Sway angle: displacement relative to torso height — Balance.html lines 1484-1488 ──
    const torsoHeight = Math.abs(
      ((landmarks[LM.LEFT_SHOULDER].y + landmarks[LM.RIGHT_SHOULDER].y) / 2) -
      ((landmarks[LM.LEFT_HIP].y + landmarks[LM.RIGHT_HIP].y) / 2)
    );
    const swayDeg = Math.atan2(displacement, torsoHeight) * (180 / Math.PI);

    this.swayHistory.push(swayDeg);
    if (swayDeg > this.maxSwayDeg) this.maxSwayDeg = swayDeg;

    // ── Breach detection: is the ball outside the circle? — Balance.html line 1494 ──
    const isInside = displacement <= this.circleRadius!;

    if (!isInside && this.lastInsideBoundary) {
      this.breachCount++;
      this.instructionText = 'BREACH!';
      this.instructionColor = '#ef4444';
    } else if (isInside && !isOneLegTest) {
      this.instructionText = 'HOLD STEADY';
      this.instructionColor = '#22c55e';
    }
    this.lastInsideBoundary = isInside;

    // Update elapsed (also done in timer, but frame-level granularity for HUD)
    this.elapsed = Math.floor((performance.now() - this.startTime) / 1000);
  }

  /**
   * Render sway visualization: circle boundary + live ball.
   * Balance.html Section 6: renderSwayCircle (lines 1526-1700).
   */
  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.calReady || this.baselineCoMX === null || this.circleRadius === null) return;

    const w = width;
    const h = height;

    // Convert normalized coords to pixel coords
    const circleCX = this.baselineCoMX * w;
    const circleCY = this.baselineCoMY! * h;
    const circleR = this.circleRadius * Math.min(w, h);

    const ballCX = (this.smoothCoMX ?? this.baselineCoMX) * w;
    const ballCY = (this.smoothCoMY ?? this.baselineCoMY!) * h;

    const dx = (this.smoothCoMX ?? this.baselineCoMX) - this.baselineCoMX;
    const dy = (this.smoothCoMY ?? this.baselineCoMY!) - this.baselineCoMY!;
    const displacement = Math.sqrt(dx * dx + dy * dy);
    const isOutside = displacement > this.circleRadius;

    const isScoring = !this.scoringPaused && (!this.isOneLegTest() || this.oneLegActive);

    if (!isScoring) {
      // Inactive/waiting state: gray dashed circle (Balance.html lines 1555-1565)
      ctx.save();
      ctx.beginPath();
      ctx.arc(circleCX, circleCY, circleR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fill();
      ctx.restore();
    } else {
      // Active state: colored circle (Balance.html lines 1566-1592)
      // Outer glow
      ctx.save();
      ctx.beginPath();
      ctx.arc(circleCX, circleCY, circleR, 0, Math.PI * 2);
      ctx.strokeStyle = isOutside ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.25)';
      ctx.lineWidth = 6;
      ctx.shadowColor = isOutside ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.3)';
      ctx.shadowBlur = 15;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Inner ring
      ctx.beginPath();
      ctx.arc(circleCX, circleCY, circleR, 0, Math.PI * 2);
      ctx.strokeStyle = isOutside ? 'rgba(239,68,68,0.7)' : 'rgba(34,197,94,0.5)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Glass fill
      ctx.beginPath();
      ctx.arc(circleCX, circleCY, circleR, 0, Math.PI * 2);
      ctx.fillStyle = isOutside ? 'rgba(239,68,68,0.04)' : 'rgba(34,197,94,0.03)';
      ctx.fill();
      ctx.restore();

      // Crosshair (Balance.html lines 1594-1604)
      const crossSize = 8;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(circleCX - crossSize, circleCY);
      ctx.lineTo(circleCX + crossSize, circleCY);
      ctx.moveTo(circleCX, circleCY - crossSize);
      ctx.lineTo(circleCX, circleCY + crossSize);
      ctx.stroke();
      ctx.restore();

      // Live ball (Balance.html lines 1608-1643)
      const ballR = Math.max(9, circleR * 0.18);

      ctx.save();
      ctx.shadowBlur = 12;
      if (isOutside) {
        ctx.shadowColor = 'rgba(239,68,68,0.8)';
        ctx.fillStyle = 'rgba(239,68,68,0.9)';
      } else {
        ctx.shadowColor = 'rgba(34,197,94,0.7)';
        ctx.fillStyle = 'rgba(34,197,94,0.85)';
      }
      ctx.beginPath();
      ctx.arc(ballCX, ballCY, ballR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Ball outline + highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ballCX - ballR * 0.25, ballCY - ballR * 0.25, ballR * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      ctx.restore();

      // Trail line from center to ball
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(circleCX, circleCY);
      ctx.lineTo(ballCX, ballCY);
      ctx.strokeStyle = isOutside ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  getHudMetrics(): HudMetrics {
    return {
      primary: {
        label: 'Breaches',
        value: this.breachCount,
        color: this.breachCount > 5 ? '#ef4444' : this.breachCount > 2 ? '#f59e0b' : '#22c55e',
      },
      secondary: {
        label: 'Max Sway',
        value: `${this.maxSwayDeg.toFixed(1)}°`,
      },
      timer: { elapsed: this.elapsed, total: this.totalDuration },
      timerLabel: this.timerLabel,
      currentLeg: this.isPerLeg ? this.currentLeg : undefined,
      scoringPaused: this.scoringPaused,
      instructionText: this.instructionText,
      instructionColor: this.instructionColor,
    };
  }

  isComplete(): boolean { return this.complete; }

  getRawData(): Record<string, unknown> {
    return {
      testId: this.testId,
      breachCount: this.breachCount,
      maxSwayDeg: Math.round(this.maxSwayDeg * 10) / 10,
      swayHistory: this.swayHistory,
      elapsed: this.elapsed,
      ...(this.isPerLeg && {
        leg1Breaches: this.leg1Breaches,
        leg2Breaches: this.leg2Breaches,
        leg1MaxSway: Math.round(this.leg1MaxSway * 10) / 10,
        leg2MaxSway: Math.round(this.leg2MaxSway * 10) / 10,
      }),
    };
  }

  destroy(): void {
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
  }

  // ── Private helpers ──

  /** Helper to check if this is a one-leg test */
  private isOneLegTest(): boolean {
    return this.posture === 'one_leg' || this.posture === 'one_leg_blind';
  }

  /**
   * Timer — 1-second ticks matching Balance.html Section 8 (lines 1933-1978).
   * Handles leg switch for BB3/BB4 with label cycling.
   */
  private startTimer(): void {
    let remaining = this.totalDuration;

    this.timerId = setInterval(() => {
      remaining--;
      this.elapsed = this.totalDuration - remaining;

      // BB3/BB4 leg switch logic (Balance.html lines 1951-1972)
      if (this.isPerLeg) {
        if (remaining === SWITCH_AT) {
          // Exact switch point (Balance.html line 1953)
          this.timerLabel = 'Switch!';
          this.currentLeg = 2;
          // Save leg 1 totals (Balance.html lines 1956-1957)
          this.leg1Breaches = this.breachCount;
          this.leg1MaxSway = this.maxSwayDeg;
          // Reset one-leg gate (Balance.html lines 1959-1962)
          this.oneLegActive = false;
          this.legWasUp = false;
          this.smoothCoMX = null;
          this.smoothCoMY = null;
          // Pause scoring during switch (Balance.html implicit — no measurement during switch)
          this.scoringPaused = true;
          this.instructionText = 'SWITCH LEGS — LIFT OTHER LEG';
          this.instructionColor = '#3b82f6';
        } else if (remaining < SWITCH_AT && remaining > SWITCH_AT - SWITCH_CALIBRATION) {
          // During switch calibration window (Balance.html line 1968-1969)
          this.timerLabel = 'Calibrate';
        } else if (remaining <= SWITCH_AT - SWITCH_CALIBRATION && !this.legSwitched) {
          // Switch calibration done — resume scoring for leg 2 (Balance.html line 1970-1971)
          // Use <= to avoid missing the exact tick, and guard with legSwitched flag
          this.timerLabel = 'Leg 2';
          this.scoringPaused = false;
          this.lastInsideBoundary = true;
          this.legSwitched = true;
        }
      }

      // Game complete (Balance.html line 1975-1977)
      if (remaining <= 0) {
        this.complete = true;
        // Finalize per-leg data: leg2 = total - leg1
        if (this.isPerLeg) {
          this.leg2Breaches = this.breachCount - this.leg1Breaches;
          this.leg2MaxSway = Math.max(0, this.maxSwayDeg - this.leg1MaxSway);
        }
        if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
      }
    }, 1000);
  }

  /**
   * Check required landmarks are visible.
   * Balance.html Section 5, lines 1280-1301.
   */
  private checkRequiredLandmarks(lm: NormalizedLandmark[]): boolean {
    const minVis = 0.5;
    // Core: shoulders, hips, nose
    const core = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP, LM.NOSE];
    for (const idx of core) {
      if (!lm[idx] || lm[idx].visibility < minVis) return false;
    }

    if (this.isOneLegTest()) {
      // BB3/BB4: need at least one ankle + both knees (Balance.html lines 1289-1295)
      const lAnkVis = lm[LM.LEFT_ANKLE] ? lm[LM.LEFT_ANKLE].visibility : 0;
      const rAnkVis = lm[LM.RIGHT_ANKLE] ? lm[LM.RIGHT_ANKLE].visibility : 0;
      if (lAnkVis < minVis && rAnkVis < minVis) return false;
      if (!lm[LM.LEFT_KNEE] || lm[LM.LEFT_KNEE].visibility < 0.4) return false;
      if (!lm[LM.RIGHT_KNEE] || lm[LM.RIGHT_KNEE].visibility < 0.4) return false;
    } else {
      // BB1/BB2: need both ankles (Balance.html lines 1298-1300)
      if (!lm[LM.LEFT_ANKLE] || lm[LM.LEFT_ANKLE].visibility < minVis) return false;
      if (!lm[LM.RIGHT_ANKLE] || lm[LM.RIGHT_ANKLE].visibility < minVis) return false;
    }

    return true;
  }

  /**
   * Posture validation.
   * Balance.html Section 5, lines 1304-1374.
   * Checks trunk angle, shoulder width, and one-leg lift (3 strategies).
   */
  private checkPosture(lm: NormalizedLandmark[]): { ok: boolean; message: string } {
    // Trunk angle check (Balance.html lines 1305-1312)
    const midShoulderY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;
    const midHipY = (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2;
    const midShoulderX = (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x) / 2;
    const midHipX = (lm[LM.LEFT_HIP].x + lm[LM.RIGHT_HIP].x) / 2;
    const trunkAngle = Math.abs(Math.atan2(midShoulderX - midHipX, midHipY - midShoulderY) * 180 / Math.PI);
    if (trunkAngle > 20) {
      return { ok: false, message: 'Stand upright — your body is tilted' };
    }

    // Shoulder width range (Balance.html lines 1315-1321)
    const shoulderWidth = Math.abs(lm[LM.LEFT_SHOULDER].x - lm[LM.RIGHT_SHOULDER].x);
    if (shoulderWidth < 0.08) {
      return { ok: false, message: 'Move closer to the camera' };
    }
    if (shoulderWidth > 0.5) {
      return { ok: false, message: 'Move further from the camera' };
    }

    // BB3/BB4: one-leg detection with 3 strategies (Balance.html lines 1326-1371)
    if (this.isOneLegTest()) {
      const lAnk = lm[LM.LEFT_ANKLE];
      const rAnk = lm[LM.RIGHT_ANKLE];
      const lKnee = lm[LM.LEFT_KNEE];
      const rKnee = lm[LM.RIGHT_KNEE];
      const lHip = lm[LM.LEFT_HIP];
      const rHip = lm[LM.RIGHT_HIP];

      const lAnkVis = lAnk ? lAnk.visibility : 0;
      const rAnkVis = rAnk ? rAnk.visibility : 0;

      let oneLegDetected = false;

      // Strategy 1: Both ankles visible — ankle gap
      if (lAnkVis >= 0.4 && rAnkVis >= 0.4) {
        const leftIsLifted = lAnk.y < rAnk.y;
        const standingAnkleY = leftIsLifted ? rAnk.y : lAnk.y;
        const liftedAnkleY = leftIsLifted ? lAnk.y : rAnk.y;
        const standingKneeY = leftIsLifted ? rKnee.y : lKnee.y;
        const shinLength = Math.abs(standingAnkleY - standingKneeY);
        const ankleGap = standingAnkleY - liftedAnkleY;
        if (ankleGap > shinLength * 0.3) oneLegDetected = true;
      }

      // Strategy 2: Knee height difference
      if (!oneLegDetected && lKnee && rKnee) {
        const kneeGap = Math.abs(lKnee.y - rKnee.y);
        const hipToKnee = Math.abs(((lHip.y + rHip.y) / 2) - Math.min(lKnee.y, rKnee.y));
        if (kneeGap > hipToKnee * 0.2) oneLegDetected = true;
      }

      // Strategy 3: One ankle not visible = leg behind body
      if (!oneLegDetected) {
        if ((lAnkVis < 0.25 && rAnkVis >= 0.4) || (rAnkVis < 0.25 && lAnkVis >= 0.4)) {
          oneLegDetected = true;
        }
      }

      if (!oneLegDetected) {
        return { ok: false, message: 'Lift one leg — bend your knee and raise your foot' };
      }
    }

    return { ok: true, message: '' };
  }
}
