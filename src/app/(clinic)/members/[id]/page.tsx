'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { MemberStatusBadge } from '@/components/members/MemberStatusBadge';
import { GameEligibilityList } from '@/components/members/GameEligibilityList';
import { PAIN_REGION_LABELS, CONSENT_METHODS, type ConsentMethod, type PainRegion } from '@/modules/members/constants';
import { dbg, dbgError } from '@/lib/debug';

type PainFlag = { id: string; region: string; severity: number; type: string; active: string };
type MemberDetail = {
  member: {
    id: string; name: string; mobile: string; age: number | null; sex: string | null;
    segment: string; status: string; complaint: string | null;
  };
  has_consent: boolean;
  pain_flags: PainFlag[];
  assignment: { id: string; clinician_id: string } | null;
};

const TABS = ['Overview', 'Pain & Games', 'Scans', 'Care Program', 'Activities', 'Prescriptions'] as const;

function MemberRecord() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { toast } = useToast();

  const [data, setData] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>('verbal');
  const [savingConsent, setSavingConsent] = useState(false);

  async function load() {
    dbg('MemberRecord:load', { id });
    const res = await apiClient.get<MemberDetail>(`/api/v1/members/${id}`);
    dbg('MemberRecord:load ←', res);
    if (res.error || !res.data) {
      if (res.error?.code === 'NOT_FOUND') setNotFound(true);
      else toast({ variant: 'error', title: 'Failed to load member', message: res.error?.message });
      setLoading(false);
      return;
    }
    setData(res.data);
    setLoading(false);
  }

  useEffect(() => {
    if (!tokenStore.get().access) {
      router.push('/clinic/login');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function captureConsent() {
    setSavingConsent(true);
    try {
      const res = await apiClient.post(`/api/v1/members/${id}/consent`, { type: 'clinical', method: consentMethod });
      dbg('MemberRecord:consent ←', res);
      if (res.error) {
        toast({ variant: 'error', title: 'Could not capture consent', message: res.error.message });
        return;
      }
      toast({ variant: 'success', title: 'Consent captured' });
      setConsentOpen(false);
      await load();
    } catch (err) {
      dbgError('MemberRecord:consent failed', err);
      toast({ variant: 'error', title: 'Network error' });
    } finally {
      setSavingConsent(false);
    }
  }

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="h-8 w-48 bg-white/5 rounded animate-pulse mb-4" />
        <div className="h-32 bg-white/5 rounded-2xl animate-pulse" />
      </main>
    );
  }

  if (notFound || !data) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-16 text-center">
        <p className="text-slate-400">Member not found, or you don’t have access.</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.back()}>← Back</Button>
      </main>
    );
  }

  const m = data.member;
  const canClinical = data.has_consent;

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <button onClick={() => router.push('/members')} className="text-slate-400 hover:text-white text-sm mb-4 transition-colors">
        ← All members
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{m.name}</h1>
            <MemberStatusBadge status={m.status} />
          </div>
          <p className="text-slate-400 text-sm mt-1">
            {m.mobile}
            {m.age != null && <> · {m.age} yrs</>}
            {m.sex && <> · {m.sex}</>}
            {' · '}<span className="capitalize">{m.segment}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!canClinical}
            title={canClinical ? undefined : 'Capture consent first'}
            onClick={() => router.push(`/members/${id}/scan`)}
          >
            Run Scan
          </Button>
          <Button
            variant="primary"
            disabled={!canClinical}
            title={canClinical ? undefined : 'Capture consent first'}
            onClick={() => router.push(`/members/${id}/prescriptions/new`)}
          >
            Generate Prescription
          </Button>
        </div>
      </div>

      {/* Consent gate banner */}
      {!data.has_consent ? (
        <div className="mt-5 flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-300">
            <span className="font-semibold">Consent required.</span> Capture consent before any scan or prescription.
          </p>
          <Button size="sm" onClick={() => setConsentOpen(true)}>Capture consent</Button>
        </div>
      ) : (
        <div className="mt-5 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3">
          <p className="text-sm text-green-300"><span className="font-semibold">Consent on file.</span> Clinical actions enabled.</p>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-white/10 overflow-x-auto">
        {TABS.map((t) => {
          const enabled = t === 'Overview' || t === 'Pain & Games';
          return (
            <button
              key={t}
              disabled={!enabled}
              onClick={() => enabled && setTab(t)}
              title={enabled ? undefined : 'Available after assessment'}
              className={[
                'px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
                tab === t ? 'border-teal-400 text-white'
                  : enabled ? 'border-transparent text-slate-400 hover:text-white'
                    : 'border-transparent text-slate-600 cursor-not-allowed',
              ].join(' ')}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="mt-6">
        {tab === 'Overview' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Complaint">
              <p className="text-sm text-slate-300">{m.complaint || <span className="text-slate-500">None recorded</span>}</p>
            </Card>
            <Card title="Assignment">
              <p className="text-sm text-slate-300">
                {data.assignment ? <span className="font-mono text-xs">{data.assignment.clinician_id}</span> : <span className="text-slate-500">Unassigned</span>}
              </p>
            </Card>
            <Card title={`Pain flags (${data.pain_flags.length})`}>
              {data.pain_flags.length === 0 ? (
                <p className="text-sm text-slate-500">None recorded</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.pain_flags.map((p) => <PainFlagRow key={p.id} flag={p} />)}
                </ul>
              )}
            </Card>
            <Card title="Next steps">
              <p className="text-sm text-slate-400">
                {canClinical ? 'Run a scan to assess movement health.' : 'Capture consent to unlock scan & prescription.'}
              </p>
            </Card>
          </div>
        )}

        {tab === 'Pain & Games' && (
          <div className="grid gap-4">
            <Card title={`Pain flags (${data.pain_flags.length})`}>
              {data.pain_flags.length === 0 ? (
                <p className="text-sm text-slate-500">None recorded</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.pain_flags.map((p) => <PainFlagRow key={p.id} flag={p} />)}
                </ul>
              )}
            </Card>
            <Card title="Game eligibility">
              <GameEligibilityList memberId={id} />
            </Card>
          </div>
        )}
      </div>

      {/* Capture consent modal */}
      <Modal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="Capture consent"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setConsentOpen(false)}>Cancel</Button>
            <Button loading={savingConsent} onClick={captureConsent}>Confirm</Button>
          </div>
        }
      >
        <p className="text-sm text-slate-400 mb-3">Record the patient’s consent for clinical data handling.</p>
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Method</span>
          {CONSENT_METHODS.map((mth) => (
            <label key={mth} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="cm" checked={consentMethod === mth} onChange={() => setConsentMethod(mth)} className="accent-teal-400" />
              <span className="text-sm text-white capitalize">{mth}</span>
            </label>
          ))}
        </div>
      </Modal>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function PainFlagRow({ flag }: { flag: PainFlag }) {
  const label = PAIN_REGION_LABELS[flag.region as PainRegion] ?? flag.region;
  const sevCls = flag.severity >= 5 ? 'text-red-400' : flag.severity >= 3 ? 'text-amber-400' : 'text-green-400';
  return (
    <li className="flex items-center justify-between text-sm">
      <span className="text-slate-300">{label}</span>
      <span className="flex items-center gap-3">
        <span className={`font-semibold tabular-nums ${sevCls}`}>{flag.severity}/10</span>
        <span className="text-xs text-slate-500 capitalize">{flag.type}</span>
      </span>
    </li>
  );
}

export default function MemberRecordPage() {
  return (
    <ToastProvider>
      <MemberRecord />
    </ToastProvider>
  );
}
