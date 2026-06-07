import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import {
  members, assessments, prescriptions, events, member_assignments,
} from '@/server/db/schema';
import { eq, and, gte, lte, count, sql, inArray } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';

function buildZeroFunnel(now: Date, fromDate: Date, toDate: Date) {
  return {
    as_of:  now.toISOString(),
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    funnel: [
      { stage: 'Seen',       count: 0, rate: 100, description: 'Members registered' },
      { stage: 'Scanned',    count: 0, rate: 0,   description: 'Completed assessment' },
      { stage: 'Prescribed', count: 0, rate: 0,   description: 'Received prescription' },
      { stage: 'Activated',  count: 0, rate: 0,   description: 'Opened Kriya app' },
      { stage: 'Retained',   count: 0, rate: 0,   description: 'Still active 30+ days' },
    ],
    headline: { conversion_rate: 0, headline_text: '0% of footfall converted to active app users' },
  };
}

function toRate(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);

  requireRole(user, ['ortho', 'physio', 'clinic_admin']);
  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'No clinic context', 403);
  const clinicId = user.clinic_id;
  const url = new URL(request.url);
  const sp = url.searchParams;

  const now = new Date();
  const fromDate = sp.get('from')
    ? new Date(sp.get('from')!)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const toDate      = sp.get('to') ? new Date(sp.get('to')!) : now;
  const branchId    = sp.get('branch_id') ?? undefined;
  const clinicianId = sp.get('clinician_id') ?? undefined;

  // Resolve member ID filter when scoped to a clinician
  let memberIdFilter: string[] | null = null;
  if (clinicianId) {
    const assigned = await db
      .select({ member_id: member_assignments.member_id })
      .from(member_assignments)
      .where(and(
        eq(member_assignments.clinician_id, clinicianId),
        eq(member_assignments.clinic_id, clinicId),
      ));
    memberIdFilter = assigned.map(a => a.member_id);
    if (memberIdFilter.length === 0) {
      return NextResponse.json({ data: buildZeroFunnel(now, fromDate, toDate), error: null });
    }
  }

  // Build member base conditions
  const memberBaseClauses = [
    eq(members.clinic_id, clinicId),
    gte(members.created_at, fromDate),
    lte(members.created_at, toDate),
    ...(branchId ? [eq(members.branch_id, branchId)] : []),
    ...(memberIdFilter ? [inArray(members.id, memberIdFilter)] : []),
  ];

  // 1. SEEN — members created in period
  const [{ seen }] = await db
    .select({ seen: count() })
    .from(members)
    .where(and(...memberBaseClauses));

  // 2. SCANNED — members with a completed assessment in the period
  const scannedQuery = [
    eq(assessments.clinic_id, clinicId),
    eq(assessments.status, 'completed'),
    gte(assessments.completed_at, fromDate),
    lte(assessments.completed_at, toDate),
    ...(branchId ? [eq(members.branch_id, branchId)] : []),
    ...(memberIdFilter ? [inArray(assessments.member_id, memberIdFilter)] : []),
  ];
  const [{ scanned }] = await db
    .select({ scanned: count(sql`DISTINCT ${assessments.member_id}`) })
    .from(assessments)
    .leftJoin(members, eq(assessments.member_id, members.id))
    .where(and(...scannedQuery));

  // 3. PRESCRIBED — members with at least one prescription in the period
  const prescribedQuery = [
    eq(prescriptions.clinic_id, clinicId),
    gte(prescriptions.created_at, fromDate),
    lte(prescriptions.created_at, toDate),
    ...(branchId ? [eq(members.branch_id, branchId)] : []),
    ...(memberIdFilter ? [inArray(prescriptions.member_id, memberIdFilter)] : []),
  ];
  const [{ prescribed }] = await db
    .select({ prescribed: count(sql`DISTINCT ${prescriptions.member_id}`) })
    .from(prescriptions)
    .leftJoin(members, eq(prescriptions.member_id, members.id))
    .where(and(...prescribedQuery));

  // 4. ACTIVATED — app.invited events in the period (deduplicated by member subject)
  const activatedEvents = await db
    .select({ subject: events.subject })
    .from(events)
    .where(and(
      eq(events.clinic_id, clinicId),
      eq(events.type, 'app.invited'),
      gte(events.ts, fromDate),
      lte(events.ts, toDate),
    ));
  const activatedMemberIds = Array.from(new Set(
    activatedEvents
      .map(e => e.subject?.replace('member:', '') ?? '')
      .filter(Boolean)
  ));
  const activated = activatedMemberIds.length;

  // 5. RETAINED — members with 'retained' status
  const retainedClauses = [
    eq(members.clinic_id, clinicId),
    eq(members.status, 'retained'),
    ...(branchId ? [eq(members.branch_id, branchId)] : []),
    ...(memberIdFilter ? [inArray(members.id, memberIdFilter)] : []),
  ];
  const [{ retained }] = await db
    .select({ retained: count() })
    .from(members)
    .where(and(...retainedClauses));

  const seenNum      = Number(seen);
  const scannedNum   = Number(scanned);
  const prescribedNum = Number(prescribed);
  const retainedNum  = Number(retained);
  const conversionRate = toRate(activated, seenNum);

  return NextResponse.json({
    data: {
      as_of:  now.toISOString(),
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      funnel: [
        { stage: 'Seen',       count: seenNum,       rate: 100,                              description: 'Members registered' },
        { stage: 'Scanned',    count: scannedNum,    rate: toRate(scannedNum, seenNum),     description: 'Completed assessment' },
        { stage: 'Prescribed', count: prescribedNum, rate: toRate(prescribedNum, seenNum),  description: 'Received prescription' },
        { stage: 'Activated',  count: activated,     rate: conversionRate,                   description: 'Opened Kriya app' },
        { stage: 'Retained',   count: retainedNum,   rate: toRate(retainedNum, seenNum),    description: 'Still active 30+ days' },
      ],
      headline: {
        conversion_rate: conversionRate,
        headline_text:   `${conversionRate}% of footfall converted to active app users`,
      },
    },
    error: null,
  });
});
