/**
 * Shared scoring types — client-safe (no server-only imports).
 *
 * Client components must import from this file directly rather than
 * from @/server/scoring/compute to avoid bundling server-only modules.
 */
import type { TestId } from './test';

/** DB-facing score result (matches test_sessions table columns) */
export interface ScoreResult {
  testId: TestId;
  preConditionedScore: number;
  conditionedScore: number;
  musculage: number;
  ageNormFactor: number;
  xBandIdx: number;
  yBandIdx: number;
  scoreData: Record<string, unknown>;
}

/** Score breakdown for display */
export interface ScoreBreakdown {
  xBandLabel: string;
  yBandLabel: string;
  matrixType: '70_30' | '50_50';
  preConditioned: number;
  ageNormFactor: number;
  conditioned: number;
  musculage: number;
}

/** Compute pipeline result — returned by computeScore() */
export interface ComputeScoreResult {
  testId: TestId;
  preCond: number;
  ageFactor: number;
  conditioned: number;
  musculage: number;
  xBandIdx: number;
  yBandIdx: number;
}

/** Raw input to the scoring engine */
export interface RawScoreInput {
  testId: TestId;
  hits?: number;
  misses?: number;
  breachCount?: number;
  maxSwayDegrees?: number;
  duration?: number;
  customMetrics?: Record<string, number>;
}

/** Score band labels derived from conditioned score (0–100 scale) */
export type ScoreBand = 'poor' | 'fair' | 'good' | 'excellent';
