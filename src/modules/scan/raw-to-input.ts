import type { TestId } from '@/types/test';

/**
 * Map a game engine's getRawData() output to the /v1/assessments/:id/results body
 * (feature 1c-UI-b). Ported from kriya-v3's GameShell buildRawScoreInput, adapted to
 * the portal's `test_id` field. Pure + unit-tested.
 */
export type ResultBody = {
  test_id: TestId;
  hits?: number;
  misses?: number;
  breachCount?: number;
  maxSwayDegrees?: number;
  duration?: number;
  customMetrics: Record<string, number>;
};

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function buildResultBody(testId: TestId, rawData: Record<string, unknown>): ResultBody {
  const raw = rawData ?? {};

  // customMetrics = all finite top-level numbers + flattened nested customMetrics.
  const customMetrics: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v)) customMetrics[k] = v;
  }
  const nested = raw.customMetrics;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && customMetrics[k] === undefined) {
        customMetrics[k] = v;
      }
    }
  }

  // hits: greenHits, else catches_first20 + catches_last10, else completions.
  let hits = num(raw.greenHits);
  if (hits === undefined && num(raw.catches_first20) !== undefined) {
    hits = (raw.catches_first20 as number) + (num(raw.catches_last10) ?? 0);
  }
  if (hits === undefined) hits = num(raw.completions);

  const elapsed = num(raw.elapsed);
  const duration = elapsed !== undefined ? elapsed / 1000 : undefined;

  return {
    test_id: testId,
    hits,
    misses: num(raw.misses),
    breachCount: num(raw.breachCount),
    maxSwayDegrees: num(raw.maxSwayDeg),
    duration,
    customMetrics,
  };
}
