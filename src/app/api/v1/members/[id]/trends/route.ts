import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { assessments } from '@/server/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import { getAuthedUser, withApiHandler } from '@/server/auth/middleware';
import { assertMemberVisible } from '@/modules/members/access';

/**
 * GET /api/v1/members/:id/trends — feature 1f · Musculage time series.
 * Ascending by completion date; only completed assessments with a musculage.
 */
export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const memberId = context?.params?.id ?? '';
  await assertMemberVisible(user, memberId);

  const rows = await db
    .select({ musculage: assessments.musculage, completed_at: assessments.completed_at })
    .from(assessments)
    .where(and(eq(assessments.member_id, memberId), eq(assessments.status, 'completed')))
    .orderBy(asc(assessments.completed_at));

  const data = rows
    .filter((r) => r.musculage != null && r.completed_at != null)
    .map((r) => ({ date: r.completed_at, musculage: r.musculage as number }));

  return NextResponse.json({ data, error: null });
});
