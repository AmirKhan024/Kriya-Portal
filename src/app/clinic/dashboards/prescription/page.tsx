'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useClinicId, useCanDo } from '@/hooks/useRole';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type RxData = {
  as_of: string;
  period: { from: string; to: string };
  total_rx: number;
  rx_by_clinician: { clinician_id: string | null; clinician_name: string; rx_count: number }[];
  program_mix: { category: string | null; count: number }[];
  override_rate_percent: number;
  override_count: number;
  total_items: number;
};

type BranchOption = { id: string; name: string };
type StaffOption  = { id: string; name: string };

function Skeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function HorizontalBar({ label, value, max, count }: { label: string; value: number; max: number; count: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-sm text-slate-300 w-36 truncate shrink-0">{label}</span>
      <div className="flex-1 bg-white/10 rounded-full h-2">
        <div className="bg-teal-400 h-2 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm text-slate-400 w-8 text-right shrink-0">{count}</span>
    </div>
  );
}

function PrescriptionDashboardInner() {
  const router = useRouter();
  const { toast } = useToast();
  const clinicId = useClinicId();
  const canView  = useCanDo('view_dashboards');

  const [data, setData] = useState<RxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);

  const [days, setDays]             = useState(30);
  const [branchId, setBranchId]     = useState('');
  const [clinicianId, setClinicianId] = useState('');

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({ from });
    if (branchId)    params.set('branch_id', branchId);
    if (clinicianId) params.set('clinician_id', clinicianId);

    const res = await apiClient.get<RxData>(`/api/v1/dashboards/prescription?${params}`);
    if (res.error || !res.data) {
      toast({ variant: 'error', title: 'Failed to load dashboard', message: res.error?.message });
    } else {
      setData(res.data);
    }
    setLoading(false);
  }, [days, branchId, clinicianId]);

  useEffect(() => {
    if (clinicId === null) return;
    if (!clinicId) { router.push('/clinic/login'); return; }
    if (!canView)  { router.push('/clinic/staff'); return; }

    // Fetch filter options in parallel
    Promise.all([
      apiClient.get<{ branches: BranchOption[] }>(`/api/v1/clinics/${clinicId}/settings`),
      apiClient.get<StaffOption[]>(`/api/v1/clinics/${clinicId}/staff`),
    ]).then(([settRes, staffRes]) => {
      if (settRes.data) setBranches((settRes.data as unknown as { branches: BranchOption[] }).branches ?? []);
      if (staffRes.data) setStaff((staffRes.data as unknown as StaffOption[]) ?? []);
    });

    fetchDashboard();
  }, [clinicId, canView, fetchDashboard]);

  const maxRx = Math.max(...(data?.rx_by_clinician.map(r => r.rx_count) ?? [1]), 1);
  const maxMix = Math.max(...(data?.program_mix.map(p => p.count) ?? [1]), 1);

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
          <span className="text-slate-900 font-bold text-sm">K</span>
        </div>
        <span className="text-white font-semibold text-sm">Clinic Portal</span>
        <span className="text-slate-600 text-sm mx-2">/</span>
        <span className="text-slate-300 text-sm">Prescription Dashboard</span>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Prescription Dashboard</h1>
            {data && (
              <p className="text-xs text-slate-500 mt-1">
                As of {new Date(data.as_of).toLocaleString('en-IN')}
              </p>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-teal-400"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>

          <select
            value={branchId}
            onChange={e => setBranchId(e.target.value)}
            className="bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-teal-400"
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          <select
            value={clinicianId}
            onChange={e => setClinicianId(e.target.value)}
            className="bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-teal-400"
          >
            <option value="">All Clinicians</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {loading ? <Skeleton /> : !data ? (
          <p className="text-slate-400 text-center py-16">No data available.</p>
        ) : (
          <>
            {/* Metric cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard label="Prescriptions Generated" value={data.total_rx} />
              <MetricCard label="Pain Lock Override Rate" value={`${data.override_rate_percent}%`} />
              <MetricCard label="Total Overrides" value={data.override_count} />
              <MetricCard
                label="Program Items Prescribed"
                value={data.program_mix.reduce((s, p) => s + p.count, 0)}
              />
            </div>

            {/* Rx by Clinician */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h2 className="text-base font-semibold text-white mb-4">Prescriptions by Clinician</h2>
              {data.rx_by_clinician.length === 0 ? (
                <p className="text-slate-400 text-sm">No prescriptions in this period.</p>
              ) : (
                <div className="space-y-1">
                  {data.rx_by_clinician.map(r => (
                    <HorizontalBar
                      key={r.clinician_id ?? 'unknown'}
                      label={r.clinician_name}
                      value={r.rx_count}
                      max={maxRx}
                      count={r.rx_count}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Program Mix */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h2 className="text-base font-semibold text-white mb-4">Exercise Category Distribution</h2>
              {data.program_mix.length === 0 ? (
                <p className="text-slate-400 text-sm">No program items in this period.</p>
              ) : (
                <div className="space-y-1">
                  {(['stability', 'balance', 'rom', 'strength'] as const).map(cat => {
                    const entry = data.program_mix.find(p => p.category === cat);
                    const label = cat.charAt(0).toUpperCase() + cat.slice(1);
                    return (
                      <HorizontalBar
                        key={cat}
                        label={label}
                        value={entry?.count ?? 0}
                        max={maxMix}
                        count={entry?.count ?? 0}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function PrescriptionDashboardPage() {
  return (
    <ToastProvider>
      <PrescriptionDashboardInner />
    </ToastProvider>
  );
}
