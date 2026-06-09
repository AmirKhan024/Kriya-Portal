import 'server-only';

import type { TestId } from '@/types/test';
import type { GameConfig } from '@/config/games/types';
import type { ComputeScoreResult, RawScoreInput, ScoreBand } from '@/types/score';
import { MATRIX_70_30, MATRIX_60_40, MATRIX_55_45, MATRIX_50_50 } from './matrices';
import {
  bandStd30, bandNN4X, bandNN4Y,
  bandBreaches, bandSway,
  bandFA1_PAA, bandFA1_SI,
  bandFA2_Reach, bandFA2_SI,
  bandFA3_PAA, bandFA3_SI,
  bandFA4_PAA, bandFA4_QI,
  bandFA5_CRS, bandFA5_SI,
  bandFA6_NGB, bandFA6_DAC,
  bandKS1X, bandKS1Y, bandKS2_MQS, bandKS2_TCI, bandKS3_MQS, bandKS3_SSI,
  bandKS4_MQS, bandKS4_TCI, bandKS5_MQS, bandKS5_DCI, bandKS6_MQS, bandKS6_TCI,
} from './bands';
import { getAgeNormFactor } from './age-norm';
import { checkPlausibility } from './validators';
import { isV3TestId, computeV3 } from './v3';

// Re-export client-safe types so server consumers can still import from here
export type { ComputeScoreResult as ScoreResult, RawScoreInput, ScoreBand };

/** Internal alias — keeps function signatures unchanged */
type ScoreResult = ComputeScoreResult;

/**
 * Normalize a raw game score into a 0–100 scale.
 * Runs the full scoring pipeline (band → matrix → age norm) and scales the result.
 * @param rawScore - Raw score input containing testId and game metrics
 * @param _gameConfig - Game configuration (reserved for future per-game overrides; testId from rawScore is used)
 * @param age - User's age in years
 * @param _gender - User's gender (reserved for future gender-adjusted bands)
 * @returns Normalized score in the range 0–100
 */
export function normalizeScore(
  rawScore: RawScoreInput,
  _gameConfig: GameConfig,
  age: number,
  _gender: 'male' | 'female' | 'other'
): number {
  const result = computeScore(rawScore, age);
  // Conditioned score is 0.0–1.2 (age-adjusted can exceed 1.0).
  // Clamp to [0, 1] then scale to 0–100.
  const clamped = Math.min(Math.max(result.conditioned, 0), 1);
  return Math.round(clamped * 100);
}

/**
 * Calculate musculage (biological muscle age) from a normalized score and chronological age.
 * Lower musculage relative to age = better muscular fitness.
 * @param normalizedScore - Score on 0–100 scale (from normalizeScore)
 * @param age - User's chronological age
 * @returns Musculage age (integer)
 */
export function calculateMusculage(normalizedScore: number, age: number): number {
  const conditioned = normalizedScore / 100;
  if (conditioned <= 0) return age * 3;
  return Math.round(age / conditioned);
}

/**
 * Plausibility check — validates whether raw game metrics are within physically possible ranges.
 * Prevents fabricated or corrupted client-side data from entering the scoring pipeline.
 * @param rawScore - Raw score input containing testId and game metrics
 * @param _gameConfig - Game configuration (reserved for future per-game validation rules)
 * @returns true if the raw data passes all plausibility checks
 */
export function validateScore(rawScore: RawScoreInput, _gameConfig: GameConfig): boolean {
  const { plausible } = checkPlausibility(rawScore.testId, {
    hits: rawScore.hits,
    misses: rawScore.misses,
    breachCount: rawScore.breachCount,
    maxSwayDegrees: rawScore.maxSwayDegrees,
    duration: rawScore.duration,
  });
  return plausible;
}

/**
 * Maps a normalized score (0–100) to a human-readable performance band.
 * Band thresholds: excellent ≥ 91, good ≥ 81, fair ≥ 61, poor < 61.
 * These align with the age normalization matrix band boundaries.
 * @param normalizedScore - Score on 0–100 scale
 * @returns Score band label
 */
export function getScoreBand(normalizedScore: number): ScoreBand {
  if (normalizedScore >= 91) return 'excellent';
  if (normalizedScore >= 81) return 'good';
  if (normalizedScore >= 61) return 'fair';
  return 'poor';
}

/** Matrix lookup: returns pre-conditioned score (0.0 - 1.0) */
export function matrixLookup(matrix: number[][], xBandIdx: number, yBandIdx: number): number {
  return matrix[yBandIdx][xBandIdx];
}

/** Full scoring pipeline: band indices -> matrix -> age norm -> conditioned -> musculage */
export function computeFullScore(
  matrix: number[][],
  xBandIdx: number,
  yBandIdx: number,
  age: number,
): ScoreResult & { testId: TestId } {
  const preCond = matrixLookup(matrix, xBandIdx, yBandIdx);
  const ageFactor = getAgeNormFactor(age, preCond);
  const conditioned = ageFactor * preCond;
  const musculage = conditioned > 0 ? Math.round(age / conditioned) : age * 3;
  return { testId: '' as TestId, preCond, ageFactor, conditioned, musculage, xBandIdx, yBandIdx };
}

