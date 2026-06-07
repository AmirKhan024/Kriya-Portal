import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { clinics, branches, entitlements, users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError } from '@/server/auth/middleware';

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops', 'clinic_admin']);

  const clinicId = context?.params?.id ?? '';
  if (user.role === 'clinic_admin') requireSameTenant(user, clinicId);

  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
  if (!clinic) throw new ApiError('NOT_FOUND', 'Clinic not found', 404);

  const clinicBranches = await db.select().from(branches).where(eq(branches.clinic_id, clinicId));
  const [ent] = await db.select().from(entitlements).where(eq(entitlements.clinic_id, clinicId)).limit(1);
  const staffCount = await db.select({ id: users.id }).from(users).where(eq(users.clinic_id, clinicId));

  return NextResponse.json({
    data: {
      ...clinic,
      branches: clinicBranches,
      entitlements: ent ?? null,
      staff_count: staffCount.length,
    },
    error: null,
  });
});
