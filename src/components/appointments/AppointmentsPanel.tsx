'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Table, type Column } from '@/components/ui-a/Table';
import { Badge, type BadgeTone } from '@/components/ui-a/Badge';
import { APPOINTMENT_TYPES, type AppointmentStatus, type AppointmentType } from '@/modules/appointments/constants';
import { dbg, dbgError } from '@/lib/debug';

type Appointment = {
  id: string; member_id: string; clinician_id: string; slot: string;
  type: string; status: string;
};

const STATUS_TONE: Record<AppointmentStatus, BadgeTone> = {
  booked: 'teal', completed: 'green', no_show: 'red', cancelled: 'gray',
};

/**
 * Member-record Appointments tab (feature 2d): book via the assigned clinician's
 * free slots, list appointments, and transition status (Complete / No-show / Cancel).
 */
export function AppointmentsPanel({ memberId, clinicianId }: { memberId: string; clinicianId: string | null }) {
  const { toast } = useToast();
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState('');
  const [type, setType] = useState<AppointmentType>('consultation');
  const [booking, setBooking] = useState(false);

  async function loadAppts() {
    dbg('AppointmentsPanel:loadAppts', { memberId });
    const res = await apiClient.get<Appointment[]>(`/api/v1/appointments?member_id=${memberId}`);
    dbg('AppointmentsPanel:loadAppts ←', res);
    setAppts(res.data ?? []);
  }

  async function loadSlots() {
    if (!clinicianId) { setSlots([]); return; }
    const res = await apiClient.get<{ slots: string[] }>(`/api/v1/clinicians/${clinicianId}/availability`);
    setSlots(res.data?.slots ?? []);
  }

  useEffect(() => {
    loadAppts();
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, clinicianId]);

  async function book() {
    if (!slot || !clinicianId) return;
    setBooking(true);
    try {
      const res = await apiClient.post<Appointment>('/api/v1/appointments', {
        member_id: memberId, clinician_id: clinicianId, slot, type,
      });
      dbg('AppointmentsPanel:book ←', res);
      if (res.error || !res.data) {
        if (res.error?.code === 'CONFLICT') toast({ variant: 'error', title: 'Slot already booked' });
        else if (res.error?.code === 'ENTITLEMENT_REQUIRED') toast({ variant: 'error', title: 'Appointments not enabled for this clinic' });
        else toast({ variant: 'error', title: 'Could not book', message: res.error?.message });
        return;
      }
      toast({ variant: 'success', title: 'Appointment booked' });
      setSlot('');
      await Promise.all([loadAppts(), loadSlots()]);
    } catch (err) {
      dbgError('AppointmentsPanel:book failed', err);
      toast({ variant: 'error', title: 'Network error' });
    } finally {
      setBooking(false);
    }
  }

  async function setStatus(id: string, status: AppointmentStatus) {
    const res = await apiClient.patch(`/api/v1/appointments/${id}`, { status });
    if (res.error) { toast({ variant: 'error', title: 'Could not update', message: res.error.message }); return; }
    toast({ variant: 'success', title: `Marked ${status.replace('_', '-')}` });
    await Promise.all([loadAppts(), loadSlots()]);
  }

  const columns: Column<Appointment>[] = [
    { key: 'when', header: 'When', render: (a) => <span className="text-slate-300 text-xs whitespace-nowrap">{new Date(a.slot).toLocaleString()}</span> },
    { key: 'type', header: 'Type', render: (a) => <span className="capitalize text-slate-300">{a.type.replace('_', ' ')}</span> },
    { key: 'status', header: 'Status', render: (a) => <Badge tone={STATUS_TONE[a.status as AppointmentStatus] ?? 'gray'}>{a.status.replace('_', '-')}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      render: (a) => a.status === 'booked' ? (
        <span className="flex gap-2 justify-end whitespace-nowrap">
          <button onClick={() => setStatus(a.id, 'completed')} className="text-xs text-green-400 hover:text-green-300">Complete</button>
          <button onClick={() => setStatus(a.id, 'no_show')} className="text-xs text-red-400 hover:text-red-300">No-show</button>
          <button onClick={() => setStatus(a.id, 'cancelled')} className="text-xs text-slate-400 hover:text-slate-300">Cancel</button>
        </span>
      ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Book */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Book an appointment</h3>
        {!clinicianId ? (
          <p className="text-sm text-slate-500">Assign a clinician to this member first.</p>
        ) : (
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400 text-xs">Slot</span>
              <select value={slot} onChange={(e) => setSlot(e.target.value)} className="rounded-lg bg-[#05080f] border border-white/10 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-teal-400/60 min-w-[14rem]">
                <option value="">{slots === null ? 'Loading…' : slots.length ? 'Pick a free slot' : 'No free slots — set availability'}</option>
                {(slots ?? []).map((s) => <option key={s} value={s}>{new Date(s).toLocaleString()}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400 text-xs">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value as AppointmentType)} className="rounded-lg bg-[#05080f] border border-white/10 px-2.5 py-1.5 text-sm text-white capitalize focus:outline-none focus:border-teal-400/60">
                {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </label>
            <Button size="sm" loading={booking} disabled={!slot} onClick={book}>Book</Button>
          </div>
        )}
      </div>

      {/* History */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Appointments</h3>
        {appts === null ? (
          <div className="h-24 bg-white/5 rounded-2xl animate-pulse" />
        ) : (
          <Table columns={columns} rows={appts} empty="No appointments yet." />
        )}
      </div>
    </div>
  );
}
