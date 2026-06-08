import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { member_assignments, members, users } from '@/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

const patchSchema = z.object({
  clinician_id: z.string().uuid(),
});

export const PATCH = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId  = context?.params?.id ?? '';
  const memberId  = context?.params?.memberId ?? '';

  requireRole(user, ['clinic_admin']);
  requireSameTenant(user, clinicId);

  const rawBody = await request.json();
  const result = patchSchema.safeParse(rawBody);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', result.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const { clinician_id } = result.data;

  // Verify member exists in this clinic
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.clinic_id, clinicId)))
    .limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found in this clinic', 404);

  // Verify target clinician
  const [clinician] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(
      eq(users.id, clinician_id),
      eq(users.clinic_id, clinicId),
      eq(users.status, 'active'),
    ))
    .limit(1);
  if (!clinician) throw new ApiError('NOT_FOUND', 'Target clinician not found or not active in this clinic', 404);

  // Close existing open assignment
  const [prev] = await db
    .select({ id: member_assignments.id, clinician_id: member_assignments.clinician_id })
    .from(member_assignments)
    .where(and(eq(member_assignments.member_id, memberId), isNull(member_assignments.ended_at)))
    .limit(1);

  if (prev && prev.clinician_id === clinician_id) {
    return NextResponse.json({ data: { message: 'Already assigned to this clinician' }, error: null });
  }

  if (prev) {
    await db.update(member_assignments)
      .set({ ended_at: new Date() })
      .where(eq(member_assignments.id, prev.id));
  }

  const newId = crypto.randomUUID();
  const startedAt = new Date();
  await db.insert(member_assignments).values({
    id:           newId,
    member_id:    memberId,
    clinician_id: clinician_id,
    clinic_id:    clinicId,
    started_at:   startedAt,
  });

  try {
    await emit('member.assigned', user.id, clinicId, `member:${memberId}`, {
      from: prev?.clinician_id ?? null,
      to:   clinician_id,
    });
  } catch (emitErr) {
    console.error('[MemberAssignment] emit failed (non-fatal):', emitErr);
  }

  return NextResponse.json({
    data: { id: newId, member_id: memberId, clinician_id, started_at: startedAt },
    error: null,
  });
});

export const DELETE = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';
  const memberId = context?.params?.memberId ?? '';

  requireRole(user, ['clinic_admin']);
  requireSameTenant(user, clinicId);

  const [existing] = await db
    .select({ id: member_assignments.id })
    .from(member_assignments)
    .where(and(
      eq(member_assignments.member_id, memberId),
      isNull(member_assignments.ended_at),
    ))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ data: { message: 'No active assignment' }, error: null });
  }

  await db.update(member_assignments)
    .set({ ended_at: new Date() })
    .where(eq(member_assignments.id, existing.id));

  try {
    await emit('member.assigned', user.id, clinicId, `member:${memberId}`, { action: 'unassigned' });
  } catch (emitErr) {
    console.error('[MemberAssignment] emit failed (non-fatal):', emitErr);
  }

  return NextResponse.json({ data: { ended: true }, error: null });
});
