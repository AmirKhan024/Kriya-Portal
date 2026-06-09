import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { activity_sessions, games } from '@/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getAuthedUser, withApiHandler } from '@/server/auth/middleware';
import { assertMemberVisible } from '@/modules/members/access';

/**
 * GET /api/v1/members/:id/activities — feature 1f · session feed (rehab games/videos).
 * Left-joins `games` for a display name. Visibility-scoped.
 */
export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const memberId = context?.params?.id ?? '';
  await assertMemberVisible(user, memberId);

  const rows = await db
    .select({
      id: activity_sessions.id,
      type: activity_sessions.type,
      score: activity_sessions.score,
      duration_sec: activity_sessions.duration_sec,
      completed_at: activity_sessions.completed_at,
      game_id: activity_sessions.game_id,
      game_name: games.name,
      video_id: activity_sessions.video_id,
    })
    .from(activity_sessions)
    .leftJoin(games, eq(activity_sessions.game_id, games.id))
    .where(eq(activity_sessions.member_id, memberId))
    .orderBy(desc(activity_sessions.completed_at))
    .limit(100);

  return NextResponse.json({ data: rows, error: null });
});
