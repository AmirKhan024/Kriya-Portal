import { NextResponse } from 'next/server';
import { signAccessToken } from '@/server/auth/jwt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/cron/nudges — Vercel Cron entry-point for inactivity nudges.
 *
 * Vercel Cron sends GET with `Authorization: Bearer <CRON_SECRET>`. This route
 * validates that secret, mints a short-lived ops JWT, then calls the existing
 * POST /api/v1/nudges/auto-scan?execute=true so all real logic lives in one place.
 *
 * Schedule (vercel.json): twice daily at 09:00 and 18:00 UTC — "0 9,18 * * *"
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ data: null, error: { code: 'AUTH_REQUIRED', message: 'Unauthorized' } }, { status: 401 });
  }

  const token = await signAccessToken({
    sub: '00000000-0000-0000-0000-000000000000',
    role: 'ops',
    clinic_id: null,
    branch_id: null,
  });

  const host = request.headers.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const res = await fetch(`${protocol}://${host}/api/v1/nudges/auto-scan?execute=true`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });

  const body = await res.json().catch(() => null);
  return NextResponse.json(body ?? { data: null, error: { code: 'UPSTREAM_ERROR', message: 'auto-scan failed' } }, { status: res.status });
}
