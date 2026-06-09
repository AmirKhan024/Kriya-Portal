import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members, branches, pain_flags, assessments, activity_sessions } from '@/server/db/schema';
import { and, eq, inArray, gte, isNotNull, desc } from 'drizzle-orm';
import { getAuthedUser, requireRole, withApiHandler, ApiError } from '@/server/auth/middleware';
import { normalizeRange, rangeToCutoff } from '@/modules/analytics/range';
import {
  patientStats, activityStats,
  type MemberRow, type SessionRow, type CompletedAssessmentRow,
} from '@/modules/analytics/aggregate';
import { dbg } from '@/lib/debug';

// Authed + query-dependent → never static-prerender (matches the events route).
export const dynamic = 'force-dynamic';

const ANALYTICS_ROLES = ['clinic_admin', 'ops'] as const;
const DASHBOARDS = ['patient', 'activity'] as const;

/**
 * GET /api/v1/analytics/:dashboard — feature 2f-A · Clinic-Admin cockpit dashboards.
 *
 * Read-only (emits NO event). Admin/ops only: clinic_admin is locked to its own clinic
 * (the `clinic_id` query is ignored for non-ops); ops sees all clinics, or one via
 * `?clinic_id=`. Filters: `range` (30d|90d|12m|all), `branch_id`. All metrics are
 * computed server-side from members/assessments/activity_sessions/pain_flags and
 * returned with an `as_of` timestamp. Heavy lifting is in pure helpers.
 */
export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...ANALYTICS_ROLES]);

  const dashboard = context?.params?.dashboard;
  if (!dashboard || !DASHBOARDS.includes(dashboard as (typeof DASHBOARDS)[number])) {
    throw new ApiError('NOT_FOUND', `Unknown dashboard "${dashboard ?? ''}"`, 404);
  }

  const url = new URL(request.url);
  const range = normalizeRange(url.searchParams.get('range'));
  const branchId = url.searchParams.get('branch_id') || undefined;

  // Resolve tenant scope. clinic_admin is forced to its own clinic; ops may drill in.
  const isOps = user.role === 'ops';
  let clinicId: string | null;
  if (isOps) {
    clinicId = url.searchParams.get('clinic_id') || null; // null = all clinics
  } else {
    if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'User is not attached to a clinic', 403);
    clinicId = user.clinic_id;
  }

  const now = new Date();
  const cutoff = rangeToCutoff(range, now);
  dbg('analytics:GET', { dashboard, range, clinicId, branchId, isOps });

  // Member scope is shared by both dashboards.
  const memberConds = [];
  if (clinicId) memberConds.push(eq(members.clinic_id, clinicId));
  if (branchId) memberConds.push(eq(members.branch_id, branchId));

  const meta = { scope: clinicId ? 'clinic' : 'platform', range };

  if (dashboard === 'patient') {
    const memberRows = (await db
      .select({
        id: members.id, segment: members.segment, status: members.status,
        branch_id: members.branch_id, created_at: members.created_at,
      })
      .from(members)
      .where(memberConds.length ? and(...memberConds) : undefined)) as MemberRow[];

    const branchRows = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(clinicId ? eq(branches.clinic_id, clinicId) : undefined);

    const ids = memberRows.map((m) => m.id);
    const flags = ids.length
      ? await db
          .select({ member_id: pain_flags.member_id, severity: pain_flags.severity, type: pain_flags.type })
          .from(pain_flags)
          .where(and(inArray(pain_flags.member_id, ids), eq(pain_flags.active, 'true')))
      : [];

    const stats = patientStats({ members: memberRows, branches: branchRows, painFlags: flags, cutoff });
    return NextResponse.json({ data: { ...stats, range, as_of: now.toISOString() }, error: null, meta });
  }

  // dashboard === 'activity'
  const memberRows = await db
    .select({ id: members.id, status: members.status })
    .from(members)
    .where(memberConds.length ? and(...memberConds) : undefined);
  const ids = memberRows.map((m) => m.id);

  if (ids.length === 0) {
    const stats = activityStats({ members: [], sessions: [], completedAssessments: [], latestMusculage: [], now });
    return NextResponse.json({ data: { ...stats, range, as_of: now.toISOString() }, error: null, meta });
  }

  // Activity sessions within the selected range (cutoff null = all time).
  const sessionConds = [inArray(activity_sessions.member_id, ids)];
  if (cutoff) sessionConds.push(gte(activity_sessions.completed_at, cutoff));
  const sessions = (await db
    .select({ member_id: activity_sessions.member_id, completed_at: activity_sessions.completed_at })
    .from(activity_sessions)
    .where(and(...sessionConds))) as SessionRow[];

  // Completed assessments (musculage present), newest first → latest-per-member + in-range trend.
  const completed = (await db
    .select({ member_id: assessments.member_id, musculage: assessments.musculage, completed_at: assessments.completed_at })
    .from(assessments)
    .where(and(
      inArray(assessments.member_id, ids),
      eq(assessments.status, 'completed'),
      isNotNull(assessments.musculage),
    ))
    .orderBy(desc(assessments.completed_at))) as CompletedAssessmentRow[];

  const seen = new Set<string>();
  const latestMusculage: number[] = [];
  for (const a of completed) {
    if (seen.has(a.member_id) || a.musculage === null) continue;
    seen.add(a.member_id);
    latestMusculage.push(a.musculage);
  }
  const completedInRange = cutoff
    ? completed.filter((a) => a.completed_at !== null && a.completed_at >= cutoff)
    : completed;

  const stats = activityStats({
    members: memberRows, sessions, completedAssessments: completedInRange, latestMusculage, now,
  });
  return NextResponse.json({ data: { ...stats, range, as_of: now.toISOString() }, error: null, meta });
});
