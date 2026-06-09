import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { assessments } from '@/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getAuthedUser, withApiHandler } from '@/server/auth/middleware';
import { assertMemberVisible } from '@/modules/members/access';

/**
 * GET /api/v1/members/:id/scans — feature 1f · assessment (scan) history.
 * Visibility-scoped via assertMemberVisible (cross-tenant/unassigned → 404).
 */
export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const memberId = context?.params?.id ?? '';
  await assertMemberVisible(user, memberId);

  const rows = await db
    .select({
      id: assessments.id,
      type: assessments.type,
      status: assessments.status,
      musculage: assessments.musculage,
      created_at: assessments.created_at,
      completed_at: assessments.completed_at,
    })
    .from(assessments)
    .where(eq(assessments.member_id, memberId))
    .orderBy(desc(assessments.created_at));

  return NextResponse.json({ data: rows, error: null });
});
