'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useClinicId, useCanDo } from '@/hooks/useRole';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type SettingsData = {
  clinic: {
    id: string; name: string; city: string; type: string;
    status: string; logo_url: string | null; created_at: string;
  };
  entitlements: {
    move: boolean; quick_scan: boolean; deep_scan: boolean; care_programs: boolean;
    pain_gating: boolean; custom_branding: boolean; iot: boolean;
    seats_total: number; seats_used: number; member_cap: number; plan: string;
  } | null;
  subscription: { plan: string; status: string; current_period_end: string | null } | null;
  branches: { id: string; name: string; address: string | null; status: string }[];
};

const MODULE_INFO: { key: keyof NonNullable<SettingsData['entitlements']>; label: string; desc: string }[] = [
  { key: 'move',            label: 'Move',            desc: 'Core movement programs and game catalog.' },
  { key: 'quick_scan',      label: 'Quick Scan',      desc: 'Fast questionnaire-based risk assessment.' },
  { key: 'deep_scan',       label: 'Deep Scan',       desc: 'Camera-based movement analysis (MediaPipe).' },
  { key: 'care_programs',   label: 'Care Programs',   desc: 'Multi-phase exercise prescription programs.' },
  { key: 'pain_gating',     label: 'Pain Gating',     desc: 'Automated safety locks on painful exercises.' },
  { key: 'custom_branding', label: 'Custom Branding', desc: 'Clinic logo on prescription letters.' },
  { key: 'iot',             label: 'IoT Devices',     desc: 'Wearable sensor integration.' },
];

