import 'server-only';

/**
 * v3 Musculage scoring — reverse-engineered grid for the 8 ROM/Mobility games
 * (FA1, FA3, FA4, FA5, KS2, KS4, KS5, KS6).
 *
 * Design properties:
 *   - Bucket scale [1.00, 0.96, 0.92, 0.88, 0.84] (tightened from 1.0..0.6 for natural bounds)
 *   - 6-cohort age-factor matrix (18-39 / 40-49 / 50-59 / 60-69 / 70-84 / 85+)
 *   - Reverse-engineered factors so the conditioned score naturally lands
 *     in [age/(age+15), age/(age-2)] → final Musculage Δ ∈ [-2, +15]
 *   - Asymmetry Index computed as informational signal (non-scoring)
 *
 * The 4 other ROM/Mobility tests (FA2 Backstitch, FA6 Hand Swings, KS1 legacy,
 * KS3 Spinal Wave) intentionally keep their existing compute paths in compute.ts.
 *
 * Source: docs/v3_scoring/Kriya_ROM_Mobility_Musculage_Spec_v3.0.docx (clinical sign-off received).
 * Regression: 30/30 personas + 96/96 E2E scenarios verified in V2 standalone test harness.
 */

import type { ComputeScoreResult } from '@/types/score';
import type { TestId } from '@/types/test';

// ─── Constants ──────────────────────────────────────────────────────────────

/** v3 bucket scale: band index 0..4 (best..worst) → bucket value. */
const BUCKETS = [1.00, 0.96, 0.92, 0.88, 0.84] as const;

/** Per-game X/Y weights — clinical relevance + measurement accuracy. */
const GAME_WEIGHTS: Record<V3TestId, readonly [number, number]> = {
  FA1: [0.5, 0.5],   // Shoulder Sunrise — bilateral, equal
  FA3: [0.5, 0.5],   // Neck Compass — bilateral, equal
  FA4: [0.6, 0.4],   // Hip Hinge Arc — trunk amplitude > knee form-guard
  FA5: [0.5, 0.5],   // Windmill Reach — bilateral, equal
  KS2: [0.5, 0.5],   // Hip Gate — bilateral, equal
  KS4: [0.5, 0.5],   // Lateral Flexion — bilateral, equal
  KS5: [0.6, 0.4],   // Deep Squat — depth > rep count
  KS6: [0.5, 0.5],   // Cossack Squat — bilateral, equal
};

/** 6-cohort age boundaries — uses oldest age in each cohort to derive ageF. */
const COHORT_MAX: Record<string, number> = {
  '18-39': 39,
  '40-49': 49,
  '50-59': 59,
  '60-69': 69,
  '70-84': 84,
  '85+':   100,
};

/** Per-cohort age-factor bounds: [ageF at preCond=0.84, ageF at preCond=1.00]. */
const COHORT_AGEF: Record<string, readonly [number, number]> = (() => {
  const out: Record<string, [number, number]> = {};
  for (const [c, ageMax] of Object.entries(COHORT_MAX)) {
    out[c] = [
      ageMax / (ageMax + 15) / 0.84,  // worst — produces Δ = +15 at ageMax
      ageMax / (ageMax - 2),          // best  — produces Δ = -2 at ageMax
    ];
  }
  return out;
})();

/** Pre-cond brackets — calibration preCond per bracket. */
const PRECOND_BRACKETS: ReadonlyArray<{ lo: number; hi: number; calib: number }> = [
  { lo: 0.96, hi: 1.00, calib: 1.00 },
  { lo: 0.92, hi: 0.96, calib: 0.94 },
  { lo: 0.88, hi: 0.92, calib: 0.90 },
  { lo: 0.86, hi: 0.88, calib: 0.87 },
  { lo: 0.84, hi: 0.86, calib: 0.84 },
];

/** Testable subset of TestId — the 8 games this module owns. */
export type V3TestId = 'FA1' | 'FA3' | 'FA4' | 'FA5' | 'KS2' | 'KS4' | 'KS5' | 'KS6';

export const V3_TEST_IDS: ReadonlySet<TestId> = new Set<TestId>([
  'FA1', 'FA3', 'FA4', 'FA5', 'KS2', 'KS4', 'KS5', 'KS6',
] as TestId[]);

/** Returns true if this testId should use the v3 pipeline. */
export function isV3TestId(testId: TestId): testId is V3TestId {
  return V3_TEST_IDS.has(testId);
}

// ─── Band classifiers — closed-lower convention; inverted axes apply the same to inverted scale ──

