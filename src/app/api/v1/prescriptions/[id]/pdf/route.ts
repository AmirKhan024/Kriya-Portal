import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { prescriptions, clinics, users, members } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { getAuthedUser, requireRole, requireSameTenant, ApiError } from '@/server/auth/middleware';
import { generatePrescriptionPDF } from '@/server/clinical/pdf-generator';

export async function GET(
  request: Request,
  context: { params: { id: string } }
): Promise<Response> {
  try {
    const user = await getAuthedUser(request);
    requireRole(user, ['ortho', 'physio', 'clinic_admin']);

    const prescriptionId = context.params.id;
    const [prescription] = await db
      .select()
      .from(prescriptions)
      .where(eq(prescriptions.id, prescriptionId))
      .limit(1);
    if (!prescription) throw new ApiError('NOT_FOUND', 'Prescription not found', 404);

    requireSameTenant(user, prescription.clinic_id);

    if (!prescription.findings) {
      throw new ApiError('NOT_FOUND', 'Prescription findings not available', 404);
    }

    const findingsData = JSON.parse(prescription.findings);
    const [clinic]    = await db.select({ name: clinics.name, logo_url: clinics.logo_url }).from(clinics).where(eq(clinics.id, prescription.clinic_id)).limit(1);
    const [clinician] = await db.select({ name: users.name }).from(users).where(eq(users.id, user.id)).limit(1);
    const [member]    = await db.select({ name: members.name, age: members.age, mobile: members.mobile }).from(members).where(eq(members.id, prescription.member_id)).limit(1);

    const { pdfBase64 } = await generatePrescriptionPDF({
      clinicName:    clinic?.name ?? 'Kriya Clinic',
      clinicLogo:    clinic?.logo_url ?? null,
      clinicianName: clinician?.name ?? 'Clinician',
      memberName:    member?.name ?? 'Patient',
      memberAge:     member?.age ?? 30,
      memberMobile:  member?.mobile ?? '',
      prescriptionId,
      clinicId: prescription.clinic_id,
      memberId: prescription.member_id,
      cdeResult: {
        findings:         findingsData.structured,
        treeWalkerOutput: findingsData.treeWalker,
        eligibility:      findingsData.eligibility,
        prose:            findingsData.prose,
      },
      generatedAt: prescription.created_at,
    });

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="prescription-${prescriptionId}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    console.error('[PDF Error]', err);
    return NextResponse.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to generate PDF' } },
      { status: 500 }
    );
  }
}
