import type { Category } from '@/types/test';
import { CATEGORIES } from './categories';

/**
 * Pure assessment aggregation (Dev A, feature 1c-b) — fully unit-testable.
 *
 * Each completed game contributes a normalized 0–100 score (its category) and a
 * per-test musculage (from the score engine). The assessment's category scores are
 * the mean per category; the composite Musculage is the mean of per-game musculage.
 */

export type GameResult = {
  category: Category;
  score: number;     // normalized 0–100
  musculage: number; // per-test musculage from the engine
};

export type AssessmentAggregate = {
  /** Mean normalized score per category that has at least one result (0–100, rounded). */
  categories: Partial<Record<Category, number>>;
  /** Composite Musculage = mean of per-game musculage (rounded), or null when empty. */
  musculage: number | null;
  count: number;
};

/** Convert the engine's conditioned score (0.0–1.2) into a 0–100 normalized score. */
export function normalizedFromConditioned(conditioned: number): number {
  return Math.round(Math.min(Math.max(conditioned, 0), 1) * 100);
}

function mean(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function aggregate(results: GameResult[]): AssessmentAggregate {
  const categories: Partial<Record<Category, number>> = {};
  for (const cat of CATEGORIES) {
    const scores = results.filter((r) => r.category === cat).map((r) => r.score);
    if (scores.length > 0) categories[cat] = Math.round(mean(scores));
  }
  const musculage = results.length > 0 ? Math.round(mean(results.map((r) => r.musculage))) : null;
  return { categories, musculage, count: results.length };
}
