type ChipVariant = 'green' | 'amber' | 'blue' | 'red' | 'gray' | 'purple' | 'teal';

const chipStyles: Record<ChipVariant, string> = {
  green:  'bg-green-500/15 text-green-400 border border-green-500/30',
  amber:  'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  blue:   'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  red:    'bg-red-500/15 text-red-400 border border-red-500/30',
  gray:   'bg-white/10 text-slate-400 border border-white/15',
  purple: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  teal:   'bg-teal-500/15 text-teal-400 border border-teal-500/30',
};

const STATUS_MAP: Record<string, { label: string; variant: ChipVariant }> = {
  // Clinic statuses
  pending_setup: { label: 'Pending Setup', variant: 'amber' },
  onboarding:    { label: 'Onboarding',    variant: 'blue' },
  active:        { label: 'Active',         variant: 'green' },
  suspended:     { label: 'Suspended',      variant: 'red' },
  // User statuses
  invited:       { label: 'Invited',        variant: 'amber' },
  // Content statuses
  draft:         { label: 'Draft',          variant: 'gray' },
  published:     { label: 'Published',      variant: 'green' },
  // Role labels
  ops:           { label: 'Ops',            variant: 'gray' },
  clinic_admin:  { label: 'Clinic Admin',   variant: 'blue' },
  ortho:         { label: 'Ortho',          variant: 'purple' },
  physio:        { label: 'Physio',         variant: 'purple' },
  trainer:       { label: 'Trainer',        variant: 'teal' },
  front_desk:    { label: 'Front Desk',     variant: 'gray' },
};

export function StatusChip({ status }: { status: string }) {
  const config = STATUS_MAP[status] ?? { label: status, variant: 'gray' as ChipVariant };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold ${chipStyles[config.variant]}`}>
      {config.label}
    </span>
  );
}
