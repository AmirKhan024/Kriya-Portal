import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { member_assignments, members, users } from '@/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

const postSchema = z.object({
  member_id:    z.string().uuid(),
  clinician_id: z.string().uuid(),
});

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';

  requireRole(user, ['ortho', 'physio', 'clinic_admin', 'ops']);
  if (user.role !== 'ops') requireSameTenant(user, clinicId);

  const rows = await db
    .select({
      id:              member_assignments.id,
      member_id:       member_assignments.member_id,
      member_name:     members.name,
      member_status:   members.status,
      clinician_id:    member_assignments.clinician_id,
      clinician_name:  users.name,
      started_at:      member_assignments.started_at,
    })
    .from(member_assignments)
    .leftJoin(members, eq(member_assignments.member_id, members.id))
    .leftJoin(users, eq(member_assignments.clinician_id, users.id))
    .where(and(
      eq(member_assignments.clinic_id, clinicId),
      isNull(member_assignments.ended_at),
    ))
    .orderBy(member_assignments.started_at);

  return NextResponse.json({ data: rows, error: null });
});

export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';

  requireRole(user, ['clinic_admin', 'ortho', 'physio']);
  requireSameTenant(user, clinicId);

  const rawBody = await request.json();
  const result = postSchema.safeParse(rawBody);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', result.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = result.data;

  // Verify member exists in this clinic
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, body.member_id), eq(members.clinic_id, clinicId)))
    .limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found in this clinic', 404);

  // Verify target clinician is active in this clinic
  const [clinician] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(
      eq(users.id, body.clinician_id),
      eq(users.clinic_id, clinicId),
      eq(users.status, 'active'),
    ))
    .limit(1);
  if (!clinician) throw new ApiError('NOT_FOUND', 'Target clinician not found or not active in this clinic', 404);

  // Check existing open assignment
  const [prev] = await db
    .select({ id: member_assignments.id, clinician_id: member_assignments.clinician_id })
    .from(member_assignments)
    .where(and(
      eq(member_assignments.member_id, body.member_id),
      isNull(member_assignments.ended_at),
    ))
    .limit(1);

  // Idempotent: already assigned to same clinician
  if (prev && prev.clinician_id === body.clinician_id) {
    return NextResponse.json({ data: { message: 'Already assigned to this clinician' }, error: null });
  }

  // Close previous assignment
  if (prev) {
    await db.update(member_assignments)
      .set({ ended_at: new Date() })
      .where(eq(member_assignments.id, prev.id));
  }

  // Open new assignment
  const newId = crypto.randomUUID();
  const startedAt = new Date();
  await db.insert(member_assignments).values({
    id:           newId,
    member_id:    body.member_id,
    clinician_id: body.clinician_id,
    clinic_id:    clinicId,
    started_at:   startedAt,
  });

  try {
    await emit('member.assigned', user.id, clinicId, `member:${body.member_id}`, {
      from: prev?.clinician_id ?? null,
      to:   body.clinician_id,
    });
  } catch (emitErr) {
    console.error('[Assignments] emit failed (non-fatal):', emitErr);
  }

  return NextResponse.json(
    { data: { id: newId, member_id: body.member_id, clinician_id: body.clinician_id, started_at: startedAt }, error: null },
    { status: 201 }
  );
});
