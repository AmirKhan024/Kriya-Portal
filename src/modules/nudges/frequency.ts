/**
 * Frequency capping + non-response accounting (feature 2c). Pure + unit-tested.
 *
 * Deterministic — the caller passes `now` (mirrors the analytics helpers; never
 * calls Date.now() inside).
 */
import {
  MAX_NUDGES_PER_DAY,
  MAX_NUDGES_PER_WEEK,
  DAY_MS,
  WEEK_MS,
  type NudgeStatus,
} from './constants';

/** Minimal shape of a nudge row needed for capping/streak logic. */
export type NudgeLike = {
  status: string;
  sent_at: Date | null;
  responded_at: Date | null;
  created_at: Date;
};

/** A nudge counts toward the cap once it has actually been sent. */
function wasSent(n: NudgeLike): boolean {
  return n.status === 'sent' || n.status === 'responded' || n.sent_at !== null;
}

export type FrequencyVerdict = { allowed: boolean; reason: string | null };

/**
 * Whether another nudge may be sent now, given the member's recent nudges.
 * Blocks when the rolling-24h or rolling-7d sent count is already at the cap.
 */
export function withinFrequencyCap(recent: NudgeLike[], now: Date): FrequencyVerdict {
  const t = now.getTime();
  let dayCount = 0;
  let weekCount = 0;
  for (const n of recent) {
    if (!wasSent(n)) continue;
    const when = (n.sent_at ?? n.created_at).getTime();
    const age = t - when;
    if (age < 0) continue; // future-dated; ignore
    if (age < DAY_MS) dayCount += 1;
    if (age < WEEK_MS) weekCount += 1;
  }
  if (dayCount >= MAX_NUDGES_PER_DAY) {
    return { allowed: false, reason: `Daily cap reached (${MAX_NUDGES_PER_DAY}/day)` };
  }
  if (weekCount >= MAX_NUDGES_PER_WEEK) {
    return { allowed: false, reason: `Weekly cap reached (${MAX_NUDGES_PER_WEEK}/week)` };
  }
  return { allowed: true, reason: null };
}

/**
 * Count of the most-recent consecutive sent-but-unresponded nudges (the
 * non-response streak that drives escalation). A responded nudge resets it.
 */
export function nonResponseStreak(recent: NudgeLike[]): number {
  const sent = recent
    .filter(wasSent)
    .sort((a, b) => (b.sent_at ?? b.created_at).getTime() - (a.sent_at ?? a.created_at).getTime());
  let streak = 0;
  for (const n of sent) {
    if (n.responded_at !== null || n.status === ('responded' as NudgeStatus)) break;
    streak += 1;
  }
  return streak;
}
