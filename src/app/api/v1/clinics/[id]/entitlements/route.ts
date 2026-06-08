import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { entitlements } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError, invalidateEntitlementCache,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

const entitlementsSchema = z.object({
  move:            z.boolean().optional(),
  quick_scan:      z.boolean().optional(),
  deep_scan:       z.boolean().optional(),
  care_programs:   z.boolean().optional(),
  pain_gating:     z.boolean().optional(),
  custom_branding: z.boolean().optional(),
  iot:             z.boolean().optional(),
  seats_total:     z.number().int().min(1).optional(),
  member_cap:      z.number().int().min(10).optional(),
  plan:            z.enum(['move', 'move_scan', 'full_suite']).optional(),
});

export const PATCH = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops']);

  const clinicId = context?.params?.id ?? '';

  const rawBody = await request.json();
  const result = entitlementsSchema.safeParse(rawBody);
  if (!result.success) {
    const msg = result.error.issues?.[0]?.message ?? 'Invalid input';
    throw new ApiError('VALIDATION_ERROR', msg, 400);
  }
  const body = result.data;

  const [current] = await db.select().from(entitlements).where(eq(entitlements.clinic_id, clinicId)).limit(1);
  if (!current) throw new ApiError('NOT_FOUND', 'Clinic not found', 404);

  if (body.seats_total !== undefined && body.seats_total < current.seats_used) {
    throw new ApiError(
      'CONFLICT',
      `Cannot reduce seats below current usage (${current.seats_used} seats in use)`,
      409,
    );
  }

  // Remove undefined values before updating
  const updates = Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;

  await db.update(entitlements)
    .set({ ...updates, updated_at: new Date() })
    .where(eq(entitlements.clinic_id, clinicId));

  invalidateEntitlementCache(clinicId);

  try {
    await emit('entitlement.changed', user.id, clinicId, `clinic:${clinicId}`, {
      before: current,
      after: { ...current, ...updates },
    });
  } catch (emitErr) {
    console.error('[Entitlements] emit failed (non-fatal):', emitErr);
  }

  const [updated] = await db.select().from(entitlements).where(eq(entitlements.clinic_id, clinicId)).limit(1);

  return NextResponse.json({ data: updated, error: null });
});
