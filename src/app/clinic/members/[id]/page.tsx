'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { MemberStatusBadge } from '@/components/members/MemberStatusBadge';
import { GameEligibilityList } from '@/components/members/GameEligibilityList';
import { NudgePanel } from '@/components/nudges/NudgePanel';
import { AppointmentsPanel } from '@/components/appointments/AppointmentsPanel';
import { VideoAssignPanel } from '@/components/videos/VideoAssignPanel';
import { Sparkline } from '@/components/ui-a/Chart';
import { Badge } from '@/components/ui-a/Badge';
import { PAIN_REGION_LABELS, CONSENT_METHODS, type ConsentMethod, type PainRegion } from '@/modules/members/constants';
import { dbg, dbgError } from '@/lib/debug';

type PainFlag = { id: string; region: string; severity: number; type: string; active: string };
type Scan = { id: string; type: string; status: string; musculage: number | null; created_at: string; completed_at: string | null };
type Activity = { id: string; type: string; score: number | null; duration_sec: number | null; completed_at: string; game_name: string | null };
type TrendPoint = { date: string; musculage: number };
type MemberDetail = {
  member: {
    id: string; name: string; mobile: string; age: number | null; sex: string | null;
    segment: string; status: string; complaint: string | null; telegram_chat_id?: string | null;
  };
  has_consent: boolean;
  pain_flags: PainFlag[];
  assignment: { id: string; clinician_id: string; clinician_name: string | null } | null;
};

const TABS = ['Overview', 'Pain & Games', 'Scans', 'Care Program', 'Activities', 'Nudges', 'Appointments', 'Care Videos', 'Prescriptions'] as const;

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
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);

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
    apiClient.get<TrendPoint[]>(`/api/v1/members/${id}/trends`).then((r) => { if (r.data) setTrends(r.data); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Lazy-load Scans / Activities when their tab is first opened.
  useEffect(() => {
    if (tab === 'Scans' && scans === null) {
      apiClient.get<Scan[]>(`/api/v1/members/${id}/scans`).then((r) => setScans(r.data ?? []));
    }
    if (tab === 'Activities' && activities === null) {
      apiClient.get<Activity[]>(`/api/v1/members/${id}/activities`).then((r) => setActivities(r.data ?? []));
    }
  }, [tab, id, scans, activities]);

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
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="h-8 w-48 bg-white/5 rounded animate-pulse mb-4" />
        <div className="h-32 bg-white/5 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-center">
        <p className="text-slate-400">Member not found, or you don’t have access.</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.back()}>← Back</Button>
      </div>
    );
  }

  const m = data.member;
  const canClinical = data.has_consent;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <button onClick={() => router.push('/clinic/members')} className="text-slate-400 hover:text-white text-sm mb-4 transition-colors">
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
            onClick={() => router.push(`/clinic/members/${id}/scan`)}
          >
            Run Scan
          </Button>
          <Button
            variant="primary"
            disabled={!canClinical}
            title={canClinical ? undefined : 'Capture consent first'}
            onClick={() => router.push(`/clinic/members/${id}/prescriptions/new`)}
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
          const enabled = t === 'Overview' || t === 'Pain & Games' || t === 'Scans' || t === 'Activities' || t === 'Nudges' || t === 'Appointments' || t === 'Care Videos';
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
                {data.assignment
                  ? (data.assignment.clinician_name ?? <span className="text-slate-500">Clinician</span>)
                  : <span className="text-slate-500">Unassigned</span>}
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
            <Card title="Musculage trend">
              {trends.length >= 2 ? (
                <div className="flex items-center gap-3">
                  <Sparkline points={trends.map((t) => t.musculage)} />
                  <span className="text-sm text-slate-400">
                    {trends.length} scans · latest{' '}
                    <span className="text-teal-400 font-semibold tabular-nums">{trends[trends.length - 1].musculage}</span>
                  </span>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Not enough scans yet for a trend.</p>
              )}
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

        {tab === 'Scans' && (
          <Card title="Scan history">
            {scans === null ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : scans.length === 0 ? (
              <p className="text-sm text-slate-500">No scans yet. Run a scan to assess movement health.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-white/5">
                {scans.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div>
                      <span className="text-slate-300 capitalize">{s.type} scan</span>
                      <span className="text-slate-500 text-xs ml-2">
                        {new Date(s.completed_at ?? s.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-white tabular-nums">{s.musculage ?? '—'}</span>
                      <Badge tone={s.status === 'completed' ? 'green' : 'amber'}>{s.status.replace('_', ' ')}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {tab === 'Activities' && (
          <Card title="Activity feed">
            {activities === null ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : activities.length === 0 ? (
              <p className="text-sm text-slate-500">No sessions recorded yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-white/5">
                {activities.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div>
                      <span className="text-slate-300">{a.game_name ?? (a.type === 'video' ? 'Care video' : 'Game')}</span>
                      <span className="text-slate-500 text-xs ml-2">{new Date(a.completed_at).toLocaleDateString()}</span>
                    </div>
                    <span className="text-white tabular-nums">{a.score != null ? `${a.score}` : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {tab === 'Nudges' && <NudgePanel memberId={id} telegramConnected={!!data.member.telegram_chat_id} />}

        {tab === 'Appointments' && (
          <AppointmentsPanel memberId={id} clinicianId={data.assignment?.clinician_id ?? null} />
        )}

        {tab === 'Care Videos' && <VideoAssignPanel memberId={id} />}
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
    </div>
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
