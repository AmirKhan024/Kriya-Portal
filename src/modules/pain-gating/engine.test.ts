import { describe, it, expect } from 'vitest';
import {
  computeVerdict, parseRegions, computeGameEligibility, canOverride,
  type ActivePainFlag, type GameRow,
} from './engine';

const flag = (region: string, severity: number, type: 'acute' | 'chronic'): ActivePainFlag => ({ region, severity, type });

describe('computeVerdict', () => {
  it('eligible when no region overlap', () => {
    const v = computeVerdict(['knee'], [flag('lower_back', 9, 'acute')]);
    expect(v.verdict).toBe('eligible');
    expect(v.reason).toBeNull();
    expect(v.modifications).toBeNull();
  });

  it('eligible when there are no active flags', () => {
    expect(computeVerdict(['lower_back'], []).verdict).toBe('eligible');
  });

  it('blocked: acute AND severity >= 5', () => {
    expect(computeVerdict(['lower_back'], [flag('lower_back', 5, 'acute')]).verdict).toBe('blocked');
    expect(computeVerdict(['lower_back'], [flag('lower_back', 10, 'acute')]).verdict).toBe('blocked');
  });

  it('capped: acute but severity 3–4 (not yet blocked)', () => {
    expect(computeVerdict(['lower_back'], [flag('lower_back', 4, 'acute')]).verdict).toBe('capped');
    expect(computeVerdict(['lower_back'], [flag('lower_back', 3, 'acute')]).verdict).toBe('capped');
  });

  it('capped: chronic high severity is NOT blocked (blocked requires acute)', () => {
    expect(computeVerdict(['lower_back'], [flag('lower_back', 5, 'chronic')]).verdict).toBe('capped');
    expect(computeVerdict(['lower_back'], [flag('lower_back', 10, 'chronic')]).verdict).toBe('capped');
  });

  it('modified: severity < 3', () => {
    expect(computeVerdict(['knee'], [flag('knee', 2, 'acute')]).verdict).toBe('modified');
    expect(computeVerdict(['knee'], [flag('knee', 0, 'chronic')]).verdict).toBe('modified');
  });

  it('capped carries the standard modifications text', () => {
    const v = computeVerdict(['knee'], [flag('knee', 6, 'chronic')]);
    expect(v.modifications).toBe('Intensity reduced to 60%, ROM limited to -20%');
    expect(v.reason).toContain('knee');
    expect(v.reason).toContain('6/10');
  });

  it('humanizes the region label in the reason (underscores → spaces)', () => {
    const v = computeVerdict(['lower_back'], [flag('lower_back', 6, 'acute')]);
    expect(v.reason).toBe('Acute lower back pain (severity 6/10)');
  });

  it('first matching flag (by order) decides', () => {
    // game touches both knee and lower_back; knee flag (mild) comes first → modified,
    // even though the later lower_back acute flag would block.
    const flags = [flag('knee', 2, 'chronic'), flag('lower_back', 8, 'acute')];
    expect(computeVerdict(['knee', 'lower_back'], flags).verdict).toBe('modified');
    // but a game touching only lower_back is blocked by the second flag.
    expect(computeVerdict(['lower_back'], flags).verdict).toBe('blocked');
  });
});

describe('parseRegions', () => {
  it('parses a JSON array of strings', () => {
    expect(parseRegions('["knee","hip"]')).toEqual(['knee', 'hip']);
  });
  it('returns [] for malformed JSON', () => {
    expect(parseRegions('not json')).toEqual([]);
  });
  it('returns [] for non-array JSON and filters non-strings', () => {
    expect(parseRegions('{"a":1}')).toEqual([]);
    expect(parseRegions('["knee", 5, null]')).toEqual(['knee']);
  });
});

describe('computeGameEligibility', () => {
  const games: GameRow[] = [
    { id: 'g1', name: 'Bird Dog', slug: 'bird-dog', category: 'stability', regions: '["lower_back","core"]' },
    { id: 'g2', name: 'Standing Balance', slug: 'standing-balance', category: 'balance', regions: '["ankle","knee"]' },
    { id: 'g3', name: 'Shoulder Press', slug: 'shoulder-press', category: 'strength', regions: '["shoulder","neck"]' },
  ];

  it('applies verdicts per game for the member’s flags', () => {
    const result = computeGameEligibility(games, [flag('lower_back', 6, 'acute')]);
    const byId = Object.fromEntries(result.map((r) => [r.game_id, r]));
    expect(byId.g1.verdict).toBe('blocked');     // touches lower_back
    expect(byId.g2.verdict).toBe('eligible');    // ankle/knee
    expect(byId.g3.verdict).toBe('eligible');    // shoulder/neck
    expect(byId.g1.regions).toEqual(['lower_back', 'core']);
    expect(byId.g1.game_name).toBe('Bird Dog');
  });

  it('all eligible when no flags', () => {
    const result = computeGameEligibility(games, []);
    expect(result.every((r) => r.verdict === 'eligible')).toBe(true);
  });
});

describe('canOverride', () => {
  it('only Ortho/Physio can override a blocked game', () => {
    expect(canOverride('ortho')).toBe(true);
    expect(canOverride('physio')).toBe(true);
    expect(canOverride('trainer')).toBe(false);
    expect(canOverride('clinic_admin')).toBe(false);
    expect(canOverride('front_desk')).toBe(false);
    expect(canOverride('ops')).toBe(false);
  });
});
