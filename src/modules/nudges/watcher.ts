/**
 * Inactivity watcher (feature 2c — the N8N "no activity in 48h" trigger).
 * Pure + unit-tested; deterministic (`now` passed in).
 *
 * The external N8N service simply calls POST /v1/nudges/auto-scan on a schedule;
 * the actual "who is inactive" decision is computed here server-side so it can be
 * tested without N8N. N8N itself is the external PAUSE point.
 */
import { INACTIVITY_THRESHOLD_HOURS, ESCALATION_NONRESPONSE_COUNT } from './constants';

export type WatcherMember = { id: string };

/**
 * Members with no activity within the threshold window.
 *
 * @param lastActivityByMember member_id → most-recent activity completed_at (or
 *        absent/null = never active → always inactive).
 */
export function findInactiveMembers({
  members,
  lastActivityByMember,
  now,
  thresholdHours = INACTIVITY_THRESHOLD_HOURS,
}: {
  members: WatcherMember[];
  lastActivityByMember: Map<string, Date | null>;
  now: Date;
  thresholdHours?: number;
}): string[] {
  const cutoff = now.getTime() - thresholdHours * 60 * 60 * 1000;
  const out: string[] = [];
  for (const m of members) {
    const last = lastActivityByMember.get(m.id) ?? null;
    if (last === null || last.getTime() <= cutoff) out.push(m.id);
  }
  return out;
}

/** Whether a non-response streak warrants escalating to the assigned clinician. */
export function shouldEscalate(streak: number): boolean {
  return streak >= ESCALATION_NONRESPONSE_COUNT;
}