/** Compute score for any testId from raw game data */
export function computeScore(input: RawScoreInput, age: number): ScoreResult {
  const { testId } = input;
  const cm = input.customMetrics ?? {};

  // v3 routing: the 8 ROM/Mobility games covered by the v3 reverse-engineered
  // grid use the dedicated pipeline. Returns a ComputeScoreResult with the
  // same shape, so /api/score/compute, the DB write, and dashboard aggregation
  // remain unchanged. See src/server/scoring/v3.ts.
  if (isV3TestId(testId)) {
    return computeV3(testId, cm, age);
  }

  let xBandIdx: number;
  let yBandIdx: number;
  let matrix: number[][];

  switch (testId) {
    // --- REFLEX (NN) ---
    case 'NN1': {
      // X = catches_first20, Y = catches_last10
      const x = cm.catches_first20 ?? input.hits ?? 0;
      const y = cm.catches_last10 ?? 0;
      xBandIdx = bandStd30(x);
      yBandIdx = bandStd30(y);
      matrix = MATRIX_70_30;
      break;
    }
    case 'NN2': {
      // X = greenCatches, Y = blueCatches
      const x = cm.greenCatches ?? 0;
      const y = cm.blueCatches ?? 0;
      xBandIdx = bandStd30(x);
      yBandIdx = bandStd30(y);
      matrix = MATRIX_50_50;
      break;
    }
    case 'NN3': {
      // X = adj greenCatches, Y = adj blueCatches
      const x = cm.greenCatches ?? 0;
      const y = cm.blueCatches ?? 0;
      xBandIdx = bandStd30(x);
      yBandIdx = bandStd30(y);
      matrix = MATRIX_50_50;
      break;
    }
    case 'NN4': {
      // X = handTorches, Y = legTorches
      const x = cm.handTorches ?? 0;
      const y = cm.legTorches ?? 0;
      xBandIdx = bandNN4X(x);
      yBandIdx = bandNN4Y(y);
      matrix = MATRIX_50_50;
      break;
    }
    case 'NN5': {
      // X = rightHandTorches, Y = leftHandTorches
      const x = cm.rightHandTorches ?? 0;
      const y = cm.leftHandTorches ?? 0;
      xBandIdx = bandStd30(x);
      yBandIdx = bandStd30(y);
      matrix = MATRIX_50_50;
      break;
    }

    // --- BALANCE (BB) ---
    case 'BB1':
    case 'BB2':
    case 'BB3':
    case 'BB4': {
      // X = breachCount, Y = maxSwayDegrees
      const breaches = input.breachCount ?? 0;
      const sway = input.maxSwayDegrees ?? 0;
      xBandIdx = bandBreaches(breaches);
      yBandIdx = bandSway(sway);
      matrix = MATRIX_50_50;
      break;
    }

    // --- ROM (FA) — v2 angle-based scoring ---
    // FA1, FA3, FA4, FA5 → handled by v3 pipeline (early-return above).
    // Their case blocks are intentionally absent from this switch.
    case 'FA2': {
      // X = reach percentage average (peak left+right / 2), Y = Symmetry Index
      // RR4 Backstitch: PAA=60%, SI=40% → MATRIX_60_40
      const paaAvg = cm.paaAverage ?? 0;
      const si = cm.symmetryIndex ?? 0;
      xBandIdx = bandFA2_Reach(paaAvg);
      yBandIdx = bandFA2_SI(si);
      matrix = MATRIX_60_40;
      break;
    }
    // FA3, FA4, FA5 → handled by v3 pipeline (early-return above).
    case 'FA6': {
      // X = NGB (number of green button hits), Y = DAC (duration of activity completion)
      // Hand Swings: NGB=70%, DAC=30% → MATRIX_70_30
      const ngb = cm.greenHits ?? input.hits ?? 0;
      const dac = cm.elapsed ?? input.duration ?? 0;
      xBandIdx = bandFA6_NGB(ngb);
      yBandIdx = bandFA6_DAC(dac);
      matrix = MATRIX_70_30;
      break;
    }

    // --- MOBILITY (KS) ---
    case 'KS1': {
      // X = green hits, Y = completions (5s holds)
      const x = cm.greenHits ?? input.hits ?? 0;
      const y = cm.completions ?? 0;
      xBandIdx = bandKS1X(x);
      yBandIdx = bandKS1Y(y);
      matrix = MATRIX_70_30;
      break;
    }
    // KS2 → handled by v3 pipeline (early-return above).
    case 'KS3': {
      // V4 Spinal Wave: X = MQS (movement quality), Y = SSI (segmental sequencing)
      // Pre-conditioned = direct 50/50 matrix lookup
      const mqs = cm.mqs ?? 0;
      const ssi = cm.ssi ?? 0;
      xBandIdx = bandKS3_MQS(mqs);
      yBandIdx = bandKS3_SSI(ssi);
      matrix = MATRIX_50_50;
      break;
    }
    // KS4, KS5, KS6 → handled by v3 pipeline (early-return above).

    default:
      throw new Error(`Unknown testId: ${testId}`);
  }

  const preCond = matrixLookup(matrix, xBandIdx, yBandIdx);
  const ageFactor = getAgeNormFactor(age, preCond);
  const conditioned = ageFactor * preCond;
  const musculage = conditioned > 0 ? Math.round(age / conditioned) : age * 3;

  return { testId, preCond, ageFactor, conditioned, musculage, xBandIdx, yBandIdx };
}
