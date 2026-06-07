'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type Clinic = {
  id: string;
  name: string;
  city: string;
  type: string;
  status: string;
  created_at: string;
  entitlements: {
    plan: string;
    seats_used: number;
    seats_total: number;
    member_cap: number;
  } | null;
};

function ClinicListPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get<Clinic[]>('/api/v1/clinics').then(res => {
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Failed to load clinics', message: res.error?.message });
      } else {
        setClinics(res.data);
      }
      setLoading(false);
    });
  }, []);

  const planLabel: Record<string, string> = {
    move: 'Move',
    move_scan: 'Move + Scan',
    full_suite: 'Full Suite',
  };

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
            <span className="text-slate-900 font-bold text-sm">K</span>
          </div>
          <span className="text-white font-semibold text-sm">Kriya Ops Console</span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Clinics</h1>
            <p className="text-slate-400 text-sm mt-1">All provisioned clinics on the platform</p>
          </div>
          <Button variant="primary" onClick={() => router.push('/ops/clinics/new')}>
            Provision New Clinic
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : clinics.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-400 text-lg">No clinics yet.</p>
            <p className="text-slate-500 text-sm mt-1">Provision your first clinic to get started.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Clinic</th>
                  <th className="text-left text-slate-400 font-medium px-4 py-3">City</th>
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Status</th>
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Plan</th>
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Seats</th>
                  <th className="text-right text-slate-400 font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {clinics.map(c => (
                  <tr key={c.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{c.name}</div>
                      <div className="text-slate-500 text-xs capitalize">{c.type}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{c.city}</td>
                    <td className="px-4 py-3"><StatusChip status={c.status} /></td>
                    <td className="px-4 py-3 text-slate-300">
                      {c.entitlements ? planLabel[c.entitlements.plan] ?? c.entitlements.plan : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {c.entitlements ? `${c.entitlements.seats_used}/${c.entitlements.seats_total}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push(`/ops/clinics/${c.id}`)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ClinicsPage() {
  return (
    <ToastProvider>
      <ClinicListPage />
    </ToastProvider>
  );
}
