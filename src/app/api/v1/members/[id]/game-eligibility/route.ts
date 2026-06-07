import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { getGameEligibility } from '@/server/clinical/eligibility-fixture';

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

  const eligibility = await getGameEligibility(memberId, member.clinic_id);

  return NextResponse.json({ data: eligibility, error: null });
});
