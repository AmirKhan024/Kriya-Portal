import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import {
  members, pain_flags, assessments, category_scores, program_instances,
} from '@/server/db/schema';
import { eq, and, desc, notInArray } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin', 'trainer', 'front_desk']);

  const memberId = context?.params?.id ?? '';

  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

  const activeFlags = await db
    .select()
    .from(pain_flags)
    .where(and(eq(pain_flags.member_id, memberId), eq(pain_flags.active, 'true')));

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
    .where(and(
      eq(program_instances.member_id, memberId),
      notInArray(program_instances.status, ['archived']),
    ))
    .orderBy(desc(program_instances.created_at))
    .limit(1);

  return NextResponse.json({
    data: {
      id: member.id,
      name: member.name,
      mobile: member.mobile,
      age: member.age,
      sex: member.sex,
      segment: member.segment,
      status: member.status,
      complaint: member.complaint,
      clinic_id: member.clinic_id,
      branch_id: member.branch_id,
      created_at: member.created_at,
      updated_at: member.updated_at,
      pain_flags: activeFlags.map(f => ({
        region: f.region,
        severity: f.severity,
        type: f.type,
        active: f.active,
      })),
      latest_assessment: latestAssessment ? {
        id: latestAssessment.id,
        type: latestAssessment.type,
        status: latestAssessment.status,
        musculage: latestAssessment.musculage,
        completed_at: latestAssessment.completed_at,
        category_scores: catScores,
      } : null,
      active_program: activeProgram ?? null,
    },
    error: null,
  });
});
