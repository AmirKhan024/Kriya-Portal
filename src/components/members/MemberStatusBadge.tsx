import type { MemberStatus } from '@/modules/members/constants';

/**
 * Colored chip for the member lifecycle states (brief §1 spine). Dev A owns the
 * Badge family in the design-system split; this mirrors the visual language of the
 * shared StatusChip without editing that shared file (keeps merges conflict-free).
 */
const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  new:        { label: 'New',        cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  assessed:   { label: 'Assessed',   cls: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
  prescribed: { label: 'Prescribed', cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  on_program: { label: 'On Program', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  retained:   { label: 'Retained',   cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  at_risk:    { label: 'At Risk',    cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  lapsed:     { label: 'Lapsed',     cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  discharged: { label: 'Discharged', cls: 'bg-white/10 text-slate-400 border-white/15' },
};

export function MemberStatusBadge({ status }: { status: MemberStatus | string }) {
  const cfg = STATUS_STYLES[status] ?? { label: status, cls: 'bg-white/10 text-slate-400 border-white/15' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}
