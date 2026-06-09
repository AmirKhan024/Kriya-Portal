import 'server-only';

/**
 * V2-audited band functions. Each returns a band INDEX (0-4).
 * 0 = best (100%), 4 = worst (60%).
 * Band percentages: [100, 90, 80, 70, 60]
 */

// NN1-3, NN5: Standard 30-ball bands (both axes)
// V2 spec: 25-30=100%, 18-24=90%, 12-17=80%, 6-11=70%, 0-5=60%
export function bandStd30(val: number): number {
  if (val >= 25) return 0;
  if (val >= 18) return 1;
  if (val >= 12) return 2;
  if (val >= 6) return 3;
  return 4;
}

// NN4 X-axis (hands): 15-16=100%, 11-14=90%, 8-10=80%, 4-7=70%, 0-3=60%
export function bandNN4X(val: number): number {
  if (val >= 15) return 0;
  if (val >= 11) return 1;
  if (val >= 8) return 2;
  if (val >= 4) return 3;
  return 4;
}

// NN4 Y-axis (legs): 15-16=100%, 12-14=90%, 8-11=80%, 4-7=70%, 0-3=60%
export function bandNN4Y(val: number): number {
  if (val >= 15) return 0;
  if (val >= 12) return 1;
  if (val >= 8) return 2;
  if (val >= 4) return 3;
  return 4;
}

// BB1-4 X-axis: breaches (inverted: fewer = better)
// V2 spec: 0=100%, 1-2=90%, 3-5=80%, 6-8=70%, 9+=60%
export function bandBreaches(breaches: number): number {
  if (breaches === 0) return 0;
  if (breaches <= 2) return 1;
  if (breaches <= 5) return 2;
  if (breaches <= 8) return 3;
  return 4;
}

// BB1-4 Y-axis: max sway degrees (inverted: less sway = better)
// V2 spec: 0-5°=100%, 5-10°=90%, 10-15°=80%, 15-20°=70%, 20+°=60%
export function bandSway(maxSwayDeg: number): number {
  if (maxSwayDeg <= 5) return 0;
  if (maxSwayDeg <= 10) return 1;
  if (maxSwayDeg <= 15) return 2;
  if (maxSwayDeg <= 20) return 3;
  return 4;
}

// ─── ROM v2: Angle-based bands (PAA + SI scoring from HTML prototypes) ───

// FA1 X-axis: PAA Score (Peak Angle Achieved average, higher = better)
// 150+°=100%, 130-149°=75%, 110-129°=50%, 90-109°=25%, <90°=0%
// Band index maps: 100%→0, 75%→1, 50%→2, 25%→3, 0%→4
export function bandFA1_PAA(paaAverage: number): number {
  if (paaAverage >= 150) return 0;
  if (paaAverage >= 130) return 1;
  if (paaAverage >= 110) return 2;
  if (paaAverage >= 90) return 3;
  return 4;
}

// FA1 Y-axis: SI Score (Symmetry Index, lower = better)
// ≤5%→100%, ≤10%→75%, ≤20%→50%, ≤30%→25%, >30%→0%
export function bandFA1_SI(si: number): number {
  if (si <= 5) return 0;
  if (si <= 10) return 1;
  if (si <= 20) return 2;
  if (si <= 30) return 3;
  return 4;
}

// FA2 X-axis: Reach percentage average — RR4 Backstitch spinal reach %
// Doc: 75-100%=100%, 50-74%=90%, 25-49%=80%, 10-24%=70%, <10%=60%
export function bandFA2_Reach(reachPct: number): number {
  if (reachPct >= 75) return 0;
  if (reachPct >= 50) return 1;
  if (reachPct >= 25) return 2;
  if (reachPct >= 10) return 3;
  return 4;
}

// FA2 Y-axis: Symmetry Index (same as FA1)
export const bandFA2_SI = bandFA1_SI;

// FA3 X-axis: PAA (cervical rotation angle average) — RR2 Neck Compass
// Doc: 75°+=100%, 60-74°=90%, 45-59°=80%, 30-44°=70%, <30°=60%
export function bandFA3_PAA(paaAverage: number): number {
  if (paaAverage >= 75) return 0;
  if (paaAverage >= 60) return 1;
  if (paaAverage >= 45) return 2;
  if (paaAverage >= 30) return 3;
  return 4;
}

