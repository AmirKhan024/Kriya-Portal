import { describe, it, expect } from 'vitest';
import { withinFrequencyCap, nonResponseStreak, type NudgeLike } from './frequency';
import { DAY_MS } from './constants';

const NOW = new Date('2026-06-07T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function sent(when: Date, responded = false): NudgeLike {
  return { status: responded ? 'responded' : 'sent', sent_at: when, responded_at: responded ? when : null, created_at: when };
}

describe('withinFrequencyCap (1/day, 3/week)', () => {
  it('allows when there are no recent nudges', () => {
    expect(withinFrequencyCap([], NOW)).toEqual({ allowed: true, reason: null });
  });

  it('blocks on the daily cap (one sent within 24h)', () => {
    const v = withinFrequencyCap([sent(ago(2 * 60 * 60 * 1000))], NOW);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/Daily/);
  });

  it('treats a nudge exactly 24h old as outside the day window', () => {
    expect(withinFrequencyCap([sent(ago(DAY_MS))], NOW).allowed).toBe(true);
  });

  it('blocks on the weekly cap (3 sent within 7d but older than 24h)', () => {
    const recent = [ago(2 * DAY_MS), ago(3 * DAY_MS), ago(4 * DAY_MS)].map((d) => sent(d));
    const v = withinFrequencyCap(recent, NOW);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/Weekly/);
  });

  it('ignores scheduled-but-not-sent nudges', () => {
    const scheduled: NudgeLike = { status: 'scheduled', sent_at: null, responded_at: null, created_at: ago(60_000) };
    expect(withinFrequencyCap([scheduled], NOW).allowed).toBe(true);
  });
});

describe('nonResponseStreak', () => {
  it('counts consecutive most-recent unresponded sends', () => {
    const list = [sent(ago(DAY_MS)), sent(ago(2 * DAY_MS)), sent(ago(3 * DAY_MS), true)];
    expect(nonResponseStreak(list)).toBe(2);
  });

  it('resets to 0 when the most recent send was responded', () => {
    expect(nonResponseStreak([sent(ago(DAY_MS), true), sent(ago(2 * DAY_MS))])).toBe(0);
  });

  it('is 0 with no sends', () => {
    expect(nonResponseStreak([])).toBe(0);
  });
});
