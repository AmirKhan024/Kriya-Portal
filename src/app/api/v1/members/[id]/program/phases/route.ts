import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { members, program_instances, program_phases } from '@/server/db/schema';
import { eq, and, notInArray, asc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';

const addPhaseSchema = z.object({
  name: z.string().min(1).max(100),
  duration_weeks: z.number().int().min(1).max(52).default(3),
  order: z.number().int().min(1).optional(),
});

export const POST = withApiHandler(async (request, context) => {
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
  const parsed = addPhaseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  // Get active program
  const [instance] = await db
    .select({ id: program_instances.id })
    .from(program_instances)
    .where(and(
      eq(program_instances.member_id, memberId),
      notInArray(program_instances.status, ['archived']),
    ))
    .limit(1);
  if (!instance) throw new ApiError('NOT_FOUND', 'No active program found', 404);

  // Determine order (next after existing phases)
  const existingPhases = await db
    .select({ order: program_phases.order })
    .from(program_phases)
    .where(eq(program_phases.instance_id, instance.id))
    .orderBy(asc(program_phases.order));

  const nextOrder = body.order ?? (existingPhases.length > 0
    ? Math.max(...existingPhases.map(p => p.order)) + 1
    : 1);

  const phaseId = crypto.randomUUID();
  await db.insert(program_phases).values({
    id: phaseId,
    instance_id: instance.id,
    order: nextOrder,
    name: body.name,
    duration_weeks: body.duration_weeks,
  });

  return NextResponse.json({
    data: {
      id: phaseId,
      instance_id: instance.id,
      order: nextOrder,
      name: body.name,
      duration_weeks: body.duration_weeks,
      items: [],
    },
    error: null,
  }, { status: 201 });
});