// FA3 Y-axis: Symmetry Index (same as FA1)
export const bandFA3_SI = bandFA1_SI;

// FA4 X-axis: Peak trunk flexion angle — RR3 Hip Hinge Arc
// Doc: 80°+=100%, 65-79°=90%, 50-64°=80%, 35-49°=70%, <35°=60%
export function bandFA4_PAA(peakAngle: number): number {
  if (peakAngle >= 80) return 0;
  if (peakAngle >= 65) return 1;
  if (peakAngle >= 50) return 2;
  if (peakAngle >= 35) return 3;
  return 4;
}

// FA4 Y-axis: Quality Index (0-1, higher = better) — RR3 Hip Hinge Arc
// Doc: 90-100%=100%, 75-89%=90%, 50-74%=80%, 25-49%=70%, <25%=60%
export function bandFA4_QI(qualityIndex: number): number {
  if (qualityIndex >= 0.90) return 0;
  if (qualityIndex >= 0.75) return 1;
  if (qualityIndex >= 0.50) return 2;
  if (qualityIndex >= 0.25) return 3;
  return 4;
}

// FA5 X-axis: CRS average (combined rotation score, 0-100%) — RR5 Windmill Reach
// Doc: 85-100%=100%, 70-84%=90%, 50-69%=80%, 30-49%=70%, <30%=60%
export function bandFA5_CRS(crsAverage: number): number {
  if (crsAverage >= 85) return 0;
  if (crsAverage >= 70) return 1;
  if (crsAverage >= 50) return 2;
  if (crsAverage >= 30) return 3;
  return 4;
}

// FA5 Y-axis: Symmetry Index (same as FA1)
export const bandFA5_SI = bandFA1_SI;

// FA6 X-axis: NGB (Number of Green Button hits, max 40, higher = better)
// Doc: 38-40=100%, 34-37=90%, 28-33=80%, 20-27=70%, <20=60%
export function bandFA6_NGB(ngb: number): number {
  if (ngb >= 38) return 0;
  if (ngb >= 34) return 1;
  if (ngb >= 28) return 2;
  if (ngb >= 20) return 3;
  return 4;
}

// FA6 Y-axis: DAC (Duration of Activity Completion in seconds, higher = better — more time = more effort)
// Doc: 0-10s=100%, 11-20s=90%, 21-30s=80%, 31-45s=70%, >45s=60%
// NOTE: The doc scoring grid inverts this — shorter duration = better score.
// But the band percentages map: 0-10s→100%, meaning fastest = best.
// Re-reading the doc: Y1=0-10s=100% means fastest completion = 100%. Lower duration = better.
// However, DAC measures total time so lower time = faster = better.
export function bandFA6_DAC(dac: number): number {
  if (dac <= 10) return 0;
  if (dac <= 20) return 1;
  if (dac <= 30) return 2;
  if (dac <= 45) return 3;
  return 4;
}

// KS1 X-axis: green hits (max 10) - 10=100%, 9=90%, 8=80%, 6-7=70%, <=5=60%
export function bandKS1X(val: number): number {
  if (val >= 10) return 0;
  if (val >= 9) return 1;
  if (val >= 8) return 2;
  if (val >= 6) return 3;
  return 4;
}

// KS1 Y-axis: completions (max 10) - 10=100%, 8-9=90%, 6-7=80%, 4-5=70%, <=3=60%
export function bandKS1Y(val: number): number {
  if (val >= 10) return 0;
  if (val >= 8) return 1;
  if (val >= 6) return 2;
  if (val >= 4) return 3;
  return 4;
}

// KS2 X-axis: MQS average (0-100%, higher = better)
// V4 spec: 85-100=100%, 70-84=90%, 50-69=80%, 30-49=70%, <30=60%
export function bandKS2_MQS(mqs: number): number {
  if (mqs >= 85) return 0;
  if (mqs >= 70) return 1;
  if (mqs >= 50) return 2;
  if (mqs >= 30) return 3;
  return 4;
}

