import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { care_videos } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/videos/:id/publish — feature 3a · publish a care video (ops only).
 * Requires the asset to be `ready` (transcoded). Emits video.published.
 */
export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops']);

  const id = context?.params?.id ?? '';
  const [video] = await db.select().from(care_videos).where(eq(care_videos.id, id)).limit(1);
  if (!video) throw new ApiError('NOT_FOUND', 'Video not found', 404);
  if (video.status !== 'ready') {
    throw new ApiError('CONFLICT', `Video is ${video.status}, not ready to publish`, 409);
  }

  const now = new Date();
  await db.update(care_videos).set({ status: 'published', published_at: now }).where(eq(care_videos.id, id));
  await emit('video.published', user.id, null, `video:${id}`, { title: video.title });

  return NextResponse.json({ data: { id, status: 'published', published_at: now }, error: null });
});
