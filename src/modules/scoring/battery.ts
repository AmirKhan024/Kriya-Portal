import type { TestId, Category } from '@/types/test';

/**
 * Scan measurement batteries (feature 1c). These are the kriya-v3 MEASUREMENT tests
 * (TestIds) — distinct from the rehab `games` catalog used by pain-gating. The real
 * MediaPipe camera (next module) will run these; for now the scan page records an
 * interim result per game using sampleMetrics().
 */
export type BatteryGame = { test_id: TestId; name: string; category: Category; durationSeconds: number };

export const QUICK_BATTERY: BatteryGame[] = [
  { test_id: 'BB1', name: 'Standing Balance', category: 'balance', durationSeconds: 30 },
];

export const DEEP_BATTERY: BatteryGame[] = [
  { test_id: 'NN1', name: 'Ball Catch', category: 'reflex', durationSeconds: 30 },
  { test_id: 'BB1', name: 'Pillar Stand', category: 'balance', durationSeconds: 30 },
  { test_id: 'FA1', name: 'Shoulder Sunrise', category: 'rom', durationSeconds: 30 },
  { test_id: 'KS1', name: 'Leg Skylift', category: 'mobility', durationSeconds: 30 },
];

export function batteryFor(type: 'quick' | 'deep'): BatteryGame[] {
  return type === 'deep' ? DEEP_BATTERY : QUICK_BATTERY;
}

/**
 * Interim canned metrics per test (placeholder until the camera scan lands). Returns
 * a plausible /results body so computeScore yields a realistic (non-zero) score.
 */
export function sampleMetrics(testId: TestId): Record<string, unknown> {
  switch (testId) {
    case 'BB1': case 'BB2': case 'BB3': case 'BB4':
      return { test_id: testId, breachCount: 1, maxSwayDegrees: 6 };
    case 'NN1':
      return { test_id: testId, customMetrics: { catches_first20: 18, catches_last10: 7 } };
    case 'KS1':
      return { test_id: testId, customMetrics: { greenHits: 8, completions: 3 } };
    default:
      // v3 ROM/mobility tests (FA1/FA3/FA4/FA5/KS2/KS4/KS5/KS6) accept customMetrics.
      return { test_id: testId, customMetrics: {} };
  }
}
