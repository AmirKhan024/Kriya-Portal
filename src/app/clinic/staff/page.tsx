'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import { Modal } from '@/components/ui/Modal';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  status: string;
  branch_id: string | null;
  created_at: string;
  activated_at: string | null;
};

function StaffRosterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [confirmUser, setConfirmUser] = useState<StaffMember | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens.access) {
      router.push('/clinic/login');
      return;
    }
    const payload = parseAccessToken(tokens.access);
    const cid = (payload as Record<string, unknown>)?.clinic_id as string | null;
    if (!cid) {
      router.push('/clinic/login');
      return;
    }
    // Staff management is clinic_admin-only (matches the API). Non-admins who land
    // here (e.g. via an old link) go to the clinic home instead of an empty page.
    const role = (payload as Record<string, unknown>)?.role as string | null;
    if (role !== 'clinic_admin') {
      router.push('/clinic/members');
      return;
    }
    setClinicId(cid);

    apiClient.get<StaffMember[]>(`/api/v1/clinics/${cid}/staff`).then(res => {
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Failed to load staff', message: res.error?.message });
      } else {
        setStaff(res.data);
      }
      setLoading(false);
    });
  }, []);

  async function handleStatusChange(member: StaffMember, newStatus: 'active' | 'suspended') {
    if (!clinicId) return;
    setActionLoading(true);
    try {
      const res = await apiClient.patch(`/api/v1/clinics/${clinicId}/staff/${member.id}`, { status: newStatus });
      if (res.error) {
        toast({ variant: 'error', title: 'Action failed', message: res.error.message });
      } else {
        setStaff(prev => prev.map(s => s.id === member.id ? { ...s, status: newStatus } : s));
        toast({ variant: 'success', title: newStatus === 'suspended' ? `${member.name} suspended` : `${member.name} reactivated` });
      }
    } finally {
      setActionLoading(false);
      setConfirmUser(null);
    }
  }

  const seatsUsed = staff.filter(s => s.status !== 'suspended').length;

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
            <span className="text-slate-900 font-bold text-sm">K</span>
          </div>
          <span className="text-white font-semibold text-sm">Clinic Portal</span>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Staff</h1>
            <p className="text-slate-400 text-sm mt-1">
              {seatsUsed} active {seatsUsed === 1 ? 'member' : 'members'} on your team
            </p>
          </div>
          <Button variant="primary" onClick={() => router.push('/clinic/staff/invite')}>
            Invite Staff
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : staff.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-400">No staff yet. Invite your first team member.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Name</th>
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Role</th>
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Status</th>
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Joined</th>
                  <th className="text-right text-slate-400 font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {staff.map(member => (
                  <tr key={member.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{member.name}</div>
                      <div className="text-slate-500 text-xs">{member.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {member.role ? <StatusChip status={member.role} /> : (
                        <span className="text-slate-500 text-xs">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusChip status={member.status} /></td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {member.activated_at
                        ? new Date(member.activated_at).toLocaleDateString()
                        : 'Not activated'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {member.status === 'invited' ? (
                        <span className="text-slate-500 text-xs">Re-invite to refresh link</span>
                      ) : member.status === 'active' ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setConfirmUser(member)}
                        >
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleStatusChange(member, 'active')}
                          loading={actionLoading}
                        >
                          Reactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {confirmUser && (
        <Modal
          open
          onClose={() => setConfirmUser(null)}
          title={`Suspend ${confirmUser.name}?`}
          size="sm"
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setConfirmUser(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={actionLoading}
                onClick={() => handleStatusChange(confirmUser, 'suspended')}
              >
                Suspend
              </Button>
            </div>
          }
        >
          <p className="text-slate-400 text-sm">
            {confirmUser.name} will lose portal access immediately. You can reactivate them later.
          </p>
        </Modal>
      )}
    </div>
  );
}

export default function StaffPage() {
  return (
    <ToastProvider>
      <StaffRosterPage />
    </ToastProvider>
  );
}
