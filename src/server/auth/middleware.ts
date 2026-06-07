import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { entitlements } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifyAccessToken, extractBearerToken, ApiError } from './jwt';
import type { AuthedUser, UserRole } from '@/types/auth';
import type { ApiResponse } from '@/types/api';

export { ApiError };

export type EntitlementModule =
  | 'move' | 'quick_scan' | 'deep_scan' | 'care_programs'
  | 'pain_gating' | 'custom_branding' | 'iot';

// In-memory entitlement cache (TTL 60s)
const entitlementCache = new Map<string, { data: Record<string, boolean>; fetchedAt: number }>();
const CACHE_TTL_MS = 60_000;

export function invalidateEntitlementCache(clinicId: string): void {
  entitlementCache.delete(clinicId);
}

export async function getAuthedUser(request: Request): Promise<AuthedUser> {
  const header = request.headers.get('Authorization');
  const token = extractBearerToken(header);
  if (!token) throw new ApiError('AUTH_REQUIRED', 'Missing bearer token', 401);
  const payload = await verifyAccessToken(token);
  return {
    id: payload.sub,
    clinic_id: payload.clinic_id,
    branch_id: payload.branch_id,
    role: payload.role,
  };
}

export function requireRole(user: AuthedUser, allowed: UserRole[]): void {
  if (!allowed.includes(user.role)) {
    throw new ApiError('FORBIDDEN', 'Insufficient role', 403);
  }
}

export function requireSameTenant(user: AuthedUser, resourceClinicId: string): void {
  if (user.role === 'ops') return;
  if (user.clinic_id !== resourceClinicId) {
    throw new ApiError('TENANT_MISMATCH', 'Access denied', 403);
  }
}

export async function requireEntitlement(
  clinicId: string,
  module: EntitlementModule
): Promise<void> {
  const cached = entitlementCache.get(clinicId);
  const now = Date.now();

  let data: Record<string, boolean>;
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    data = cached.data;
  } else {
    const row = await db.select().from(entitlements).where(eq(entitlements.clinic_id, clinicId)).limit(1);
    if (!row[0]) throw new ApiError('ENTITLEMENT_REQUIRED', 'Clinic not found', 404);
    data = row[0] as unknown as Record<string, boolean>;
    entitlementCache.set(clinicId, { data, fetchedAt: now });
  }

  if (!data[module]) {
    throw new ApiError('ENTITLEMENT_REQUIRED', `Module ${module} not enabled`, 403);
  }
}

export function withApiHandler(
  handler: (request: Request, context?: { params: Record<string, string> }) => Promise<NextResponse>
) {
  return async (
    request: Request,
    context?: { params: Record<string, string> }
  ): Promise<NextResponse> => {
    try {
      return await handler(request, context);
    } catch (err) {
      if (err instanceof ApiError) {
        const body: ApiResponse<null> = {
          data: null,
          error: { code: err.code, message: err.message },
        };
        return NextResponse.json(body, { status: err.status });
      }
      console.error('[API Error]', err);
      const body: ApiResponse<null> = {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      };
      return NextResponse.json(body, { status: 500 });
    }
  };
}
