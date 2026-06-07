import type { Verdict } from './engine';

/**
 * Pure verdict → chip styling (Dev A). Color code per brief §8 1c:
 * green Eligible · teal Modified · amber Capped · red Blocked. Kept pure (no JSX)
 * so it's unit-testable and shared by the badge + list components.
 */
export const VERDICT_STYLE: Record<Verdict, { label: string; cls: string }> = {
  eligible: { label: 'Eligible', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  modified: { label: 'Modified', cls: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
  capped:   { label: 'Capped',   cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  blocked:  { label: 'Blocked',  cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

export function verdictStyle(v: Verdict): { label: string; cls: string } {
  return VERDICT_STYLE[v];
}
