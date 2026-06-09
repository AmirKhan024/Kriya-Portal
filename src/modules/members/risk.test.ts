import { describe, it, expect } from 'vitest';
import { computeAdherence, deriveRisk, isAdherenceTracked } from './risk';

describe('isAdherenceTracked', () => {
  it('tracks engaged statuses only', () => {
    expect(isAdherenceTracked('on_program')).toBe(true);
    expect(isAdherenceTracked('prescribed')).toBe(true);
    expect(isAdherenceTracked('new')).toBe(false);
    expect(isAdherenceTracked('assessed')).toBe(false);
    expect(isAdherenceTracked('discharged')).toBe(false);
  });
});

describe('computeAdherence', () => {
  it('returns null when not tracked', () => {
    expect(computeAdherence(5, false)).toBeNull();
  });
  it('computes capped percentage of expected', () => {
    expect(computeAdherence(5, true, 10)).toBe(50);
    expect(computeAdherence(10, true, 10)).toBe(100);
    expect(computeAdherence(20, true, 10)).toBe(100); // capped
    expect(computeAdherence(0, true, 10)).toBe(0);
  });
});

describe('deriveRisk', () => {
  it('flags acute high pain first', () => {
    expect(deriveRisk({ status: 'new', adherence: null, hasAcuteHighPain: true, daysSinceActivity: 0 }))
      .toEqual({ atRisk: true, reason: 'Acute pain' });
  });
  it('flags lapsed', () => {
    expect(deriveRisk({ status: 'lapsed', adherence: 100, hasAcuteHighPain: false, daysSinceActivity: 1 }).atRisk).toBe(true);
  });
  it('flags low adherence', () => {
    expect(deriveRisk({ status: 'on_program', adherence: 40, hasAcuteHighPain: false, daysSinceActivity: 2 }))
      .toEqual({ atRisk: true, reason: 'Low adherence' });
  });
  it('flags no recent activity for on-program/prescribed', () => {
    expect(deriveRisk({ status: 'on_program', adherence: 90, hasAcuteHighPain: false, daysSinceActivity: null }).atRisk).toBe(true);
    expect(deriveRisk({ status: 'prescribed', adherence: 90, hasAcuteHighPain: false, daysSinceActivity: 20 }).reason).toBe('No recent activity');
  });
  it('is not at-risk for a healthy on-program member', () => {
    expect(deriveRisk({ status: 'on_program', adherence: 90, hasAcuteHighPain: false, daysSinceActivity: 1 }))
      .toEqual({ atRisk: false, reason: null });
  });
  it('does not flag a brand-new member with no pain', () => {
    expect(deriveRisk({ status: 'new', adherence: null, hasAcuteHighPain: false, daysSinceActivity: null }).atRisk).toBe(false);
  });
});
