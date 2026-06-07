'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui';
import PrescriptionDetail from '../[prescriptionId]/PrescriptionDetail';

const GENERATION_STEPS = [
  'Analysing clinical data...',
  'Running MSK decision tree...',
  'Evaluating exercise safety...',
  'Formatting clinical letter...',
];

type PrescriptionData = {
  prescription_id: string;
  status: string;
  member: { id: string; name: string; status: string };
  qr_code: string;
  qr_code_image: string;
  pdf_url: string;
  findings: object;
  treeWalkerOutput: {
    dx_summary: string;
    contraindications: string[];
    precautions: string[];
    program_seed: object[];
    red_flag_alert: string | null;
  };
  eligibility: {
    game_id: string;
    game_name: string;
    slug: string;
    category: string;
    regions: string[];
    verdict: 'eligible' | 'modified' | 'capped' | 'blocked';
    reason: string | null;
    modifications: string | null;
  }[];
  prose: {
    findings_prose: string;
    impression_prose: string;
    contraindications_prose: string;
    program_rationale_prose: string;
    safety_note_prose: string;
  };
};

export default function NewPrescriptionPage() {
  const params = useParams();
  const router = useRouter();
  const memberId = params.id as string;

  const [phase, setPhase] = useState<'idle' | 'generating' | 'review'>('idle');
  const [stepIndex, setStepIndex] = useState(0);
  const [prescription, setPrescription] = useState<PrescriptionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cycle through generation step labels every 4 seconds while generating
  useEffect(() => {
    if (phase === 'generating') {
      intervalRef.current = setInterval(() => {
        setStepIndex(i => Math.min(i + 1, GENERATION_STEPS.length - 1));
      }, 4000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setStepIndex(0);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [phase]);

  async function handleGenerate() {
    setError(null);
    setPhase('generating');
    try {
      const res = await apiClient.post<PrescriptionData>('/api/v1/prescriptions', {
        member_id: memberId,
      });
      if (res.error) {
        setError(res.error.message);
        setPhase('idle');
        return;
      }
      setPrescription(res.data!);
      setPhase('review');
    } catch {
      setError('Failed to generate prescription. Please try again.');
      setPhase('idle');
    }
  }

  if (phase === 'idle') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-teal-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Generate Prescription</h1>
          <p className="text-slate-400 text-sm mb-6">
            This will analyse the member&apos;s scan data and generate a personalised
            prescription letter with exercise safety ratings. This takes 10–20 seconds.
          </p>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm text-left">
              {error}
            </div>
          )}
          <div className="flex gap-3">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleGenerate}>
              Generate Prescription
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'generating') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full text-center">
          <div className="relative mx-auto mb-6 w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-teal-500/20" />
            <div className="absolute inset-0 rounded-full border-t-2 border-teal-400 animate-spin" />
            <div className="absolute inset-2 rounded-full bg-teal-500/10 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-teal-400 animate-pulse" />
            </div>
          </div>
          <h2 className="text-white font-semibold text-lg mb-2">Generating Prescription</h2>
          <p className="text-teal-400 text-sm min-h-[20px] transition-all">
            {GENERATION_STEPS[stepIndex]}
          </p>
          <div className="mt-4 flex gap-1.5 justify-center">
            {GENERATION_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-500 ${
                  i <= stepIndex ? 'w-6 bg-teal-400' : 'w-6 bg-slate-700'
                }`}
              />
            ))}
          </div>
          <p className="text-slate-500 text-xs mt-4">Usually takes 10–20 seconds</p>
        </div>
      </div>
    );
  }

  // Review phase: render prescription detail inline
  return prescription ? (
    <PrescriptionDetail prescription={prescription} />
  ) : null;
}
