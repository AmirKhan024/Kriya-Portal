'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { PainMapInput } from '@/components/members/PainMapInput';
import { ConsentCapture, type ConsentDraft } from '@/components/members/ConsentCapture';
import { SEXES, SEGMENTS } from '@/modules/members/constants';
import type { PainFlagInput } from '@/modules/members/schemas';
import { dbg, dbgError } from '@/lib/debug';

type CreateMemberResponse = {
  member: { id: string; name: string; status: string };
  assigned_clinician_id: string;
  consent_captured: boolean;
};

const MOBILE_RE = /^\+?\d{10,15}$/;

function AddMemberForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [authChecked, setAuthChecked] = useState(false);

  // Step 1 — details
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [segment, setSegment] = useState(''); // '' = auto-derive

  // Step 2 — complaint + pain map + consent
  const [complaint, setComplaint] = useState('');
  const [painMap, setPainMap] = useState<PainFlagInput[]>([]);
  const [consent, setConsent] = useState<ConsentDraft>({ granted: false, method: 'verbal' });

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; mobile?: string }>({});
  const [duplicate, setDuplicate] = useState<{ existingId: string } | null>(null);

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens.access) {
      router.push('/clinic/login');
      return;
    }
    const payload = parseAccessToken(tokens.access);
    if (!payload?.clinic_id) {
      router.push('/clinic/login');
      return;
    }
    setAuthChecked(true);
    dbg('AddMember:mount', { clinic_id: payload.clinic_id, role: payload.role });
  }, [router]);

  const derivedSegment = useMemo(
    () => (segment ? segment : complaint.trim() ? 'care' : 'wellness'),
    [segment, complaint],
  );

  function validateStep1(): boolean {
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!MOBILE_RE.test(mobile.trim())) e.mobile = 'Enter a valid mobile (10–15 digits)';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function goNext() {
    if (validateStep1()) {
      dbg('AddMember:step1->2', { name, mobile, segment: derivedSegment });
      setStep(2);
    }
  }

  async function submit(allowDuplicate = false) {
    setSubmitting(true);
    const body: Record<string, unknown> = {
      name: name.trim(),
      mobile: mobile.trim(),
      complaint: complaint.trim() || undefined,
      pain_map: painMap.length ? painMap : undefined,
      ...(age ? { age: Number(age) } : {}),
      ...(sex ? { sex } : {}),
      ...(segment ? { segment } : {}),
      ...(consent.granted ? { consent: { type: 'clinical', method: consent.method } } : {}),
      ...(allowDuplicate ? { allow_duplicate: true } : {}),
    };
    dbg('AddMember:submit →', body);
    try {
      const res = await apiClient.post<CreateMemberResponse>('/api/v1/members', body);
      dbg('AddMember:submit ←', res);

      if (res.error) {
        if (res.error.code === 'CONFLICT') {
          const existingId = (res.meta as { existing_member_id?: string } | undefined)?.existing_member_id;
          if (existingId) {
            setDuplicate({ existingId });
            return;
          }
        }
        toast({ variant: 'error', title: 'Could not create member', message: res.error.message });
        return;
      }
      if (res.data) {
        toast({ variant: 'success', title: `${res.data.member.name} added` });
        router.push(`/members/${res.data.member.id}`);
      }
    } catch (err) {
      dbgError('AddMember:submit failed', err);
      toast({ variant: 'error', title: 'Network error', message: 'Please try again' });
    } finally {
      setSubmitting(false);
    }
  }

  if (!authChecked) {
    return <div className="min-h-screen bg-[#05080f]" />;
  }

  return (
    <main className="max-w-2xl mx-auto px-6 py-10">
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="text-slate-400 hover:text-white text-sm mb-3 transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white">Add Member</h1>
        <div className="flex items-center gap-2 mt-3">
          <StepDot active={step >= 1} label="Details" n={1} current={step === 1} />
          <div className="h-px w-8 bg-white/15" />
          <StepDot active={step >= 2} label="Complaint & Consent" n={2} current={step === 2} />
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <Input
              label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              placeholder="e.g. Ravi Kumar"
            />
            <Input
              label="Mobile (identity key)"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              error={errors.mobile}
              placeholder="9876543210"
              inputMode="tel"
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Age"
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="38"
                min={0}
                max={120}
              />
              <Field label="Sex">
                <Select value={sex} onChange={setSex} placeholder="Select…" options={SEXES.map((s) => ({ value: s, label: cap(s) }))} />
              </Field>
            </div>
            <Field label={`Segment (auto: ${cap(derivedSegment)})`}>
              <Select
                value={segment}
                onChange={setSegment}
                placeholder="Auto from complaint"
                options={SEGMENTS.map((s) => ({ value: s, label: cap(s) }))}
              />
            </Field>

            <div className="flex justify-end mt-2">
              <Button onClick={goNext}>Continue</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <Field label="Presenting complaint (optional)">
              <textarea
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
                rows={3}
                placeholder="e.g. Lower back pain for 3 weeks, worsens on sitting"
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/20"
              />
              <p className="text-xs text-slate-500 mt-1">
                Segment will be <span className="text-teal-400">{cap(derivedSegment)}</span>. New member is auto-assigned to you.
              </p>
            </Field>

            <PainMapInput value={painMap} onChange={setPainMap} />
            <ConsentCapture value={consent} onChange={setConsent} />

            <div className="flex justify-between mt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
              <Button onClick={() => submit(false)} loading={submitting}>Create member</Button>
            </div>
          </div>
        )}
      </div>

      {duplicate && (
        <Modal
          open
          onClose={() => setDuplicate(null)}
          title="Member already exists"
          size="sm"
          footer={
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  const id = duplicate.existingId;
                  setDuplicate(null);
                  router.push(`/members/${id}`);
                }}
              >
                Open existing
              </Button>
              <Button
                variant="primary"
                loading={submitting}
                onClick={() => { setDuplicate(null); submit(true); }}
              >
                Create new anyway
              </Button>
            </div>
          }
        >
          <p className="text-slate-400 text-sm">
            A member with this mobile already exists in your clinic. Open the existing record, or
            create a separate new member with the same number.
          </p>
        </Modal>
      )}
    </main>
  );
}

function StepDot({ n, label, active, current }: { n: number; label: string; active: boolean; current: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={[
          'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
          active ? 'bg-teal-400 text-slate-900' : 'bg-white/10 text-slate-400',
        ].join(' ')}
      >
        {n}
      </span>
      <span className={current ? 'text-white text-sm' : 'text-slate-500 text-sm'}>{label}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function Select({
  value, onChange, options, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/20"
    >
      {placeholder && <option value="" className="bg-slate-900">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>
      ))}
    </select>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function AddMemberPage() {
  return (
    <ToastProvider>
      <AddMemberForm />
    </ToastProvider>
  );
}
