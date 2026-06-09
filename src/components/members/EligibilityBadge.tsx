import type { Verdict } from '@/modules/pain-gating/engine';
import { verdictStyle } from '@/modules/pain-gating/verdict-style';

/** Colored eligibility chip (green/teal/amber/red) for a game verdict. */
export function EligibilityBadge({ verdict }: { verdict: Verdict }) {
  const s = verdictStyle(verdict);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold border ${s.cls}`}>
      {s.label}
    </span>
  );
}
