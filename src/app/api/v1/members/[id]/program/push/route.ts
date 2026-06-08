import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import {
  members, pain_flags, program_instances, program_phases, program_items, games,
} from '@/server/db/schema';
import { eq, and, notInArray, asc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { computeGatingVerdict } from '@/server/clinical/pain-gate';

export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin']);

  const memberId = context?.params?.id ?? '';

  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

  const [oldInstance] = await db
    .select()
    .from(program_instances)
    .where(and(
      eq(program_instances.member_id, memberId),
      notInArray(program_instances.status, ['archived']),
    ))
    .limit(1);
  if (!oldInstance) throw new ApiError('NOT_FOUND', 'No active program to update', 404);

  // Load old phases + items
  const oldPhases = await db
    .select()
    .from(program_phases)
    .where(eq(program_phases.instance_id, oldInstance.id))
    .orderBy(asc(program_phases.order));

  const oldPhasesWithItems = await Promise.all(oldPhases.map(async (phase) => {
    const items = await db
      .select()
      .from(program_items)
      .where(eq(program_items.phase_id, phase.id));
    return { ...phase, items };
  }));

  // Load current pain flags for re-gating
  const activeFlags = await db
    .select()
    .from(pain_flags)
    .where(and(eq(pain_flags.member_id, memberId), eq(pain_flags.active, 'true')));

  const allGames = await db.select().from(games);
  const gameMap = new Map(allGames.map(g => [g.id, g]));

  // Archive old program
  await db.update(program_instances)
    .set({ status: 'archived', updated_at: new Date() })
    .where(eq(program_instances.id, oldInstance.id));

  // Create new version
  const newInstanceId = crypto.randomUUID();
  await db.insert(program_instances).values({
    id: newInstanceId,
    member_id: memberId,
    clinic_id: member.clinic_id,
    source_template_id: oldInstance.source_template_id,
    prescription_id: oldInstance.prescription_id,
    version: oldInstance.version + 1,
    status: 'draft',
    current_phase: 1,
  });

  // Re-create phases and items, re-running pain gate (preserve explicit overrides)
  for (const oldPhase of oldPhasesWithItems) {
    const newPhaseId = crypto.randomUUID();
    await db.insert(program_phases).values({
      id: newPhaseId,
      instance_id: newInstanceId,
      order: oldPhase.order,
      name: oldPhase.name,
      duration_weeks: oldPhase.duration_weeks,
    });

    for (const oldItem of oldPhase.items) {
      if (!oldItem.game_id) continue;
      const game = gameMap.get(oldItem.game_id);
      if (!game) continue;

      const gameRegions = JSON.parse(game.regions) as string[];
      const verdict = oldItem.is_overridden
        ? ('eligible' as const)
        : computeGatingVerdict(
            gameRegions,
            activeFlags.map(f => ({ region: f.region, severity: f.severity, type: f.type })),
          );

      await db.insert(program_items).values({
        id: crypto.randomUUID(),
        phase_id: newPhaseId,
        clinic_id: member.clinic_id,
        game_id: oldItem.game_id,
        frequency_per_week: oldItem.frequency_per_week,
        gating_verdict: verdict,
        is_overridden: oldItem.is_overridden,
      });
    }
  }

  try {
    await emit('phase.advanced', user.id, member.clinic_id, `member:${memberId}`, {
      new_version: oldInstance.version + 1,
    });
  } catch (emitErr) {
    console.error('[ProgramPush] emit failed (non-fatal):', emitErr);
  }

  // Return new program
  const [newInstance] = await db
    .select()
    .from(program_instances)
    .where(eq(program_instances.id, newInstanceId))
    .limit(1);

  const newPhases = await db
    .select()
    .from(program_phases)
    .where(eq(program_phases.instance_id, newInstanceId))
    .orderBy(asc(program_phases.order));

  const phasesWithItems = await Promise.all(newPhases.map(async (phase) => {
    const items = await db
      .select({
        id: program_items.id,
        game_id: program_items.game_id,
        game_name: games.name,
        category: games.category,
        regions: games.regions,
        frequency_per_week: program_items.frequency_per_week,
        gating_verdict: program_items.gating_verdict,
        is_overridden: program_items.is_overridden,
      })
      .from(program_items)
      .leftJoin(games, eq(program_items.game_id, games.id))
      .where(eq(program_items.phase_id, phase.id));

    return {
      id: phase.id,
      order: phase.order,
      name: phase.name,
      duration_weeks: phase.duration_weeks,
      items: items.map(i => ({
        ...i,
        regions: i.regions ? (JSON.parse(i.regions) as string[]) : [],
        game_name: i.game_name ?? '',
        category: i.category ?? '',
      })),
    };
  }));

  return NextResponse.json({
    data: { ...newInstance, phases: phasesWithItems },
    error: null,
  }, { status: 201 });
});
