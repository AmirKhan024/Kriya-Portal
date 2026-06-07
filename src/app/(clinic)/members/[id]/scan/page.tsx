'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import type { Category } from '@/types/test';
import { Button } from '@/components/ui/Button';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { ResultsCard } from '@/components/scoring/ResultsCard';
import { batteryFor, sampleMetrics, type BatteryGame } from '@/modules/scoring/battery';
import { dbg, dbgError } from '@/lib/debug';

type ScanType = 'quick' | 'deep';
type CreateResp = { assessment: { id: string; type: ScanType; status: string } };
type ResultResp = { test_id: string; category: Category; score: number; musculage: number };
type CompleteResp = { assessment_id: string; musculage: number | null; categories: Partial<Record<Category, number>>; count: number };
type MemberResp = { member: { name: string; age: number | null } };

function ScanFlow() {
  const router = useRouter();
  const { toast } = useToast();
  const params = useParams<{ id: string }>();
  const memberId = params?.id ?? '';

  const [member, setMember] = useState<{ name: string; age: number | null } | null>(null);
  const [phase, setPhase] = useState<'choose' | 'battery' | 'done'>('choose');
  const [scanType, setScanType] = useState<ScanType>('deep');
  const [assessmentId, setAssessmentId] = useState('');
  const [battery, setBattery] = useState<BatteryGame[]>([]);
  const [done, setDone] = useState<Record<number, { score: number; musculage: number }>>({});
  const [busy, setBusy] = useState(false);
  const [final, setFinal] = useState<CompleteResp | null>(null);

  useEffect(() => {
    if (!tokenStore.get().access) { router.push('/clinic/login'); return; }
    apiClient.get<MemberResp>(`/api/v1/members/${memberId}`).then((res) => {
      if (res.data) setMember(res.data.member);
    });
  }, [memberId, router]);

  async function start(type: ScanType) {
    setBusy(true);
    dbg('Scan:create', { memberId, type });
    try {
      const res = await apiClient.post<CreateResp>('/api/v1/assessments', { member_id: memberId, type });
      dbg('Scan:create ←', res);
      if (res.error || !res.data) {
        const code = res.error?.code;
        if (code === 'FORBIDDEN') toast({ variant: 'error', title: 'Consent required', message: 'Capture consent on the member page first.' });
        else if (code === 'ENTITLEMENT_REQUIRED') toast({ variant: 'error', title: 'Upgrade required', message: `${type === 'deep' ? 'Deep' : 'Quick'} Scan is not enabled for this clinic.` });
        else toast({ variant: 'error', title: 'Could not start scan', message: res.error?.message });
        return;
      }
      setAssessmentId(res.data.assessment.id);
      setScanType(type);
      setBattery(batteryFor(type));
      setDone({});
      setPhase('battery');
    } catch (err) {
      dbgError('Scan:create failed', err);
      toast({ variant: 'error', title: 'Network error' });
    } finally {
      setBusy(false);
    }
  }

  async function recordGame(idx: number, game: BatteryGame) {
    setBusy(true);
    dbg('Scan:result', { idx, test: game.test_id });
    try {
      const res = await apiClient.post<ResultResp>(`/api/v1/assessments/${assessmentId}/results`, sampleMetrics(game.test_id));
      dbg('Scan:result ←', res);
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Could not record result', message: res.error?.message });
        return;
      }
      setDone((d) => ({ ...d, [idx]: { score: res.data!.score, musculage: res.data!.musculage } }));
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    dbg('Scan:complete', { assessmentId });
    try {
      const res = await apiClient.post<CompleteResp>(`/api/v1/assessments/${assessmentId}/complete`, {});
      dbg('Scan:complete ←', res);
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Could not complete scan', message: res.error?.message });
        return;
      }
      setFinal(res.data);
      setPhase('done');
      toast({ variant: 'success', title: 'Scan complete' });
    } finally {
      setBusy(false);
    }
  }

  const allDone = battery.length > 0 && battery.every((_, i) => done[i]);

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <button onClick={() => router.push(`/members/${memberId}`)} className="text-slate-400 hover:text-white text-sm mb-4 transition-colors">
        ← Back to member
      </button>
      <h1 className="text-2xl font-bold text-white">Scan{member ? ` · ${member.name}` : ''}</h1>
      {phase !== 'choose' && (
        <p className="text-sm text-slate-400 mt-1 capitalize">{scanType} scan</p>
      )}

      {phase === 'choose' && (
        <div className="grid sm:grid-cols-2 gap-4 mt-6">
          <TypeCard
            title="Quick Scan" desc="Short triage + 1 movement → risk tier." cta="Start Quick"
            onStart={() => start('quick')} busy={busy}
          />
          <TypeCard
            title="Deep Scan" desc="Camera-game battery → Musculage + 4 category scores." cta="Start Deep"
            onStart={() => start('deep')} busy={busy} primary
          />
        </div>
      )}

      {phase === 'battery' && (
        <div className="mt-6 flex flex-col gap-4">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-amber-300">
            📷 Camera scan arrives in the next module — recording <strong>simulated</strong> results for now so the flow is end-to-end.
          </div>
          <div className="flex flex-col gap-2">
            {battery.map((g, i) => (
              <div key={i} className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-white">{g.name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{g.category}</div>
                </div>
                {done[i] ? (
                  <span className="text-sm text-green-400 tabular-nums">✓ {done[i].score}/100</span>
                ) : (
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => recordGame(i, g)}>Record</Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{Object.keys(done).length}/{battery.length} recorded</span>
            <Button disabled={!allDone} loading={busy} onClick={complete}>Complete scan</Button>
          </div>
        </div>
      )}

      {phase === 'done' && final && (
        <div className="mt-6 flex flex-col gap-4">
          <ResultsCard musculage={final.musculage} categories={final.categories} memberAge={member?.age ?? undefined} />
          <p className="text-sm text-slate-400">Member is now <span className="text-teal-400">Assessed</span>. You can curate a program or generate a prescription.</p>
          <Button onClick={() => router.push(`/members/${memberId}`)}>Back to member</Button>
        </div>
      )}
    </main>
  );
}

function TypeCard({ title, desc, cta, onStart, busy, primary }: { title: string; desc: string; cta: string; onStart: () => void; busy: boolean; primary?: boolean }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-3">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="text-sm text-slate-400 flex-1">{desc}</p>
      <Button variant={primary ? 'primary' : 'secondary'} loading={busy} onClick={onStart}>{cta}</Button>
    </div>
  );
}

export default function ScanPage() {
  return (
    <ToastProvider>
      <ScanFlow />
    </ToastProvider>
  );
}
