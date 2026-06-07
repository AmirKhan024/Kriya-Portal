'use client';

import { PAIN_REGIONS, PAIN_REGION_LABELS, PAIN_TYPES } from '@/modules/members/constants';
import type { PainFlagInput } from '@/modules/members/schemas';
import { Button } from '@/components/ui/Button';

/**
 * Quick pain-map editor (feature 1b). A controlled list of pain points; each is a
 * region + 0–10 severity + Acute/Chronic. This is a triage signal that gates which
 * scan games are safe later (Module 1c pain-gating).
 */
export function PainMapInput({
  value,
  onChange,
}: {
  value: PainFlagInput[];
  onChange: (next: PainFlagInput[]) => void;
}) {
  function addRow() {
    onChange([...value, { region: 'lower_back', severity: 5, type: 'acute' }]);
  }
  function updateRow(i: number, patch: Partial<PainFlagInput>) {
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeRow(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Quick Pain Map
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={addRow}>
          + Add pain point
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="text-xs text-slate-500">
          No pain points. Add any reported pain — it gates which games are safe.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {value.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto] gap-3 items-center bg-white/5 border border-white/10 rounded-xl p-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select
                  aria-label="Region"
                  value={row.region}
                  onChange={(e) => updateRow(i, { region: e.target.value as PainFlagInput['region'] })}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-400"
                >
                  {PAIN_REGIONS.map((r) => (
                    <option key={r} value={r} className="bg-slate-900">
                      {PAIN_REGION_LABELS[r]}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-2">
                  <input
                    aria-label="Severity"
                    type="range"
                    min={0}
                    max={10}
                    value={row.severity}
                    onChange={(e) => updateRow(i, { severity: Number(e.target.value) })}
                    className="flex-1 accent-teal-400"
                  />
                  <span className="text-sm text-white w-6 text-right tabular-nums">{row.severity}</span>
                </div>

                <select
                  aria-label="Type"
                  value={row.type}
                  onChange={(e) => updateRow(i, { type: e.target.value as PainFlagInput['type'] })}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-400"
                >
                  {PAIN_TYPES.map((t) => (
                    <option key={t} value={t} className="bg-slate-900">
                      {t === 'acute' ? 'Acute' : 'Chronic'}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label="Remove pain point"
                className="text-slate-500 hover:text-red-400 transition-colors px-2"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
