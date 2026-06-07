import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { prescriptions } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin', 'trainer']);

  const prescriptionId = context?.params?.id ?? '';
  const [prescription] = await db
    .select()
    .from(prescriptions)
    .where(eq(prescriptions.id, prescriptionId))
    .limit(1);
  if (!prescription) throw new ApiError('NOT_FOUND', 'Prescription not found', 404);

  requireSameTenant(user, prescription.clinic_id);

  const findingsParsed = prescription.findings
    ? JSON.parse(prescription.findings)
    : null;
  const contraindicationsParsed = prescription.contraindications
    ? JSON.parse(prescription.contraindications)
    : [];

  return NextResponse.json({
    data: {
      ...prescription,
      findings_parsed: findingsParsed,
      contraindications_parsed: contraindicationsParsed,
    },
    error: null,
  });
});
