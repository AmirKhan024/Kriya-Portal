import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members, consents, pain_flags, member_assignments, users, assessments, category_scores, program_instances } from '@/server/db/schema';
import { and, eq, isNull, desc, notInArray } from 'drizzle-orm';
import { getAuthedUser, withApiHandler, ApiError } from '@/server/auth/middleware';

/**
 * GET /api/v1/members/:id — feature 1b · member record.
 *
 * Returns the member plus consent state, active pain flags and current assignment.
 * Visibility: every clinic role can open any member in their own clinic (matches the
 * clinic-wide members list). Cross-tenant access returns NOT_FOUND (no existence leak).
 */
const VIEW_ALL_ROLES = ['ops', 'clinic_admin', 'front_desk', 'ortho', 'physio', 'trainer'];

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const memberId = context?.params?.id ?? '';

  const rows = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  const member = rows[0];
  const notFound = () => new ApiError('NOT_FOUND', 'Member not found', 404);
  if (!member) throw notFound();

  // Tenant scope (ops is platform-wide).
  if (user.role !== 'ops' && member.clinic_id !== user.clinic_id) throw notFound();

  // Assignment scope for clinical (non-admin) roles.
  if (!VIEW_ALL_ROLES.includes(user.role)) {
    const assigned = await db
      .select({ id: member_assignments.id })
      .from(member_assignments)
      .where(and(
        eq(member_assignments.member_id, memberId),
        eq(member_assignments.clinician_id, user.id),
        isNull(member_assignments.ended_at),
      ))
      .limit(1);
    if (!assigned[0]) throw notFound();
  }

  const activeConsent = await db
    .select()
    .from(consents)
    .where(and(eq(consents.member_id, memberId), isNull(consents.withdrawn_at)))
    .limit(1);

  const activePainFlags = await db
    .select()
    .from(pain_flags)
    .where(and(eq(pain_flags.member_id, memberId), eq(pain_flags.active, 'true')));

  const currentAssignment = await db
    .select()
    .from(member_assignments)
    .where(and(eq(member_assignments.member_id, memberId), isNull(member_assignments.ended_at)))
    .limit(1);

  // Resolve the assigned clinician's name (avoid showing a raw UUID in the UI).
  let assignment = currentAssignment[0] ?? null;
  if (assignment) {
    const clinician = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, assignment.clinician_id))
      .limit(1);
    assignment = { ...assignment, clinician_name: clinician[0]?.name ?? null } as typeof assignment & { clinician_name: string | null };
  }

  // Dev B fields (latest completed assessment + category scores, active program) so
  // main's consumers (program / prescription pages) keep working — union of both shapes.
  const [latestAssessment] = await db
    .select()
    .from(assessments)
    .where(and(eq(assessments.member_id, memberId), eq(assessments.status, 'completed')))
    .orderBy(desc(assessments.completed_at))
    .limit(1);
  let catScores: { category: string; score: number }[] = [];
  if (latestAssessment) {
    catScores = await db
      .select({ category: category_scores.category, score: category_scores.score })
      .from(category_scores)
      .where(eq(category_scores.assessment_id, latestAssessment.id));
  }
  const [activeProgram] = await db
    .select({
      id: program_instances.id,
      version: program_instances.version,
      status: program_instances.status,
      current_phase: program_instances.current_phase,
    })
    .from(program_instances)
    .where(and(eq(program_instances.member_id, memberId), notInArray(program_instances.status, ['archived'])))
    .orderBy(desc(program_instances.created_at))
    .limit(1);

  return NextResponse.json({
    data: {
      // flat fields (Dev B consumers)
      id: member.id, name: member.name, mobile: member.mobile, age: member.age, sex: member.sex,
      segment: member.segment, status: member.status, complaint: member.complaint,
      clinic_id: member.clinic_id, branch_id: member.branch_id,
      created_at: member.created_at, updated_at: member.updated_at,
      // Dev A record shape
      member,
      consent: activeConsent[0] ?? null,
      has_consent: !!activeConsent[0],
      pain_flags: activePainFlags,
      assignment,
      // Dev B extras
      latest_assessment: latestAssessment ? {
        id: latestAssessment.id, type: latestAssessment.type, status: latestAssessment.status,
        musculage: latestAssessment.musculage, completed_at: latestAssessment.completed_at,
        category_scores: catScores,
      } : null,
      active_program: activeProgram ?? null,
    },
    error: null,
  });
});