const bShoulder = (v: number): number => v >= 160 ? 0 : v >= 140 ? 1 : v >= 120 ? 2 : v >= 90 ? 3 : 4;
const bNeck     = (v: number): number => v >= 75  ? 0 : v >= 60  ? 1 : v >= 45  ? 2 : v >= 30 ? 3 : 4;
const bTrunk    = (v: number): number => v >= 80  ? 0 : v >= 65  ? 1 : v >= 50  ? 2 : v >= 35 ? 3 : 4;
const bKneeInv  = (v: number): number => v <  10  ? 0 : v <  20  ? 1 : v <  30  ? 2 : v <  40 ? 3 : 4;  // INVERTED
const bWind     = (v: number): number => v >= 45  ? 0 : v >= 35  ? 1 : v >= 25  ? 2 : v >= 15 ? 3 : 4;
const bCirc     = (v: number): number => v >= 6   ? 0 : v >= 4   ? 1 : v >= 3   ? 2 : v >= 1  ? 3 : 4;
const bSquat    = (v: number): number => v >= 120 ? 0 : v >= 90  ? 1 : v >= 60  ? 2 : v >= 30 ? 3 : 4;
const bReps     = (v: number): number => v >= 8   ? 0 : v >= 6   ? 1 : v >= 4   ? 2 : v >= 2  ? 3 : 4;
const bLat      = (v: number): number => v >= 30  ? 0 : v >= 20  ? 1 : v >= 10  ? 2 : v >= 5  ? 3 : 4;
const bCoss     = (v: number): number => v >= 90  ? 0 : v >= 70  ? 1 : v >= 50  ? 2 : v >= 30 ? 3 : 4;

const BAND_FN: Record<V3TestId, [(v: number) => number, (v: number) => number]> = {
  FA1: [bShoulder, bShoulder],
  FA3: [bNeck,     bNeck],
  FA4: [bTrunk,    bKneeInv],   // inverted Y
  FA5: [bWind,     bWind],
  KS2: [bCirc,     bCirc],
  KS4: [bLat,      bLat],
  KS5: [bSquat,    bReps],
  KS6: [bCoss,     bCoss],
};

// ─── Cohort & age factor ─────────────────────────────────────────────────────

/** Map age → cohort key. */
export function ageCohort(age: number): keyof typeof COHORT_MAX {
  if (age < 40) return '18-39';
  if (age < 50) return '40-49';
  if (age < 60) return '50-59';
  if (age < 70) return '60-69';
  if (age < 85) return '70-84';
  return '85+';
}

/**
 * Reverse-engineered age normalisation factor.
 * @param preCondPct  Pre-conditioned score as a percentage (84..100). Rounded to 2 dp internally.
 * @param age         Chronological age (15..100).
 */
export function ageFactor(preCondPct: number, age: number): number {
  const cohort = ageCohort(age);
  const [worst, best] = COHORT_AGEF[cohort];
  const preCond = preCondPct / 100;
  for (const b of PRECOND_BRACKETS) {
    if (preCond >= b.lo - 1e-9 && preCond <= b.hi + 1e-9) {
      const t = (b.calib - 0.84) / 0.16;
      return worst + t * (best - worst);
    }
  }
  return worst;  // defensive — should never hit for valid preCond ∈ [0.84, 1.00]
}

/** Asymmetry index from bucket values (non-scoring, surfaced as report tile). */
export function asymmetryIndex(Xv: number, Yv: number): number {
  const hi = Math.max(Xv, Yv);
  if (hi === 0) return 0;
  return Math.round(Math.abs(Xv - Yv) / hi * 1000) / 10;
}

// ─── Raw metric extraction ───────────────────────────────────────────────────

/**
 * Pull the v3 raw scalars (per the HTML scoring spec) from the engine's customMetrics.
 * The engine sends pose-derived scalars under stable keys; this function selects the
 * correct (x, y) pair per testId. Falls back to 0 if missing.
 */
