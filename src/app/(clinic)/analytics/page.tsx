'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Badge } from '@/components/ui-a/Badge';
import { Table, type Column } from '@/components/ui-a/Table';
import { MiniBar, Sparkline } from '@/components/ui-a/Chart';
import { dbg } from '@/lib/debug';

type PatientData = {
  total: number;
  new_in_range: number;
  segment_mix: { care: number; wellness: number };
  status_distribution: Record<string, number>;
  risk_distribution: { at_risk: number; ok: number };
  branch_split: { branch_id: string | null; branch_name: string; count: number }[];
  range: string;
  as_of: string;
};
type ActivityData = {
  sessions_total: number;
  sessions_per_active_member: number;
  active_30d: number;
  adherence_avg: number | null;
  musculage_avg: number | null;
  musculage_trend: { date: string; avg: number }[];
  range: string;
  as_of: string;
};

const RANGES: { value: string; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

const STATUS_LABEL: Record<string, string> = {
  new: 'New', assessed: 'Assessed', prescribed: 'Prescribed', on_program: 'On program',
  retained: 'Retained', at_risk: 'At risk', lapsed: 'Lapsed',
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {hint && <div className="text-slate-500 text-xs mt-0.5">{hint}</div>}
    </div>
  );
}

function Analytics() {
  const router = useRouter();
  const { toast } = useToast();
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState<'patient' | 'activity'>('patient');
  const [range, setRange] = useState('30d');
  const [branchId, setBranchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<PatientData | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  // Branch options are derived from the (unfiltered) patient branch_split.
  const [branchOptions, setBranchOptions] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens.access) { router.push('/clinic/login'); return; }
    setAuthChecked(true);
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ range });
    if (branchId) qs.set('branch_id', branchId);
    const suffix = `?${qs.toString()}`;
    dbg('Analytics:load', { range, branchId });
    const [p, a] = await Promise.all([
      apiClient.get<PatientData>(`/api/v1/analytics/patient${suffix}`),
      apiClient.get<ActivityData>(`/api/v1/analytics/activity${suffix}`),
    ]);
    dbg('Analytics:load ←', { patient: p, activity: a });
    if (p.error || a.error) {
      toast({ variant: 'error', title: 'Failed to load analytics', message: p.error?.message ?? a.error?.message });
    } else {
      setPatient(p.data ?? null);
      setActivity(a.data ?? null);
      if (!branchId && p.data) {
        setBranchOptions(
          p.data.branch_split.filter((b) => b.branch_id).map((b) => ({ id: b.branch_id as string, name: b.branch_name })),
        );
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, branchId, toast]);

  useEffect(() => { if (authChecked) load(); }, [authChecked, range, branchId, load]);

  const asOf = (patient?.as_of ?? activity?.as_of);
  const statusMax = patient ? Math.max(1, ...Object.values(patient.status_distribution)) : 1;

  const branchColumns: Column<PatientData['branch_split'][number]>[] = [
    { key: 'branch', header: 'Branch', render: (b) => <span className="text-slate-200">{b.branch_name}</span> },
    { key: 'count', header: 'Members', align: 'right', render: (b) => <Badge tone="teal">{b.count}</Badge> },
  ];

  if (!authChecked) return <div className="min-h-screen" />;

  return (
    <div>
      <nav className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center"><span className="text-slate-900 font-bold text-sm">K</span></div>
          <span className="text-white font-semibold text-sm">Analytics</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button onClick={() => router.push('/members')} className="text-slate-400 hover:text-white">Members</button>
          <button onClick={() => router.push('/activity')} className="text-slate-400 hover:text-white">Activity log</button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Tabs + controls */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex rounded-xl border border-white/10 overflow-hidden">
            {(['patient', 'activity'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'bg-teal-400 text-slate-900' : 'text-slate-400 hover:text-white'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <select value={range} onChange={(e) => setRange(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-400">
            {RANGES.map((r) => <option key={r.value} value={r.value} className="bg-slate-900">{r.label}</option>)}
          </select>
          {branchOptions.length > 0 && (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-400">
              <option value="" className="bg-slate-900">All branches</option>
              {branchOptions.map((b) => <option key={b.id} value={b.id} className="bg-slate-900">{b.name}</option>)}
            </select>
          )}
          {asOf && <span className="ml-auto text-slate-500 text-xs">as of {new Date(asOf).toLocaleString()}</span>}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />)}</div>
        ) : tab === 'patient' ? (
          patient && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total members" value={patient.total} />
                <StatCard label="New in range" value={patient.new_in_range} />
                <StatCard label="Care / Wellness" value={`${patient.segment_mix.care} / ${patient.segment_mix.wellness}`} />
                <StatCard label="At risk" value={patient.risk_distribution.at_risk} hint={`${patient.risk_distribution.ok} ok`} />
              </div>

              <section>
                <h3 className="text-slate-300 text-sm font-semibold mb-3">Status distribution</h3>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
                  {Object.entries(patient.status_distribution).length === 0 ? (
                    <div className="px-4 py-6 text-center text-slate-500 text-sm">No members yet.</div>
                  ) : (
                    Object.entries(patient.status_distribution)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => (
                        <div key={status} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-slate-300 text-sm w-28">{statusLabel(status)}</span>
                          <MiniBar value={count} max={statusMax} />
                          <span className="text-slate-400 text-xs tabular-nums ml-auto">{count}</span>
                        </div>
                      ))
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-slate-300 text-sm font-semibold mb-3">By branch</h3>
                <Table columns={branchColumns} rows={patient.branch_split} empty="No branch data." />
              </section>
            </div>
          )
        ) : (
          activity && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Sessions total" value={activity.sessions_total} />
                <StatCard label="Sessions / active member" value={activity.sessions_per_active_member} />
                <StatCard label="Active in 30 days" value={activity.active_30d} />
                <StatCard label="Avg Musculage" value={activity.musculage_avg ?? '—'} />
              </div>

              <section>
                <h3 className="text-slate-300 text-sm font-semibold mb-3">Avg adherence</h3>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-4 flex items-center gap-4">
                  {activity.adherence_avg === null ? (
                    <span className="text-slate-500 text-sm">No tracked members in program yet.</span>
                  ) : (
                    <>
                      <MiniBar value={activity.adherence_avg} max={100} />
                      <span className="text-white text-lg font-semibold tabular-nums">{activity.adherence_avg}%</span>
                    </>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-slate-300 text-sm font-semibold mb-3">Musculage trend</h3>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-4">
                  {activity.musculage_trend.length < 2 ? (
                    <span className="text-slate-500 text-sm">Not enough completed assessments in this range to plot a trend.</span>
                  ) : (
                    <Sparkline points={activity.musculage_trend.map((d) => d.avg)} width={460} height={80} />
                  )}
                </div>
              </section>
            </div>
          )
        )}
      </main>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <ToastProvider>
      <Analytics />
    </ToastProvider>
  );
}
