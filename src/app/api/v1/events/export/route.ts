import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { events, users } from '@/server/db/schema';
import { and, eq, gte, lte, ilike, desc } from 'drizzle-orm';
import { getAuthedUser, withApiHandler } from '@/server/auth/middleware';
import { resolveEventScope, dateBounds } from '@/modules/events/query';

/**
 * POST /api/v1/events/export — feature 2e · export the (scoped, filtered) log as CSV.
 *
 * Same RLS lens + filters as GET /v1/events. Returns the CSV text in the response
 * (the UI downloads it client-side). Capped at 5000 rows. Read-only — no event.
 * (Async email delivery via Resend is a future enhancement.)
 */
const EXPORT_CAP = 5000;

function csvCell(v: unknown): string {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  const url = new URL(request.url);

  const scope = resolveEventScope(user, { actor: url.searchParams.get('actor') });
  const type = url.searchParams.get('type') || undefined;
  const subject = url.searchParams.get('subject')?.trim() || undefined;
  const from = url.searchParams.get('from') || undefined;
  const to = url.searchParams.get('to') || undefined;

  const conds = [];
  if (scope.clinicId !== null) conds.push(eq(events.clinic_id, scope.clinicId));
  if (scope.actorId !== null) conds.push(eq(events.actor, scope.actorId));
  if (type) conds.push(eq(events.type, type));
  if (subject) conds.push(ilike(events.subject, `%${subject}%`));
  const { fromDate, toDate } = dateBounds(from, to);
  if (fromDate) conds.push(gte(events.ts, fromDate));
  if (toDate) conds.push(lte(events.ts, toDate));

  const rows = await db
    .select({
      ts: events.ts, type: events.type, actor: events.actor,
      actor_name: users.name, subject: events.subject, payload: events.payload,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actor))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(events.ts), desc(events.id))
    .limit(EXPORT_CAP);

  const header = ['ts', 'type', 'actor', 'actor_name', 'subject', 'payload'].join(',');
  const lines = rows.map((r) => [
    csvCell((r.ts as Date).toISOString()),
    csvCell(r.type),
    csvCell(r.actor),
    csvCell(r.actor_name),
    csvCell(r.subject),
    csvCell(r.payload),
  ].join(','));
  const csv = [header, ...lines].join('\n');

  return NextResponse.json({
    data: { csv, count: rows.length, capped: rows.length === EXPORT_CAP },
    error: null,
  });
});
