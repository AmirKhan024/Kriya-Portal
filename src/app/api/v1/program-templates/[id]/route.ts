import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { program_templates, program_phases, program_items, games } from '@/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';

const updateTemplateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  segment: z.enum(['care', 'wellness']).optional(),
  phases: z.array(z.object({
    name: z.string().min(1).max(100),
    duration_weeks: z.number().int().min(1).max(52),
    order: z.number().int().min(1),
    items: z.array(z.object({
      game_id: z.string().uuid(),
      frequency_per_week: z.number().int().min(1).max(7).default(3),
    })).default([]),
  })).optional(),
});

async function loadTemplateWithPhases(templateId: string) {
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
        gating_verdict: program_items.gating_verdict,
      })
      .from(program_items)
      .leftJoin(games, eq(program_items.game_id, games.id))
      .where(eq(program_items.phase_id, phase.id));

    return {
      ...phase,
      items: items.map(i => ({ ...i, game_name: i.game_name ?? '', category: i.category ?? '' })),
    };
  }));
}

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin', 'trainer']);

  const templateId = context?.params?.id ?? '';

  const [template] = await db
    .select()
    .from(program_templates)
    .where(eq(program_templates.id, templateId))
    .limit(1);
  if (!template) throw new ApiError('NOT_FOUND', 'Template not found', 404);

  if (user.role !== 'ops' && user.clinic_id !== template.clinic_id) {
    throw new ApiError('TENANT_MISMATCH', 'Access denied', 403);
  }

  const phases = await loadTemplateWithPhases(templateId);

  return NextResponse.json({ data: { ...template, phases }, error: null });
});

export const PATCH = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['clinic_admin']);

  const templateId = context?.params?.id ?? '';

  const [template] = await db
    .select()
    .from(program_templates)
    .where(eq(program_templates.id, templateId))
    .limit(1);
  if (!template) throw new ApiError('NOT_FOUND', 'Template not found', 404);

  if (user.role !== 'ops' && user.clinic_id !== template.clinic_id) {
    throw new ApiError('TENANT_MISMATCH', 'Access denied', 403);
  }

  const raw = await request.json();
  const parsed = updateTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  if (body.name !== undefined || body.segment !== undefined) {
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.segment !== undefined) updates.segment = body.segment;
    await db.update(program_templates).set(updates).where(eq(program_templates.id, templateId));
  }

  if (body.phases !== undefined) {
    // Replace all phases and items (editing published template only affects future clones)
    const oldPhases = await db
      .select({ id: program_phases.id })
      .from(program_phases)
      .where(eq(program_phases.template_id, templateId));

    for (const oldPhase of oldPhases) {
      await db.delete(program_items).where(eq(program_items.phase_id, oldPhase.id));
    }
    await db.delete(program_phases).where(eq(program_phases.template_id, templateId));

    const allGames = await db.select({ id: games.id }).from(games);
    const gameMap = new Set(allGames.map(g => g.id));

    for (const phaseData of body.phases) {
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
          clinic_id: template.clinic_id,
          game_id: itemData.game_id,
          frequency_per_week: itemData.frequency_per_week,
          gating_verdict: 'eligible',
          is_overridden: false,
        });
      }
    }
  }

  const [updated] = await db
    .select()
    .from(program_templates)
    .where(eq(program_templates.id, templateId))
    .limit(1);
  const phases = await loadTemplateWithPhases(templateId);

  return NextResponse.json({ data: { ...updated, phases }, error: null });
});
