'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useClinicId, useCanDo } from '@/hooks/useRole';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type FunnelStage = {
  stage: string;
  count: number;
  rate: number;
  description: string;
};

type ConversionData = {
  as_of: string;
  period: { from: string; to: string };
  funnel: FunnelStage[];
  headline: { conversion_rate: number; headline_text: string };
};

type BranchOption = { id: string; name: string };
type StaffOption  = { id: string; name: string };

function Skeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

function FunnelBar({ stage, count, rate, description, dropoff }: FunnelStage & { dropoff: number | null }) {
  const barColor = rate >= 50 ? 'bg-teal-400' : rate >= 20 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-white">{stage}</span>
          <span className="text-xs text-slate-500 ml-2">{description}</span>
        </div>
        <div className="text-right">
          <span className="text-sm font-bold text-white">{count}</span>
          <span className="text-xs text-slate-400 ml-2">{rate}%</span>
        </div>
      </div>
      <div className="w-full bg-white/10 rounded-full h-3">
        <div className={`${barColor} h-3 rounded-full transition-all`} style={{ width: `${rate}%` }} />
      </div>
      {dropoff !== null && dropoff > 0 && (
        <p className="text-xs text-slate-500 text-right">↓ {dropoff}% drop-off to next stage</p>
      )}
    </div>
  );
}

function ConversionDashboardInner() {
  const router = useRouter();
  const { toast } = useToast();
  const clinicId = useClinicId();
  const canView  = useCanDo('view_dashboards');

  const [data, setData] = useState<ConversionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);

  const [days, setDays]               = useState(30);
  const [branchId, setBranchId]       = useState('');
  const [clinicianId, setClinicianId] = useState('');
  const [selectedClinicianName, setSelectedClinicianName] = useState('');

  const fetchDashboard = useCallback(async (cid: string) => {
    setLoading(true);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({ from });
    if (branchId)    params.set('branch_id', branchId);
    if (clinicianId) params.set('clinician_id', clinicianId);

    const res = await apiClient.get<ConversionData>(`/api/v1/dashboards/conversion?${params}`);
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

    Promise.all([
      apiClient.get<{ branches: BranchOption[] }>(`/api/v1/clinics/${clinicId}/settings`),
      apiClient.get<StaffOption[]>(`/api/v1/clinics/${clinicId}/staff`),
    ]).then(([settRes, staffRes]) => {
      if (settRes.data) setBranches((settRes.data as unknown as { branches: BranchOption[] }).branches ?? []);
      if (staffRes.data) setStaff((staffRes.data as unknown as StaffOption[]) ?? []);
    });

    fetchDashboard(clinicId);
  }, [clinicId, canView, fetchDashboard]);

  // Compute drop-offs between stages
  function computeDropoff(funnel: FunnelStage[], idx: number): number | null {
    if (idx >= funnel.length - 1) return null;
    return funnel[idx].rate - funnel[idx + 1].rate;
  }

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
          <span className="text-slate-900 font-bold text-sm">K</span>
        </div>
        <span className="text-white font-semibold text-sm">Clinic Portal</span>
        <span className="text-slate-600 text-sm mx-2">/</span>
        <span className="text-slate-300 text-sm">Conversion Dashboard</span>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Header + headline */}
        <div>
          <h1 className="text-2xl font-bold text-white">Conversion Dashboard</h1>
          {data && (
            <p className="text-xs text-slate-500 mt-1">
              As of {new Date(data.as_of).toLocaleString('en-IN')}
            </p>
          )}
        </div>

        {data && (
          <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl px-6 py-4 flex items-center gap-3">
            <span className="text-2xl">📊</span>
            <p className="text-teal-300 font-semibold text-lg">{data.headline.headline_text}</p>
          </div>
        )}

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
            onChange={e => {
              setClinicianId(e.target.value);
              setSelectedClinicianName(staff.find(s => s.id === e.target.value)?.name ?? '');
            }}
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
            {/* Clinician attribution banner */}
            {clinicianId && selectedClinicianName && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-sm text-slate-300">
                  Showing members attributed to <span className="text-white font-semibold">{selectedClinicianName}</span>
                </p>
              </div>
            )}

            {/* Funnel */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
              <h2 className="text-base font-semibold text-white">Patient Conversion Funnel</h2>
              <div className="space-y-5 divide-y divide-white/5">
                {data.funnel.map((stage, idx) => (
                  <div key={stage.stage} className={idx > 0 ? 'pt-4' : ''}>
                    <FunnelBar
                      {...stage}
                      dropoff={computeDropoff(data.funnel, idx)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Renewal story callout */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <p className="text-sm text-slate-400 leading-relaxed">
                The Conversion dashboard is the renewal metric that justifies the Kriya subscription.
                <br />
                <span className="text-white font-medium">
                  &quot;This clinic converted {data.headline.conversion_rate}% of footfall into active app users.&quot;
                </span>
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function ConversionDashboardPage() {
  return (
    <ToastProvider>
      <ConversionDashboardInner />
    </ToastProvider>
  );
}
