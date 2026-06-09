import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { games, pain_flags } from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAuthedUser, withApiHandler } from '@/server/auth/middleware';
import { assertMemberVisible } from '@/modules/members/access';
import { computeGameEligibility, canOverride } from '@/modules/pain-gating/engine';

/**
 * GET /api/v1/members/:id/game-eligibility — feature 1c · ⭐ Pain-Gating.
 *
 * Returns the full game catalog with a server-computed verdict per game
 * (eligible | modified | capped | blocked) for the member's active pain flags.
 * Read-only (no event). Safety is always computed (not behind an entitlement).
 * `meta.can_override` tells the UI whether the caller (Ortho/Physio) may lift a
 * BLOCKED game; the override write itself lives in the program builder (Dev B).
 *
 * Replaces Dev B's eligibility-fixture — the `data` items are byte-compatible.
 */
export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const memberId = context?.params?.id ?? '';

  // Visibility scoping (cross-tenant / unassigned → 404).
  await assertMemberVisible(user, memberId);

  const allGames = await db.select().from(games);
  const activeFlags = await db
    .select()
    .from(pain_flags)
    .where(and(eq(pain_flags.member_id, memberId), eq(pain_flags.active, 'true')));

  const data = computeGameEligibility(allGames, activeFlags);

  return NextResponse.json({
    data,
    error: null,
    meta: { can_override: canOverride(user.role) },
  });
});
