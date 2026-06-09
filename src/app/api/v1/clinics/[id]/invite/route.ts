import { NextResponse } from 'next/server';
import { z } from 'zod';
import { uuidish } from '@/server/validation';
import { db } from '@/server/db';
import { branches, entitlements, users } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { signInviteToken } from '@/server/auth/jwt';
import { emit } from '@/server/db/emit';

const inviteSchema = z.object({
  name:      z.string().min(1).max(100),
  email:     z.string().email(),
  role:      z.enum(['clinic_admin', 'ortho', 'physio', 'trainer', 'front_desk']),
  branch_id: uuidish,
});

export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';

  requireRole(user, ['ops', 'clinic_admin']);
  if (user.role === 'clinic_admin') requireSameTenant(user, clinicId);

  const rawBody = await request.json();
  const result = inviteSchema.safeParse(rawBody);
  if (!result.success) {
    const msg = result.error.issues?.[0]?.message ?? 'Invalid input';
    throw new ApiError('VALIDATION_ERROR', msg, 400);
  }
  const body = result.data;

  // Verify branch belongs to this clinic
  const [branch] = await db.select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, body.branch_id), eq(branches.clinic_id, clinicId)))
    .limit(1);
  if (!branch) throw new ApiError('NOT_FOUND', 'Branch not found in this clinic', 404);

  // Seat check
  const [ent] = await db.select().from(entitlements).where(eq(entitlements.clinic_id, clinicId)).limit(1);
  if (!ent) throw new ApiError('NOT_FOUND', 'Clinic not found', 404);
  if (ent.seats_used >= ent.seats_total) {
    throw new ApiError(
      'CONFLICT',
      `Seat limit reached (${ent.seats_used} of ${ent.seats_total} used)`,
      409,
    );
  }

  // Email uniqueness within clinic
  const [existingUser] = await db.select({ id: users.id, status: users.status })
    .from(users)
    .where(and(eq(users.email, body.email), eq(users.clinic_id, clinicId)))
    .limit(1);
  if (existingUser) {
    const msg = existingUser.status === 'invited'
      ? 'An invite for this email is already pending'
      : 'A user with this email already exists in this clinic';
    throw new ApiError('CONFLICT', msg, 409);
  }

  const newUserId = crypto.randomUUID();
  await db.insert(users).values({
    id: newUserId,
    clinic_id: clinicId,
    branch_id: body.branch_id,
    email: body.email,
    name: body.name,
    status: 'invited',
  });

  const invite_token = await signInviteToken({
    email: body.email,
    clinic_id: clinicId,
    branch_id: body.branch_id,
    role: body.role,
  });

  await db.update(entitlements)
    .set({ seats_used: ent.seats_used + 1, updated_at: new Date() })
    .where(eq(entitlements.clinic_id, clinicId));

  try {
    await emit('user.invited', user.id, clinicId, `user:${newUserId}`, {
      email: body.email, role: body.role,
    });
  } catch (emitErr) {
    console.error('[Invite] emit user.invited failed (non-fatal):', emitErr);
  }

  return NextResponse.json({
    data: {
      user: { id: newUserId, email: body.email, name: body.name, status: 'invited' },
      invite_link: `/clinic/invite-activate?token=${invite_token}`,
      invite_token,
      seats: { used: ent.seats_used + 1, total: ent.seats_total },
    },
    error: null,
  }, { status: 201 });
});