function extractXY(testId: V3TestId, cm: Record<string, number>): { x: number; y: number } {
  // Each game accepts BOTH the v3 canonical field name AND the legacy field name
  // currently emitted by the production engines (rom-v2-engine, hip-gate-engine, etc.).
  // This avoids invasive engine edits; the engines already compute these scalars.
  const pick = (...keys: string[]): number => {
    for (const k of keys) {
      const v = cm[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return 0;
  };
  switch (testId) {
    case 'FA1':  // Shoulder Sunrise: rom-v2-engine emits peakLeft / peakRight
      return { x: pick('peakLeft'),  y: pick('peakRight') };
    case 'FA3':  // Neck Compass: rom-v2-engine emits peakLeft / peakRight (per-phase)
      return { x: pick('peakLeft'),  y: pick('peakRight') };
    case 'FA4':  // Hip Hinge Arc: engine emits peakAngle (= trunk angle) and maxKneeFlexion
      return { x: pick('peakTrunkAngle', 'peakAngle', 'paaAverage'),
               y: pick('worstKneeAngle', 'maxKneeFlexion') };
    case 'FA5':  // Windmill Reach: engine emits peakTRALeft / peakTRARight (trunk rotation)
      return { x: pick('traAtPeakLeft',  'peakTRALeft'),
               y: pick('traAtPeakRight', 'peakTRARight') };
    case 'KS2':  // Hip Gate: engine emits circlesL / circlesR
      return { x: pick('circlesL'), y: pick('circlesR') };
    case 'KS4': {
      // Lateral Flexion: engine emits bestAngleL / bestAngleR in customMetrics
      // (the "session peak" per phase, computed as Math.max across the phase's reps).
      return { x: pick('sessionPeakL', 'bestAngleL'),
               y: pick('sessionPeakR', 'bestAngleR') };
    }
    case 'KS5': {
      // Deep Squat: engine emits maxFlexion + reps
      return { x: pick('sessionPeakFlexion', 'maxFlexion'),
               y: pick('repCount', 'reps') };
    }
    case 'KS6': {
      // Cossack Squat: engine emits bestDepthL / bestDepthR (deepest interior angle).
      // Flexion = 180 − interior. Use direct field if present, else derive.
      const lFlex = pick('leftKneeFlexion');
      const rFlex = pick('rightKneeFlexion');
      if (lFlex > 0 || rFlex > 0) return { x: lFlex, y: rFlex };
      const lDepth = pick('bestDepthL');
      const rDepth = pick('bestDepthR');
      return {
        x: lDepth > 0 ? Math.max(0, 180 - lDepth) : 0,
        y: rDepth > 0 ? Math.max(0, 180 - rDepth) : 0,
      };
    }
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Compute Musculage for a v3-owned testId. Returns the standard
 * ComputeScoreResult so the rest of the pipeline (DB, dashboard) is unchanged.
 *
 * Side effects: none. Pure function of (testId, customMetrics, age).
 *
 * @throws RangeError on invalid age. The 8 v3 games run through engine validation
 *         before reaching this function; this is defence in depth.
 */
export function computeV3(testId: V3TestId, customMetrics: Record<string, number>, age: number): ComputeScoreResult {
  if (!Number.isFinite(age) || age < 15 || age > 120) {
    throw new RangeError(`v3 scoring: age must be 15..120, got ${age}`);
  }

  const { x, y } = extractXY(testId, customMetrics);
  const [bxFn, byFn] = BAND_FN[testId];
  const xBandIdx = bxFn(Number.isFinite(x) ? x : 0);
  const yBandIdx = byFn(Number.isFinite(y) ? y : 0);

  const Xv = BUCKETS[xBandIdx];
  const Yv = BUCKETS[yBandIdx];
  const [Wx, Wy] = GAME_WEIGHTS[testId];

  const preCond = Wx * Xv + Wy * Yv;          // 0.84 .. 1.00
  // Round to 2 dp before bracket lookup — closes float-precision gap (e.g. 0.85 vs 0.8500000000001).
  const preCondPct = Math.round(preCond * 10000) / 100;

  const af = ageFactor(preCondPct, age);
  const conditioned = Math.round(preCond * af * 1e6) / 1e6;

  // Excel formula: Musculage = age / conditioned.
  // The v3 grid is reverse-engineered so this naturally lands in [age-2, age+15].
  // We still apply a defensive clamp; it should never activate on valid input.
  const rawMusc = conditioned > 0 ? age / conditioned : age + 15;
  const muscClamped = Math.max(age - 2, Math.min(age + 15, rawMusc));
  const musculage = Math.round(muscClamped);

  return {
    testId: testId as TestId,
    preCond,
    ageFactor: af,
    conditioned,
    musculage,
    xBandIdx,
    yBandIdx,
  };
}

const BAND_PCT = [100, 75, 50, 25, 0] as const;
const BAND_LABEL = ['Excellent', 'Good', 'Moderate', 'Below average', 'Limited'] as const;
const BILATERAL_GAMES: ReadonlySet<V3TestId> = new Set<V3TestId>(['FA1', 'FA3', 'FA5', 'KS2', 'KS4', 'KS6']);

export interface V3ReportMetrics {
  xBandLabel: string;
  yBandLabel: string;
  xBandPct: number;
  yBandPct: number;
  cohort: string;
  asymmetryIndex: number | null;
  asymmetryLabel: string | null;
  delta: number;
  Wx: number;
  Wy: number;
}

export function reportMetricsV3(testId: V3TestId, result: ComputeScoreResult, age: number): V3ReportMetrics {
  const Xv = BUCKETS[result.xBandIdx];
  const Yv = BUCKETS[result.yBandIdx];
  const bilateral = BILATERAL_GAMES.has(testId);
  const ai = bilateral ? asymmetryIndex(Xv, Yv) : null;
  const aiLabel = ai === null ? null
                 : ai <= 5    ? 'Even'
                 : ai <= 12   ? 'Slight imbalance'
                 : 'Notable imbalance';
  const [Wx, Wy] = GAME_WEIGHTS[testId];
  return {
    xBandLabel: BAND_LABEL[result.xBandIdx],
    yBandLabel: BAND_LABEL[result.yBandIdx],
    xBandPct:   BAND_PCT[result.xBandIdx],
    yBandPct:   BAND_PCT[result.yBandIdx],
    cohort:     ageCohort(age) as string,
    asymmetryIndex: ai,
    asymmetryLabel: aiLabel,
    delta:      result.musculage - age,
    Wx, Wy,
  };
}

export { BUCKETS, GAME_WEIGHTS, COHORT_MAX, COHORT_AGEF, PRECOND_BRACKETS, BAND_PCT, BAND_LABEL };
