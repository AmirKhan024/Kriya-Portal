import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { nudges, users } from '@/server/db/schema';
import { and, eq, gte, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { assertMemberVisible } from '@/modules/members/access';
import { selectChannel } from '@/modules/nudges/channel';
import { withinFrequencyCap } from '@/modules/nudges/frequency';
import { dispatchNudge } from '@/modules/nudges/dispatch';
import { createNudgeSchema, defaultOptIn } from '@/modules/nudges/schemas';
import { WEEK_MS, NUDGE_CHANNELS, NUDGE_STATUSES } from '@/modules/nudges/constants';

// Authed + header/query-dependent → never static-prerender.
export const dynamic = 'force-dynamic';

/** Roles that may send/list/manage nudges (engagement actions). */
const NUDGE_ROLES = ['clinic_admin', 'ortho', 'physio', 'trainer', 'front_desk'] as const;
const VIEW_ALL_ROLES = ['ops', 'clinic_admin', 'front_desk'];

/**
 * POST /api/v1/nudges — feature 2c · send a manual nudge.
 *
 * Channel order WhatsApp→push→SMS (opted-in only); a frequency cap prevents
 * spamming. Schedules → dispatches (stub) → marks sent, emitting
 * nudge.scheduled then nudge.sent. Tenant + assignment scoped via the member.
 */
export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...NUDGE_ROLES]);

  const raw = await request.json();
  const parsed = createNudgeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const { member_id, message, channel: requested, type } = parsed.data;

  // Visibility (cross-tenant / unassigned → 404, no existence leak).
  const member = await assertMemberVisible(user, member_id);

  const now = new Date();

  // Frequency cap over the member's last-7-day nudges.
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const recent = await db
    .select()
    .from(nudges)
    .where(and(eq(nudges.member_id, member_id), gte(nudges.created_at, weekAgo)));
  const cap = withinFrequencyCap(recent, now);
  if (!cap.allowed) {
    throw new ApiError('CONFLICT', cap.reason ?? 'Frequency cap reached', 409);
  }

  // Channel selection (opted-in only; a request can't bypass opt-in).
  const choice = selectChannel(defaultOptIn(), requested ?? null);
  if (!choice) {
    throw new ApiError('VALIDATION_ERROR', 'No opted-in channel available for this member', 400);
  }

  const id = crypto.randomUUID();
  await db.insert(nudges).values({
    id,
    member_id,
    clinic_id: member.clinic_id,
    sent_by: user.id,
    channel: choice.channel,
    message,
    status: 'scheduled',
    scheduled_at: now,
  });
  await emit('nudge.scheduled', user.id, member.clinic_id, `member:${member_id}`, {
    channel: choice.channel, type: type ?? null,
  });

  const result = await dispatchNudge({ channel: choice.channel, member_id, message });

  await db.update(nudges).set({ status: 'sent', sent_at: now }).where(eq(nudges.id, id));
  await emit('nudge.sent', user.id, member.clinic_id, `member:${member_id}`, {
    channel: choice.channel,
    provider: result.provider,
    provider_message_id: result.provider_message_id,
    stubbed: result.stubbed,
  });

  return NextResponse.json({
    data: {
      id,
      member_id,
      clinic_id: member.clinic_id,
      channel: choice.channel,
      message,
      status: 'sent',
      scheduled_at: now,
      sent_at: now,
      responded_at: null,
      provider_message_id: result.provider_message_id,
      stubbed: result.stubbed,
    },
    error: null,
  }, { status: 201 });
});

/**
 * GET /api/v1/nudges — feature 2c · nudge history (read-only, emits nothing).
 *
 * Scope: `?member_id` → assertMemberVisible then that member (works for
 * clinicians); otherwise a VIEW_ALL role (ops/clinic_admin/front_desk) lists
 * clinic-wide (ops may pass `?clinic_id`). Filters: status, channel.
 */
export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  const url = new URL(request.url);

  const memberId = url.searchParams.get('member_id') || undefined;
  const statusFilter = url.searchParams.get('status') || undefined;
  const channelFilter = url.searchParams.get('channel') || undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);

  const conds = [];

  if (memberId) {
    await assertMemberVisible(user, memberId); // tenant + assignment scoping
    conds.push(eq(nudges.member_id, memberId));
  } else {
    if (!VIEW_ALL_ROLES.includes(user.role)) {
      throw new ApiError('FORBIDDEN', 'A member_id is required for your role', 403);
    }
    const clinicId = user.role === 'ops'
      ? (url.searchParams.get('clinic_id') || null)
      : user.clinic_id;
    if (clinicId) conds.push(eq(nudges.clinic_id, clinicId));
  }

  if (statusFilter && (NUDGE_STATUSES as readonly string[]).includes(statusFilter)) {
    conds.push(eq(nudges.status, statusFilter));
  }
  if (channelFilter && (NUDGE_CHANNELS as readonly string[]).includes(channelFilter)) {
    conds.push(eq(nudges.channel, channelFilter));
  }

  const rows = await db
    .select({
      id: nudges.id,
      member_id: nudges.member_id,
      clinic_id: nudges.clinic_id,
      channel: nudges.channel,
      message: nudges.message,
      status: nudges.status,
      scheduled_at: nudges.scheduled_at,
      sent_at: nudges.sent_at,
      responded_at: nudges.responded_at,
      created_at: nudges.created_at,
      sent_by: nudges.sent_by,
      sent_by_name: users.name,
    })
    .from(nudges)
    .leftJoin(users, eq(users.id, nudges.sent_by))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(nudges.created_at), desc(nudges.id))
    .limit(limit);

  const data = rows.map((r) => ({ ...r, sent_by_name: r.sent_by_name ?? null }));
  return NextResponse.json({ data, error: null, meta: { count: data.length } });
});
