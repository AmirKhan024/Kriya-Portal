import 'server-only';

/**
 * V3-audited Age Normalization. Identical for all activities.
 * Band boundaries: >=90%, >=75%, >=50%, >=25%, <25%
 * Age cohorts: 18-39, 40-49, 50-59, 60-69, 70+
 * Source: Balance Baron scoring doc (applies globally to all test categories)
 */

// Age Normalization Factor Matrix
// Rows = pre-conditioned score band index, Cols = age cohort index
export const AGE_NORM_MATRIX: number[][] = [
  /* 90-100% */ [1.00, 1.05, 1.10, 1.15, 1.20],
  /* 75-89%  */ [0.90, 1.00, 1.05, 1.10, 1.15],
  /* 50-74%  */ [0.85, 0.90, 1.00, 1.05, 1.10],
  /* 25-49%  */ [0.80, 0.85, 0.90, 1.00, 1.05],
  /* <25%    */ [0.75, 0.80, 0.85, 0.90, 1.00],
];

interface AgeCohort { min: number; max: number; }

const AGE_COHORTS: AgeCohort[] = [
  { min: 18, max: 39 },
  { min: 40, max: 49 },
  { min: 50, max: 59 },
  { min: 60, max: 69 },
  { min: 70, max: 150 },
];

/** Get age cohort index (0-4) */
export function getAgeCohortIdx(age: number): number {
  const idx = AGE_COHORTS.findIndex(c => age >= c.min && age <= c.max);
  if (idx !== -1) return idx;
  return age < 18 ? 0 : 4;
}

/** Get pre-conditioned score band index (0-4) */
export function getPreCondBandIdx(score: number): number {
  if (score >= 0.90) return 0;
  if (score >= 0.75) return 1;
  if (score >= 0.50) return 2;
  if (score >= 0.25) return 3;
  return 4;
}

/** Get age normalization factor */
export function getAgeNormFactor(age: number, preCondScore: number): number {
  return AGE_NORM_MATRIX[getPreCondBandIdx(preCondScore)][getAgeCohortIdx(age)];
}
