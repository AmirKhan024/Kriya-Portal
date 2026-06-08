import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { clinics, branches, entitlements, subscriptions, users } from '@/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { signInviteToken } from '@/server/auth/jwt';
import { emit } from '@/server/db/emit';

const provisionSchema = z.object({
  name: z.string().min(2).max(100),
  city: z.string().min(2).max(50),
  type: z.enum(['physio', 'ortho', 'sports', 'general']),
  branches: z.array(z.object({
    name: z.string().min(1).max(100),
    address: z.string().optional(),
  })).min(1),
  seats_total: z.number().int().min(1).max(500),
  member_cap: z.number().int().min(10),
  plan: z.enum(['move', 'move_scan', 'full_suite']),
  entitlements: z.object({
    move: z.boolean(),
    quick_scan: z.boolean(),
    deep_scan: z.boolean(),
    care_programs: z.boolean(),
    pain_gating: z.boolean(),
    custom_branding: z.boolean(),
    iot: z.boolean(),
  }),
  admin_name: z.string().min(1).max(100),
  admin_email: z.string().email(),
});

export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops']);

  const rawBody = await request.json();
  const result = provisionSchema.safeParse(rawBody);
  if (!result.success) {
    const msg = result.error.issues?.[0]?.message ?? 'Invalid input';
    throw new ApiError('VALIDATION_ERROR', msg, 400);
  }
  const body = result.data;

  // Clinic name must be unique per city
  const existing = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(and(eq(clinics.name, body.name), eq(clinics.city, body.city)))
    .limit(1);
  if (existing[0]) {
    throw new ApiError('CONFLICT', 'A clinic with this name already exists in this city', 409);
  }

  // Admin email must not already exist
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, body.admin_email))
    .limit(1);
  if (existingUser[0]) {
    throw new ApiError('CONFLICT', 'A user with this email already exists', 409);
  }

  const clinicId = crypto.randomUUID();

  await db.insert(clinics).values({
    id: clinicId,
    name: body.name,
    city: body.city,
    type: body.type,
    status: 'pending_setup',
  });

  // Insert branches; capture first branch ID for admin user
  const branchIds: string[] = [];
  for (const branch of body.branches) {
    const branchId = crypto.randomUUID();
    branchIds.push(branchId);
    await db.insert(branches).values({
      id: branchId,
      clinic_id: clinicId,
      name: branch.name,
      address: branch.address ?? null,
    });
  }
  const firstBranchId = branchIds[0]!;

  await db.insert(entitlements).values({
    clinic_id: clinicId,
    move: body.entitlements.move,
    quick_scan: body.entitlements.quick_scan,
    deep_scan: body.entitlements.deep_scan,
    care_programs: body.entitlements.care_programs,
    pain_gating: body.entitlements.pain_gating,
    custom_branding: body.entitlements.custom_branding,
    iot: body.entitlements.iot,
    seats_total: body.seats_total,
    seats_used: 0,
    member_cap: body.member_cap,
    plan: body.plan,
  });

  await db.insert(subscriptions).values({
    clinic_id: clinicId,
    razorpay_sub_id: null,
    plan: body.plan,
    status: 'active',
  });

  const adminId = crypto.randomUUID();
  await db.insert(users).values({
    id: adminId,
    clinic_id: clinicId,
    branch_id: firstBranchId,
    email: body.admin_email,
    name: body.admin_name,
    status: 'invited',
  });

  const invite_token = await signInviteToken({
    email: body.admin_email,
    clinic_id: clinicId,
    branch_id: firstBranchId,
    role: 'clinic_admin',
  });

  await db.update(entitlements)
    .set({ seats_used: 1 })
    .where(eq(entitlements.clinic_id, clinicId));

  try {
    await emit('clinic.provisioned', user.id, clinicId, `clinic:${clinicId}`, {
      name: body.name, city: body.city,
    });
    await emit('user.invited', user.id, clinicId, `user:${adminId}`, {
      email: body.admin_email, role: 'clinic_admin',
    });
  } catch (emitErr) {
    console.error('[Clinics] emit failed (non-fatal):', emitErr);
  }

  return NextResponse.json({
    data: {
      clinic: { id: clinicId, name: body.name, city: body.city, type: body.type, status: 'pending_setup' },
      invite_link: `/clinic/invite-activate?token=${invite_token}`,
      invite_token,
    },
    error: null,
  }, { status: 201 });
});

export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops']);

  const clinicList = await db.select().from(clinics).orderBy(desc(clinics.created_at));
  const allEntitlements = await db.select().from(entitlements);
  const entMap = new Map(allEntitlements.map(e => [e.clinic_id, e]));

  const data = clinicList.map(c => ({
    ...c,
    entitlements: entMap.get(c.id) ?? null,
  }));

  return NextResponse.json({ data, error: null });
});
