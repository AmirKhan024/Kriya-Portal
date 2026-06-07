import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { users, entitlements } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

const staffPatchSchema = z.object({
  status: z.enum(['active', 'suspended']),
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
  const { status } = result.data;

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
    const [ent] = await db.select().from(entitlements).where(eq(entitlements.clinic_id, clinicId)).limit(1);
    if (ent && ent.seats_used > 0) {
      await db.update(entitlements)
        .set({ seats_used: ent.seats_used - 1, updated_at: new Date() })
        .where(eq(entitlements.clinic_id, clinicId));
    }
  }

  await db.update(users).set({ status }).where(eq(users.id, userId));

  await emit('access.scope_changed', user.id, clinicId, `user:${userId}`, {
    action: status, target: userId,
  });

  return NextResponse.json({ data: { id: userId, status }, error: null });
});
