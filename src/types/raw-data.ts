// [NEW] Kriya Gap Bridge v5 - Per-game raw data types (discriminated union on testId)

// === BALANCE BARON ===
export interface BalanceRawData {
  testId: 'BB1' | 'BB2' | 'BB3' | 'BB4';
  breachCount: number;
  maxSwayDeg: number;
  swayHistory: number[];
  elapsed: number;
  leg1Breaches?: number;
  leg2Breaches?: number;
  leg1MaxSway?: number;
  leg2MaxSway?: number;
}

// === NEURAL NINJA ===
export interface NN1RawData {
  testId: 'NN1';
  catches_first20: number;
  catches_last10: number;
  elapsed: number;
}

export interface NN2RawData {
  testId: 'NN2';
  greenCatches: number;
  blueCatches: number;
  elapsed: number;
}

export interface NN3RawData {
  testId: 'NN3';
  greenCatches: number;
  blueCatches: number;
  greyPenalties: number;
  elapsed: number;
}

export interface NN4RawData {
  testId: 'NN4';
  handTorches: number;
  legTorches: number;
  elapsed: number;
}

export interface NN5RawData {
  testId: 'NN5';
  rightHandTorches: number;
  leftHandTorches: number;
  elapsed: number;
}

// === FLOWFIELD ARC ===
export interface FA1RawData {
  testId: 'FA1';
  greenHits: number;
  elapsed: number;
}

export interface FA2RawData {
  testId: 'FA2';
  activity1Hits: number;
  activity2Hits: number;
  elapsed: number;
}

export interface FA3RawData {
  testId: 'FA3';
  greenHits: number;
  elapsed: number;
}

export interface FA4RawData {
  testId: 'FA4';
  greenHits: number;
  elapsed: number;
}

export interface FA5RawData {
  testId: 'FA5';
  greenHits: number;
  elapsed: number;
}

export interface FA6RawData {
  testId: 'FA6';
  greenHits: number;
  phase1Hits: number;
  phase2Hits: number;
  elapsed: number;
}

// === KINETIC SCULPTOR ===
export interface KS1RawData {
  testId: 'KS1';
  greenHits: number;
  completions: number;
  elapsed: number;
}

export interface KS2RawData {
  testId: 'KS2';
  completions: number;
  maxKneeBend: number;
  elapsed: number;
}

export interface KS3RawData {
  testId: 'KS3';
  combo1: number;
  combo2: number;
  elapsed: number;
}

export interface KS4RawData {
  testId: 'KS4';
  mqsL: number;
  mqsR: number;
  mqsAvg: number;
  tci: number;
  repsL: number;
  repsR: number;
  elapsed: number;
}

export interface KS5RawData {
  testId: 'KS5';
  mqs: number;
  dci: number;
  reps: number;
  maxFlexion: number;
  elapsed: number;
}

export interface KS6RawData {
  testId: 'KS6';
  mqsL: number;
  mqsR: number;
  mqsAvg: number;
  tci: number;
  repsL: number;
  repsR: number;
  elapsed: number;
}

// === UNION TYPE ===
export type RawGameData =
  | BalanceRawData
  | NN1RawData | NN2RawData | NN3RawData | NN4RawData | NN5RawData
  | FA1RawData | FA2RawData | FA3RawData | FA4RawData | FA5RawData | FA6RawData
  | KS1RawData | KS2RawData | KS3RawData | KS4RawData | KS5RawData | KS6RawData;

// === PENDING RAW DATA (stored in auth store for guest flow) ===
export interface PendingRawData {
  testId: string;
  rawData: RawGameData;
  timestamp: number;
}

// === PENDING SESSION DATA (extended pending data with session context for claim flow) ===
export interface PendingSessionContext {
  sessionId: string;
  testId: string;
  category: string;
  gameId: string;
  rawData: Record<string, unknown>;
  rawScoreInput: {
    testId: string;
    hits?: number;
    misses?: number;
    breachCount?: number;
    maxSwayDegrees?: number;
    duration?: number;
    customMetrics?: Record<string, number>;
  };
  durationSec: number;
  ageAtSession: number;
  genderAtSession: 'male' | 'female' | 'other';
  playedAt: string;
  score: {
    testId: string;
    preCond: number;
    conditioned: number;
    musculage: number;
    ageFactor: number;
    xBandIdx: number;
    yBandIdx: number;
  };
  kriya360Id?: string;
}

// === PENDING DIAGNOSTIC DATA (stored for guest pain flow) ===
export interface PendingDiagnosticData {
  region: string;
  severity_bucket: string;
  severity_score: number;
  red_flag_detected: boolean;
  top_3: string[];
  confidence: string;
  action: string;
  form_data: Record<string, unknown>;
  timestamp: number;
}

// === HELPERS ===
export function getTestCategory(testId: string): 'reflex' | 'balance' | 'rom' | 'mobility' {
  if (testId.startsWith('NN')) return 'reflex';
  if (testId.startsWith('BB')) return 'balance';
  if (testId.startsWith('FA')) return 'rom';
  if (testId.startsWith('KS')) return 'mobility';
  throw new Error(`Unknown testId: ${testId}`);
}

export function getTestMaxValues(testId: string): { maxHits: number; maxDuration: number } {
  const defaults = { maxHits: 60, maxDuration: 300 };
  const map: Record<string, { maxHits: number; maxDuration: number }> = {
    NN1: { maxHits: 60, maxDuration: 35 },
    NN2: { maxHits: 50, maxDuration: 35 },
    NN3: { maxHits: 50, maxDuration: 35 },
    NN4: { maxHits: 32, maxDuration: 35 },
    NN5: { maxHits: 60, maxDuration: 35 },
    BB1: { maxHits: 100, maxDuration: 35 },
    BB2: { maxHits: 100, maxDuration: 35 },
    BB3: { maxHits: 100, maxDuration: 35 },
    BB4: { maxHits: 100, maxDuration: 35 },
    FA1: { maxHits: 40, maxDuration: 60 },
    FA2: { maxHits: 40, maxDuration: 60 },
    FA3: { maxHits: 20, maxDuration: 60 },
    FA4: { maxHits: 21, maxDuration: 60 },
    FA5: { maxHits: 20, maxDuration: 60 },
    FA6: { maxHits: 40, maxDuration: 60 },
    KS1: { maxHits: 10, maxDuration: 120 },
    KS2: { maxHits: 10, maxDuration: 120 },
    KS3: { maxHits: 10, maxDuration: 120 },
    KS4: { maxHits: 20, maxDuration: 60 },
    KS5: { maxHits: 20, maxDuration: 60 },
    KS6: { maxHits: 20, maxDuration: 60 },
  };
  return map[testId] ?? defaults;
}
