import { db } from '@/server/db';
import { games, pain_flags } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';

export type GameEligibility = {
  game_id: string;
  game_name: string;
  slug: string;
  category: string;
  regions: string[];
  verdict: 'eligible' | 'modified' | 'capped' | 'blocked';
  reason: string | null;
  modifications: string | null;
};

function computeVerdict(
  gameRegions: string[],
  activeFlags: { region: string; severity: number; type: string; active: string }[]
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

// Replace this function body with a fetch to GET /api/v1/members/:id/game-eligibility
// when Dev A ships the real endpoint — the return type is identical.
export async function getGameEligibility(
  memberId: string,
  clinicId: string
): Promise<GameEligibility[]> {
  void clinicId; // reserved for when Dev A's real endpoint replaces this fixture
  const allGames = await db.select().from(games);
  const activeFlags = await db
    .select()
    .from(pain_flags)
    .where(and(eq(pain_flags.member_id, memberId), eq(pain_flags.active, 'true')));

  return allGames.map(game => {
    const gameRegions: string[] = JSON.parse(game.regions);
    const verdict = computeVerdict(gameRegions, activeFlags);
    return {
      game_id: game.id,
      game_name: game.name,
      slug: game.slug,
      category: game.category,
      regions: gameRegions,
      ...verdict,
    };
  });
}
