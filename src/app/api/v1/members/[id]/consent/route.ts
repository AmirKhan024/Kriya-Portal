import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members, consents } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import type { UserRole } from '@/types/auth';
import { consentInputSchema } from '@/modules/members/schemas';
import { MEMBER_CREATE_ROLES } from '@/modules/members/constants';

/**
 * POST /api/v1/members/:id/consent — feature 1b · capture consent.
 *
 * Consent is mandatory before any clinical action. Same roles as Add Member may
 * capture it (clinic_admin, ortho, physio, front_desk).
 */
export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...MEMBER_CREATE_ROLES] as UserRole[]);
  if (!user.clinic_id) {
    throw new ApiError('FORBIDDEN', 'User is not attached to a clinic', 403);
  }
  const memberId = context?.params?.id ?? '';

  const raw = await request.json();
  const parsed = consentInputSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message ?? 'Invalid input';
    throw new ApiError('VALIDATION_ERROR', msg, 400);
  }
  const body = parsed.data;

  // Member must exist and belong to the caller's clinic.
  const rows = await db
    .select({ id: members.id, clinic_id: members.clinic_id })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  const member = rows[0];
  if (!member || member.clinic_id !== user.clinic_id) {
    throw new ApiError('NOT_FOUND', 'Member not found', 404);
  }

  const consentId = crypto.randomUUID();
  await db.insert(consents).values({
    id: consentId,
    member_id: memberId,
    clinic_id: user.clinic_id,
    type: body.type,
    method: body.method,
  });

  await emit('member.consented', user.id, user.clinic_id, `member:${memberId}`, {
    type: body.type, method: body.method,
  });

  return NextResponse.json(
    {
      data: { consent: { id: consentId, member_id: memberId, type: body.type, method: body.method } },
      error: null,
    },
    { status: 201 },
  );
});
