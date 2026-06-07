import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { care_videos, video_assignments, activity_sessions } from '@/server/db/schema';
import { and, eq, inArray, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireEntitlement, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { assertMemberVisible } from '@/modules/members/access';
import { assignVideoSchema } from '@/modules/videos/schemas';

export const dynamic = 'force-dynamic';

const ASSIGN_ROLES = ['clinic_admin', 'ortho', 'physio', 'trainer'] as const;

/**
 * POST /api/v1/members/:id/video-assignments — feature 3a · assign a published
 * care video to a member. Entitlement-gated (care_programs), member-scoped.
 * Emits video.assigned.
 */
export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...ASSIGN_ROLES]);
  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'No clinic context', 403);
  await requireEntitlement(user.clinic_id, 'care_programs');

  const memberId = context?.params?.id ?? '';
  const member = await assertMemberVisible(user, memberId);

  const parsed = assignVideoSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const { video_id } = parsed.data;

  const [video] = await db.select().from(care_videos).where(eq(care_videos.id, video_id)).limit(1);
  if (!video) throw new ApiError('NOT_FOUND', 'Video not found', 404);
  if (video.status !== 'published') {
    throw new ApiError('CONFLICT', 'Only published videos can be assigned', 409);
  }

  const id = crypto.randomUUID();
  await db.insert(video_assignments).values({
    id, member_id: memberId, video_id, clinic_id: member.clinic_id, assigned_by: user.id,
  });
  await emit('video.assigned', user.id, member.clinic_id, `member:${memberId}`, { video_id, title: video.title });

  return NextResponse.json({ data: { id, member_id: memberId, video_id }, error: null }, { status: 201 });
});

/**
 * GET /api/v1/members/:id/video-assignments — feature 3a · a member's assigned
 * videos with watch %. Member-scoped (assertMemberVisible). Read-only.
 */
export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const memberId = context?.params?.id ?? '';
  await assertMemberVisible(user, memberId);

  const rows = await db
    .select({
      id: video_assignments.id,
      video_id: video_assignments.video_id,
      assigned_at: video_assignments.assigned_at,
      title: care_videos.title,
      status: care_videos.status,
      playback_id: care_videos.playback_id,
    })
    .from(video_assignments)
    .leftJoin(care_videos, eq(care_videos.id, video_assignments.video_id))
    .where(eq(video_assignments.member_id, memberId))
    .orderBy(desc(video_assignments.assigned_at));

  // Watch % per video from the member's video activity sessions (max score).
  const videoIds = rows.map((r) => r.video_id);
  const watched = new Map<string, number>();
  if (videoIds.length) {
    const sessions = await db
      .select({ video_id: activity_sessions.video_id, score: activity_sessions.score })
      .from(activity_sessions)
      .where(and(eq(activity_sessions.member_id, memberId), inArray(activity_sessions.video_id, videoIds)));
    for (const s of sessions) {
      if (!s.video_id) continue;
      const pct = Number(s.score ?? 0);
      watched.set(s.video_id, Math.max(watched.get(s.video_id) ?? 0, pct));
    }
  }

  const data = rows.map((r) => ({ ...r, watched_pct: watched.get(r.video_id) ?? 0 }));
  return NextResponse.json({ data, error: null, meta: { count: data.length } });
});
