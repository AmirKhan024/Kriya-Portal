import { describe, it, expect } from 'vitest';
import { scoreBarColor, musculageDelta, CATEGORY_LABELS } from './score-display';

describe('scoreBarColor', () => {
  it('maps score bands to colors', () => {
    expect(scoreBarColor(95)).toBe('bg-green-400');
    expect(scoreBarColor(81)).toBe('bg-green-400');
    expect(scoreBarColor(70)).toBe('bg-teal-400');
    expect(scoreBarColor(61)).toBe('bg-teal-400');
    expect(scoreBarColor(50)).toBe('bg-amber-400');
    expect(scoreBarColor(41)).toBe('bg-amber-400');
    expect(scoreBarColor(30)).toBe('bg-red-400');
    expect(scoreBarColor(0)).toBe('bg-red-400');
  });
});

describe('musculageDelta', () => {
  it('returns null when musculage or age is missing', () => {
    expect(musculageDelta(null, 40)).toBeNull();
    expect(musculageDelta(35, undefined)).toBeNull();
  });
  it('describes younger / older / on-par', () => {
    expect(musculageDelta(36, 40)).toBe('4 yrs younger than your age');
    expect(musculageDelta(43, 40)).toBe('3 yrs older than your age');
    expect(musculageDelta(40, 40)).toBe('on par with your age');
    expect(musculageDelta(39, 40)).toBe('1 yr younger than your age');
  });
});

describe('CATEGORY_LABELS', () => {
  it('labels all four categories', () => {
    expect(CATEGORY_LABELS).toEqual({ reflex: 'Reflex', balance: 'Balance', rom: 'ROM', mobility: 'Mobility' });
  });
});
