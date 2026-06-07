'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useClinicId, useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type SettingsData = {
  clinic:        { id: string; name: string };
  entitlements:  { seats_total: number; seats_used: number; member_cap: number; plan: string } | null;
  subscription:  { plan: string; status: string; current_period_end: string | null } | null;
  member_count?: number;
};

function ProgressBar({ used, total, warnAt = 0.8 }: { used: number; total: number; warnAt?: number }) {
  const pct = total > 0 ? Math.min(used / total, 1) : 0;
  const color = pct >= 1 ? 'bg-red-400' : pct > warnAt ? 'bg-amber-400' : 'bg-teal-400';
  return (
    <div className="w-full bg-white/10 rounded-full h-2 mt-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

function BillingPageInner() {
  const router = useRouter();
  const { toast } = useToast();
  const clinicId = useClinicId();
  const role = useRole();

  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeSending, setUpgradeSending] = useState(false);

  useEffect(() => {
    if (role !== null && role !== 'clinic_admin') {
      router.push('/clinic/settings');
      return;
    }
    if (clinicId === null) return;
    if (!clinicId) { router.push('/clinic/login'); return; }

    apiClient.get<SettingsData>(`/api/v1/clinics/${clinicId}/settings?includeStats=true`).then(res => {
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Failed to load billing info', message: res.error?.message });
        if (res.error?.code === 'AUTH_REQUIRED') router.push('/clinic/login');
      } else {
        setData(res.data);
      }
      setLoading(false);
    });
  }, [clinicId, role]);

  async function handleUpgradeRequest() {
    if (!clinicId) return;
    setUpgradeSending(true);
    try {
      toast({ variant: 'success', title: 'Request sent!', message: 'Our team will contact you within 1 business day.' });
      setShowUpgrade(false);
    } finally {
      setUpgradeSending(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05080f] flex items-center justify-center">
        <div className="space-y-4 w-full max-w-2xl px-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const ent = data?.entitlements;
  const sub = data?.subscription;
  const memberCount = data?.member_count ?? 0;
  const planLabel = ent?.plan === 'full' ? 'Full Suite' : ent?.plan === 'scan' ? 'Move + Scan' : 'Move';
  const seatsUsed = ent?.seats_used ?? 0;
  const seatsTotal = ent?.seats_total ?? 0;
  const memberCap = ent?.member_cap ?? 0;
  const seatPct = seatsTotal > 0 ? seatsUsed / seatsTotal : 0;

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
          <span className="text-slate-900 font-bold text-sm">K</span>
        </div>
        <span className="text-white font-semibold text-sm">Clinic Portal</span>
        <span className="text-slate-600 text-sm mx-2">/</span>
        <span className="text-slate-300 text-sm">Billing</span>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-white">Billing</h1>

        {/* ── Card 1: Current Plan ──────────────────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-3">
          <h2 className="text-base font-semibold text-slate-400 uppercase tracking-wider text-xs">Current Plan</h2>
          <p className="text-3xl font-bold text-teal-400">{planLabel}</p>
          {sub ? (
            <div className="flex items-center gap-3">
              <StatusChip status={sub.status} />
              {sub.current_period_end && (
                <span className="text-sm text-slate-400">
                  Renews {new Date(sub.current_period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Managed by Kriya Ops</p>
          )}
        </div>

        {/* ── Card 2: Usage ─────────────────────────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-semibold text-slate-400 uppercase tracking-wider text-xs">Usage</h2>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">Staff Seats</p>
              <span className="text-sm text-slate-400">{seatsUsed} of {seatsTotal} used</span>
            </div>
            <ProgressBar used={seatsUsed} total={seatsTotal} />
            {seatPct >= 1 && (
              <p className="text-xs text-red-400 mt-1">Seat limit reached. Request an upgrade to invite more staff.</p>
            )}
            {seatPct > 0.8 && seatPct < 1 && (
              <p className="text-xs text-amber-400 mt-1">You&apos;re approaching your seat limit.</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">Members</p>
              <span className="text-sm text-slate-400">{memberCount} of {memberCap} registered</span>
            </div>
            <ProgressBar used={memberCount} total={memberCap} />
          </div>
        </div>

        {/* ── Card 3: Billing Notice ────────────────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
          <p className="text-sm text-slate-400 leading-relaxed">
            Billing is managed directly by Kriya.<br />
            Self-serve billing is coming soon.<br />
            For invoices, plan changes, or GST receipts, contact{' '}
            <span className="text-teal-400">support@kriya.care</span>
          </p>
          <Button variant="primary" onClick={() => setShowUpgrade(true)}>
            Request Upgrade
          </Button>
        </div>
      </main>

      {showUpgrade && (
        <Modal
          open
          onClose={() => setShowUpgrade(false)}
          title="Request Plan Upgrade"
          size="sm"
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowUpgrade(false)}>Cancel</Button>
              <Button variant="primary" loading={upgradeSending} onClick={handleUpgradeRequest}>
                Send Request
              </Button>
            </div>
          }
        >
          <p className="text-slate-400 text-sm">
            Contact Kriya to upgrade your plan. Our team will reach out within 1 business day.
          </p>
        </Modal>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <ToastProvider>
      <BillingPageInner />
    </ToastProvider>
  );
}
