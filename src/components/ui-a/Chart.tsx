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

/** Tiny SVG line chart for a numeric series (e.g., Musculage over time). */
export function Sparkline({
  points,
  width = 140,
  height = 40,
  stroke = '#2dd4bf',
}: {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 3;
  const stepX = (width - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (p - min) / range);
    return [x, y] as const;
  });
  const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = coords[coords.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={3} fill={stroke} />
    </svg>
  );
}
