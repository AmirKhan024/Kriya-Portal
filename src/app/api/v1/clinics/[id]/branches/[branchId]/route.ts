import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { branches, members } from '@/server/db/schema';
import { eq, and, count, notInArray } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';

const patchSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

export const PATCH = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId  = context?.params?.id ?? '';
  const branchId  = context?.params?.branchId ?? '';

  requireRole(user, ['ops', 'clinic_admin']);
  if (user.role !== 'ops') requireSameTenant(user, clinicId);

  const rawBody = await request.json();
  const result = patchSchema.safeParse(rawBody);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', result.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const { status } = result.data;

  // Verify branch belongs to this clinic
  const [branch] = await db
    .select({ id: branches.id, clinic_id: branches.clinic_id })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!branch || branch.clinic_id !== clinicId) {
    throw new ApiError('NOT_FOUND', 'Branch not found in this clinic', 404);
  }

  if (status === 'disabled') {
    // Block if active members exist in this branch
    const [{ c }] = await db
      .select({ c: count() })
      .from(members)
      .where(and(
        eq(members.branch_id, branchId),
        notInArray(members.status, ['discharged', 'lapsed']),
      ));
    if (Number(c) > 0) {
      throw new ApiError('CONFLICT', `Branch has ${c} active member(s). Reassign them first.`, 409);
    }
  }

  await db.update(branches)
    .set({ status })
    .where(eq(branches.id, branchId));

  const [updated] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);

  return NextResponse.json({ data: updated, error: null });
});
