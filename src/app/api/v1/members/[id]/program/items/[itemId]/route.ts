import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members, program_instances, program_phases, program_items } from '@/server/db/schema';
import { eq, and, notInArray } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

export const DELETE = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin']);

  const memberId = context?.params?.id ?? '';
  const itemId = context?.params?.itemId ?? '';

  const [member] = await db
    .select({ id: members.id, clinic_id: members.clinic_id })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

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

  await db.delete(program_items).where(eq(program_items.id, itemId));

  try {
    await emit('program.customized', user.id, member.clinic_id, `member:${memberId}`, {
      action: 'remove_item',
      item_id: itemId,
    });
  } catch (emitErr) {
    console.error('[ProgramItem] emit failed (non-fatal):', emitErr);
  }

  return NextResponse.json({ data: { deleted: true }, error: null });
});
