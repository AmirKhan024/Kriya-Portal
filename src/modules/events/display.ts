import type { EventType } from '@/server/db/emit';
import type { BadgeTone } from '@/components/ui-a/Badge';

/**
 * Human-readable labels + Badge tones for the activity log (feature 2e). Pure.
 */
export const EVENT_LABELS: Record<EventType, string> = {
  'clinic.provisioned': 'Clinic provisioned',
  'entitlement.changed': 'Entitlement changed',
  'video.published': 'Video published',
  'video.assigned': 'Video assigned',
  'video.watched': 'Video watched',
  'user.invited': 'Staff invited',
  'user.activated': 'Staff activated',
  'user.login': 'User login',
  'role.granted': 'Role granted',
  'access.scope_changed': 'Access changed',
  'member.created': 'Member created',
  'member.consented': 'Consent captured',
  'member.assigned': 'Member assigned',
  'assessment.started': 'Scan started',
  'assessment.completed': 'Scan completed',
  'painflag.set': 'Pain flag set',
  'painlock.overridden': 'Pain lock overridden',
  'prescription.generated': 'Prescription generated',
  'prescription.sent': 'Prescription sent',
  'program.assigned': 'Program assigned',
  'program.customized': 'Program customized',
  'activity.assigned': 'Activity assigned',
  'activity.completed': 'Activity completed',
  'phase.advanced': 'Phase advanced',
  'nudge.scheduled': 'Nudge scheduled',
  'nudge.sent': 'Nudge sent',
  'nudge.responded': 'Nudge responded',
  'appointment.booked': 'Appointment booked',
  'appointment.completed': 'Appointment completed',
  'app.invited': 'App invite sent',
  'app.activated': 'App activated',
  'member.retained_30d': 'Retained 30 days',
  'program_template.published': 'Program template published',
};

export function eventLabel(type: string): string {
  return (EVENT_LABELS as Record<string, string>)[type] ?? type;
}

/** Badge tone by event domain (prefix). */
export function eventTone(type: string): BadgeTone {
  if (type === 'painlock.overridden') return 'red';
  if (type.startsWith('painflag')) return 'amber';
  if (type.startsWith('member.') || type.startsWith('user.') || type.startsWith('access') || type.startsWith('role')) return 'blue';
  if (type.startsWith('assessment') || type.startsWith('prescription') || type.startsWith('program')) return 'teal';
  if (type.startsWith('nudge') || type.startsWith('appointment') || type.startsWith('app.')) return 'purple';
  if (type.startsWith('activity') || type.startsWith('video') || type.startsWith('phase')) return 'green';
  return 'gray';
}

/** The full list of event types (for the filter dropdown). */
export const ALL_EVENT_TYPES = Object.keys(EVENT_LABELS) as EventType[];
