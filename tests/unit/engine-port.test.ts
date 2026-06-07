import { describe, it, expect } from 'vitest';
import { computeScore } from '@/server/scoring';

/**
 * Guards the ported score engine (copied verbatim from kriya-v3). We assert
 * deterministic, structurally-sound, monotonic behaviour rather than hard-coding
 * matrix internals — so the port is verified without coupling to private constants.
 */
describe('ported score engine · computeScore', () => {
  it('is deterministic (same input → same output)', () => {
    const input = { testId: 'BB1' as const, breachCount: 2, maxSwayDegrees: 8 };
    expect(computeScore(input, 40)).toEqual(computeScore(input, 40));
  });

  it('produces sound ranges (conditioned ≥ 0, musculage a positive integer)', () => {
    const s = computeScore({ testId: 'BB1', breachCount: 1, maxSwayDegrees: 4 }, 35);
    expect(s.conditioned).toBeGreaterThanOrEqual(0);
    expect(s.conditioned).toBeLessThanOrEqual(1.2);
    expect(Number.isInteger(s.musculage)).toBe(true);
    expect(s.musculage).toBeGreaterThan(0);
  });

  it('is monotonic: a better balance performance scores ≥ a worse one', () => {
    const good = computeScore({ testId: 'BB1', breachCount: 0, maxSwayDegrees: 0 }, 40);
    const bad = computeScore({ testId: 'BB1', breachCount: 9, maxSwayDegrees: 30 }, 40);
    expect(good.conditioned).toBeGreaterThanOrEqual(bad.conditioned);
  });

  it('is monotonic for reflex (more catches scores ≥ fewer)', () => {
    const good = computeScore({ testId: 'NN1', customMetrics: { catches_first20: 25, catches_last10: 10 } }, 30);
    const bad = computeScore({ testId: 'NN1', customMetrics: { catches_first20: 2, catches_last10: 0 } }, 30);
    expect(good.conditioned).toBeGreaterThanOrEqual(bad.conditioned);
  });

  it('routes a v3 ROM test (FA1) through the v3 pipeline without throwing', () => {
    const s = computeScore({ testId: 'FA1', customMetrics: {} }, 40);
    expect(s.testId).toBe('FA1');
    expect(typeof s.musculage).toBe('number');
  });
});
