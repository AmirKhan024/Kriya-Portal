/**
 * Analytics time-range helpers (feature 2f-A). Pure + unit-tested.
 *
 * Kept deterministic: every cutoff is computed from a `now: Date` passed in by the
 * caller — helpers NEVER read the clock themselves, so tests are stable.
 */
export type AnalyticsRange = '30d' | '90d' | '12m' | 'all';

export const DEFAULT_RANGE: AnalyticsRange = '30d';
/** "Active" = had at least one activity session in this trailing window. */
export const ACTIVE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Coerce a raw query value to a known range, defaulting to 30d. */
export function normalizeRange(raw: string | null | undefined): AnalyticsRange {
  if (raw === '30d' || raw === '90d' || raw === '12m' || raw === 'all') return raw;
  return DEFAULT_RANGE;
}

/** Start of the range relative to `now`, or null for 'all' (no lower bound). */
export function rangeToCutoff(range: AnalyticsRange, now: Date): Date | null {
  switch (range) {
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS);
    case '90d':
      return new Date(now.getTime() - 90 * DAY_MS);
    case '12m': {
      const d = new Date(now.getTime());
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return d;
    }
    case 'all':
    default:
      return null;
  }
}

/** Trailing-window cutoff (e.g. active-in-30d, adherence-in-14d). */
export function windowCutoff(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
