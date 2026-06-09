import 'server-only';

/**
 * V2-audited scoring matrices. HARDCODED - NO FORMULAS.
 * Zero tolerance for deviation from V2 spec.
 */

// Pre-Conditioned Score Matrix: 70/30 weighted
// Used by: NN1, KS1
// Rows = Y-axis band index (0=100%..4=60%), Cols = X-axis band index
// Cell = (X_band_pct × 0.7) + (Y_band_pct × 0.3) as decimal
export const MATRIX_70_30: number[][] = [
  /* Y0=100% -> */ [1.000, 0.930, 0.860, 0.790, 0.720],
  /* Y1=90%  -> */ [0.970, 0.900, 0.830, 0.760, 0.690],
  /* Y2=80%  -> */ [0.940, 0.870, 0.800, 0.730, 0.660],
  /* Y3=70%  -> */ [0.910, 0.840, 0.770, 0.700, 0.630],
  /* Y4=60%  -> */ [0.880, 0.810, 0.740, 0.670, 0.600],
];

// Pre-Conditioned Score Matrix: 60/40 weighted
// Used by: KS2, KS4, KS5, FA1, FA2, FA4, FA5
// Rows = Y-axis band index (0=100%..4=60%), Cols = X-axis band index
// Cell = (X_band_pct × 0.6) + (Y_band_pct × 0.4) as decimal
export const MATRIX_60_40: number[][] = [
  /* Y0=100% -> */ [1.000, 0.940, 0.880, 0.820, 0.760],
  /* Y1=90%  -> */ [0.960, 0.900, 0.840, 0.780, 0.720],
  /* Y2=80%  -> */ [0.920, 0.860, 0.800, 0.740, 0.680],
  /* Y3=70%  -> */ [0.880, 0.820, 0.760, 0.700, 0.640],
  /* Y4=60%  -> */ [0.840, 0.780, 0.720, 0.660, 0.600],
];

// Pre-Conditioned Score Matrix: 55/45 weighted
// Used by: KS6 (Cossack Squat) — MQS×0.55 + TCI×0.45
// Rows = Y-axis band index (0=100%..4=60%), Cols = X-axis band index
// Cell = (X_band_pct × 0.55) + (Y_band_pct × 0.45) as decimal
export const MATRIX_55_45: number[][] = [
  /* Y0=100% -> */ [1.000, 0.945, 0.890, 0.835, 0.780],
  /* Y1=90%  -> */ [0.955, 0.900, 0.845, 0.790, 0.735],
  /* Y2=80%  -> */ [0.910, 0.855, 0.800, 0.745, 0.690],
  /* Y3=70%  -> */ [0.865, 0.810, 0.755, 0.700, 0.645],
  /* Y4=60%  -> */ [0.820, 0.765, 0.710, 0.655, 0.600],
];

// Pre-Conditioned Score Matrix: 50/50 weighted
// Used by: NN2, NN3, NN4, NN5, KS3, FA3, BB1-4
export const MATRIX_50_50: number[][] = [
  /* Y0=100% -> */ [1.000, 0.950, 0.900, 0.850, 0.800],
  /* Y1=90%  -> */ [0.950, 0.900, 0.850, 0.800, 0.750],
  /* Y2=80%  -> */ [0.900, 0.850, 0.800, 0.750, 0.700],
  /* Y3=70%  -> */ [0.850, 0.800, 0.750, 0.700, 0.650],
  /* Y4=60%  -> */ [0.800, 0.750, 0.700, 0.650, 0.600],
];
