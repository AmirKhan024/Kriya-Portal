/**
 * Analytics aggregation (feature 2f-A · Patient + Activity dashboards). All pure —
 * they take already-fetched rows + a `now: Date` and return plain numbers, so the
 * route stays a thin fetch-and-shape layer and the maths is fully unit-tested.
 *
 * The risk count here intentionally uses the SAME acute-high-pain rule as the 1f
 * member list (`type === 'acute' && severity >= 5`) for consistency, but keeps the
 * aggregate lightweight (at-risk vs ok) — it does not re-run the full per-member
 * `deriveRisk` (which needs per-member activity lookups). Documented heuristic; the
 * per-member cockpit remains the source of truth for an individual's risk.
 */
import {
  ADHERENCE_WINDOW_DAYS,
  computeAdherence,
  isAdherenceTracked,
} from '@/modules/members/risk';
import { ACTIVE_WINDOW_DAYS, windowCutoff } from './range';

// ---- input row shapes (subset of the DB columns the route selects) ----
export type MemberRow = {
  id: string;
  segment: string;
  status: string;
  branch_id: string | null;
  created_at: Date;
};
export type BranchRow = { id: string; name: string };
export type PainFlagRow = { member_id: string; severity: number; type: string };
export type SessionRow = { member_id: string; completed_at: Date };
export type CompletedAssessmentRow = { member_id: string; musculage: number | null; completed_at: Date | null };

const UNASSIGNED = 'Unassigned';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

/** Members with an active acute pain flag of severity >= 5 (matches the 1f list rule). */
function acuteHighSet(painFlags: PainFlagRow[]): Set<string> {
  const s = new Set<string>();
  for (const f of painFlags) if (f.type === 'acute' && f.severity >= 5) s.add(f.member_id);
  return s;
}

export type PatientStats = {
  total: number;
  new_in_range: number;
  segment_mix: { care: number; wellness: number };
  status_distribution: Record<string, number>;
  risk_distribution: { at_risk: number; ok: number };
  branch_split: { branch_id: string | null; branch_name: string; count: number }[];
};

export function patientStats(input: {
  members: MemberRow[];
  branches: BranchRow[];
  painFlags: PainFlagRow[];
  cutoff: Date | null;
}): PatientStats {
  const { members, branches, painFlags, cutoff } = input;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const acuteHigh = acuteHighSet(painFlags);

  const segment_mix = { care: 0, wellness: 0 };
  const status_distribution: Record<string, number> = {};
  const branchCounts = new Map<string | null, number>();
  let atRisk = 0;
  let newInRange = 0;

  for (const m of members) {
    if (m.segment === 'care') segment_mix.care++;
    else if (m.segment === 'wellness') segment_mix.wellness++;

    status_distribution[m.status] = (status_distribution[m.status] ?? 0) + 1;

    branchCounts.set(m.branch_id, (branchCounts.get(m.branch_id) ?? 0) + 1);

    if (m.status === 'at_risk' || m.status === 'lapsed' || acuteHigh.has(m.id)) atRisk++;

    if (!cutoff || m.created_at >= cutoff) newInRange++;
  }

  const branch_split = Array.from(branchCounts.entries())
    .map(([branch_id, count]) => ({
      branch_id,
      branch_name: branch_id ? branchName.get(branch_id) ?? UNASSIGNED : UNASSIGNED,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    total: members.length,
    new_in_range: newInRange,
    segment_mix,
    status_distribution,
    risk_distribution: { at_risk: atRisk, ok: members.length - atRisk },
    branch_split,
  };
}

export type ActivityStats = {
  sessions_total: number;
  sessions_per_active_member: number;
  active_30d: number;
  adherence_avg: number | null;
  musculage_avg: number | null;
  musculage_trend: { date: string; avg: number }[];
};

export function activityStats(input: {
  members: { id: string; status: string }[];
  sessions: SessionRow[]; // already filtered to the selected range
  completedAssessments: CompletedAssessmentRow[]; // in-range, completed, for the trend
  latestMusculage: number[]; // latest completed musculage per member (non-null)
  now: Date;
}): ActivityStats {
  const { members, sessions, completedAssessments, latestMusculage, now } = input;

  const activeCutoff = windowCutoff(ACTIVE_WINDOW_DAYS, now);
  const adherenceCutoff = windowCutoff(ADHERENCE_WINDOW_DAYS, now);

  const activeIn30d = new Set<string>();
  const activeInRange = new Set<string>();
  const adherenceCounts = new Map<string, number>();
  for (const s of sessions) {
    activeInRange.add(s.member_id);
    if (s.completed_at >= activeCutoff) activeIn30d.add(s.member_id);
    if (s.completed_at >= adherenceCutoff) {
      adherenceCounts.set(s.member_id, (adherenceCounts.get(s.member_id) ?? 0) + 1);
    }
  }

  // Adherence averaged over tracked members only (those expected to be doing sessions).
  const adherenceVals: number[] = [];
  for (const m of members) {
    const tracked = isAdherenceTracked(m.status);
    const a = computeAdherence(adherenceCounts.get(m.id) ?? 0, tracked);
    if (a !== null) adherenceVals.push(a);
  }
  const adherence_avg = adherenceVals.length
    ? Math.round(adherenceVals.reduce((x, y) => x + y, 0) / adherenceVals.length)
    : null;

  const musculage_avg = latestMusculage.length
    ? round1(latestMusculage.reduce((x, y) => x + y, 0) / latestMusculage.length)
    : null;

  // Musculage trend: completed assessments bucketed by UTC day, ascending.
  const byDay = new Map<string, { sum: number; n: number }>();
  for (const a of completedAssessments) {
    if (a.musculage === null || a.completed_at === null) continue;
    const k = dayKey(a.completed_at);
    const cur = byDay.get(k) ?? { sum: 0, n: 0 };
    cur.sum += a.musculage;
    cur.n += 1;
    byDay.set(k, cur);
  }
  const musculage_trend = Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, { sum, n }]) => ({ date, avg: round1(sum / n) }));

  return {
    sessions_total: sessions.length,
    sessions_per_active_member: activeInRange.size ? round1(sessions.length / activeInRange.size) : 0,
    active_30d: activeIn30d.size,
    adherence_avg,
    musculage_avg,
    musculage_trend,
  };
}