function SettingsPageInner() {
  const router = useRouter();
  const { toast } = useToast();
  const clinicId = useClinicId();
  const canManage = useCanDo('manage_settings');

  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable identity fields
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [type, setType] = useState('');
  const [logoUrl, setLogoUrl] = useState('');

  // Branch add form
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchAddress, setNewBranchAddress] = useState('');
  const [branchSaving, setBranchSaving] = useState(false);

  // Disable branch confirm
  const [disablingBranch, setDisablingBranch] = useState<{ id: string; name: string } | null>(null);
  const [branchActing, setBranchActing] = useState(false);

  // Upgrade request modal
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeSending, setUpgradeSending] = useState(false);

  useEffect(() => {
    if (clinicId === null) return; // still resolving from token
    if (!clinicId) {
      router.push('/clinic/login');
      return;
    }
    apiClient.get<SettingsData>(`/api/v1/clinics/${clinicId}/settings`).then(res => {
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Failed to load settings', message: res.error?.message });
        if (res.error?.code === 'AUTH_REQUIRED') router.push('/clinic/login');
      } else {
        setData(res.data);
        setName(res.data.clinic.name);
        setCity(res.data.clinic.city);
        setType(res.data.clinic.type);
        setLogoUrl(res.data.clinic.logo_url ?? '');
      }
      setLoading(false);
    });
  }, [clinicId]);

  async function handleSaveIdentity() {
    if (!clinicId) return;
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (name !== data?.clinic.name) body.name = name;
      if (city !== data?.clinic.city) body.city = city;
      if (type !== data?.clinic.type) body.type = type;
      const logoVal = logoUrl.trim() === '' ? null : logoUrl.trim();
      if (logoVal !== (data?.clinic.logo_url ?? null)) body.logo_url = logoVal;

      const res = await apiClient.patch<SettingsData['clinic']>(`/api/v1/clinics/${clinicId}/settings`, body);
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Save failed', message: res.error?.message });
      } else {
        setData(prev => prev ? { ...prev, clinic: res.data! } : prev);
        toast({ variant: 'success', title: 'Settings saved.', message: 'New prescription letters will use the updated logo.' });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBranch() {
    if (!clinicId || !newBranchName.trim()) return;
    setBranchSaving(true);
    try {
      const res = await apiClient.post<{ id: string; name: string; address: string | null; status: string }>(
        `/api/v1/clinics/${clinicId}/branches`,
        { name: newBranchName.trim(), address: newBranchAddress.trim() || undefined }
      );
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Failed to add branch', message: res.error?.message });
      } else {
        setData(prev => prev ? { ...prev, branches: [...prev.branches, res.data!] } : prev);
        setNewBranchName('');
        setNewBranchAddress('');
        setShowAddBranch(false);
        toast({ variant: 'success', title: `Branch "${res.data.name}" added.` });
      }
    } finally {
      setBranchSaving(false);
    }
  }

  async function handleBranchStatus(branchId: string, status: 'active' | 'disabled') {
    if (!clinicId) return;
    setBranchActing(true);
    try {
      const res = await apiClient.patch<{ id: string; status: string }>(
        `/api/v1/clinics/${clinicId}/branches/${branchId}`,
        { status }
      );
      if (res.error) {
        const msg = res.error.code === 'CONFLICT'
          ? 'This branch has active members. Reassign them first.'
          : res.error.message;
        toast({ variant: 'error', title: 'Cannot disable branch', message: msg });
      } else {
        setData(prev => prev
          ? { ...prev, branches: prev.branches.map(b => b.id === branchId ? { ...b, status } : b) }
          : prev
        );
        toast({ variant: 'success', title: `Branch ${status === 'disabled' ? 'disabled' : 'enabled'}.` });
      }
    } finally {
      setBranchActing(false);
      setDisablingBranch(null);
    }
  }

  async function handleUpgradeRequest() {
    if (!clinicId) return;
    setUpgradeSending(true);
    try {
      await apiClient.post(`/api/v1/clinics/${clinicId}/settings`, {
        __upgrade_request: true,
      });
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
            <div key={i} className="h-24 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const ent = data?.entitlements;
  const planLabel = ent?.plan === 'full' ? 'Full Suite' : ent?.plan === 'scan' ? 'Move + Scan' : 'Move';

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
          <span className="text-slate-900 font-bold text-sm">K</span>
        </div>
        <span className="text-white font-semibold text-sm">Clinic Portal</span>
        <span className="text-slate-600 text-sm mx-2">/</span>
        <span className="text-slate-300 text-sm">Settings</span>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-white">Clinic Settings</h1>

        {/* ── Section 1: Clinic Identity ────────────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
          <h2 className="text-lg font-semibold text-white">Clinic Identity</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Display Name"
              value={name}
              onChange={e => setName(e.target.value)}
              readOnly={!canManage}
              className={!canManage ? 'opacity-50 cursor-not-allowed' : ''}
            />
            <Input
              label="City"
              value={city}
              onChange={e => setCity(e.target.value)}
              readOnly={!canManage}
              className={!canManage ? 'opacity-50 cursor-not-allowed' : ''}
            />
          </div>

          <div>
            <p className="text-sm text-slate-400 mb-2">Clinic Type</p>
            <div className="flex flex-wrap gap-3">
              {(['physio', 'ortho', 'sports', 'general'] as const).map(t => (
                <label key={t} className={`flex items-center gap-2 cursor-pointer ${!canManage ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input
                    type="radio"
                    name="type"
                    value={t}
                    checked={type === t}
                    onChange={() => canManage && setType(t)}
                    className="accent-teal-400"
                    disabled={!canManage}
                  />
                  <span className="text-sm text-slate-300 capitalize">
                    {t === 'sports' ? 'Sports Med' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Input
              label="Logo URL"
              type="url"
              value={logoUrl}
              onChange={e => setLogoUrl(e.target.value)}
              placeholder="https://yoursite.com/logo.png"
              readOnly={!canManage}
              className={!canManage ? 'opacity-50 cursor-not-allowed' : ''}
            />
            {logoUrl && (
              <img src={logoUrl} alt="Logo preview" className="mt-2 max-h-16 object-contain" />
            )}
            <p className="text-xs text-slate-500 mt-1">This logo appears on all generated prescription letters.</p>
          </div>

          {canManage && (
            <Button variant="primary" loading={saving} onClick={handleSaveIdentity} className="w-full">
              Save Changes
            </Button>
          )}
        </div>

        {/* ── Section 2: Branch Management ─────────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Branches</h2>
            {ent && (
              <span className="text-xs text-slate-400 bg-white/10 border border-white/10 rounded-lg px-2.5 py-1">
                {ent.seats_used} / {ent.seats_total} seats used
              </span>
            )}
          </div>

          <div className="space-y-2">
            {data?.branches.map(branch => (
              <div key={branch.id} className="flex items-center justify-between p-3 bg-white/3 rounded-lg border border-white/5">
                <div>
                  <p className="text-sm font-medium text-white">{branch.name}</p>
                  {branch.address && <p className="text-xs text-slate-500">{branch.address}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <StatusChip status={branch.status} />
                  {canManage && (
                    branch.status === 'active' ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDisablingBranch({ id: branch.id, name: branch.name })}
                      >
                        Disable
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={branchActing}
                        onClick={() => handleBranchStatus(branch.id, 'active')}
                      >
                        Enable
                      </Button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>

          {canManage && !showAddBranch && (
            <Button variant="ghost" size="sm" onClick={() => setShowAddBranch(true)}>
              + Add Branch
            </Button>
          )}

          {showAddBranch && (
            <div className="mt-3 flex flex-col gap-3 p-4 bg-white/3 rounded-lg border border-white/10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label="Branch Name"
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  placeholder="e.g. Andheri Branch"
                />
                <Input
                  label="Address (optional)"
                  value={newBranchAddress}
                  onChange={e => setNewBranchAddress(e.target.value)}
                  placeholder="e.g. Link Road, Andheri West"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" loading={branchSaving} onClick={handleAddBranch}>
                  Add
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setShowAddBranch(false); setNewBranchName(''); setNewBranchAddress(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 3: Entitlements (read-only) ──────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Your Plan</h2>
            {ent && <StatusChip status={planLabel.toLowerCase().replace(/ /g, '_')} />}
            {ent && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-teal-500/15 text-teal-400 border border-teal-500/30">
                {planLabel}
              </span>
            )}
          </div>

          {ent && MODULE_INFO.map(m => (
            <div key={m.key} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
              <div>
                <p className="text-sm font-medium text-white">{m.label}</p>
                <p className="text-xs text-slate-500">{m.desc}</p>
              </div>
              {(ent[m.key] as boolean) ? (
                <span className="text-teal-400 text-sm font-semibold">✓ Enabled</span>
              ) : (
                <span className="text-slate-500 text-sm">✗ Disabled</span>
              )}
            </div>
          ))}

          <Button variant="secondary" onClick={() => setShowUpgrade(true)} className="mt-2">
            Request Upgrade
          </Button>
        </div>
      </main>

      {/* ── Disable branch confirm modal ─────────────────────────────────── */}
      {disablingBranch && (
        <Modal
          open
          onClose={() => setDisablingBranch(null)}
          title={`Disable "${disablingBranch.name}"?`}
          size="sm"
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setDisablingBranch(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={branchActing}
                onClick={() => handleBranchStatus(disablingBranch.id, 'disabled')}
              >
                Disable
              </Button>
            </div>
          }
        >
          <p className="text-slate-400 text-sm">
            This branch will be marked as disabled. Staff and members currently assigned here will not be moved automatically.
          </p>
        </Modal>
      )}

      {/* ── Upgrade request modal ─────────────────────────────────────────── */}
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

export default function SettingsPage() {
  return (
    <ToastProvider>
      <SettingsPageInner />
    </ToastProvider>
  );
}
