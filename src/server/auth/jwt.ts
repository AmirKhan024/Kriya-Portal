import { SignJWT, jwtVerify } from 'jose';
import type { JwtPayload, RefreshTokenPayload, InviteTokenPayload } from '@/types/auth';

(['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET', 'INVITE_TOKEN_SECRET'] as const).forEach((key) => {
  if (!process.env[key]) {
    console.error(`[Auth] WARNING: Missing env var ${key}. Token signing/verification will fail. Check .env.local`);
  }
});

function accessKey() {
  return new TextEncoder().encode(process.env.ACCESS_TOKEN_SECRET!);
}
function refreshKey() {
  return new TextEncoder().encode(process.env.REFRESH_TOKEN_SECRET!);
}
function inviteKey() {
  return new TextEncoder().encode(process.env.INVITE_TOKEN_SECRET!);
}

const ACCESS_TTL  = Number(process.env.ACCESS_TOKEN_TTL_SECONDS  ?? 900);
const REFRESH_TTL = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 604800);
const INVITE_TTL  = Number(process.env.INVITE_TOKEN_TTL_SECONDS  ?? 259200);

export async function signAccessToken(
  payload: Omit<JwtPayload, 'iat' | 'exp'>
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL}s`)
    .sign(accessKey());
}

export async function signRefreshToken(
  sessionId: string,
  userId: string
): Promise<string> {
  return new SignJWT({ session_id: sessionId, sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL}s`)
    .sign(refreshKey());
}

export async function signInviteToken(
  payload: Omit<InviteTokenPayload, 'iat' | 'exp'>
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${INVITE_TTL}s`)
    .sign(inviteKey());
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  try {
    const { payload } = await jwtVerify(token, accessKey());
    return payload as unknown as JwtPayload;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('expired')) throw new ApiError('TOKEN_EXPIRED', 'Access token has expired', 401);
    throw new ApiError('AUTH_REQUIRED', 'Invalid token', 401);
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, refreshKey());
    return payload as unknown as RefreshTokenPayload;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('expired')) throw new ApiError('TOKEN_EXPIRED', 'Refresh token has expired', 401);
    throw new ApiError('AUTH_REQUIRED', 'Invalid refresh token', 401);
  }
}

export async function verifyInviteToken(token: string): Promise<InviteTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, inviteKey());
    return payload as unknown as InviteTokenPayload;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('expired')) throw new ApiError('TOKEN_EXPIRED', 'Invite token has expired', 401);
    throw new ApiError('AUTH_REQUIRED', 'Invalid invite token', 401);
  }
}

export function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}

// Inline ApiError to avoid circular import with middleware.ts
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
