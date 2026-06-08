import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { members, program_instances, program_phases, program_items, override_log } from '@/server/db/schema';
import { eq, and, notInArray } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

const overrideSchema = z.object({
  reason: z.string()
    .min(10, 'Reason must be at least 10 characters')
    .max(500),
});

export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio']); // Qualified clinicians only — trainers cannot override

  const memberId = context?.params?.id ?? '';
  const itemId = context?.params?.itemId ?? '';

  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

  const raw = await request.json();
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  const [instance] = await db
    .select({ id: program_instances.id })
    .from(program_instances)
    .where(and(
      eq(program_instances.member_id, memberId),
      notInArray(program_instances.status, ['archived']),
    ))
    .limit(1);
  if (!instance) throw new ApiError('NOT_FOUND', 'No active program found', 404);

  const phases = await db
    .select({ id: program_phases.id })
    .from(program_phases)
    .where(eq(program_phases.instance_id, instance.id));
  const phaseIds = phases.map(p => p.id);

  const [item] = await db
    .select()
    .from(program_items)
    .where(eq(program_items.id, itemId))
    .limit(1);
  if (!item || !phaseIds.includes(item.phase_id)) {
    throw new ApiError('NOT_FOUND', 'Item not found in active program', 404);
  }

  if (item.gating_verdict !== 'blocked') {
    throw new ApiError('VALIDATION_ERROR', 'Only blocked items can be overridden', 400);
  }

  if (item.is_overridden) {
    throw new ApiError('CONFLICT', 'Item is already overridden', 409);
  }

  await db.update(program_items)
    .set({ is_overridden: true, gating_verdict: 'eligible' })
    .where(eq(program_items.id, itemId));

  await db.insert(override_log).values({
    member_id: memberId,
    clinic_id: member.clinic_id,
    item_id: itemId,
    by_user: user.id,
    reason: body.reason,
  });

  try {
    await emit('painlock.overridden', user.id, member.clinic_id, `member:${memberId}`, {
      item_id: itemId,
      game_id: item.game_id,
      reason: body.reason,
    });
  } catch (emitErr) {
    console.error('[PainOverride] emit failed (non-fatal):', emitErr);
  }

  return NextResponse.json({
    data: { item_id: itemId, is_overridden: true, override_reason: body.reason },
    error: null,
  });
});