// KS2 Y-axis: TCI — Temporal Consistency Index (0-100%, higher = better)
// V4 spec: 90-100=100%, 75-89=90%, 50-74=80%, 25-49=70%, <25=60%
export function bandKS2_TCI(tci: number): number {
  if (tci >= 90) return 0;
  if (tci >= 75) return 1;
  if (tci >= 50) return 2;
  if (tci >= 25) return 3;
  return 4;
}

// KS3 X-axis: MQS (0-100%, higher = better) — same bands as KS2
// V4 spec: 85-100=100%, 70-84=90%, 50-69=80%, 30-49=70%, <30=60%
export function bandKS3_MQS(mqs: number): number {
  if (mqs >= 85) return 0;
  if (mqs >= 70) return 1;
  if (mqs >= 50) return 2;
  if (mqs >= 30) return 3;
  return 4;
}

// KS3 Y-axis: SSI — Segmental Sequencing Index (0-100%, higher = better)
// V4 spec: 90-100=100%, 70-89=90%, 50-69=80%, 30-49=70%, <30=60%
export function bandKS3_SSI(ssi: number): number {
  if (ssi >= 90) return 0;
  if (ssi >= 70) return 1;
  if (ssi >= 50) return 2;
  if (ssi >= 30) return 3;
  return 4;
}

// KS4 X-axis: MQS (0-100%, higher = better) — same thresholds as KS2/KS3
// V4 spec: 85-100=100%, 70-84=90%, 50-69=80%, 30-49=70%, <30=60%
export function bandKS4_MQS(mqs: number): number {
  if (mqs >= 85) return 0;
  if (mqs >= 70) return 1;
  if (mqs >= 50) return 2;
  if (mqs >= 30) return 3;
  return 4;
}

// KS4 Y-axis: TCI — Temporal Consistency Index (0-100%, higher = better)
// V4 spec: 90-100=100%, 75-89=90%, 50-74=80%, 25-49=70%, <25=60%
export function bandKS4_TCI(tci: number): number {
  if (tci >= 90) return 0;
  if (tci >= 75) return 1;
  if (tci >= 50) return 2;
  if (tci >= 25) return 3;
  return 4;
}

// KS5 X-axis: MQS (0-100%, higher = better) — same thresholds
// V4 spec: 85-100=100%, 70-84=90%, 50-69=80%, 30-49=70%, <30=60%
export function bandKS5_MQS(mqs: number): number {
  if (mqs >= 85) return 0;
  if (mqs >= 70) return 1;
  if (mqs >= 50) return 2;
  if (mqs >= 30) return 3;
  return 4;
}

// KS5 Y-axis: DCI — Depth Consistency Index (0-100%, higher = better)
// V4 spec: 90-100=100%, 75-89=90%, 50-74=80%, 25-49=70%, <25=60%
export function bandKS5_DCI(dci: number): number {
  if (dci >= 90) return 0;
  if (dci >= 75) return 1;
  if (dci >= 50) return 2;
  if (dci >= 25) return 3;
  return 4;
}

// KS6 X-axis: MQS (0-100%, higher = better) — same thresholds
// V4 spec: 85-100=100%, 70-84=90%, 50-69=80%, 30-49=70%, <30=60%
export function bandKS6_MQS(mqs: number): number {
  if (mqs >= 85) return 0;
  if (mqs >= 70) return 1;
  if (mqs >= 50) return 2;
  if (mqs >= 30) return 3;
  return 4;
}

// KS6 Y-axis: TCI — Temporal Consistency Index (0-100%, higher = better)
// V4 spec: 90-100=100%, 75-89=90%, 50-74=80%, 25-49=70%, <25=60%
export function bandKS6_TCI(tci: number): number {
  if (tci >= 90) return 0;
  if (tci >= 75) return 1;
  if (tci >= 50) return 2;
  if (tci >= 25) return 3;
  return 4;
}

/** Band index to percentage */
export function bandPct(idx: number): number {
  return [100, 90, 80, 70, 60][idx];
}
