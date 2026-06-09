import { describe, it, expect } from 'vitest';
import { normalizeRange, rangeToCutoff, windowCutoff } from './range';

const NOW = new Date('2026-06-07T00:00:00.000Z');

describe('normalizeRange', () => {
  it('accepts known tokens', () => {
    for (const r of ['30d', '90d', '12m', 'all'] as const) expect(normalizeRange(r)).toBe(r);
  });
  it('defaults unknown/empty to 30d', () => {
    expect(normalizeRange(null)).toBe('30d');
    expect(normalizeRange(undefined)).toBe('30d');
    expect(normalizeRange('garbage')).toBe('30d');
  });
});

describe('rangeToCutoff', () => {
  it('30d → 30 days before now', () => {
    expect(rangeToCutoff('30d', NOW)).toEqual(new Date('2026-05-08T00:00:00.000Z'));
  });
  it('90d → 90 days before now', () => {
    expect(rangeToCutoff('90d', NOW)).toEqual(new Date('2026-03-09T00:00:00.000Z'));
  });
  it('12m → one year before now', () => {
    expect(rangeToCutoff('12m', NOW)).toEqual(new Date('2025-06-07T00:00:00.000Z'));
  });
  it('all → null (no lower bound)', () => {
    expect(rangeToCutoff('all', NOW)).toBeNull();
  });
});

describe('windowCutoff', () => {
  it('subtracts the given days', () => {
    expect(windowCutoff(14, NOW)).toEqual(new Date('2026-05-24T00:00:00.000Z'));
  });
});
