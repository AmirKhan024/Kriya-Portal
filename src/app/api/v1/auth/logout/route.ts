import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { sessions } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifyRefreshToken } from '@/server/auth/jwt';
import { withApiHandler } from '@/server/auth/middleware';
import type { ApiResponse } from '@/types/api';

const logoutSchema = z.object({
  refresh_token: z.string(),
});

export const POST = withApiHandler(async (request) => {
  const body = await request.json();
  const parsed = logoutSchema.safeParse(body);

  if (parsed.success) {
    try {
      const { session_id } = await verifyRefreshToken(parsed.data.refresh_token);
      await db.update(sessions).set({ revoked_at: new Date() }).where(eq(sessions.id, session_id));
    } catch {
      // Idempotent — if token is invalid/expired, treat as already logged out
    }
  }

  const res: ApiResponse<{ success: boolean }> = { data: { success: true }, error: null };
  return NextResponse.json(res, { status: 200 });
});
