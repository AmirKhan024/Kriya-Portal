import { describe, it, expect } from 'vitest';

// Inline computeGatingVerdict to avoid DB imports — tests the pure logic only.
// This mirrors src/server/clinical/pain-gate.ts exactly.
type GatingVerdict = 'eligible' | 'modified' | 'capped' | 'blocked';

function computeGatingVerdict(
  gameRegions: string[],
  flags: { region: string; severity: number; type: string }[],
): GatingVerdict {
  for (const flag of flags) {
    if (!gameRegions.includes(flag.region)) continue;
    if (flag.type === 'acute' && flag.severity >= 5) return 'blocked';
    if (flag.severity >= 3) return 'capped';
    return 'modified';
  }
  return 'eligible';
}

// ── computeGatingVerdict: determinism tests ────────────────────────────────

describe('computeGatingVerdict', () => {
  it('returns eligible when no flags match any game region', () => {
    const verdict = computeGatingVerdict(['shoulder', 'neck'], [
      { region: 'lower_back', severity: 7, type: 'acute' },
    ]);
    expect(verdict).toBe('eligible');
  });

  it('returns eligible when there are no flags at all', () => {
    expect(computeGatingVerdict(['core', 'lower_back'], [])).toBe('eligible');
  });

  it('returns blocked for acute flag with severity >= 5 in matching region', () => {
    const verdict = computeGatingVerdict(['lower_back', 'core'], [
      { region: 'lower_back', severity: 5, type: 'acute' },
    ]);
    expect(verdict).toBe('blocked');
  });

  it('returns blocked at severity exactly 5 (boundary)', () => {
    expect(computeGatingVerdict(['knee'], [
      { region: 'knee', severity: 5, type: 'acute' },
    ])).toBe('blocked');
  });

  it('returns blocked at severity 10 (upper bound)', () => {
    expect(computeGatingVerdict(['hip'], [
      { region: 'hip', severity: 10, type: 'acute' },
    ])).toBe('blocked');
  });

  it('does NOT block for acute flag with severity 4 (just below threshold)', () => {
    const verdict = computeGatingVerdict(['lower_back'], [
      { region: 'lower_back', severity: 4, type: 'acute' },
    ]);
    // severity >= 3 → capped (not blocked, since severity < 5)
    expect(verdict).toBe('capped');
  });

  it('does NOT block for chronic flag with severity >= 5 (only acute triggers block)', () => {
    const verdict = computeGatingVerdict(['lower_back'], [
      { region: 'lower_back', severity: 8, type: 'chronic' },
    ]);
    // chronic + severity >= 3 → capped
    expect(verdict).toBe('capped');
  });

  it('returns capped when severity >= 3 (non-acute)', () => {
    expect(computeGatingVerdict(['ankle'], [
      { region: 'ankle', severity: 3, type: 'chronic' },
    ])).toBe('capped');
  });

  it('returns capped at severity exactly 3 (boundary)', () => {
    expect(computeGatingVerdict(['shoulder'], [
      { region: 'shoulder', severity: 3, type: 'sub_acute' },
    ])).toBe('capped');
  });

  it('returns modified when severity < 3 and flag region matches', () => {
    expect(computeGatingVerdict(['core', 'hip'], [
      { region: 'hip', severity: 2, type: 'chronic' },
    ])).toBe('modified');
  });

  it('returns modified at severity 1 (lowest possible match)', () => {
    expect(computeGatingVerdict(['knee'], [
      { region: 'knee', severity: 1, type: 'chronic' },
    ])).toBe('modified');
  });

  it('uses first matching flag in iteration order (blocked wins if first)', () => {
    // lower_back flag is acute sev 7 → blocked; second flag is for same region but lower sev
    // Only first matching flag matters due to early return
    const verdict = computeGatingVerdict(['lower_back'], [
      { region: 'lower_back', severity: 7, type: 'acute' },
      { region: 'lower_back', severity: 2, type: 'chronic' },
    ]);
    expect(verdict).toBe('blocked');
  });

  it('skips non-matching regions and finds matching one', () => {
    const verdict = computeGatingVerdict(['core'], [
      { region: 'shoulder', severity: 9, type: 'acute' },
      { region: 'core', severity: 4, type: 'acute' },
    ]);
    // shoulder doesn't match; core acute sev 4 < 5 → capped
    expect(verdict).toBe('capped');
  });

  it('is deterministic: same inputs always return same output', () => {
    const args: [string[], { region: string; severity: number; type: string }[]] = [
      ['lower_back', 'core'],
      [{ region: 'lower_back', severity: 6, type: 'acute' }],
    ];
    expect(computeGatingVerdict(...args)).toBe(computeGatingVerdict(...args));
  });

  it('returns eligible for empty regions array', () => {
    expect(computeGatingVerdict([], [
      { region: 'lower_back', severity: 9, type: 'acute' },
    ])).toBe('eligible');
  });
});

// ── Template publish validation logic ─────────────────────────────────────

describe('template publish validation (logic mirror)', () => {
  type Phase = { id: string; items: unknown[] };

  function validateTemplateForPublish(phases: Phase[]): { valid: boolean; error?: string } {
    if (phases.length === 0) return { valid: false, error: 'Template must have at least one phase' };
    for (const phase of phases) {
      if (phase.items.length === 0) return { valid: false, error: 'Each phase must have at least one exercise' };
    }
    return { valid: true };
  }

  it('fails validation with no phases', () => {
    const result = validateTemplateForPublish([]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least one phase/);
  });

  it('fails validation when a phase has no items', () => {
    const result = validateTemplateForPublish([{ id: 'p1', items: [] }]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least one exercise/);
  });

  it('fails when second phase has no items but first does', () => {
    const result = validateTemplateForPublish([
      { id: 'p1', items: [{}] },
      { id: 'p2', items: [] },
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least one exercise/);
  });

  it('passes validation with all phases having items', () => {
    const result = validateTemplateForPublish([
      { id: 'p1', items: [{}] },
      { id: 'p2', items: [{}, {}] },
    ]);
    expect(result.valid).toBe(true);
  });
});

// ── Program push: override preservation logic ─────────────────────────────

describe('program push: override preservation', () => {
  type OldItem = { game_id: string; is_overridden: boolean; gating_verdict: string };

  // Mirror the logic in POST /program/push:
  // if oldItem.is_overridden === true → preserve as 'eligible', skip gate
  function resolveNewVerdict(
    oldItem: OldItem,
    gateResult: GatingVerdict,
  ): GatingVerdict {
    if (oldItem.is_overridden) return 'eligible';
    return gateResult;
  }

  it('preserves eligible verdict for overridden items regardless of gate result', () => {
    expect(resolveNewVerdict({ game_id: 'g1', is_overridden: true, gating_verdict: 'blocked' }, 'blocked')).toBe('eligible');
  });

  it('does not override non-overridden items', () => {
    expect(resolveNewVerdict({ game_id: 'g1', is_overridden: false, gating_verdict: 'blocked' }, 'blocked')).toBe('blocked');
  });

  it('applies new gate verdict to non-overridden items', () => {
    expect(resolveNewVerdict({ game_id: 'g1', is_overridden: false, gating_verdict: 'capped' }, 'capped')).toBe('capped');
  });

  it('overridden item always comes back eligible even if gating changed', () => {
    // Pain flag may have changed severity — overridden items still stay eligible
    expect(resolveNewVerdict({ game_id: 'g1', is_overridden: true, gating_verdict: 'eligible' }, 'capped')).toBe('eligible');
  });
});
