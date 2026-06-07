import { describe, it, expect } from 'vitest';
import { buildResultBody } from './raw-to-input';

describe('buildResultBody', () => {
  it('maps balance raw data (breach/sway/elapsed)', () => {
    const b = buildResultBody('BB1', { testId: 'BB1', breachCount: 2, maxSwayDeg: 8.5, elapsed: 30000 });
    expect(b.test_id).toBe('BB1');
    expect(b.breachCount).toBe(2);
    expect(b.maxSwayDegrees).toBe(8.5);
    expect(b.duration).toBe(30); // 30000ms → 30s
    expect(b.customMetrics).toMatchObject({ breachCount: 2, maxSwayDeg: 8.5, elapsed: 30000 });
  });

  it('sums catches for NN1 hits', () => {
    const b = buildResultBody('NN1', { catches_first20: 18, catches_last10: 7, elapsed: 30000 });
    expect(b.hits).toBe(25);
    expect(b.duration).toBe(30);
  });

  it('prefers greenHits, then completions, for hits', () => {
    expect(buildResultBody('FA1', { greenHits: 12, completions: 3 }).hits).toBe(12);
    expect(buildResultBody('KS1', { completions: 5 }).hits).toBe(5);
  });

  it('flattens nested customMetrics without overwriting top-level', () => {
    const b = buildResultBody('KS4', { mqsAvg: 70, customMetrics: { mqs: 65, tci: 80, mqsAvg: 999 } });
    expect(b.customMetrics.mqs).toBe(65);
    expect(b.customMetrics.tci).toBe(80);
    expect(b.customMetrics.mqsAvg).toBe(70); // top-level wins
  });

  it('ignores non-finite values', () => {
    const b = buildResultBody('BB1', { breachCount: NaN, maxSwayDeg: Infinity, elapsed: 10000 });
    expect(b.breachCount).toBeUndefined();
    expect(b.maxSwayDegrees).toBeUndefined();
    expect(b.customMetrics.breachCount).toBeUndefined();
    expect(b.duration).toBe(10);
  });

  it('handles empty raw data', () => {
    const b = buildResultBody('BB1', {});
    expect(b.test_id).toBe('BB1');
    expect(b.customMetrics).toEqual({});
    expect(b.hits).toBeUndefined();
  });
});
