import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { users, user_roles, sessions, clinics } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifyInviteToken, signAccessToken, signRefreshToken } from '@/server/auth/jwt';
import { ApiError, withApiHandler } from '@/server/auth/middleware';
import { hashPassword } from '@/server/auth/passwords';
import { emit } from '@/server/db/emit';
import type { ApiResponse } from '@/types/api';
import type { UserRole } from '@/types/auth';
import { v4 as uuidv4 } from 'uuid';

const activateSchema = z.object({
  invite_token: z.string(),
  password: z.string().min(8),
});

export const POST = withApiHandler(async (request) => {
  const body = await request.json();
  const parsed = activateSchema.safeParse(body);
  if (!parsed.success) {
    const res: ApiResponse<null> = {
      data: null,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
    };
    return NextResponse.json(res, { status: 400 });
  }

  const tokenPayload = await verifyInviteToken(parsed.data.invite_token);
  const { email, clinic_id, branch_id, role } = tokenPayload;

  const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = userRows[0];

  if (!user) throw new ApiError('NOT_FOUND', 'User not found', 404);
  if (user.status !== 'invited') {
    throw new ApiError('CONFLICT', 'Account already activated, please log in', 409);
  }

  const password_hash = await hashPassword(parsed.data.password);
  const now = new Date();

  await db.update(users).set({
    password_hash,
    status: 'active',
    activated_at: now,
    updated_at: now,
  }).where(eq(users.id, user.id));

  if (role === 'clinic_admin' && clinic_id) {
    await db.update(clinics)
      .set({ status: 'active', updated_at: now })
      .where(eq(clinics.id, clinic_id));
  }

  await db.insert(user_roles).values({
    user_id: user.id,
    role: role as UserRole,
    clinic_id,
    branch_id,
  });

  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: sessionId, user_id: user.id, expires_at: expiresAt });

  const access_token = await signAccessToken({
    sub: user.id,
    clinic_id,
    branch_id,
    role: role as UserRole,
  });
  const refresh_token = await signRefreshToken(sessionId, user.id);

  await emit('user.activated', user.id, clinic_id, null, {});

  const res: ApiResponse<{
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string; name: string; role: UserRole; clinic_id: string };
  }> = {
    data: {
      access_token,
      refresh_token,
      user: { id: user.id, email: user.email, name: user.name, role: role as UserRole, clinic_id },
    },
    error: null,
  };
  return NextResponse.json(res, { status: 200 });
});
