import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { assessments, members, category_scores } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import type { UserRole } from '@/types/auth';
import { computeScore } from '@/server/scoring';
import { resultSchema, SCAN_ROLES } from '@/modules/scoring/schemas';
import { isKnownTestId, categoryForTest } from '@/modules/scoring/categories';
import { normalizedFromConditioned } from '@/modules/scoring/aggregate';

const DEFAULT_AGE = 30;

/**
 * POST /api/v1/assessments/:id/results — feature 1c-b · score one game.
 *
 * Raw per-game metrics → ported score engine → a normalized 0–100 score persisted as
 * a `category_scores` row (raw_metrics keeps test_id + conditioned + per-test musculage).
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

  const parsed = resultSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues?.[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;
  if (!isKnownTestId(body.test_id)) {
    throw new ApiError('VALIDATION_ERROR', `Unknown test_id: ${body.test_id}`, 400);
  }

  const memberRows = await db
    .select({ age: members.age })
    .from(members)
    .where(eq(members.id, assessment.member_id))
    .limit(1);
  const age = memberRows[0]?.age ?? DEFAULT_AGE;

  let conditioned: number;
  let musculage: number;
  try {
    const score = computeScore(
      {
        testId: body.test_id,
        hits: body.hits,
        misses: body.misses,
        breachCount: body.breachCount,
        maxSwayDegrees: body.maxSwayDegrees,
        duration: body.duration,
        customMetrics: body.customMetrics ?? {},
      },
      age,
    );
    conditioned = score.conditioned;
    musculage = score.musculage;
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Could not score this result — check metrics', 400);
  }

  const normalized = normalizedFromConditioned(conditioned);
  const category = categoryForTest(body.test_id);

  await db.insert(category_scores).values({
    assessment_id: assessmentId,
    clinic_id: user.clinic_id,
    category,
    score: normalized,
    raw_metrics: JSON.stringify({ test_id: body.test_id, raw: body, conditioned, musculage }),
  });

  return NextResponse.json(
    { data: { test_id: body.test_id, category, score: normalized, musculage }, error: null },
    { status: 201 },
  );
});
