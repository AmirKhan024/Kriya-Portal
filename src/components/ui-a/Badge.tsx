import React from 'react';

/** Generic colored badge primitive (Dev A design-system). */
export type BadgeTone = 'green' | 'teal' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';

const TONE: Record<BadgeTone, string> = {
  green:  'bg-green-500/15 text-green-400 border-green-500/30',
  teal:   'bg-teal-500/15 text-teal-400 border-teal-500/30',
  amber:  'bg-amber-500/15 text-amber-400 border-amber-500/30',
  red:    'bg-red-500/15 text-red-400 border-red-500/30',
  blue:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
  purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  gray:   'bg-white/10 text-slate-400 border-white/15',
};

export function Badge({ tone = 'gray', children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold border ${TONE[tone]}`}>
      {children}
    </span>
  );
}
