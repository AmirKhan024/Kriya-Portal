import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { assessments, members, category_scores } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import type { UserRole } from '@/types/auth';
import type { Category } from '@/types/test';
import { SCAN_ROLES } from '@/modules/scoring/schemas';
import { aggregate, type GameResult } from '@/modules/scoring/aggregate';

/**
 * POST /api/v1/assessments/:id/complete — feature 1c-b · finalize a scan.
 *
 * Aggregates the recorded game results → category scores + composite Musculage,
 * marks the assessment completed, and advances a brand-new member to `assessed`.
 */
export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...SCAN_ROLES] as UserRole[]);
  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'User is not attached to a clinic', 403);
  const assessmentId = context?.params?.id ?? '';

  const rows = await db
    .select({ id: assessments.id, clinic_id: assessments.clinic_id, member_id: assessments.member_id, status: assessments.status })
    .from(assessments)
    .where(eq(assessments.id, assessmentId))
    .limit(1);
  const assessment = rows[0];
  if (!assessment || assessment.clinic_id !== user.clinic_id) {
    throw new ApiError('NOT_FOUND', 'Assessment not found', 404);
  }
  if (assessment.status !== 'in_progress') {
    throw new ApiError('CONFLICT', 'Assessment is not in progress', 409);
  }

  const scoreRows = await db
    .select({ category: category_scores.category, score: category_scores.score, raw_metrics: category_scores.raw_metrics })
    .from(category_scores)
    .where(eq(category_scores.assessment_id, assessmentId));

  if (scoreRows.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'No game results recorded for this assessment', 400);
  }

  const results: GameResult[] = scoreRows.map((r) => {
    let musculage = 0;
    try {
      musculage = JSON.parse(r.raw_metrics ?? '{}').musculage ?? 0;
    } catch { /* keep 0 */ }
    return { category: r.category as Category, score: r.score, musculage };
  });

  const agg = aggregate(results);

  await db.update(assessments)
    .set({ musculage: agg.musculage, status: 'completed', completed_at: new Date() })
    .where(eq(assessments.id, assessmentId));

  // Advance a first-time member to `assessed` (don't regress members already further along).
  const memberRows = await db
    .select({ status: members.status })
    .from(members)
    .where(eq(members.id, assessment.member_id))
    .limit(1);
  if (memberRows[0]?.status === 'new') {
    await db.update(members).set({ status: 'assessed', updated_at: new Date() }).where(eq(members.id, assessment.member_id));
  }

  await emit('assessment.completed', user.id, user.clinic_id, `assessment:${assessmentId}`, {
    member_id: assessment.member_id, musculage: agg.musculage, categories: agg.categories,
  });

  return NextResponse.json({
    data: { assessment_id: assessmentId, musculage: agg.musculage, categories: agg.categories, count: agg.count },
    error: null,
  });
});
