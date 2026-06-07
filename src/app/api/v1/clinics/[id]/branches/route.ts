import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { branches } from '@/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';

const postSchema = z.object({
  name:    z.string().min(1).max(100),
  address: z.string().optional(),
});

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';

  requireRole(user, ['ops', 'clinic_admin', 'ortho', 'physio', 'trainer', 'front_desk']);
  if (user.role !== 'ops') requireSameTenant(user, clinicId);

  const rows = await db
    .select({
      id:         branches.id,
      name:       branches.name,
      address:    branches.address,
      status:     branches.status,
      created_at: branches.created_at,
    })
    .from(branches)
    .where(eq(branches.clinic_id, clinicId))
    .orderBy(asc(branches.created_at));

  return NextResponse.json({ data: rows, error: null });
});

export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';

  requireRole(user, ['ops', 'clinic_admin']);
  if (user.role !== 'ops') requireSameTenant(user, clinicId);

  const rawBody = await request.json();
  const result = postSchema.safeParse(rawBody);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', result.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const id = crypto.randomUUID();
  await db.insert(branches).values({
    id,
    clinic_id: clinicId,
    name:      result.data.name,
    address:   result.data.address,
    status:    'active',
  });

  const [newBranch] = await db.select().from(branches).where(eq(branches.id, id)).limit(1);

  return NextResponse.json({ data: newBranch, error: null }, { status: 201 });
});
