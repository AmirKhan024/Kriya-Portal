/**
 * Adherence + at-risk derivation (feature 1f). Pure + unit-tested.
 *
 * DOCUMENTED HEURISTIC — needs physiotherapist sign-off (like the pain-gating
 * thresholds). Until program-based adherence lands (Dev B's programs / Module 4b),
 * "expected" is a flat target of sessions per 14-day window.
 */
export const ADHERENCE_WINDOW_DAYS = 14;
export const ADHERENCE_EXPECTED_DEFAULT = 10; // ~5 sessions/week × 2 weeks
export const LOW_ADHERENCE_THRESHOLD = 50;     // % below which a member is "low adherence"
export const INACTIVITY_FLAG_DAYS = 14;

/** Member statuses for which adherence is meaningful (they should be doing sessions). */
const ADHERENCE_TRACKED = new Set(['prescribed', 'on_program', 'retained', 'at_risk', 'lapsed']);

export function isAdherenceTracked(status: string): boolean {
  return ADHERENCE_TRACKED.has(status);
}

/** completed-in-window / expected → 0–100 (capped), or null when not tracked. */
export function computeAdherence(
  completedInWindow: number,
  tracked: boolean,
  expected: number = ADHERENCE_EXPECTED_DEFAULT,
): number | null {
  if (!tracked || expected <= 0) return null;
  return Math.min(100, Math.round((completedInWindow / expected) * 100));
}

export type RiskInput = {
  status: string;
  adherence: number | null;
  hasAcuteHighPain: boolean;
  /** Days since the member's last activity session; null = never active. */
  daysSinceActivity: number | null;
};

/** Whether a member is at-risk (auto-flagged), with a short reason for the UI. */
export function deriveRisk(i: RiskInput): { atRisk: boolean; reason: string | null } {
  if (i.hasAcuteHighPain) return { atRisk: true, reason: 'Acute pain' };
  if (i.status === 'lapsed') return { atRisk: true, reason: 'Lapsed' };
  if (i.adherence !== null && i.adherence < LOW_ADHERENCE_THRESHOLD) {
    return { atRisk: true, reason: 'Low adherence' };
  }
  if (
    (i.status === 'prescribed' || i.status === 'on_program') &&
    (i.daysSinceActivity === null || i.daysSinceActivity >= INACTIVITY_FLAG_DAYS)
  ) {
    return { atRisk: true, reason: 'No recent activity' };
  }
  if (i.status === 'at_risk') return { atRisk: true, reason: 'Flagged' };
  return { atRisk: false, reason: null };
}
