import 'server-only';

export { MATRIX_70_30, MATRIX_60_40, MATRIX_55_45, MATRIX_50_50 } from './matrices';
export {
  bandStd30, bandNN4X, bandNN4Y,
  bandBreaches, bandSway,
  bandFA1_PAA, bandFA1_SI,
  bandFA2_Reach, bandFA2_SI,
  bandFA3_PAA, bandFA3_SI,
  bandFA4_PAA, bandFA4_QI,
  bandFA5_CRS, bandFA5_SI,
  bandKS1X, bandKS1Y, bandKS2_MQS, bandKS2_TCI, bandKS3_MQS, bandKS3_SSI,
  bandKS4_MQS, bandKS4_TCI, bandKS5_MQS, bandKS5_DCI, bandKS6_MQS, bandKS6_TCI,
  bandPct,
} from './bands';
export { AGE_NORM_MATRIX, getAgeCohortIdx, getPreCondBandIdx, getAgeNormFactor } from './age-norm';
export { computeScore, computeFullScore, matrixLookup, normalizeScore, calculateMusculage, validateScore, getScoreBand } from './compute';
export type { ScoreResult, RawScoreInput, ScoreBand } from './compute';
export { isValidTestId, validateAge, validateRawInput, checkPlausibility } from './validators';
export type { ValidationResult, PlausibilityResult } from './validators';
