import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members, member_assignments, users } from '@/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { assignmentInputSchema } from '@/modules/members/schemas';

/**
 * POST /api/v1/members/:id/assignments — feature 1b · (re)assign a member.
 *
 * Admin action (clinic_admin / ops). Closes the current open assignment and opens a
 * new one (full history retained). Cross-clinic assignment is impossible.
 */
export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops', 'clinic_admin']);
  if (!user.clinic_id && user.role !== 'ops') {
    throw new ApiError('FORBIDDEN', 'User is not attached to a clinic', 403);
  }
  const memberId = context?.params?.id ?? '';

  const raw = await request.json();
  const parsed = assignmentInputSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message ?? 'Invalid input';
    throw new ApiError('VALIDATION_ERROR', msg, 400);
  }
  const { clinician_id } = parsed.data;

  // Member must exist and belong to the caller's clinic (ops is platform-wide).
  const rows = await db
    .select({ id: members.id, clinic_id: members.clinic_id })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  const member = rows[0];
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  if (user.role !== 'ops' && member.clinic_id !== user.clinic_id) {
    throw new ApiError('NOT_FOUND', 'Member not found', 404);
  }
  const clinicId = member.clinic_id;

  // New clinician must be in the same clinic (no cross-tenant assignment).
  const clinician = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, clinician_id), eq(users.clinic_id, clinicId)))
    .limit(1);
  if (!clinician[0]) {
    throw new ApiError('VALIDATION_ERROR', 'Clinician is not in this clinic', 400);
  }

  // Close the current open assignment(s), then open the new one.
  await db.update(member_assignments)
    .set({ ended_at: new Date() })
    .where(and(eq(member_assignments.member_id, memberId), isNull(member_assignments.ended_at)));

  const assignmentId = crypto.randomUUID();
  await db.insert(member_assignments).values({
    id: assignmentId,
    member_id: memberId,
    clinician_id,
    clinic_id: clinicId,
  });

  await emit('member.assigned', user.id, clinicId, `member:${memberId}`, { clinician_id });
  await emit('access.scope_changed', user.id, clinicId, `member:${memberId}`, {
    clinician_id, action: 'reassigned',
  });

  return NextResponse.json(
    {
      data: { assignment: { id: assignmentId, member_id: memberId, clinician_id } },
      error: null,
    },
    { status: 201 },
  );
});
