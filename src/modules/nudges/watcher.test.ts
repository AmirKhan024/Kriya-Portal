import { describe, it, expect } from 'vitest';
import { findInactiveMembers, shouldEscalate } from './watcher';

const NOW = new Date('2026-06-07T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe('findInactiveMembers (48h threshold)', () => {
  const members = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];

  it('flags members with no activity in the window, including never-active', () => {
    const last = new Map<string, Date | null>([
      ['m1', hoursAgo(10)], // active
      ['m2', hoursAgo(50)], // inactive
      // m3 absent → never active → inactive
    ]);
    expect(findInactiveMembers({ members, lastActivityByMember: last, now: NOW })).toEqual(['m2', 'm3']);
  });

  it('treats activity exactly at the 48h boundary as inactive', () => {
    const last = new Map<string, Date | null>([['m1', hoursAgo(48)]]);
    expect(findInactiveMembers({ members: [{ id: 'm1' }], lastActivityByMember: last, now: NOW })).toEqual(['m1']);
  });

  it('respects a custom threshold', () => {
    const last = new Map<string, Date | null>([['m1', hoursAgo(10)]]);
    expect(findInactiveMembers({ members: [{ id: 'm1' }], lastActivityByMember: last, now: NOW, thresholdHours: 6 })).toEqual(['m1']);
  });
});

describe('shouldEscalate (>= 3 non-responses)', () => {
  it('escalates at the threshold, not before', () => {
    expect(shouldEscalate(2)).toBe(false);
    expect(shouldEscalate(3)).toBe(true);
    expect(shouldEscalate(5)).toBe(true);
  });
});
