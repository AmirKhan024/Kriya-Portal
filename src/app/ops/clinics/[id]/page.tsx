'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type Branch = { id: string; name: string; address?: string };
type Entitlements = {
  move: boolean; quick_scan: boolean; deep_scan: boolean;
  care_programs: boolean; pain_gating: boolean;
  custom_branding: boolean; iot: boolean;
  seats_total: number; seats_used: number;
  member_cap: number; plan: string;
};
type StaffMember = {
  id: string; name: string; email: string;
  role: string | null; status: string;
  branch_id: string | null; created_at: string; activated_at: string | null;
};
type ClinicDetail = {
  id: string; name: string; city: string;
  type: string; status: string; created_at: string;
  branches: Branch[];
  entitlements: Entitlements | null;
  staff_count: number;
};

const ENTITLEMENT_META: { key: keyof Entitlements; label: string }[] = [
  { key: 'move',            label: 'Move' },
  { key: 'quick_scan',      label: 'Quick Scan' },
  { key: 'deep_scan',       label: 'Deep Scan' },
  { key: 'care_programs',   label: 'Care Programs' },
  { key: 'pain_gating',     label: 'Pain Gating' },
  { key: 'custom_branding', label: 'Custom Branding' },
  { key: 'iot',             label: 'IoT' },
];

