import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { users, user_roles, sessions } from '@/server/db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '@/server/auth/jwt';
import { ApiError, withApiHandler } from '@/server/auth/middleware';
import type { ApiResponse } from '@/types/api';
import type { UserRole } from '@/types/auth';
import { v4 as uuidv4 } from 'uuid';

const refreshSchema = z.object({
  refresh_token: z.string(),
});

export const POST = withApiHandler(async (request) => {
  const body = await request.json();
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    const res: ApiResponse<null> = {
      data: null,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
    };
    return NextResponse.json(res, { status: 400 });
  }

  const { session_id, sub } = await verifyRefreshToken(parsed.data.refresh_token);

  const now = new Date();
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, session_id), isNull(sessions.revoked_at), gt(sessions.expires_at, now)))
    .limit(1);

  if (!sessionRows[0]) {
    throw new ApiError('AUTH_REQUIRED', 'Session invalid or expired', 401);
  }

  const userRows = await db.select().from(users).where(eq(users.id, sub)).limit(1);
  const user = userRows[0];
  if (!user || user.status !== 'active') {
    throw new ApiError('AUTH_REQUIRED', 'User not found or inactive', 401);
  }

  const roleRows = await db.select().from(user_roles).where(eq(user_roles.user_id, user.id)).limit(1);
  const userRole = (roleRows[0]?.role ?? 'front_desk') as UserRole;

  // Rotate: revoke old session, create new one
  await db.update(sessions).set({ revoked_at: now }).where(eq(sessions.id, session_id));

  const newSessionId = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: newSessionId, user_id: user.id, expires_at: expiresAt });

  const access_token = await signAccessToken({
    sub: user.id,
    clinic_id: user.clinic_id ?? null,
    branch_id: user.branch_id ?? null,
    role: userRole,
  });
  const refresh_token = await signRefreshToken(newSessionId, user.id);

  const res: ApiResponse<{ access_token: string; refresh_token: string }> = {
    data: { access_token, refresh_token },
    error: null,
  };
  return NextResponse.json(res, { status: 200 });
});
