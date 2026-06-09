import { describe, it, expect } from 'vitest';
import { patientStats, activityStats } from './aggregate';

const NOW = new Date('2026-06-07T00:00:00.000Z');
const d = (iso: string) => new Date(iso);

describe('patientStats', () => {
  const members = [
    { id: 'm1', segment: 'care', status: 'new', branch_id: 'A', created_at: d('2026-06-01T12:00:00Z') },
    { id: 'm2', segment: 'wellness', status: 'on_program', branch_id: 'A', created_at: d('2026-01-01T12:00:00Z') },
    { id: 'm3', segment: 'care', status: 'at_risk', branch_id: null, created_at: d('2026-06-05T12:00:00Z') },
    { id: 'm4', segment: 'care', status: 'lapsed', branch_id: 'B', created_at: d('2026-06-06T12:00:00Z') },
  ];
  const branches = [{ id: 'A', name: 'Branch A' }, { id: 'B', name: 'Branch B' }];
  // m1 acute sev6 = acute-high; m2 chronic sev8 = NOT acute-high.
  const painFlags = [
    { member_id: 'm1', severity: 6, type: 'acute' },
    { member_id: 'm2', severity: 8, type: 'chronic' },
  ];
  const cutoff = d('2026-05-08T00:00:00Z'); // 30d

  const s = patientStats({ members, branches, painFlags, cutoff });

  it('counts totals and new-in-range against the cutoff boundary', () => {
    expect(s.total).toBe(4);
    expect(s.new_in_range).toBe(3); // m2 (Jan) excluded
  });
  it('computes the segment mix', () => {
    expect(s.segment_mix).toEqual({ care: 3, wellness: 1 });
  });
  it('tallies the status distribution', () => {
    expect(s.status_distribution).toEqual({ new: 1, on_program: 1, at_risk: 1, lapsed: 1 });
  });
  it('counts at-risk via status OR acute-high pain (chronic does not count)', () => {
    expect(s.risk_distribution).toEqual({ at_risk: 3, ok: 1 }); // m1(acute), m3(at_risk), m4(lapsed)
  });
  it('splits by branch with names and Unassigned for null, sorted by count', () => {
    expect(s.branch_split[0]).toEqual({ branch_id: 'A', branch_name: 'Branch A', count: 2 });
    const byId = Object.fromEntries(s.branch_split.map((b) => [b.branch_id ?? 'null', b]));
    expect(byId.B).toEqual({ branch_id: 'B', branch_name: 'Branch B', count: 1 });
    expect(byId.null).toEqual({ branch_id: null, branch_name: 'Unassigned', count: 1 });
  });
  it('treats null cutoff (all-time) as everyone new-in-range', () => {
    expect(patientStats({ members, branches, painFlags, cutoff: null }).new_in_range).toBe(4);
  });
});

describe('activityStats', () => {
  const members = [
    { id: 'mA', status: 'on_program' }, // tracked
    { id: 'mB', status: 'new' },        // NOT tracked
    { id: 'mC', status: 'prescribed' }, // tracked, no sessions
  ];
  const sessions = [
    { member_id: 'mA', completed_at: d('2026-06-06T12:00:00Z') },
    { member_id: 'mA', completed_at: d('2026-06-05T12:00:00Z') },
    { member_id: 'mA', completed_at: d('2026-06-04T12:00:00Z') },
    { member_id: 'mA', completed_at: d('2026-06-03T12:00:00Z') },
    { member_id: 'mA', completed_at: d('2026-06-02T12:00:00Z') },
    { member_id: 'mA', completed_at: d('2026-06-01T12:00:00Z') }, // 6 within 14d & 30d
    { member_id: 'mA', completed_at: d('2026-04-28T12:00:00Z') }, // 40d ago: in 90d range, outside 30d
    { member_id: 'mB', completed_at: d('2026-06-02T12:00:00Z') },
  ];
  const completedAssessments = [
    { member_id: 'mA', musculage: 50, completed_at: d('2026-06-06T12:00:00Z') },
    { member_id: 'mB', musculage: 40, completed_at: d('2026-06-06T09:00:00Z') }, // same UTC day → avg with 50
    { member_id: 'mC', musculage: 44, completed_at: d('2026-06-01T12:00:00Z') },
  ];
  const latestMusculage = [44, 50];

  const s = activityStats({ members, sessions, completedAssessments, latestMusculage, now: NOW });

  it('totals sessions and per-active-member (distinct in range)', () => {
    expect(s.sessions_total).toBe(8);
    expect(s.sessions_per_active_member).toBe(4); // 8 sessions / 2 active (mA, mB)
  });
  it('counts distinct members active in the last 30 days', () => {
    expect(s.active_30d).toBe(2); // mA + mB (mA also has a 40d-old one but is already counted)
  });
  it('averages adherence over tracked members only', () => {
    // mA: 6/10 → 60 ; mC: 0/10 → 0 ; mB not tracked → excluded. mean = 30
    expect(s.adherence_avg).toBe(30);
  });
  it('averages latest Musculage across members', () => {
    expect(s.musculage_avg).toBe(47);
  });
  it('buckets the Musculage trend by UTC day, ascending', () => {
    expect(s.musculage_trend).toEqual([
      { date: '2026-06-01', avg: 44 },
      { date: '2026-06-06', avg: 45 }, // (50 + 40) / 2
    ]);
  });

  it('handles empty inputs without dividing by zero', () => {
    const e = activityStats({ members: [], sessions: [], completedAssessments: [], latestMusculage: [], now: NOW });
    expect(e).toEqual({
      sessions_total: 0, sessions_per_active_member: 0, active_30d: 0,
      adherence_avg: null, musculage_avg: null, musculage_trend: [],
    });
  });
});
