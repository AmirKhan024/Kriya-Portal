'use client';

import { CONSENT_METHODS } from '@/modules/members/constants';
import type { ConsentMethod } from '@/modules/members/constants';

export type ConsentDraft = { granted: boolean; method: ConsentMethod };

/**
 * Consent capture (feature 1b). Consent is mandatory before any clinical action;
 * without it the member sits profile-only. Verbal = checkbox + timestamp, or digital.
 */
export function ConsentCapture({
  value,
  onChange,
}: {
  value: ConsentDraft;
  onChange: (next: ConsentDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-3 bg-white/5 border border-white/10 rounded-xl p-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={value.granted}
          onChange={(e) => onChange({ ...value, granted: e.target.checked })}
          className="mt-1 accent-teal-400 w-4 h-4"
        />
        <span className="text-sm text-white">
          The patient has given consent for clinical data handling (DPDP Act 2023).
          <span className="block text-xs text-slate-500 mt-0.5">
            Required before scan or prescription. Captured {new Date().toLocaleString()}.
          </span>
        </span>
      </label>

      {value.granted && (
        <div className="flex items-center gap-4 pl-7">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Method</span>
          {CONSENT_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="consent-method"
                checked={value.method === m}
                onChange={() => onChange({ ...value, method: m })}
                className="accent-teal-400"
              />
              <span className="text-sm text-white capitalize">{m}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
