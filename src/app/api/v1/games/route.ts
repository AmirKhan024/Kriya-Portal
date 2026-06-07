import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { games } from '@/server/db/schema';
import { getAuthedUser, requireRole, withApiHandler } from '@/server/auth/middleware';

export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin', 'trainer', 'front_desk']);

  const allGames = await db.select().from(games);

  return NextResponse.json({
    data: allGames.map(g => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      category: g.category,
      regions: JSON.parse(g.regions) as string[],
    })),
    error: null,
  });
});
