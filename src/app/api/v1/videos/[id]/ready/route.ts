import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { care_videos } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/videos/:id/ready — feature 3a · the client calls this after the
 * file finishes uploading to the signed Storage URL. Flips draft → ready (the
 * storage path was stored as playback_id at create time). Ops only.
 */
export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops']);

  const id = context?.params?.id ?? '';
  const [video] = await db.select().from(care_videos).where(eq(care_videos.id, id)).limit(1);
  if (!video) throw new ApiError('NOT_FOUND', 'Video not found', 404);
  if (video.status === 'published') {
    return NextResponse.json({ data: { id, status: 'published' }, error: null });
  }

  await db.update(care_videos).set({ status: 'ready' }).where(eq(care_videos.id, id));
  return NextResponse.json({ data: { id, status: 'ready' }, error: null });
});
