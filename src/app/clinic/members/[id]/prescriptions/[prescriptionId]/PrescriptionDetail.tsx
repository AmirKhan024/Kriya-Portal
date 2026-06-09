'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { StatusChip } from '@/components/ui';

type GameEligibility = {
  game_id: string;
  game_name: string;
  verdict: 'eligible' | 'modified' | 'capped' | 'blocked';
  reason: string | null;
  modifications: string | null;
};

type PrescriptionData = {
  prescription_id: string;
  status: string;
  member: { id: string; name: string; status: string };
  qr_code: string;
  qr_code_image: string;
  pdf_url: string;
  findings: object;
  treeWalkerOutput: {
    dx_summary: string;
    contraindications: string[];
    precautions: string[];
    program_seed: object[];
    red_flag_alert: string | null;
  };
  eligibility: GameEligibility[];
  prose: {
    findings_prose: string;
    impression_prose: string;
    contraindications_prose: string;
    program_rationale_prose: string;
    safety_note_prose: string;
  };
};

type EditableSection = 'findings' | 'impression' | 'contraindications' | 'safety';

export default function PrescriptionDetail({ prescription }: { prescription: PrescriptionData }) {
  const [status, setStatus] = useState(prescription.status);
  const [prose, setProse] = useState(prescription.prose);
  const [editing, setEditing] = useState<EditableSection | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [sentChannels, setSentChannels] = useState<string[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);

  const eligibleGames  = prescription.eligibility.filter(g => g.verdict === 'eligible');
  const modifiedGames  = prescription.eligibility.filter(g => g.verdict === 'modified' || g.verdict === 'capped');
  const blockedGames   = prescription.eligibility.filter(g => g.verdict === 'blocked');

  function startEdit(section: EditableSection, value: string) {
    setEditing(section);
    setEditDraft(value);
  }

  function saveEdit() {
    if (!editing) return;
    const map: Record<EditableSection, keyof typeof prose> = {
      findings: 'findings_prose',
      impression: 'impression_prose',
      contraindications: 'contraindications_prose',
      safety: 'safety_note_prose',
    };
    setProse(p => ({ ...p, [map[editing]]: editDraft }));
    setEditing(null);
  }

  async function handleSend(channel: string) {
    if (channel === 'print') { window.print(); return; }
    setSending(channel);
    setSendError(null);
    const res = await apiClient.post<{ status: string; channel: string }>(
      `/api/v1/prescriptions/${prescription.prescription_id}/send`,
      { channel }
    );
    setSending(null);
    if (res.error) { setSendError(res.error.message); return; }
    setSentChannels(prev => [...prev, channel]);
    setStatus('sent');
  }

  function handleDownloadPDF() {
    window.open(`/api/v1/prescriptions/${prescription.prescription_id}/pdf`, '_blank');
  }

  const sectionCard = (
    title: string,
    key: EditableSection,
    text: string,
    titleColor = 'text-teal-400'
  ) => (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className={`text-sm font-semibold uppercase tracking-wide ${titleColor}`}>{title}</h3>
        {editing === key ? (
          <div className="flex gap-2">
            <button onClick={saveEdit} className="text-xs text-teal-400 hover:text-teal-300">Save</button>
            <button onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:text-slate-300">Cancel</button>
          </div>
        ) : (
          <button onClick={() => startEdit(key, text)} className="text-slate-500 hover:text-slate-300">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}
      </div>
      {editing === key ? (
        <textarea
          value={editDraft}
          onChange={e => setEditDraft(e.target.value)}
          rows={4}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 resize-none focus:outline-none focus:border-teal-500"
        />
      ) : (
        <p className="text-slate-300 text-sm leading-relaxed">{text}</p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 print:bg-white">
      <div className="max-w-7xl mx-auto p-6 print:p-0">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:block">

          {/* ── Left Panel: Controls ─────────────────────────────────────── */}
          <div className="lg:col-span-1 space-y-4 print:hidden">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-white font-semibold">Prescription</h1>
                <StatusChip status={status} />
              </div>
              <p className="text-slate-400 text-sm">{prescription.member.name}</p>
            </div>

            {/* Red flag alert */}
            {prescription.treeWalkerOutput.red_flag_alert && (
              <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4">
                <p className="text-amber-300 text-sm">{prescription.treeWalkerOutput.red_flag_alert}</p>
                <p className="text-amber-400/70 text-xs mt-1">This alert requires clinical review before sending.</p>
              </div>
            )}

            {/* Editable sections */}
            {sectionCard('Findings', 'findings', prose.findings_prose)}
            {sectionCard('MSK Impression', 'impression', prose.impression_prose)}
            {sectionCard('Contraindications', 'contraindications', prose.contraindications_prose, 'text-red-400')}
            {sectionCard('Safety Notes', 'safety', prose.safety_note_prose, 'text-slate-400')}

            {/* Send */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <h2 className="text-white font-semibold mb-3">Send Prescription</h2>
              {sendError && (
                <p className="text-red-400 text-xs mb-3">{sendError}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {(['telegram', 'email', 'print'] as const).map(channel => (
                  <button
                    key={channel}
                    onClick={() => handleSend(channel)}
                    disabled={sending === channel}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-sm font-medium transition-all ${
                      sentChannels.includes(channel)
                        ? 'border-teal-700 bg-teal-900/20 text-teal-300'
                        : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600 hover:bg-slate-700'
                    } ${sending === channel ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <ChannelIcon channel={channel} />
                    <span className="capitalize">
                      {sentChannels.includes(channel) ? `✓ ${channel}` : channel}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={handleDownloadPDF}
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 text-sm font-medium hover:bg-slate-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download PDF
              </button>
            </div>
          </div>

          {/* ── Right Panel: Letter Preview ──────────────────────────────── */}
          <div className="lg:col-span-2 print:col-span-2">
            <div className="bg-white rounded-2xl p-8 shadow-xl print:shadow-none print:rounded-none">
              {/* Letter header */}
              <div className="border-b border-slate-200 pb-4 mb-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-2xl font-bold text-teal-600">KRIYA</h1>
                    <p className="text-xs text-slate-400">Movement Health Platform</p>
                    <p className="text-base font-semibold text-slate-800 mt-1">
                      {prescription.member.name ? `${prescription.member.name}'s Clinic` : 'Kriya Clinic'}
                    </p>
                  </div>
                  {prescription.qr_code_image && (
                    <div className="text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={prescription.qr_code_image} alt="Activation QR" className="w-24 h-24" />
                      <p className="text-xs text-slate-400 mt-1">Scan to activate Kriya app</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex gap-6 text-sm text-slate-600">
                  <span>Patient: <strong>{prescription.member.name}</strong></span>
                  <span>Prescription ID: <code className="text-xs text-slate-400">{prescription.prescription_id.slice(0, 8)}…</code></span>
                </div>
              </div>

              {/* Findings */}
              <LetterSection title="Clinical Findings" color="teal">
                <p className="text-slate-700 text-sm leading-relaxed">{prose.findings_prose}</p>
              </LetterSection>

              {/* Impression */}
              <LetterSection title="MSK Impression" color="teal">
                <p className="text-slate-700 text-sm leading-relaxed">{prose.impression_prose}</p>
              </LetterSection>

              {/* Contraindications */}
              <LetterSection title="⚠ Contraindications" color="red">
                <p className="text-slate-700 text-sm leading-relaxed mb-2">{prose.contraindications_prose}</p>
                <ul className="space-y-1">
                  {prescription.treeWalkerOutput.contraindications.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-red-700">
                      <span className="mt-0.5 text-red-400">•</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </LetterSection>

              {/* Exercise Program */}
              <LetterSection title="✓ Prescribed Exercise Program" color="teal">
                <p className="text-slate-600 text-sm mb-3">{prose.program_rationale_prose}</p>
                {eligibleGames.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-teal-600 uppercase tracking-wide mb-1">Cleared exercises</p>
                    <ul className="space-y-1">
                      {eligibleGames.map(g => (
                        <li key={g.game_id} className="flex items-center gap-2 text-sm text-slate-700">
                          <span className="text-teal-500">✓</span> {g.game_name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {modifiedGames.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Modified exercises</p>
                    <ul className="space-y-1">
                      {modifiedGames.map(g => (
                        <li key={g.game_id} className="flex items-start gap-2 text-sm text-slate-700">
                          <span className="text-amber-500 mt-0.5">~</span>
                          <span>{g.game_name} <span className="text-slate-400 text-xs">({g.modifications})</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {blockedGames.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">Locked until reassessment</p>
                    <ul className="space-y-1">
                      {blockedGames.map(g => (
                        <li key={g.game_id} className="flex items-start gap-2 text-sm text-slate-500">
                          <span className="text-red-400 mt-0.5">✗</span>
                          <span>{g.game_name} <span className="text-slate-400 text-xs">— {g.reason}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </LetterSection>

              {/* Safety note */}
              <div className="border-t border-slate-200 mt-6 pt-4">
                <p className="text-slate-500 text-xs text-center leading-relaxed">{prose.safety_note_prose}</p>
                <p className="text-slate-400 text-xs text-center mt-2">
                  This letter was prepared with AI assistance and reviewed by the named clinician.
                  Kriya is a wellness tool and does not replace in-clinic clinical care.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LetterSection({
  title,
  color,
  children,
}: {
  title: string;
  color: 'teal' | 'red';
  children: React.ReactNode;
}) {
  const headingColor = color === 'teal' ? 'text-teal-700' : 'text-red-700';
  return (
    <div className="mb-5">
      <h2 className={`text-sm font-bold uppercase tracking-wide ${headingColor} mb-2`}>{title}</h2>
      {children}
    </div>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  const icons: Record<string, string> = {
    telegram: 'M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5',
    email: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    print: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
  };
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icons[channel]} />
    </svg>
  );
}
