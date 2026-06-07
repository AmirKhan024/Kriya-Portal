'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { DAY_NAMES } from '@/modules/appointments/constants';
import { dbg } from '@/lib/debug';

type DayRow = { available: boolean; start_time: string; end_time: string };
type AvailRow = { day_of_week: string; start_time: string; end_time: string; is_available: string };

function decodeToken(token: string | null): { sub: string; role: string } | null {
  if (!token) return null;
  try {
    const mid = token.split('.')[1];
    return JSON.parse(atob(mid.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

function blankWeek(): Record<string, DayRow> {
  return Object.fromEntries(DAY_NAMES.map((d) => [d, { available: false, start_time: '09:00', end_time: '17:00' }]));
}

function AvailabilityEditor() {
  const router = useRouter();
  const { toast } = useToast();
  const [clinicianId, setClinicianId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [week, setWeek] = useState<Record<string, DayRow>>(blankWeek());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load(id: string) {
    if (!id) return;
    setLoading(true);
    dbg('AvailabilityEditor:load', { id });
    const res = await apiClient.get<{ availability: AvailRow[] }>(`/api/v1/clinicians/${id}/availability`);
    const next = blankWeek();
    for (const r of res.data?.availability ?? []) {
      if (next[r.day_of_week]) next[r.day_of_week] = { available: r.is_available === 'true', start_time: r.start_time, end_time: r.end_time };
    }
    setWeek(next);
    setLoading(false);
  }

  useEffect(() => {
    const tok = tokenStore.get().access;
    if (!tok) { router.push('/clinic/login'); return; }
    const me = decodeToken(tok);
    if (!me) { router.push('/clinic/login'); return; }
    setClinicianId(me.sub);
    setIsAdmin(me.role === 'clinic_admin' || me.role === 'ops');
    load(me.sub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    try {
      const slots = DAY_NAMES.filter((d) => week[d].available).map((d) => ({
        day_of_week: d, start_time: week[d].start_time, end_time: week[d].end_time,
      }));
      const res = await apiClient.post(`/api/v1/clinicians/${clinicianId}/availability`, { slots });
      dbg('AvailabilityEditor:save ←', res);
      if (res.error) { toast({ variant: 'error', title: 'Could not save', message: res.error.message }); return; }
      toast({ variant: 'success', title: 'Availability saved' });
    } finally {
      setSaving(false);
    }
  }

  function setDay(day: string, patch: Partial<DayRow>) {
    setWeek((w) => ({ ...w, [day]: { ...w[day], ...patch } }));
  }

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <button onClick={() => router.push('/members')} className="text-slate-400 hover:text-white text-sm mb-4 transition-colors">← Members</button>
      <h1 className="text-2xl font-bold text-white">Availability</h1>
      <p className="text-slate-400 text-sm mt-1">Set your weekly hours. Free 30-minute slots are generated from these for booking.</p>

      {isAdmin && (
        <div className="mt-4 flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400 text-xs">Clinician ID (admin)</span>
            <input value={clinicianId} onChange={(e) => setClinicianId(e.target.value)} className="rounded-lg bg-[#05080f] border border-white/10 px-2.5 py-1.5 text-sm text-white w-[22rem] focus:outline-none focus:border-teal-400/60" />
          </label>
          <Button size="sm" variant="secondary" onClick={() => load(clinicianId)}>Load</Button>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {loading ? (
          <div className="h-64 bg-white/5 rounded-2xl animate-pulse" />
        ) : DAY_NAMES.map((d) => (
          <div key={d} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5">
            <label className="flex items-center gap-2 w-32 cursor-pointer">
              <input type="checkbox" checked={week[d].available} onChange={(e) => setDay(d, { available: e.target.checked })} className="accent-teal-400" />
              <span className="text-sm text-white">{d}</span>
            </label>
            <input type="time" value={week[d].start_time} disabled={!week[d].available} onChange={(e) => setDay(d, { start_time: e.target.value })} className="rounded-lg bg-[#05080f] border border-white/10 px-2 py-1 text-sm text-white disabled:opacity-40 focus:outline-none focus:border-teal-400/60" />
            <span className="text-slate-500">–</span>
            <input type="time" value={week[d].end_time} disabled={!week[d].available} onChange={(e) => setDay(d, { end_time: e.target.value })} className="rounded-lg bg-[#05080f] border border-white/10 px-2 py-1 text-sm text-white disabled:opacity-40 focus:outline-none focus:border-teal-400/60" />
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Button loading={saving} onClick={save}>Save availability</Button>
      </div>
    </main>
  );
}

export default function AvailabilityPage() {
  return (
    <ToastProvider>
      <AvailabilityEditor />
    </ToastProvider>
  );
}
