'use client';

import React from 'react';

/**
 * Generic data table (Dev A owns Table/Badge/Chart per brief §6). Own namespace
 * `components/ui-a/` so it never collides with Dev B's `components/ui/`.
 */
export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
};

const ALIGN: Record<'left' | 'right', string> = { left: 'text-left', right: 'text-right' };

export function Table<T>({
  columns,
  rows,
  onRowClick,
  empty = 'No rows',
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return <div className="text-center py-12 text-slate-400 text-sm">{empty}</div>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-3 ${ALIGN[c.align ?? 'left']} text-slate-400 font-medium whitespace-nowrap`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-white/[0.03]' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 ${ALIGN[c.align ?? 'left']}`}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
