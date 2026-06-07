import { describe, it, expect } from 'vitest';
import { aggregate, normalizedFromConditioned, type GameResult } from './aggregate';

describe('normalizedFromConditioned', () => {
  it('scales conditioned 0–1 to 0–100 and rounds', () => {
    expect(normalizedFromConditioned(0)).toBe(0);
    expect(normalizedFromConditioned(0.5)).toBe(50);
    expect(normalizedFromConditioned(0.834)).toBe(83);
  });
  it('clamps out-of-range conditioned (age-adjusted can exceed 1.0)', () => {
    expect(normalizedFromConditioned(1.2)).toBe(100);
    expect(normalizedFromConditioned(-0.3)).toBe(0);
  });
});

describe('aggregate', () => {
  const r = (category: GameResult['category'], score: number, musculage: number): GameResult => ({ category, score, musculage });

  it('returns empty shape for no results', () => {
    expect(aggregate([])).toEqual({ categories: {}, musculage: null, count: 0 });
  });

  it('means scores per category and means per-game musculage', () => {
    const out = aggregate([
      r('balance', 80, 30),
      r('balance', 60, 40),
      r('reflex', 90, 20),
    ]);
    expect(out.categories.balance).toBe(70); // (80+60)/2
    expect(out.categories.reflex).toBe(90);
    expect(out.categories.rom).toBeUndefined();
    expect(out.musculage).toBe(30); // (30+40+20)/3 = 30
    expect(out.count).toBe(3);
  });

  it('rounds category and musculage means', () => {
    const out = aggregate([r('rom', 70, 33), r('rom', 75, 34)]);
    expect(out.categories.rom).toBe(73); // 72.5 → 73
    expect(out.musculage).toBe(34);      // 33.5 → 34
  });
});
