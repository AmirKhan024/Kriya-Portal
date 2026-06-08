import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { users, entitlements, member_assignments } from '@/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

const staffPatchSchema = z.object({
  status:      z.enum(['active', 'suspended']),
  reassign_to: z.string().uuid().optional(),
});

export const PATCH = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';
  const userId = context?.params?.userId ?? '';

  requireRole(user, ['ops', 'clinic_admin']);
  if (user.role === 'clinic_admin') requireSameTenant(user, clinicId);

  const rawBody = await request.json();
  const result = staffPatchSchema.safeParse(rawBody);
  if (!result.success) {
    const msg = result.error.issues?.[0]?.message ?? 'Invalid input';
    throw new ApiError('VALIDATION_ERROR', msg, 400);
  }
  const { status, reassign_to } = result.data;

  // Verify target user belongs to this clinic
  const [target] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.clinic_id, clinicId)))
    .limit(1);
  if (!target) throw new ApiError('NOT_FOUND', 'User not found in this clinic', 404);

  if (status === 'suspended' && target.status === 'suspended') {
    return NextResponse.json({ data: { id: userId, status }, error: null });
  }

  if (status === 'active') {
    // Reactivating: check seat availability
    const [ent] = await db.select().from(entitlements).where(eq(entitlements.clinic_id, clinicId)).limit(1);
    if (ent && ent.seats_used >= ent.seats_total) {
      throw new ApiError('CONFLICT', `Seat limit reached (${ent.seats_used} of ${ent.seats_total} used)`, 409);
    }
    if (ent) {
      await db.update(entitlements)
        .set({ seats_used: ent.seats_used + 1, updated_at: new Date() })
        .where(eq(entitlements.clinic_id, clinicId));
    }
  }

  if (status === 'suspended') {
    // ── Bulk reassign members before suspending ──────────────────────────────
    const openAssignments = await db
      .select({ id: member_assignments.id, member_id: member_assignments.member_id })
      .from(member_assignments)
      .where(and(
        eq(member_assignments.clinician_id, userId),
        isNull(member_assignments.ended_at),
      ));

    if (openAssignments.length > 0) {
      if (!reassign_to) {
        throw new ApiError(
          'VALIDATION_ERROR',
          `This clinician has ${openAssignments.length} active member(s). Provide reassign_to to bulk-reassign them before suspending.`,
          400
        );
      }

      // Verify reassign_to is a valid, active clinician in this clinic
      const [newClinician] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.id, reassign_to),
          eq(users.clinic_id, clinicId),
          eq(users.status, 'active'),
        ))
        .limit(1);
      if (!newClinician) {
        throw new ApiError('NOT_FOUND', 'Reassign target clinician not found or not active', 404);
      }

      // Close old assignments, open new ones
      for (const assignment of openAssignments) {
        await db.update(member_assignments)
          .set({ ended_at: new Date() })
          .where(eq(member_assignments.id, assignment.id));

        await db.insert(member_assignments).values({
          id:           crypto.randomUUID(),
          member_id:    assignment.member_id,
          clinician_id: reassign_to,
          clinic_id:    clinicId,
          started_at:   new Date(),
        });
      }

      try {
        await emit('member.assigned', user.id, clinicId, null, {
          bulk:           true,
          from_clinician: userId,
          to_clinician:   reassign_to,
          member_count:   openAssignments.length,
        });
      } catch (emitErr) {
        console.error('[StaffUser] emit member.assigned failed (non-fatal):', emitErr);
      }
    }
    // ── End bulk reassign ────────────────────────────────────────────────────

    const [ent] = await db.select().from(entitlements).where(eq(entitlements.clinic_id, clinicId)).limit(1);
    if (ent && ent.seats_used > 0) {
      await db.update(entitlements)
        .set({ seats_used: ent.seats_used - 1, updated_at: new Date() })
        .where(eq(entitlements.clinic_id, clinicId));
    }
  }

  await db.update(users).set({ status }).where(eq(users.id, userId));

  try {
    await emit('access.scope_changed', user.id, clinicId, `user:${userId}`, {
      action: status, target: userId,
    });
  } catch (emitErr) {
    console.error('[StaffUser] emit access.scope_changed failed (non-fatal):', emitErr);
  }

  return NextResponse.json({ data: { id: userId, status }, error: null });
});
