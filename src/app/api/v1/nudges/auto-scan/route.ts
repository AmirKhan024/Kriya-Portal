import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import {
  members, activity_sessions, nudges, notifications, member_assignments,
} from '@/server/db/schema';
import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { selectChannel } from '@/modules/nudges/channel';
import { withinFrequencyCap, nonResponseStreak, type NudgeLike } from '@/modules/nudges/frequency';
import { findInactiveMembers, shouldEscalate } from '@/modules/nudges/watcher';
import { dispatchNudge } from '@/modules/nudges/dispatch';
import { defaultOptIn } from '@/modules/nudges/schemas';
import { WEEK_MS } from '@/modules/nudges/constants';

export const dynamic = 'force-dynamic';

/** Cap a single scan so an ops-wide run can never sweep unbounded rows. */
const MAX_SCAN = 1000;
const REENGAGE_MESSAGE = "It's been a while — your next session is ready when you are.";

/**
 * POST /api/v1/nudges/auto-scan — feature 2c · the N8N inactivity watcher.
 *
 * N8N calls this on a schedule (N8N itself is the external PAUSE point). Finds
 * members with no activity in the inactivity window, applies the frequency cap,
 * and — when `?execute=true` — sends a re-engagement nudge and escalates members
 * with a long non-response streak to their assigned clinician. Default is a
 * DRY-RUN that only returns the candidate list (emits nothing).
 *
 * Scope: clinic_admin → own clinic; ops → all clinics or `?clinic_id` drill-in.
 */
export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops', 'clinic_admin']);

  const url = new URL(request.url);
  const execute = url.searchParams.get('execute') === 'true';
  const clinicId = user.role === 'ops'
    ? (url.searchParams.get('clinic_id') || null)
    : user.clinic_id;

  const now = new Date();

  // 1 · Members in scope (batched, capped).
  const memberRows = await db
    .select({ id: members.id, clinic_id: members.clinic_id, status: members.status, telegram_chat_id: members.telegram_chat_id })
    .from(members)
    .where(clinicId ? eq(members.clinic_id, clinicId) : undefined)
    .limit(MAX_SCAN);
  const truncated = memberRows.length === MAX_SCAN;
  const memberIds = memberRows.map((m) => m.id);

  // 2 · Latest activity per member → inactivity decision.
  const acts = memberIds.length
    ? await db
      .select({ member_id: activity_sessions.member_id, completed_at: activity_sessions.completed_at })
      .from(activity_sessions)
      .where(inArray(activity_sessions.member_id, memberIds))
    : [];
  const lastActivityByMember = new Map<string, Date | null>();
  for (const a of acts) {
    const t = (a.completed_at as Date | null) ?? null;
    const prev = lastActivityByMember.get(a.member_id) ?? null;
    if (!prev || (t && t > prev)) lastActivityByMember.set(a.member_id, t);
  }
  const inactiveIds = findInactiveMembers({ members: memberRows, lastActivityByMember, now });

  // 3 · Recent nudges (7d) for inactive members → cap + non-response streak.
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const recentNudges = inactiveIds.length
    ? await db
      .select()
      .from(nudges)
      .where(and(inArray(nudges.member_id, inactiveIds), gte(nudges.created_at, weekAgo)))
    : [];
  const byMember = new Map<string, NudgeLike[]>();
  for (const n of recentNudges as NudgeLike[] & { member_id: string }[]) {
    const list = byMember.get(n.member_id) ?? [];
    list.push(n);
    byMember.set(n.member_id, list);
  }

  const memberById = new Map(memberRows.map((m) => [m.id, m]));
  const candidates = inactiveIds.map((mid) => {
    const rec = byMember.get(mid) ?? [];
    const cap = withinFrequencyCap(rec, now);
    const streak = nonResponseStreak(rec);
    const m = memberById.get(mid)!;
    return {
      member_id: mid,
      clinic_id: m.clinic_id,
      status: m.status,
      last_activity: lastActivityByMember.get(mid) ?? null,
      eligible: cap.allowed,
      cap_reason: cap.reason,
      non_response_streak: streak,
      escalate: shouldEscalate(streak),
    };
  });

  let scheduled = 0;
  let escalated = 0;

  if (execute) {
    const channel = selectChannel(defaultOptIn())!.channel; // highest-priority opted-in

    // 4 · Send a re-engagement nudge to each eligible candidate.
    for (const c of candidates) {
      if (!c.eligible) continue;
      const id = crypto.randomUUID();
      await db.insert(nudges).values({
        id, member_id: c.member_id, clinic_id: c.clinic_id, sent_by: null,
        channel, message: REENGAGE_MESSAGE, status: 'scheduled', scheduled_at: now,
      });
      await emit('nudge.scheduled', user.id, c.clinic_id, `member:${c.member_id}`, { channel, auto: true });
      const r = await dispatchNudge({ to: memberById.get(c.member_id)?.telegram_chat_id ?? null, message: REENGAGE_MESSAGE });
      await db.update(nudges).set({
        status: r.status, sent_at: r.status === 'sent' ? now : null,
        provider: r.provider, provider_message_id: r.provider_message_id,
      }).where(eq(nudges.id, id));
      await emit('nudge.sent', user.id, c.clinic_id, `member:${c.member_id}`, {
        channel, status: r.status, provider_message_id: r.provider_message_id, reason: r.reason ?? null, auto: true,
      });
      if (r.status === 'sent') scheduled += 1;
    }

    // 5 · Escalate long non-responders to their assigned clinician.
    const escIds = candidates.filter((c) => c.escalate).map((c) => c.member_id);
    if (escIds.length) {
      const assigns = await db
        .select({ member_id: member_assignments.member_id, clinician_id: member_assignments.clinician_id })
        .from(member_assignments)
        .where(and(inArray(member_assignments.member_id, escIds), isNull(member_assignments.ended_at)));
      const clinicianByMember = new Map(assigns.map((a) => [a.member_id, a.clinician_id]));
      for (const c of candidates) {
        if (!c.escalate) continue;
        const clinicianId = clinicianByMember.get(c.member_id);
        if (!clinicianId) continue;
        await db.insert(notifications).values({
          clinic_id: c.clinic_id, user_id: clinicianId, member_id: c.member_id,
          type: 'nudge_escalation', title: 'Member not responding',
          body: `Member has not responded to ${c.non_response_streak} nudges — please follow up.`,
        });
        await emit('nudge.scheduled', user.id, c.clinic_id, `member:${c.member_id}`, {
          escalation: true, streak: c.non_response_streak,
        });
        escalated += 1;
      }
    }
  }

  return NextResponse.json({
    data: {
      dry_run: !execute,
      scanned: memberRows.length,
      inactive: candidates.length,
      candidates,
      scheduled,
      escalated,
    },
    error: null,
    meta: { scope: clinicId ? 'clinic' : 'platform', truncated },
  });
});
