import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { nudges } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { assertMemberVisible } from '@/modules/members/access';
import { patchNudgeSchema } from '@/modules/nudges/schemas';

export const dynamic = 'force-dynamic';

const NUDGE_ROLES = ['clinic_admin', 'ortho', 'physio', 'trainer', 'front_desk'] as const;

/**
 * PATCH /api/v1/nudges/:id — feature 2c · mark a nudge responded.
 *
 * Records the member's engagement, which resets the non-response streak that the
 * auto-scan watcher uses for escalation. Emits nudge.responded.
 */
export const PATCH = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...NUDGE_ROLES]);

  const id = context?.params?.id ?? '';
  const [nudge] = await db.select().from(nudges).where(eq(nudges.id, id)).limit(1);
  if (!nudge) throw new ApiError('NOT_FOUND', 'Nudge not found', 404);

  requireSameTenant(user, nudge.clinic_id);
  await assertMemberVisible(user, nudge.member_id); // assignment scoping for clinicians

  const raw = await request.json();
  const parsed = patchNudgeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const now = new Date();
  await db.update(nudges)
    .set({ status: 'responded', responded_at: now })
    .where(eq(nudges.id, id));

  await emit('nudge.responded', user.id, nudge.clinic_id, `member:${nudge.member_id}`, {
    nudge_id: id, channel: nudge.channel,
  });

  return NextResponse.json({
    data: { id, status: 'responded', responded_at: now },
    error: null,
  });
});
