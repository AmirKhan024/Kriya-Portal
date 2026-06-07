import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import {
  members, pain_flags, program_instances, program_phases, program_items, games, program_templates,
} from '@/server/db/schema';
import { eq, and, notInArray, asc, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, requireEntitlement, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { computeGatingVerdict } from '@/server/clinical/pain-gate';

const itemInputSchema = z.object({
  game_id: z.string().uuid(),
  frequency_per_week: z.number().int().min(1).max(7).default(3),
});

const phaseInputSchema = z.object({
  name: z.string().min(1).max(100),
  duration_weeks: z.number().int().min(1).max(52),
  order: z.number().int().min(1),
  items: z.array(itemInputSchema).default([]),
});

const createProgramSchema = z.object({
  source_template_id: z.string().uuid().optional(),
  prescription_id: z.string().uuid().optional(),
  phases: z.array(phaseInputSchema).optional(),
}).strict();

type PhaseInput = { name: string; duration_weeks: number; order: number; items: { game_id: string; frequency_per_week: number }[] };

async function loadProgramWithPhases(instanceId: string) {
  const phases = await db
    .select()
    .from(program_phases)
    .where(eq(program_phases.instance_id, instanceId))
    .orderBy(asc(program_phases.order));

  return Promise.all(phases.map(async (phase) => {
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
        id: i.id,
        game_id: i.game_id,
        game_name: i.game_name ?? '',
        category: i.category ?? '',
        regions: i.regions ? (JSON.parse(i.regions) as string[]) : [],
        frequency_per_week: i.frequency_per_week,
        gating_verdict: i.gating_verdict,
        is_overridden: i.is_overridden,
      })),
    };
  }));
}

async function insertPhasesAndItems(
  instanceId: string,
  clinicId: string,
  phasesToCreate: PhaseInput[],
  activeFlags: { region: string; severity: number; type: string }[],
  gameMap: Map<string, { id: string; name: string; regions: string; category: string }>
) {
  for (const phaseData of phasesToCreate) {
    const phaseId = crypto.randomUUID();
    await db.insert(program_phases).values({
      id: phaseId,
      instance_id: instanceId,
      order: phaseData.order,
      name: phaseData.name,
      duration_weeks: phaseData.duration_weeks,
    });

    for (const itemData of phaseData.items) {
      const game = gameMap.get(itemData.game_id);
      if (!game) continue;

      const gameRegions = JSON.parse(game.regions) as string[];
      const verdict = computeGatingVerdict(gameRegions, activeFlags);

      await db.insert(program_items).values({
        id: crypto.randomUUID(),
        phase_id: phaseId,
        clinic_id: clinicId,
        game_id: itemData.game_id,
        frequency_per_week: itemData.frequency_per_week,
        gating_verdict: verdict,
        is_overridden: false,
      });
    }
  }
}

export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin']);

  const memberId = context?.params?.id ?? '';

  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

  await requireEntitlement(member.clinic_id, 'care_programs');

  const raw = await request.json();
  const parsed = createProgramSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  // Check no active program exists
  const [existing] = await db
    .select({ id: program_instances.id })
    .from(program_instances)
    .where(and(
      eq(program_instances.member_id, memberId),
      notInArray(program_instances.status, ['archived']),
    ))
    .limit(1);
  if (existing) {
    throw new ApiError('CONFLICT', 'Member already has an active program. Push an update or archive the existing one.', 409);
  }

  // Load pain flags for gating
  const activeFlags = await db
    .select()
    .from(pain_flags)
    .where(and(eq(pain_flags.member_id, memberId), eq(pain_flags.active, 'true')));

  // Load games for lookup
  const allGames = await db.select().from(games);
  const gameMap = new Map(allGames.map(g => [g.id, g]));

  // Resolve phases to create
  let phasesToCreate: PhaseInput[] = body.phases ?? [];

  if (body.source_template_id && phasesToCreate.length === 0) {
    const [template] = await db
      .select()
      .from(program_templates)
      .where(and(
        eq(program_templates.id, body.source_template_id),
        eq(program_templates.clinic_id, member.clinic_id),
      ))
      .limit(1);
    if (!template) throw new ApiError('NOT_FOUND', 'Template not found', 404);
    if (template.status !== 'published') {
      throw new ApiError('VALIDATION_ERROR', 'Template must be published before cloning', 400);
    }

    const templatePhases = await db
      .select()
      .from(program_phases)
      .where(eq(program_phases.template_id, body.source_template_id))
      .orderBy(asc(program_phases.order));

    phasesToCreate = await Promise.all(templatePhases.map(async (tp) => {
      const items = await db
        .select({ game_id: program_items.game_id, frequency_per_week: program_items.frequency_per_week })
        .from(program_items)
        .where(eq(program_items.phase_id, tp.id));
      return {
        name: tp.name ?? `Phase ${tp.order}`,
        duration_weeks: tp.duration_weeks ?? 3,
        order: tp.order,
        items: items.filter(i => i.game_id !== null).map(i => ({
          game_id: i.game_id!,
          frequency_per_week: i.frequency_per_week,
        })),
      };
    }));
  }

  if (phasesToCreate.length === 0) {
    phasesToCreate = [{ name: 'Phase 1', duration_weeks: 3, order: 1, items: [] }];
  }

  // Create program instance
  const instanceId = crypto.randomUUID();
  await db.insert(program_instances).values({
    id: instanceId,
    member_id: memberId,
    clinic_id: member.clinic_id,
    source_template_id: body.source_template_id ?? null,
    prescription_id: body.prescription_id ?? null,
    version: 1,
    status: 'draft',
    current_phase: 1,
  });

  await insertPhasesAndItems(
    instanceId,
    member.clinic_id,
    phasesToCreate,
    activeFlags.map(f => ({ region: f.region, severity: f.severity, type: f.type })),
    gameMap,
  );

  // Advance member status
  await db.update(members)
    .set({ status: 'on_program', updated_at: new Date() })
    .where(eq(members.id, memberId));

  await emit('program.assigned', user.id, member.clinic_id, `member:${memberId}`, {
    instance_id: instanceId,
    phase_count: phasesToCreate.length,
  });

  const [instance] = await db.select().from(program_instances).where(eq(program_instances.id, instanceId)).limit(1);
  const phases = await loadProgramWithPhases(instanceId);

  return NextResponse.json({ data: { ...instance, phases }, error: null }, { status: 201 });
});

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin', 'trainer']);

  const memberId = context?.params?.id ?? '';

  const [member] = await db
    .select({ id: members.id, clinic_id: members.clinic_id })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw new ApiError('NOT_FOUND', 'Member not found', 404);
  requireSameTenant(user, member.clinic_id);

  const [instance] = await db
    .select()
    .from(program_instances)
    .where(and(
      eq(program_instances.member_id, memberId),
      notInArray(program_instances.status, ['archived']),
    ))
    .orderBy(desc(program_instances.created_at))
    .limit(1);

  if (!instance) {
    return NextResponse.json({ data: null, error: null });
  }

  const phases = await loadProgramWithPhases(instance.id);

  return NextResponse.json({ data: { ...instance, phases }, error: null });
});
