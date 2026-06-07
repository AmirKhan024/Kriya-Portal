import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { program_templates, program_phases, program_items } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

export const POST = withApiHandler(async (request, context) => {
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

  // Idempotent: already published
  if (template.status === 'published') {
    return NextResponse.json({
      data: { id: templateId, status: 'published', published_at: template.published_at },
      error: null,
    });
  }

  // Validate: at least 1 phase
  const phases = await db
    .select({ id: program_phases.id })
    .from(program_phases)
    .where(eq(program_phases.template_id, templateId));

  if (phases.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'Template must have at least one phase', 400);
  }

  // Validate: every phase has at least 1 item
  for (const phase of phases) {
    const [firstItem] = await db
      .select({ id: program_items.id })
      .from(program_items)
      .where(eq(program_items.phase_id, phase.id))
      .limit(1);
    if (!firstItem) {
      throw new ApiError('VALIDATION_ERROR', 'Each phase must have at least one exercise', 400);
    }
  }

  const publishedAt = new Date();
  await db.update(program_templates)
    .set({ status: 'published', published_at: publishedAt })
    .where(eq(program_templates.id, templateId));

  await emit('program_template.published', user.id, template.clinic_id, `template:${templateId}`, {
    name: template.name,
  });

  return NextResponse.json({
    data: { id: templateId, status: 'published', published_at: publishedAt },
    error: null,
  });
});
