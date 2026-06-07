import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members, prescriptions } from '@/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin', 'trainer']);

  const memberId = context?.params?.id ?? '';

  const [member] = await db
    .select({ id: members.id, clinic_id: members.clinic_id })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

  const rxList = await db
    .select({
      id: prescriptions.id,
      status: prescriptions.status,
      created_at: prescriptions.created_at,
      sent_at: prescriptions.sent_at,
      clinician_id: prescriptions.clinician_id,
      pdf_url: prescriptions.pdf_url,
    })
    .from(prescriptions)
    .where(eq(prescriptions.member_id, memberId))
    .orderBy(desc(prescriptions.created_at));

  return NextResponse.json({ data: rxList, error: null });
});
