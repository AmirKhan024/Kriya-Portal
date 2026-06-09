import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import {
  members, consents, member_assignments, pain_flags, users, branches, assessments, activity_sessions,
} from '@/server/db/schema';
import { and, eq, inArray, isNull, ilike, or, gte, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import type { UserRole } from '@/types/auth';
import { createMemberSchema } from '@/modules/members/schemas';
import { MEMBER_CREATE_ROLES } from '@/modules/members/constants';
import { deriveSegment, normalizeMobile, painMapToRows } from '@/modules/members/logic';
import {
  computeAdherence, deriveRisk, isAdherenceTracked, ADHERENCE_WINDOW_DAYS,
} from '@/modules/members/risk';

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

/**
 * GET /api/v1/members — feature 1f · member cockpit list.
 *
 * RLS-scoped: ops/clinic_admin/front_desk see all members in their clinic; ortho/
 * physio/trainer see only members actively assigned to them. Filters: status, segment,
 * branch_id, risk (new|flagged|low_adherence), q (name/mobile). Each row carries latest
 * Musculage, computed adherence, and an at-risk flag + reason.
 */
const MEMBER_VIEW_ALL_ROLES = ['ops', 'clinic_admin', 'front_desk'];

export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'User is not attached to a clinic', 403);
  const clinicId = user.clinic_id;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || undefined;
  const segment = url.searchParams.get('segment') || undefined;
  const branchId = url.searchParams.get('branch_id') || undefined;
  const risk = url.searchParams.get('risk') || undefined; // new | flagged | low_adherence
  const q = url.searchParams.get('q')?.trim() || undefined;

  const conds = [eq(members.clinic_id, clinicId)];
  if (status) conds.push(eq(members.status, status));
  if (segment) conds.push(eq(members.segment, segment));
  if (branchId) conds.push(eq(members.branch_id, branchId));
  if (risk === 'new') conds.push(eq(members.status, 'new'));
  if (q) conds.push(or(ilike(members.name, `%${q}%`), ilike(members.mobile, `%${q}%`))!);

  // Assignment scope for clinical (non-admin) roles.
  if (!MEMBER_VIEW_ALL_ROLES.includes(user.role)) {
    const assigned = await db
      .select({ member_id: member_assignments.member_id })
      .from(member_assignments)
      .where(and(
        eq(member_assignments.clinic_id, clinicId),
        eq(member_assignments.clinician_id, user.id),
        isNull(member_assignments.ended_at),
      ));
    const scopedIds = assigned.map((a) => a.member_id);
    if (scopedIds.length === 0) return NextResponse.json({ data: [], error: null, meta: { total: 0 } });
    conds.push(inArray(members.id, scopedIds));
  }

  const rows = await db.select().from(members).where(and(...conds)).orderBy(desc(members.created_at));
  if (rows.length === 0) return NextResponse.json({ data: [], error: null, meta: { total: 0 } });
  const ids = rows.map((r) => r.id);

  // Latest completed assessment musculage per member.
  const assess = await db
    .select({ member_id: assessments.member_id, musculage: assessments.musculage, completed_at: assessments.completed_at })
    .from(assessments)
    .where(and(inArray(assessments.member_id, ids), eq(assessments.status, 'completed')))
    .orderBy(desc(assessments.completed_at));
  const latestMusculage = new Map<string, number | null>();
  for (const a of assess) if (!latestMusculage.has(a.member_id)) latestMusculage.set(a.member_id, a.musculage ?? null);

  // Active acute-high pain flags.
  const flags = await db
    .select({ member_id: pain_flags.member_id, severity: pain_flags.severity, type: pain_flags.type })
    .from(pain_flags)
    .where(and(inArray(pain_flags.member_id, ids), eq(pain_flags.active, 'true')));
  const acuteHigh = new Set<string>();
  for (const f of flags) if (f.type === 'acute' && f.severity >= 5) acuteHigh.add(f.member_id);

  // Activity sessions in the adherence window.
  const cutoff = new Date(Date.now() - ADHERENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const acts = await db
    .select({ member_id: activity_sessions.member_id, completed_at: activity_sessions.completed_at })
    .from(activity_sessions)
    .where(and(inArray(activity_sessions.member_id, ids), gte(activity_sessions.completed_at, cutoff)));
  const counts = new Map<string, number>();
  const lastActivity = new Map<string, Date>();
  for (const s of acts) {
    counts.set(s.member_id, (counts.get(s.member_id) ?? 0) + 1);
    const prev = lastActivity.get(s.member_id);
    if (!prev || s.completed_at > prev) lastActivity.set(s.member_id, s.completed_at);
  }

  const now = Date.now();
  let data = rows.map((m) => {
    const tracked = isAdherenceTracked(m.status);
    const adherence = computeAdherence(counts.get(m.id) ?? 0, tracked);
    const last = lastActivity.get(m.id);
    const daysSinceActivity = last ? Math.floor((now - last.getTime()) / (24 * 60 * 60 * 1000)) : null;
    const { atRisk, reason } = deriveRisk({ status: m.status, adherence, hasAcuteHighPain: acuteHigh.has(m.id), daysSinceActivity });
    return {
      id: m.id, name: m.name, mobile: m.mobile, age: m.age, sex: m.sex,
      segment: m.segment, status: m.status, branch_id: m.branch_id,
      musculage: latestMusculage.get(m.id) ?? null,
      adherence, at_risk: atRisk, risk_reason: reason,
    };
  });

  if (risk === 'flagged') data = data.filter((d) => d.at_risk);
  if (risk === 'low_adherence') data = data.filter((d) => d.adherence !== null && d.adherence < 50);

  return NextResponse.json({ data, error: null, meta: { total: data.length } });
});
