import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { appointments, nudges, members } from '@/server/db/schema';
import { and, eq, gte, inArray } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { dueReminders, type ReminderAppointment } from '@/modules/appointments/slots';
import { selectChannel } from '@/modules/nudges/channel';
import { defaultOptIn } from '@/modules/nudges/schemas';
import { dispatchNudge } from '@/modules/nudges/dispatch';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/appointments/reminders-scan — feature 2d · the N8N reminder watcher.
 *
 * Finds booked appointments inside a T-24h / T-2h window and (when `?execute=true`)
 * sends a reminder by REUSING the 2c nudge dispatcher (records a nudges row + emits
 * nudge.scheduled/sent). N8N (or any cron) calls this on a schedule; the dispatcher
 * delivers via Telegram (no-op when TELEGRAM_BOT_TOKEN is unset). Dry-run by default.
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
  const conds = [eq(appointments.status, 'booked'), gte(appointments.slot, now)];
  if (clinicId) conds.push(eq(appointments.clinic_id, clinicId));
  const rows = await db.select().from(appointments).where(and(...conds));

  const due = dueReminders(rows as unknown as ReminderAppointment[], now);

  let sent = 0;
  if (execute) {
    const channel = selectChannel(defaultOptIn())!.channel;
    // Batch-resolve each due member's telegram_chat_id (no N+1).
    const dueMemberIds = Array.from(new Set(due.map((d) => d.appointment.member_id)));
    const chatByMember = new Map<string, string | null>();
    if (dueMemberIds.length) {
      const ms = await db.select({ id: members.id, telegram_chat_id: members.telegram_chat_id })
        .from(members).where(inArray(members.id, dueMemberIds));
      for (const m of ms) chatByMember.set(m.id, m.telegram_chat_id);
    }
    for (const { appointment, window } of due) {
      const message = `Reminder: your appointment is in about ${window}h.`;
      const id = crypto.randomUUID();
      await db.insert(nudges).values({
        id, member_id: appointment.member_id, clinic_id: appointment.clinic_id, sent_by: null,
        channel, message, status: 'scheduled', scheduled_at: now,
      });
      await emit('nudge.scheduled', user.id, appointment.clinic_id, `member:${appointment.member_id}`, {
        channel, kind: 'appointment_reminder', appointment_id: appointment.id, window,
      });
      const r = await dispatchNudge({ to: chatByMember.get(appointment.member_id) ?? null, message });
      await db.update(nudges).set({
        status: r.status, sent_at: r.status === 'sent' ? now : null,
        provider: r.provider, provider_message_id: r.provider_message_id,
      }).where(eq(nudges.id, id));
      await emit('nudge.sent', user.id, appointment.clinic_id, `member:${appointment.member_id}`, {
        channel, status: r.status, provider_message_id: r.provider_message_id, reason: r.reason ?? null, kind: 'appointment_reminder',
      });
      if (r.status === 'sent') sent += 1;
    }
  }

  return NextResponse.json({
    data: {
      dry_run: !execute,
      due: due.length,
      reminders: due.map((d) => ({ appointment_id: d.appointment.id, member_id: d.appointment.member_id, window: d.window })),
      sent,
    },
    error: null,
    meta: { scope: clinicId ? 'clinic' : 'platform' },
  });
});
