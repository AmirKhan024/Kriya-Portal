'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useProvisionStore, PLAN_PRESETS, type PlanPreset, type WizardBranch } from '@/store/provision';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToastProvider, useToast } from '@/components/ui/Toast';

// ── Step indicator ──────────────────────────────────────────────────────────
const STEPS = ['Clinic Profile', 'Branches & Seats', 'Entitlements', 'Admin Invite'];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-10">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                done    ? 'bg-teal-400 text-slate-900' :
                active  ? 'bg-teal-400/20 text-teal-400 ring-2 ring-teal-400' :
                          'bg-white/10 text-slate-500'
              }`}>
                {done ? '✓' : step}
              </div>
              <span className={`text-xs mt-1.5 whitespace-nowrap ${active ? 'text-teal-400' : done ? 'text-slate-300' : 'text-slate-600'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-12 mx-2 mt-[-14px] ${done ? 'bg-teal-400' : 'bg-white/10'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Clinic Profile ───────────────────────────────────────────────────
const CLINIC_TYPES = [
  { value: 'physio',  label: 'Physio' },
  { value: 'ortho',   label: 'Ortho' },
  { value: 'sports',  label: 'Sports Med' },
  { value: 'general', label: 'General' },
];

function Step1({ onNext }: { onNext: () => void }) {
  const { profile, setProfile } = useProvisionStore();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (profile.name.trim().length < 2) e.name = 'Clinic name must be at least 2 characters';
    if (!profile.city.trim()) e.city = 'City is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  return (
    <div className="flex flex-col gap-5 max-w-lg">
      <Input
        label="Clinic Name"
        value={profile.name}
        onChange={e => setProfile({ ...profile, name: e.target.value })}
        placeholder="e.g. Apex Physiotherapy"
        error={errors.name}
      />
      <Input
        label="City"
        value={profile.city}
        onChange={e => setProfile({ ...profile, city: e.target.value })}
        placeholder="e.g. Bangalore"
        error={errors.city}
      />
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-slate-300">Type</label>
        <div className="grid grid-cols-4 gap-2">
          {CLINIC_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setProfile({ ...profile, type: t.value })}
              className={`py-2.5 px-3 rounded-xl border text-sm font-medium transition-all ${
                profile.type === t.value
                  ? 'bg-teal-400/15 border-teal-400/60 text-teal-400'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <Button variant="primary" onClick={() => { if (validate()) onNext(); }}>Next</Button>
      </div>
    </div>
  );
}

// ── Step 2: Branches & Seats ─────────────────────────────────────────────────
function Step2({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { branches, seats, setBranches, setSeats } = useProvisionStore();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function addBranch() {
    setBranches([...branches, { _clientId: crypto.randomUUID(), name: '', address: '' }]);
  }

  function removeBranch(id: string) {
    if (branches.length <= 1) return;
    setBranches(branches.filter(b => b._clientId !== id));
  }

  function updateBranch(id: string, field: keyof WizardBranch, value: string) {
    setBranches(branches.map(b => b._clientId === id ? { ...b, [field]: value } : b));
  }

  function validate() {
    const e: Record<string, string> = {};
    const emptyBranch = branches.find(b => !b.name.trim());
    if (emptyBranch) e.branches = 'All branches must have a name';
    if (seats.total < 1) e.seats = 'At least 1 seat is required';
    if (seats.member_cap < 10) e.member_cap = 'Member cap must be at least 10';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div>
        <label className="text-sm font-medium text-slate-300 mb-3 block">Branches</label>
        <div className="flex flex-col gap-3">
          {branches.map((b, i) => (
            <div key={b._clientId} className="flex gap-2 items-start">
              <div className="flex-1 flex gap-2">
                <Input
                  placeholder="Branch name *"
                  value={b.name}
                  onChange={e => updateBranch(b._clientId, 'name', e.target.value)}
                />
                <Input
                  placeholder="Address (optional)"
                  value={b.address}
                  onChange={e => updateBranch(b._clientId, 'address', e.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={branches.length <= 1}
                onClick={() => removeBranch(b._clientId)}
                className="mt-2 w-8 h-8 flex items-center justify-center text-slate-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label={`Remove branch ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {errors.branches && <p className="text-red-400 text-xs mt-1">{errors.branches}</p>}
        <button
          type="button"
          onClick={addBranch}
          className="mt-2 text-teal-400 text-sm hover:text-teal-300 font-medium"
        >
          + Add Branch
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Input
            label="Clinician Seats"
            type="number"
            value={seats.total.toString()}
            onChange={e => setSeats({ ...seats, total: Math.max(1, parseInt(e.target.value) || 1) })}
            helpText="Max clinicians who can log in"
            error={errors.seats}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Input
            label="Member Cap"
            type="number"
            value={seats.member_cap.toString()}
            onChange={e => setSeats({ ...seats, member_cap: Math.max(10, parseInt(e.target.value) || 10) })}
            helpText="Max patients this clinic can register"
            error={errors.member_cap}
          />
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button variant="primary" onClick={() => { if (validate()) onNext(); }}>Next</Button>
      </div>
    </div>
  );
}

// ── Step 3: Entitlements ─────────────────────────────────────────────────────
const PLAN_CARDS: { key: PlanPreset; label: string; subtitle: string; includes: string[] }[] = [
  {
    key: 'move',
    label: 'Move (Basic)',
    subtitle: 'Movement games only. No scanning.',
    includes: ['Move'],
  },
  {
    key: 'move_scan',
    label: 'Move + Scan',
    subtitle: 'Full scan engine with pain-gating.',
    includes: ['Move', 'Quick Scan', 'Deep Scan', 'Care Programs', 'Pain Gating'],
  },
  {
    key: 'full_suite',
    label: 'Full Suite',
    subtitle: 'Everything including branding and IoT.',
    includes: ['Move', 'Quick Scan', 'Deep Scan', 'Care Programs', 'Pain Gating', 'Custom Branding', 'IoT'],
  },
];

const ENTITLEMENT_META: { key: keyof typeof PLAN_PRESETS['move']; label: string; desc: string }[] = [
  { key: 'move',            label: 'Move',            desc: 'Camera-based movement exercise games' },
  { key: 'quick_scan',      label: 'Quick Scan',      desc: '8-question triage + 1 movement assessment' },
  { key: 'deep_scan',       label: 'Deep Scan',       desc: 'Full MediaPipe assessment battery (Musculage + 4 scores)' },
  { key: 'care_programs',   label: 'Care Programs',   desc: 'Structured multi-phase exercise programs' },
  { key: 'pain_gating',     label: 'Pain Gating',     desc: 'Automatic safety verdicts per exercise per member' },
  { key: 'custom_branding', label: 'Custom Branding', desc: 'Clinic logo on prescription letters' },
  { key: 'iot',             label: 'IoT',             desc: 'Connected device add-on tier' },
];

function Step3({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { plan, entitlements, setPlan, setEntitlements } = useProvisionStore();

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="grid grid-cols-3 gap-3">
        {PLAN_CARDS.map(card => (
          <button
            key={card.key}
            type="button"
            onClick={() => setPlan(card.key)}
            className={`text-left p-4 rounded-xl border transition-all ${
              plan === card.key
                ? 'bg-teal-400/10 border-teal-400/60'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <div className={`font-semibold text-sm mb-1 ${plan === card.key ? 'text-teal-400' : 'text-white'}`}>
              {card.label}
            </div>
            <div className="text-slate-500 text-xs mb-3">{card.subtitle}</div>
            <div className="flex flex-col gap-1">
              {card.includes.map(f => (
                <span key={f} className="text-xs text-slate-400">✓ {f}</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div>
        <p className="text-sm text-slate-400 mb-3">Fine-tune individual modules:</p>
        <div className="grid grid-cols-2 gap-3">
          {ENTITLEMENT_META.map(m => (
            <label key={m.key} className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer hover:bg-white/8 transition-colors">
              <input
                type="checkbox"
                checked={entitlements[m.key]}
                onChange={e => setEntitlements({ ...entitlements, [m.key]: e.target.checked })}
                className="mt-0.5 accent-teal-400"
              />
              <div>
                <div className="text-sm font-medium text-white">{m.label}</div>
                <div className="text-xs text-slate-500">{m.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button variant="primary" onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}

// ── Step 4: Admin Invite + Submit ────────────────────────────────────────────
const PLAN_LABELS: Record<PlanPreset, string> = {
  move: 'Move (Basic)',
  move_scan: 'Move + Scan',
  full_suite: 'Full Suite',
};

function Step4({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const store = useProvisionStore();
  const { adminInvite, setAdminInvite, reset } = store;
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successModal, setSuccessModal] = useState<{ clinicName: string; invite_link: string } | null>(null);

  function validate() {
    const e: Record<string, string> = {};
    if (!adminInvite.name.trim()) e.name = 'Name is required';
    if (!adminInvite.email.trim() || !adminInvite.email.includes('@')) e.email = 'Valid email is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await apiClient.post<{
        clinic: { id: string; name: string };
        invite_link: string;
      }>('/api/v1/clinics', {
        name: store.profile.name,
        city: store.profile.city,
        type: store.profile.type,
        branches: store.branches.map(b => ({ name: b.name, address: b.address || undefined })),
        seats_total: store.seats.total,
        member_cap: store.seats.member_cap,
        plan: store.plan,
        entitlements: store.entitlements,
        admin_name: adminInvite.name,
        admin_email: adminInvite.email,
      });

      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Provisioning failed', message: res.error?.message });
        return;
      }

      setSuccessModal({ clinicName: res.data.clinic.name, invite_link: res.data.invite_link });
      reset();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-lg">
        <div>
          <h3 className="text-lg font-semibold text-white mb-1">Invite the first Clinic Admin</h3>
          <p className="text-slate-400 text-sm">They will receive a link to set their password and activate the clinic.</p>
        </div>
        <Input
          label="Admin Full Name"
          value={adminInvite.name}
          onChange={e => setAdminInvite({ ...adminInvite, name: e.target.value })}
          placeholder="e.g. Priya Sharma"
          error={errors.name}
        />
        <Input
          label="Admin Email"
          type="email"
          value={adminInvite.email}
          onChange={e => setAdminInvite({ ...adminInvite, email: e.target.value })}
          placeholder="admin@clinic.com"
          error={errors.email}
        />

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-300 space-y-1">
          <div><span className="text-slate-500">Clinic:</span> {store.profile.name}, {store.profile.city}</div>
          <div><span className="text-slate-500">Branches:</span> {store.branches.length} branch{store.branches.length !== 1 ? 'es' : ''}</div>
          <div><span className="text-slate-500">Plan:</span> {PLAN_LABELS[store.plan]}</div>
          <div><span className="text-slate-500">Seats:</span> {store.seats.total} clinician seats</div>
        </div>

        <div className="flex justify-between pt-2">
          <Button type="button" variant="ghost" onClick={onBack}>Back</Button>
          <Button type="submit" variant="primary" loading={loading} className="flex-1 ml-4">
            Provision Clinic &amp; Send Invite
          </Button>
        </div>
      </form>

      {successModal && (
        <Modal
          open
          onClose={() => { setSuccessModal(null); router.push('/ops/clinics'); }}
          title="Clinic provisioned!"
          size="md"
          footer={
            <Button
              variant="primary"
              onClick={() => { setSuccessModal(null); router.push('/ops/clinics'); }}
            >
              Go to Clinics
            </Button>
          }
        >
          <p className="text-slate-300 text-sm mb-4">
            <strong className="text-white">{successModal.clinicName}</strong> is now in Pending Setup.
          </p>
          <p className="text-slate-400 text-xs mb-2">Invite link (share with the admin):</p>
          <div className="flex items-center gap-2 bg-black/30 rounded-xl p-3">
            <code className="text-teal-400 text-xs break-all flex-1">
              {typeof window !== 'undefined' ? window.location.origin : ''}{successModal.invite_link}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(
                  (typeof window !== 'undefined' ? window.location.origin : '') + successModal.invite_link,
                );
              }}
            >
              Copy
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Wizard shell ─────────────────────────────────────────────────────────────
function ProvisionWizard() {
  const { step, setStep } = useProvisionStore();

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
          <span className="text-slate-900 font-bold text-sm">K</span>
        </div>
        <span className="text-white font-semibold text-sm">Kriya Ops Console</span>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-2">
          <h1 className="text-2xl font-bold text-white">Provision New Clinic</h1>
          <p className="text-slate-400 text-sm mt-1">Set up a new clinic in 4 steps</p>
        </div>

        <div className="mt-8">
          <StepIndicator current={step} />

          {step === 1 && <Step1 onNext={() => setStep(2)} />}
          {step === 2 && <Step2 onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && <Step3 onBack={() => setStep(2)} onNext={() => setStep(4)} />}
          {step === 4 && <Step4 onBack={() => setStep(3)} />}
        </div>
      </main>
    </div>
  );
}

export default function ProvisionPage() {
  return (
    <ToastProvider>
      <ProvisionWizard />
    </ToastProvider>
  );
}
