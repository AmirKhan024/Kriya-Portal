'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import PrescriptionDetail from './PrescriptionDetail';

export default function PrescriptionViewPage() {
  const params = useParams();
  const prescriptionId = params.prescriptionId as string;
  const [prescription, setPrescription] = useState<Parameters<typeof PrescriptionDetail>[0]['prescription'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<{
      id: string;
      status: string;
      member_id: string;
      qr_code: string;
      findings_parsed: {
        structured: object;
        treeWalker: { dx_summary: string; contraindications: string[]; precautions: string[]; program_seed: object[]; red_flag_alert: string | null };
        eligibility: Parameters<typeof PrescriptionDetail>[0]['prescription']['eligibility'];
        prose: Parameters<typeof PrescriptionDetail>[0]['prescription']['prose'];
      };
    }>(`/api/v1/prescriptions/${prescriptionId}`).then(res => {
      setLoading(false);
      if (res.error || !res.data) { setError(res.error?.message ?? 'Failed to load'); return; }
      const d = res.data;
      setPrescription({
        prescription_id: d.id,
        status: d.status,
        member: { id: d.member_id, name: 'Patient', status: d.status },
        qr_code: d.qr_code ?? '',
        qr_code_image: '',
        pdf_url: `/api/v1/prescriptions/${d.id}/pdf`,
        findings: d.findings_parsed?.structured ?? {},
        treeWalkerOutput: d.findings_parsed?.treeWalker ?? {
          dx_summary: '', contraindications: [], precautions: [], program_seed: [], red_flag_alert: null,
        },
        eligibility: d.findings_parsed?.eligibility ?? [],
        prose: d.findings_parsed?.prose ?? {
          findings_prose: '', impression_prose: '', contraindications_prose: '',
          program_rationale_prose: '', safety_note_prose: '',
        },
      });
    });
  }, [prescriptionId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !prescription) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-red-400">{error ?? 'Prescription not found'}</p>
      </div>
    );
  }

  return <PrescriptionDetail prescription={prescription} />;
}
