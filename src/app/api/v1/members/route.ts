import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import {
  members, consents, member_assignments, pain_flags, users, branches,
} from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import type { UserRole } from '@/types/auth';
import { createMemberSchema } from '@/modules/members/schemas';
import { MEMBER_CREATE_ROLES } from '@/modules/members/constants';
import { deriveSegment, normalizeMobile, painMapToRows } from '@/modules/members/logic';

/**
 * POST /api/v1/members — feature 1b · Add Member.
 *
 * Creates a member (status `new`), auto-assigns to the creating/selected clinician,
 * optionally records a quick pain map and consent. Mobile is the identity key:
 * a duplicate within the same clinic returns 409 (with the existing id in `meta`)
 * unless `allow_duplicate` is set — never a silent duplicate.
 */
export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...MEMBER_CREATE_ROLES] as UserRole[]);
  if (!user.clinic_id) {
    throw new ApiError('FORBIDDEN', 'User is not attached to a clinic', 403);
  }
  const clinicId = user.clinic_id;

  const raw = await request.json();
  const parsed = createMemberSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message ?? 'Invalid input';
    throw new ApiError('VALIDATION_ERROR', msg, 400);
  }
  const body = parsed.data;
  const mobile = normalizeMobile(body.mobile);

  // Duplicate mobile within the clinic → 409 unless explicitly overridden.
  const dup = await db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(and(eq(members.clinic_id, clinicId), eq(members.mobile, mobile)))
    .limit(1);
  if (dup[0] && !body.allow_duplicate) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'CONFLICT',
          message: 'A member with this mobile already exists in this clinic',
        },
        meta: { existing_member_id: dup[0].id },
      },
      { status: 409 },
    );
  }

  // Resolve & tenant-check the clinician to assign to (defaults to creator).
  const clinicianId = body.clinician_id ?? user.id;
  if (body.clinician_id) {
    const clinician = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, body.clinician_id), eq(users.clinic_id, clinicId)))
      .limit(1);
    if (!clinician[0]) {
      throw new ApiError('VALIDATION_ERROR', 'Assigned clinician is not in this clinic', 400);
    }
  }

  // Resolve & tenant-check branch (defaults to the creator's branch).
  let branchId: string | null = user.branch_id ?? null;
  if (body.branch_id) {
    const branch = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, body.branch_id), eq(branches.clinic_id, clinicId)))
      .limit(1);
    if (!branch[0]) {
      throw new ApiError('VALIDATION_ERROR', 'Branch is not in this clinic', 400);
    }
    branchId = body.branch_id;
  }

  const segment = deriveSegment(body);
  const memberId = crypto.randomUUID();

  // Sequential writes (matches the provisioning route's style in this codebase).
  await db.insert(members).values({
    id: memberId,
    clinic_id: clinicId,
    branch_id: branchId,
    mobile,
    name: body.name,
    age: body.age ?? null,
    sex: body.sex ?? null,
    segment,
    status: 'new',
    complaint: body.complaint ?? null,
  });

  await db.insert(member_assignments).values({
    member_id: memberId,
    clinician_id: clinicianId,
    clinic_id: clinicId,
  });

  const painRows = painMapToRows(memberId, clinicId, user.id, body.pain_map);
  if (painRows.length > 0) {
    await db.insert(pain_flags).values(painRows);
  }

  let consentCaptured = false;
  if (body.consent) {
    await db.insert(consents).values({
      member_id: memberId,
      clinic_id: clinicId,
      type: body.consent.type,
      method: body.consent.method,
    });
    consentCaptured = true;
  }

  // Events — one per meaningful action (audit + analytics + automation).
  await emit('member.created', user.id, clinicId, `member:${memberId}`, {
    name: body.name, segment,
  });
  await emit('member.assigned', user.id, clinicId, `member:${memberId}`, {
    clinician_id: clinicianId,
  });
  if (painRows.length > 0) {
    await emit('painflag.set', user.id, clinicId, `member:${memberId}`, {
      regions: painRows.map((p) => p.region),
    });
  }
  if (consentCaptured) {
    await emit('member.consented', user.id, clinicId, `member:${memberId}`, {
      type: body.consent!.type, method: body.consent!.method,
    });
  }

  return NextResponse.json(
    {
      data: {
        member: {
          id: memberId,
          clinic_id: clinicId,
          branch_id: branchId,
          name: body.name,
          mobile,
          age: body.age ?? null,
          sex: body.sex ?? null,
          segment,
          status: 'new',
          complaint: body.complaint ?? null,
        },
        assigned_clinician_id: clinicianId,
        consent_captured: consentCaptured,
        pain_flags_count: painRows.length,
      },
      error: null,
    },
    { status: 201 },
  );
});
