import { QUALIFIED_ROLES, type UserRole } from '@/types/auth';

/**
 * ⭐ Pain-Gating engine (Dev A signature subsystem) — feature 1c.
 *
 * Deterministic, server-authoritative. The LLM never touches this; the client only
 * renders the verdict. Implements brief §8 1c exactly. The output shape is byte-
 * compatible with Dev B's `src/server/clinical/eligibility-fixture.ts` so Dev B can
 * swap their fixture for a fetch to GET /v1/members/:id/game-eligibility with no changes.
 */

export type Verdict = 'eligible' | 'modified' | 'capped' | 'blocked';

export type GameEligibility = {
  game_id: string;
  game_name: string;
  slug: string;
  category: string;
  regions: string[];
  verdict: Verdict;
  reason: string | null;
  modifications: string | null;
};

/** Minimal shape of an active pain flag the engine needs. */
export type ActivePainFlag = {
  region: string;
  severity: number;
  type: string; // 'acute' | 'chronic'
};

/** A game row as stored: `regions` is a JSON-encoded string array. */
export type GameRow = {
  id: string;
  name: string;
  slug: string;
  category: string;
  regions: string;
};

/**
 * The core rule (conservative by design — false-safe over false-permissive):
 *   no region overlap                 → eligible (full)
 *   matching flag: Acute AND sev ≥ 5  → blocked   (needs override)
 *   matching flag: sev ≥ 3            → capped    (intensity ×0.6, ROM −20%)
 *   matching flag: sev < 3            → modified  (seated / low-load)
 * The first matching flag (in flag order) decides. As pain is re-scored lower, a game
 * naturally relaxes to the next safer state on the next call.
 */
export function computeVerdict(
  gameRegions: string[],
  activeFlags: ActivePainFlag[],
): Pick<GameEligibility, 'verdict' | 'reason' | 'modifications'> {
  for (const flag of activeFlags) {
    if (!gameRegions.includes(flag.region)) continue;

    const label = flag.region.replace(/_/g, ' ');
    if (flag.type === 'acute' && flag.severity >= 5) {
      return {
        verdict: 'blocked',
        reason: `Acute ${label} pain (severity ${flag.severity}/10)`,
        modifications: null,
      };
    }
    if (flag.severity >= 3) {
      return {
        verdict: 'capped',
        reason: `Pain in ${label} (severity ${flag.severity}/10)`,
        modifications: 'Intensity reduced to 60%, ROM limited to -20%',
      };
    }
    return {
      verdict: 'modified',
      reason: `Mild ${label} discomfort (severity ${flag.severity}/10)`,
      modifications: 'Seated or low-load variant recommended',
    };
  }
  return { verdict: 'eligible', reason: null, modifications: null };
}

/** Safely parse a game's JSON-encoded `regions` column into a string[]. */
export function parseRegions(regionsJson: string): string[] {
  try {
    const parsed = JSON.parse(regionsJson);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

/** Compute the full game catalog with a verdict per game for a member's active flags. */
export function computeGameEligibility(
  games: GameRow[],
  activeFlags: ActivePainFlag[],
): GameEligibility[] {
  return games.map((game) => {
    const regions = parseRegions(game.regions);
    return {
      game_id: game.id,
      game_name: game.name,
      slug: game.slug,
      category: game.category,
      regions,
      ...computeVerdict(regions, activeFlags),
    };
  });
}

/**
 * Whether a role may lift a BLOCKED game (with a written reason). Only medically-
 * qualified roles (Ortho/Physio). A Trainer can never unlock a clinical lock. The
 * override WRITE (override_log + painlock.overridden) happens at program-item level
 * (Dev B's program builder); this just reports capability for the UI.
 */
export function canOverride(role: UserRole): boolean {
  return QUALIFIED_ROLES.includes(role);
}
