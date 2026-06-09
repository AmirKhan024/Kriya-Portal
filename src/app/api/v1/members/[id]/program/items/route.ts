import { NextResponse } from 'next/server';
import { z } from 'zod';
import { uuidish } from '@/server/validation';
import { db } from '@/server/db';
import {
  members, pain_flags, program_instances, program_phases, program_items, games,
} from '@/server/db/schema';
import { eq, and, notInArray } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { computeGatingVerdict } from '@/server/clinical/pain-gate';

const addItemSchema = z.object({
  phase_id: uuidish,
  game_id: uuidish,
  frequency_per_week: z.number().int().min(1).max(7).default(3),
});

const updateItemSchema = z.object({
  item_id: uuidish,
  frequency_per_week: z.number().int().min(1).max(7),
});

async function getActiveInstance(memberId: string) {
  const [instance] = await db
    .select()
    .from(program_instances)
    .where(and(
      eq(program_instances.member_id, memberId),
      notInArray(program_instances.status, ['archived']),
    ))
    .limit(1);
  return instance ?? null;
}

async function getPhaseIdsForInstance(instanceId: string): Promise<string[]> {
  const phases = await db
    .select({ id: program_phases.id })
    .from(program_phases)
    .where(eq(program_phases.instance_id, instanceId));
  return phases.map(p => p.id);
}

export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin']);

  const memberId = context?.params?.id ?? '';

  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

  const raw = await request.json();
  const parsed = addItemSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  const instance = await getActiveInstance(memberId);
  if (!instance) throw new ApiError('NOT_FOUND', 'No active program found', 404);

  // Verify phase belongs to this program
  const [phase] = await db
    .select()
    .from(program_phases)
    .where(and(
      eq(program_phases.id, body.phase_id),
      eq(program_phases.instance_id, instance.id),
    ))
    .limit(1);
  if (!phase) throw new ApiError('NOT_FOUND', 'Phase not found in active program', 404);

  // No duplicates in same phase
  const [existingItem] = await db
    .select({ id: program_items.id })
    .from(program_items)
    .where(and(
      eq(program_items.phase_id, body.phase_id),
      eq(program_items.game_id, body.game_id),
    ))
    .limit(1);
  if (existingItem) {
    throw new ApiError('CONFLICT', 'This exercise is already in the phase', 409);
  }

  const [game] = await db.select().from(games).where(eq(games.id, body.game_id)).limit(1);
  if (!game) throw new ApiError('NOT_FOUND', 'Game not found', 404);

  const activeFlags = await db
    .select()
    .from(pain_flags)
    .where(and(eq(pain_flags.member_id, memberId), eq(pain_flags.active, 'true')));

  const gameRegions = JSON.parse(game.regions) as string[];
  const verdict = computeGatingVerdict(
    gameRegions,
    activeFlags.map(f => ({ region: f.region, severity: f.severity, type: f.type })),
  );

  const itemId = crypto.randomUUID();
  await db.insert(program_items).values({
    id: itemId,
    phase_id: body.phase_id,
    clinic_id: member.clinic_id,
    game_id: body.game_id,
    frequency_per_week: body.frequency_per_week,
    gating_verdict: verdict,
    is_overridden: false,
  });

  try {
    await emit('program.customized', user.id, member.clinic_id, `member:${memberId}`, {
      action: 'add_item',
      game_id: body.game_id,
      phase_id: body.phase_id,
    });
  } catch (emitErr) {
    console.error('[ProgramItems] emit failed (non-fatal):', emitErr);
  }

  return NextResponse.json({
    data: {
      id: itemId,
      game_id: body.game_id,
      game_name: game.name,
      category: game.category,
      regions: gameRegions,
      frequency_per_week: body.frequency_per_week,
      gating_verdict: verdict,
      is_overridden: false,
    },
    error: null,
  }, { status: 201 });
});

export const PATCH = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin']);

  const memberId = context?.params?.id ?? '';

  const [member] = await db
    .select({ id: members.id, clinic_id: members.clinic_id })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

  const raw = await request.json();
  const parsed = updateItemSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  const instance = await getActiveInstance(member.id);
  if (!instance) throw new ApiError('NOT_FOUND', 'No active program found', 404);

  const phaseIds = await getPhaseIdsForInstance(instance.id);

  const [item] = await db
    .select()
    .from(program_items)
    .where(eq(program_items.id, body.item_id))
    .limit(1);
  if (!item || !phaseIds.includes(item.phase_id)) {
    throw new ApiError('NOT_FOUND', 'Item not found in active program', 404);
  }

  await db.update(program_items)
    .set({ frequency_per_week: body.frequency_per_week })
    .where(eq(program_items.id, body.item_id));

  return NextResponse.json({
    data: { id: body.item_id, frequency_per_week: body.frequency_per_week },
    error: null,
  });
});
