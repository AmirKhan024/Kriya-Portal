import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { clinics, entitlements, subscriptions, branches, members } from '@/server/db/schema';
import { eq, asc, count } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';

const patchSchema = z.object({
  name:     z.string().min(2).max(100).optional(),
  logo_url: z.string().url().nullable().optional(),
  city:     z.string().min(2).max(50).optional(),
  type:     z.enum(['physio', 'ortho', 'sports', 'general']).optional(),
});

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';

  requireRole(user, ['ops', 'clinic_admin', 'ortho', 'physio', 'trainer', 'front_desk']);
  if (user.role !== 'ops') requireSameTenant(user, clinicId);

  const [clinic] = await db
    .select({
      id:         clinics.id,
      name:       clinics.name,
      city:       clinics.city,
      type:       clinics.type,
      status:     clinics.status,
      logo_url:   clinics.logo_url,
      created_at: clinics.created_at,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinic) throw new ApiError('NOT_FOUND', 'Clinic not found', 404);

  const [ent] = await db.select().from(entitlements).where(eq(entitlements.clinic_id, clinicId)).limit(1);
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.clinic_id, clinicId)).limit(1);
  const clinicBranches = await db
    .select({ id: branches.id, name: branches.name, address: branches.address, status: branches.status })
    .from(branches)
    .where(eq(branches.clinic_id, clinicId))
    .orderBy(asc(branches.created_at));

  // Optional member count when ?includeStats=true
  const url = new URL(request.url);
  let member_count: number | undefined;
  if (url.searchParams.get('includeStats') === 'true') {
    const [{ c }] = await db
      .select({ c: count() })
      .from(members)
      .where(eq(members.clinic_id, clinicId));
    member_count = Number(c);
  }

  return NextResponse.json({
    data: {
      clinic,
      entitlements: ent
        ? {
            move:            ent.move,
            quick_scan:      ent.quick_scan,
            deep_scan:       ent.deep_scan,
            care_programs:   ent.care_programs,
            pain_gating:     ent.pain_gating,
            custom_branding: ent.custom_branding,
            iot:             ent.iot,
            seats_total:     ent.seats_total,
            seats_used:      ent.seats_used,
            member_cap:      ent.member_cap,
            plan:            ent.plan,
          }
        : null,
      subscription: sub
        ? {
            plan:               sub.plan,
            status:             sub.status,
            current_period_end: sub.current_period_end,
          }
        : null,
      branches: clinicBranches,
      ...(member_count !== undefined ? { member_count } : {}),
    },
    error: null,
  });
});

export const PATCH = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';

  requireRole(user, ['clinic_admin']);
  requireSameTenant(user, clinicId);

  const rawBody = await request.json();
  const result = patchSchema.safeParse(rawBody);
  if (!result.success) {
    throw new ApiError('VALIDATION_ERROR', result.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  // Build update object with only provided fields
  const updates: Partial<{ name: string; logo_url: string | null; city: string; type: string; updated_at: Date }> = {};
  if (result.data.name !== undefined)     updates.name     = result.data.name;
  if (result.data.logo_url !== undefined) updates.logo_url = result.data.logo_url;
  if (result.data.city !== undefined)     updates.city     = result.data.city;
  if (result.data.type !== undefined)     updates.type     = result.data.type;
  updates.updated_at = new Date();

  await db.update(clinics).set(updates).where(eq(clinics.id, clinicId));

  const [updated] = await db
    .select({
      id:         clinics.id,
      name:       clinics.name,
      city:       clinics.city,
      type:       clinics.type,
      status:     clinics.status,
      logo_url:   clinics.logo_url,
      created_at: clinics.created_at,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  return NextResponse.json({ data: updated, error: null });
});
