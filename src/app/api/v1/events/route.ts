import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { events, users } from '@/server/db/schema';
import { and, eq, or, lt, gte, lte, ilike, desc } from 'drizzle-orm';
import { getAuthedUser, withApiHandler } from '@/server/auth/middleware';
import { resolveEventScope, encodeCursor, decodeCursor } from '@/modules/events/query';

// Authed + header-dependent → never static-prerender (avoids build-time dynamic-usage probe).
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/events — feature 2e · Activity Log (append-only audit trail).
 *
 * RLS lens (filters can never widen scope): ops = all clinics; clinic_admin = own
 * clinic; everyone else = own actions only. Filters: type, actor, from/to (ts),
 * subject. Cursor-paginated (ts desc, id desc). Read-only — emits NO event.
 */
export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  const url = new URL(request.url);

  const scope = resolveEventScope(user, { actor: url.searchParams.get('actor') });
  const type = url.searchParams.get('type') || undefined;
  const subject = url.searchParams.get('subject')?.trim() || undefined;
  const from = url.searchParams.get('from') || undefined;
  const to = url.searchParams.get('to') || undefined;
  const cursorStr = url.searchParams.get('cursor') || undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);

  const conds = [];
  if (scope.clinicId !== null) conds.push(eq(events.clinic_id, scope.clinicId));
  if (scope.actorId !== null) conds.push(eq(events.actor, scope.actorId));
  if (type) conds.push(eq(events.type, type));
  if (subject) conds.push(ilike(events.subject, `%${subject}%`));
  if (from && !Number.isNaN(Date.parse(from))) conds.push(gte(events.ts, new Date(from)));
  if (to && !Number.isNaN(Date.parse(to))) conds.push(lte(events.ts, new Date(to)));

  if (cursorStr) {
    const c = decodeCursor(cursorStr);
    if (c) {
      const ts = new Date(c.ts);
      conds.push(or(lt(events.ts, ts), and(eq(events.ts, ts), lt(events.id, c.id)))!);
    }
  }

  const rows = await db
    .select({
      id: events.id,
      type: events.type,
      actor: events.actor,
      actor_name: users.name,
      clinic_id: events.clinic_id,
      subject: events.subject,
      payload: events.payload,
      ts: events.ts,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actor))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(events.ts), desc(events.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ ts: (last.ts as Date).toISOString(), id: last.id }) : null;

  const data = page.map((r) => {
    let payload: unknown = null;
    if (r.payload) { try { payload = JSON.parse(r.payload); } catch { payload = r.payload; } }
    return {
      id: r.id, type: r.type, actor: r.actor, actor_name: r.actor_name ?? null,
      clinic_id: r.clinic_id, subject: r.subject, payload, ts: r.ts,
    };
  });

  return NextResponse.json({ data, error: null, meta: { cursor: nextCursor } });
});
