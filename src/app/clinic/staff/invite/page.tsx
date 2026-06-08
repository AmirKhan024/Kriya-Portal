'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type Branch = {
  id: string;
  name: string;
};

const ROLE_OPTIONS = [
  { value: 'physio',       label: 'Physiotherapist' },
  { value: 'ortho',        label: 'Orthopaedic' },
  { value: 'trainer',      label: 'Fitness Trainer' },
  { value: 'front_desk',   label: 'Front Desk' },
  { value: 'clinic_admin', label: 'Clinic Admin' },
];

function InviteForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [clinicId, setClinicId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('physio');
  const [branchId, setBranchId] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ name: string; email: string; invite_link: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens.access) { router.push('/clinic/login'); return; }
    const payload = parseAccessToken(tokens.access);
    const cid = (payload as Record<string, unknown>)?.clinic_id as string | null;
    if (!cid) { router.push('/clinic/login'); return; }
    setClinicId(cid);

    apiClient.get<{ branches: Branch[] }>(`/api/v1/clinics/${cid}`).then(res => {
      if (res.data?.branches?.length) {
        setBranches(res.data.branches);
        setBranchId(res.data.branches[0]!.id);
      }
    });
  }, []);

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!email.trim()) e.email = 'Email is required';
    if (!branchId) e.branchId = 'Branch is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate() || !clinicId) return;

    setLoading(true);
    try {
      const res = await apiClient.post<{
        user: { name: string; email: string };
        invite_link: string;
        seats: { used: number; total: number };
      }>(`/api/v1/clinics/${clinicId}/invite`, {
        name, email, role, branch_id: branchId,
      });

      if (res.error) {
        if (res.error.code === 'CONFLICT' && res.error.message.includes('Seat')) {
          toast({ variant: 'error', title: 'Seat limit reached', message: 'Upgrade your plan to add more staff.' });
        } else {
          toast({ variant: 'error', title: 'Invite failed', message: res.error.message });
        }
        return;
      }

      setSuccess({
        name: res.data!.user.name,
        email: res.data!.user.email,
        invite_link: res.data!.invite_link,
      });
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setName(''); setEmail(''); setRole('physio');
    setBranchId(branches[0]?.id ?? '');
    setErrors({}); setSuccess(null);
  }

  if (success) {
    return (
      <div className="max-w-lg">
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-6 mb-6">
          <h2 className="text-green-400 font-semibold text-lg mb-1">Invite created!</h2>
          <p className="text-slate-300 text-sm">
            {success.name} ({success.email}) will receive this link to set their password.
          </p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
          <p className="text-slate-400 text-xs mb-2">Invite link (dev — share directly):</p>
          <div className="flex items-center gap-2">
            <code className="text-teal-400 text-xs break-all flex-1 bg-black/30 rounded p-2">
              {typeof window !== 'undefined' ? window.location.origin : ''}{success.invite_link}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(
                  (typeof window !== 'undefined' ? window.location.origin : '') + success.invite_link,
                );
                toast({ variant: 'success', title: 'Copied!' });
              }}
            >
              Copy
            </Button>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="primary" onClick={handleReset}>Invite another person</Button>
          <Button variant="ghost" onClick={() => router.push('/clinic/staff')}>Back to Staff</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg flex flex-col gap-5" noValidate>
      <Input
        label="Full Name"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="e.g. Priya Sharma"
        error={errors.name}
      />
      <Input
        label="Email Address"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="priya@clinic.com"
        error={errors.email}
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-300">Role</label>
        <select
          value={role}
          onChange={e => setRole(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/50"
        >
          {ROLE_OPTIONS.map(o => (
            <option key={o.value} value={o.value} className="bg-[#0d1117]">{o.label}</option>
          ))}
        </select>
      </div>

      {branches.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-300">Branch</label>
          <select
            value={branchId}
            onChange={e => setBranchId(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/50"
          >
            {branches.map(b => (
              <option key={b.id} value={b.id} className="bg-[#0d1117]">{b.name}</option>
            ))}
          </select>
          {errors.branchId && <p className="text-red-400 text-xs">{errors.branchId}</p>}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" variant="primary" loading={loading}>Send Invite</Button>
        <Button type="button" variant="ghost" onClick={() => router.push('/clinic/staff')}>Cancel</Button>
      </div>
    </form>
  );
}

export default function InviteStaffPage() {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#05080f]">
        <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
            <span className="text-slate-900 font-bold text-sm">K</span>
          </div>
          <span className="text-white font-semibold text-sm">Clinic Portal</span>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white">Invite a team member</h1>
            <p className="text-slate-400 text-sm mt-1">They will receive a link to set their password and activate their account.</p>
          </div>
          <InviteForm />
        </main>
      </div>
    </ToastProvider>
  );
}
