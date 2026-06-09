import type { Category } from '@/types/test';

/** Pure score → bar color (0–100). Aligned with the engine's band thresholds. */
export function scoreBarColor(score: number): string {
  if (score >= 81) return 'bg-green-400';
  if (score >= 61) return 'bg-teal-400';
  if (score >= 41) return 'bg-amber-400';
  return 'bg-red-400';
}

export const CATEGORY_LABELS: Record<Category, string> = {
  reflex: 'Reflex',
  balance: 'Balance',
  rom: 'ROM',
  mobility: 'Mobility',
};

/** "4 yrs younger" / "3 yrs older" / "on par" vs chronological age (null when unknown). */
export function musculageDelta(musculage: number | null, age?: number): string | null {
  if (musculage == null || age == null) return null;
  const d = musculage - age;
  if (d === 0) return 'on par with your age';
  return d < 0 ? `${Math.abs(d)} yr${Math.abs(d) === 1 ? '' : 's'} younger than your age` : `${d} yr${d === 1 ? '' : 's'} older than your age`;
}
