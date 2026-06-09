import { NextResponse } from 'next/server';
import { z } from 'zod';
import { uuidish } from '@/server/validation';
import { db } from '@/server/db';
import {
  members, consents, assessments, category_scores, pain_flags,
  prescriptions, clinics, users,
} from '@/server/db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { runCDEPipeline } from '@/server/clinical/cde-pipeline';
import { generatePrescriptionPDF } from '@/server/clinical/pdf-generator';

const generateSchema = z.object({
  member_id: uuidish,
  assessment_id: uuidish.optional(),
  notes: z.string().optional(),
});

export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin']);

  const raw = await request.json();
  const parsed = generateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  // 1. Load + verify member
  const [member] = await db.select().from(members).where(eq(members.id, body.member_id)).limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

  // 2. Consent check
  const [consent] = await db
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.member_id, member.id),
        eq(consents.type, 'clinical'),
        isNull(consents.withdrawn_at)
      )
    )
    .limit(1);
  if (!consent) {
    throw new ApiError('FORBIDDEN', 'Member has not given clinical consent', 403);
  }

  // 3. Resolve assessment
  let assessmentId: string;
  if (body.assessment_id) {
    const [assessment] = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, body.assessment_id), eq(assessments.member_id, member.id)))
      .limit(1);
    if (!assessment || assessment.status !== 'completed') {
      throw new ApiError('FORBIDDEN', 'Scan required before prescription', 422);
    }
    assessmentId = assessment.id;
  } else {
    const [latest] = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.member_id, member.id), eq(assessments.status, 'completed')))
      .orderBy(desc(assessments.completed_at))
      .limit(1);
    if (!latest) {
      throw new ApiError('FORBIDDEN', 'Scan required before prescription', 422);
    }
    assessmentId = latest.id;
  }

  // 4. Load assessment data
  const [assessment] = await db.select().from(assessments).where(eq(assessments.id, assessmentId)).limit(1);
  const catScores = await db.select().from(category_scores).where(eq(category_scores.assessment_id, assessmentId));
  const activeFlags = await db
    .select()
    .from(pain_flags)
    .where(and(eq(pain_flags.member_id, member.id), eq(pain_flags.active, 'true')));

  // 5. Load clinic and clinician names
  const [clinic] = await db.select({ name: clinics.name, logo_url: clinics.logo_url }).from(clinics).where(eq(clinics.id, member.clinic_id)).limit(1);
  const [clinician] = await db.select({ name: users.name }).from(users).where(eq(users.id, user.id)).limit(1);

  // 6. Run CDE pipeline (LLM + TreeWalker + eligibility + prose)
  const cdeResult = await runCDEPipeline({
    memberId: member.id,
    clinicId: member.clinic_id,
    complaint: member.complaint ?? '',
    musculage: assessment?.musculage ?? 0,
    categoryScores: catScores.map(c => ({ category: c.category, score: c.score })),
    painFlags: activeFlags.map(f => ({ region: f.region, severity: f.severity, type: f.type })),
    memberAge: member.age ?? 30,
    memberName: member.name,
    clinicName: clinic?.name ?? 'Kriya Clinic',
    clinicianName: clinician?.name ?? 'Clinician',
  });

  // 7. Generate PDF + QR (Stage 5)
  const prescriptionId = crypto.randomUUID();
  const { pdfBase64, qrCodeBase64, qrPayload } = await generatePrescriptionPDF({
    clinicName: clinic?.name ?? 'Kriya Clinic',
    clinicLogo: clinic?.logo_url ?? null,
    clinicianName: clinician?.name ?? 'Clinician',
    memberName: member.name,
    memberAge: member.age ?? 30,
    memberMobile: member.mobile,
    prescriptionId,
    clinicId: member.clinic_id,
    memberId: member.id,
    cdeResult,
    generatedAt: new Date(),
  });

  // 8. Build findings JSON
  const findingsJson = JSON.stringify({
    structured: cdeResult.findings,
    treeWalker: cdeResult.treeWalkerOutput,
    eligibility: cdeResult.eligibility,
    prose: cdeResult.prose,
    notes: body.notes ?? null,
  });

  // 9. Insert prescription row
  await db.insert(prescriptions).values({
    id: prescriptionId,
    member_id: member.id,
    assessment_id: assessmentId,
    clinic_id: member.clinic_id,
    clinician_id: user.id,
    status: 'generated',
    findings: findingsJson,
    impression: cdeResult.prose.impression_prose,
    contraindications: JSON.stringify(cdeResult.treeWalkerOutput.contraindications),
    qr_code: qrPayload,
    pdf_url: `/api/v1/prescriptions/${prescriptionId}/pdf`,
  });

  // 10. Advance member status
  await db.update(members)
    .set({ status: 'prescribed', updated_at: new Date() })
    .where(eq(members.id, member.id));

  // 11. Emit events
  try {
    await emit('prescription.generated', user.id, member.clinic_id, `member:${member.id}`, {
      prescription_id: prescriptionId,
      member_id: member.id,
    });
  } catch (emitErr) {
    console.error('[Prescriptions] emit failed (non-fatal):', emitErr);
  }

  return NextResponse.json({
    data: {
      prescription_id: prescriptionId,
      status: 'generated',
      member: { id: member.id, name: member.name, status: 'prescribed' },
      qr_code: qrPayload,
      qr_code_image: qrCodeBase64,
      pdf_url: `/api/v1/prescriptions/${prescriptionId}/pdf`,
      pdf_base64: pdfBase64,
      findings: cdeResult.findings,
      treeWalkerOutput: cdeResult.treeWalkerOutput,
      eligibility: cdeResult.eligibility,
      prose: cdeResult.prose,
    },
    error: null,
  }, { status: 201 });
});
