import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { care_videos, activity_sessions, members } from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { withApiHandler, ApiError } from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { verifyWebhookSignature } from '@/modules/videos/mux';
import { parseMuxEvent, isWatchComplete } from '@/modules/videos/watch';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/mux — feature 3a · Mux server-to-server webhook.
 *
 * NOT authed via JWT — verified by the Mux signature header (stub-accepts when
 * MUX_WEBHOOK_SECRET is unset). Handles:
 *   • video.asset.ready → mark the care_video ready + store its playback id
 *   • a completed view (≥90%) → record an activity_sessions video row + emit
 *     video.watched (and activity.completed, matching the activity-sessions route)
 */
export const POST = withApiHandler(async (request) => {
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get('mux-signature'))) {
    throw new ApiError('AUTH_REQUIRED', 'Invalid webhook signature', 401);
  }

  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new ApiError('VALIDATION_ERROR', 'Invalid JSON', 400); }
  const event = parseMuxEvent(body);

  if (event.kind === 'asset.ready') {
    if (event.videoId) {
      await db.update(care_videos)
        .set({ status: 'ready', playback_id: event.playbackId })
        .where(eq(care_videos.id, event.videoId));
    }
    return NextResponse.json({ data: { handled: 'asset.ready', video_id: event.videoId }, error: null });
  }

  if (event.kind === 'view.completed') {
    if (!isWatchComplete(event.percent) || !event.memberId || !event.videoId) {
      return NextResponse.json({ data: { handled: 'view.incomplete', percent: event.percent }, error: null });
    }
    // Resolve the member's clinic from the DB (don't trust passthrough for tenant).
    const [member] = await db.select({ clinic_id: members.clinic_id }).from(members).where(eq(members.id, event.memberId)).limit(1);
    if (!member) {
      return NextResponse.json({ data: { handled: 'view.unknown_member' }, error: null });
    }

    // Idempotent: skip if this member already has a logged session for this video.
    const existing = await db.select({ id: activity_sessions.id }).from(activity_sessions)
      .where(and(eq(activity_sessions.member_id, event.memberId), eq(activity_sessions.video_id, event.videoId)))
      .limit(1);
    if (existing[0]) {
      return NextResponse.json({ data: { handled: 'view.duplicate' }, error: null });
    }

    const id = crypto.randomUUID();
    await db.insert(activity_sessions).values({
      id, member_id: event.memberId, clinic_id: member.clinic_id, video_id: event.videoId,
      type: 'video', score: event.percent,
    });
    await emit('video.watched', null, member.clinic_id, `member:${event.memberId}`, { video_id: event.videoId, percent: event.percent });
    await emit('activity.completed', null, member.clinic_id, `member:${event.memberId}`, { type: 'video', video_id: event.videoId });

    return NextResponse.json({ data: { handled: 'view.completed', session_id: id }, error: null });
  }

  return NextResponse.json({ data: { handled: 'ignored' }, error: null });
});
