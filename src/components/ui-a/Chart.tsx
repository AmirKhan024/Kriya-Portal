import React from 'react';

/**
 * Minimal inline bar/progress (Dev A design-system "Chart"). No chart library —
 * a single proportional bar, used for adherence% in the member list.
 */
export function MiniBar({
  value,
  max = 100,
  colorClass = 'bg-teal-400',
  label,
}: {
  value: number;
  max?: number;
  colorClass?: string;
  label?: React.ReactNode;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      {label != null && <span className="text-xs text-slate-400 tabular-nums">{label}</span>}
    </div>
  );
}