function ClinicDetailContent() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const clinicId = params.id as string;

  const [clinic, setClinic] = useState<ClinicDetail | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEnt, setSavingEnt] = useState(false);
  const [localEnt, setLocalEnt] = useState<Partial<Entitlements>>({});

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('physio');
  const [inviteBranchId, setInviteBranchId] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function load() {
    const [clinicRes, staffRes] = await Promise.all([
      apiClient.get<ClinicDetail>(`/api/v1/clinics/${clinicId}`),
      apiClient.get<StaffMember[]>(`/api/v1/clinics/${clinicId}/staff`),
    ]);

    if (clinicRes.data) {
      setClinic(clinicRes.data);
      setLocalEnt({ ...clinicRes.data.entitlements });
      if (clinicRes.data.branches[0]) setInviteBranchId(clinicRes.data.branches[0].id);
    } else {
      toast({ variant: 'error', title: 'Clinic not found' });
      router.push('/ops/clinics');
    }
    if (staffRes.data) setStaff(staffRes.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [clinicId]);

  async function saveEntitlements() {
    setSavingEnt(true);
    const res = await apiClient.patch(`/api/v1/clinics/${clinicId}/entitlements`, localEnt);
    setSavingEnt(false);
    if (res.error) {
      toast({ variant: 'error', title: 'Save failed', message: res.error.message });
    } else {
      toast({ variant: 'success', title: 'Entitlements updated' });
      load();
    }
  }

  async function handleInvite(ev: React.FormEvent) {
    ev.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    setInviteLoading(true);
    const res = await apiClient.post<{ invite_link: string }>(`/api/v1/clinics/${clinicId}/invite`, {
      name: inviteName, email: inviteEmail, role: inviteRole, branch_id: inviteBranchId,
    });
    setInviteLoading(false);
    if (res.error) {
      toast({ variant: 'error', title: 'Invite failed', message: res.error.message });
    } else {
      setInviteLink(res.data?.invite_link ?? null);
      setInviteName(''); setInviteEmail('');
      load();
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05080f] flex items-center justify-center">
        <div className="text-slate-400">Loading…</div>
      </div>
    );
  }

  if (!clinic) return null;

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
          <span className="text-slate-900 font-bold text-sm">K</span>
        </div>
        <span className="text-white font-semibold text-sm">Kriya Ops Console</span>
        <span className="text-slate-600 mx-1">/</span>
        <button onClick={() => router.push('/ops/clinics')} className="text-slate-400 text-sm hover:text-white">Clinics</button>
        <span className="text-slate-600 mx-1">/</span>
        <span className="text-white text-sm">{clinic.name}</span>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Clinic header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-white">{clinic.name}</h1>
              <StatusChip status={clinic.status} />
            </div>
            <p className="text-slate-400 text-sm capitalize">{clinic.city} · {clinic.type}</p>
          </div>
        </div>

        {/* Entitlements panel */}
        <section className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Entitlements</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-4 text-sm text-slate-400">
                <span>Seats: <Input
                  type="number"
                  value={(localEnt.seats_total ?? clinic.entitlements?.seats_total ?? 0).toString()}
                  onChange={e => setLocalEnt(p => ({ ...p, seats_total: parseInt(e.target.value) || 1 }))}
                  className="w-20 inline-block"
                /></span>
              </div>
              <Button variant="primary" size="sm" onClick={saveEntitlements} loading={savingEnt}>
                Save Entitlements
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {ENTITLEMENT_META.map(m => {
              const key = m.key as keyof Entitlements;
              if (typeof (localEnt[key]) !== 'boolean' && typeof (clinic.entitlements?.[key]) !== 'boolean') return null;
              const checked = (localEnt[key] as boolean) ?? false;
              return (
                <label key={m.key} className="flex items-center gap-2 p-3 bg-white/5 rounded-xl cursor-pointer hover:bg-white/8">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => setLocalEnt(p => ({ ...p, [m.key]: e.target.checked }))}
                    className="accent-teal-400"
                  />
                  <span className="text-sm text-slate-300">{m.label}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-6 text-sm text-slate-400">
            <span>
              Seats used: <strong className="text-white">{clinic.entitlements?.seats_used ?? 0}</strong>
              {' / '}
              <strong className="text-white">{localEnt.seats_total ?? clinic.entitlements?.seats_total ?? 0}</strong>
            </span>
            <span>
              Member cap:{' '}
              <Input
                type="number"
                value={(localEnt.member_cap ?? clinic.entitlements?.member_cap ?? 0).toString()}
                onChange={e => setLocalEnt(p => ({ ...p, member_cap: parseInt(e.target.value) || 10 }))}
                className="w-24 inline-block"
              />
            </span>
          </div>
        </section>

        {/* Staff roster */}
        <section className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Staff</h2>
            <Button variant="secondary" size="sm" onClick={() => setShowInvite(true)}>Invite Staff</Button>
          </div>

          {staff.length === 0 ? (
            <p className="text-slate-500 text-sm">No staff yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-slate-400 font-medium py-2">Name</th>
                  <th className="text-left text-slate-400 font-medium py-2">Role</th>
                  <th className="text-left text-slate-400 font-medium py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {staff.map(s => (
                  <tr key={s.id}>
                    <td className="py-2.5">
                      <div className="text-white font-medium">{s.name}</div>
                      <div className="text-slate-500 text-xs">{s.email}</div>
                    </td>
                    <td className="py-2.5">
                      {s.role ? <StatusChip status={s.role} /> : <span className="text-slate-500 text-xs">Pending</span>}
                    </td>
                    <td className="py-2.5"><StatusChip status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {/* Invite modal */}
      <Modal
        open={showInvite}
        onClose={() => { setShowInvite(false); setInviteLink(null); }}
        title="Invite Staff"
        size="sm"
      >
        {inviteLink ? (
          <div>
            <p className="text-green-400 text-sm mb-3">Invite created!</p>
            <div className="bg-black/30 rounded-xl p-3 flex items-center gap-2">
              <code className="text-teal-400 text-xs break-all flex-1">
                {typeof window !== 'undefined' ? window.location.origin : ''}{inviteLink}
              </code>
              <Button variant="ghost" size="sm" onClick={() => {
                navigator.clipboard.writeText((typeof window !== 'undefined' ? window.location.origin : '') + inviteLink);
                toast({ variant: 'success', title: 'Copied!' });
              }}>Copy</Button>
            </div>
            <Button variant="primary" className="mt-4 w-full" onClick={() => setInviteLink(null)}>
              Invite another
            </Button>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="flex flex-col gap-4">
            <Input label="Full Name" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Name" />
            <Input label="Email" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@clinic.com" />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-300">Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/50"
              >
                {[
                  { v: 'physio', l: 'Physiotherapist' },
                  { v: 'ortho', l: 'Orthopaedic' },
                  { v: 'trainer', l: 'Fitness Trainer' },
                  { v: 'front_desk', l: 'Front Desk' },
                  { v: 'clinic_admin', l: 'Clinic Admin' },
                ].map(o => <option key={o.v} value={o.v} className="bg-[#0d1117]">{o.l}</option>)}
              </select>
            </div>
            {clinic.branches.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-300">Branch</label>
                <select
                  value={inviteBranchId}
                  onChange={e => setInviteBranchId(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/50"
                >
                  {clinic.branches.map(b => <option key={b.id} value={b.id} className="bg-[#0d1117]">{b.name}</option>)}
                </select>
              </div>
            )}
            <Button type="submit" variant="primary" loading={inviteLoading} className="w-full mt-2">
              Send Invite
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export default function ClinicDetailPage() {
  return (
    <ToastProvider>
      <ClinicDetailContent />
    </ToastProvider>
  );
}
