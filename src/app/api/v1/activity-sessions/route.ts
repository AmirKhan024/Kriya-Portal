import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { members, activity_sessions } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import type { UserRole } from '@/types/auth';

/**
 * POST /api/v1/activity-sessions — feature 1f · record a completed session.
 *
 * In production this is driven by the patient app on game/video completion; in the
 * portal, clinical roles + trainers may record one. Tenant-scoped; emits
 * `activity.completed` (adherence is computed on read in GET /v1/members).
 */
const RECORD_ROLES = ['clinic_admin', 'ortho', 'physio', 'trainer'] as const;

// Accept any Postgres-valid uuid (8-4-4-4-12 hex). Zod's strict .uuid() rejects
// non-RFC-v4 variants (e.g. seed/imported ids) that Postgres stores fine.
const PG_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const pgUuid = z.string().regex(PG_UUID, 'Invalid id');

const bodySchema = z.object({
  member_id: pgUuid,
  game_id: pgUuid.optional(),
  video_id: pgUuid.optional(),
  type: z.enum(['game', 'video']),
  score: z.number().optional(),
  duration_sec: z.number().int().min(0).optional(),
});

export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...RECORD_ROLES] as UserRole[]);
  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'User is not attached to a clinic', 403);

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues?.[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  // Member must exist and belong to the caller's clinic.
  const rows = await db
    .select({ id: members.id, clinic_id: members.clinic_id })
    .from(members)
    .where(eq(members.id, body.member_id))
    .limit(1);
  const member = rows[0];
  if (!member || member.clinic_id !== user.clinic_id) {
    throw new ApiError('NOT_FOUND', 'Member not found', 404);
  }

  const id = crypto.randomUUID();
  await db.insert(activity_sessions).values({
    id,
    member_id: body.member_id,
    clinic_id: user.clinic_id,
    game_id: body.game_id ?? null,
    video_id: body.video_id ?? null,
    type: body.type,
    score: body.score ?? null,
    duration_sec: body.duration_sec ?? null,
  });

  await emit('activity.completed', user.id, user.clinic_id, `member:${body.member_id}`, {
    type: body.type, game_id: body.game_id ?? null, video_id: body.video_id ?? null,
  });

  return NextResponse.json(
    { data: { session: { id, member_id: body.member_id, type: body.type, score: body.score ?? null } }, error: null },
    { status: 201 },
  );
});
