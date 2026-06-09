import { NextResponse } from 'next/server';
import { z } from 'zod';
import { uuidish } from '@/server/validation';
import { db } from '@/server/db';
import { program_templates, program_phases, program_items, games } from '@/server/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireEntitlement, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

const itemInputSchema = z.object({
  game_id: uuidish,
  frequency_per_week: z.number().int().min(1).max(7).default(3),
});

const phaseInputSchema = z.object({
  name: z.string().min(1).max(100),
  duration_weeks: z.number().int().min(1).max(52),
  order: z.number().int().min(1),
  items: z.array(itemInputSchema).default([]),
});

const createTemplateSchema = z.object({
  name: z.string().min(2).max(100),
  segment: z.enum(['care', 'wellness']),
  phases: z.array(phaseInputSchema).default([]),
});

async function loadTemplatePhases(templateId: string) {
  const phases = await db
    .select()
    .from(program_phases)
    .where(eq(program_phases.template_id, templateId))
    .orderBy(asc(program_phases.order));

  return Promise.all(phases.map(async (phase) => {
    const items = await db
      .select({
        id: program_items.id,
        game_id: program_items.game_id,
        game_name: games.name,
        category: games.category,
        frequency_per_week: program_items.frequency_per_week,
      })
      .from(program_items)
      .leftJoin(games, eq(program_items.game_id, games.id))
      .where(eq(program_items.phase_id, phase.id));

    return { ...phase, items: items.map(i => ({ ...i, game_name: i.game_name ?? '', category: i.category ?? '' })) };
  }));
}

async function insertTemplatePhases(
  templateId: string,
  clinicId: string,
  phasesData: z.infer<typeof phaseInputSchema>[],
  gameMap: Map<string, { id: string }>,
) {
  for (const phaseData of phasesData) {
    const phaseId = crypto.randomUUID();
    await db.insert(program_phases).values({
      id: phaseId,
      template_id: templateId,
      order: phaseData.order,
      name: phaseData.name,
      duration_weeks: phaseData.duration_weeks,
    });

    for (const itemData of phaseData.items) {
      if (!gameMap.has(itemData.game_id)) continue;
      await db.insert(program_items).values({
        id: crypto.randomUUID(),
        phase_id: phaseId,
        clinic_id: clinicId,
        game_id: itemData.game_id,
        frequency_per_week: itemData.frequency_per_week,
        gating_verdict: 'eligible', // No pain gating on templates
        is_overridden: false,
      });
    }
  }
}

export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['clinic_admin']);

  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'No clinic context', 403);

  await requireEntitlement(user.clinic_id, 'care_programs');

  const raw = await request.json();
  const parsed = createTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  const allGames = await db.select({ id: games.id }).from(games);
  const gameMap = new Map(allGames.map(g => [g.id, g]));

  const templateId = crypto.randomUUID();
  await db.insert(program_templates).values({
    id: templateId,
    clinic_id: user.clinic_id,
    created_by: user.id,
    name: body.name,
    segment: body.segment,
    status: 'draft',
  });

  await insertTemplatePhases(templateId, user.clinic_id, body.phases, gameMap);

  try {
    await emit('program.customized', user.id, user.clinic_id, `template:${templateId}`, {
      action: 'template_created',
      template_id: templateId,
    });
  } catch (emitErr) {
    console.error('[ProgramTemplates] emit failed (non-fatal):', emitErr);
  }

  const [template] = await db
    .select()
    .from(program_templates)
    .where(eq(program_templates.id, templateId))
    .limit(1);
  const phases = await loadTemplatePhases(templateId);

  return NextResponse.json({ data: { ...template, phases }, error: null }, { status: 201 });
});

export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin', 'trainer']);

  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'No clinic context', 403);

  const templates = await db
    .select()
    .from(program_templates)
    .where(eq(program_templates.clinic_id, user.clinic_id))
    .orderBy(desc(program_templates.created_at));

  const templatesWithCounts = await Promise.all(templates.map(async (t) => {
    const phases = await loadTemplatePhases(t.id);
    const totalItems = phases.reduce((sum, p) => sum + p.items.length, 0);
    return { ...t, phase_count: phases.length, item_count: totalItems };
  }));

  return NextResponse.json({ data: templatesWithCounts, error: null });
});
