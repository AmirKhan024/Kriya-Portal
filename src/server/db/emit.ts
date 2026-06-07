import { db } from './index';
import { events } from './schema';

export type EventType =
  | 'clinic.provisioned' | 'entitlement.changed'
  | 'video.published' | 'video.assigned' | 'video.watched'
  | 'user.invited' | 'user.activated' | 'user.login'
  | 'role.granted' | 'access.scope_changed'
  | 'member.created' | 'member.consented' | 'member.assigned'
  | 'assessment.started' | 'assessment.completed'
  | 'painflag.set' | 'painlock.overridden'
  | 'prescription.generated' | 'prescription.sent'
  | 'program.assigned' | 'program.customized'
  | 'activity.assigned' | 'activity.completed'
  | 'phase.advanced'
  | 'nudge.scheduled' | 'nudge.sent' | 'nudge.responded'
  | 'appointment.booked' | 'appointment.completed'
  | 'app.invited' | 'app.activated'
  | 'member.retained_30d';

export async function emit(
  type: EventType,
  actor: string | null,
  clinic_id: string | null,
  subject: string | null,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await db.insert(events).values({
    type,
    actor: actor ?? undefined,
    clinic_id: clinic_id ?? undefined,
    subject: subject ?? undefined,
    payload: JSON.stringify(payload),
  });
}
