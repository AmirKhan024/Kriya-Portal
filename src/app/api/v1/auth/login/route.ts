import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { users, user_roles, sessions } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/server/auth/passwords';
import { signAccessToken, signRefreshToken } from '@/server/auth/jwt';
import { ApiError, withApiHandler } from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import type { ApiResponse } from '@/types/api';
import type { UserRole } from '@/types/auth';
import { v4 as uuidv4 } from 'uuid';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = withApiHandler(async (request) => {
  const body = await request.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    const res: ApiResponse<null> = {
      data: null,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
    };
    return NextResponse.json(res, { status: 400 });
  }

  const { email, password } = parsed.data;

  const INVALID_MSG = 'Invalid email or password';

  const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = userRows[0];

  if (!user || user.status !== 'active') {
    throw new ApiError('AUTH_REQUIRED', INVALID_MSG, 401);
  }

  const valid = user.password_hash
    ? await verifyPassword(password, user.password_hash)
    : false;
  if (!valid) throw new ApiError('AUTH_REQUIRED', INVALID_MSG, 401);

  const roleRows = await db.select().from(user_roles).where(eq(user_roles.user_id, user.id)).limit(1);
  const userRole = (roleRows[0]?.role ?? 'front_desk') as UserRole;

  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    id: sessionId,
    user_id: user.id,
    expires_at: expiresAt,
  });

  const access_token = await signAccessToken({
    sub: user.id,
    clinic_id: user.clinic_id ?? null,
    branch_id: user.branch_id ?? null,
    role: userRole,
  });
  const refresh_token = await signRefreshToken(sessionId, user.id);

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  try {
    await emit('user.login', user.id, user.clinic_id ?? null, null, { ip });
  } catch (emitErr) {
    console.error('[Login] emit user.login failed (non-fatal):', emitErr);
  }

  const res: ApiResponse<{
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string; name: string; role: UserRole; clinic_id: string | null };
  }> = {
    data: {
      access_token,
      refresh_token,
      user: { id: user.id, email: user.email, name: user.name, role: userRole, clinic_id: user.clinic_id ?? null },
    },
    error: null,
  };

  const ACCESS_TTL = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900);
  const response = NextResponse.json(res, { status: 200 });
  response.cookies.set('kriya_access_token', access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL,
  });
  return response;
});
