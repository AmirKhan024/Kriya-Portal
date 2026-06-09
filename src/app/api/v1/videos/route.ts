import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { care_videos } from '@/server/db/schema';
import { and, eq, ilike, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { createVideoSchema } from '@/modules/videos/schemas';
import { createVideoUpload } from '@/server/lib/supabase-storage';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/videos — feature 3a · create a care video (ops only; the catalog is
 * platform-wide, no clinic_id). Creates a `draft` row and returns a Supabase Storage
 * signed upload URL the client PUTs the file to; the client then calls /ready.
 */
export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops']);

  const parsed = createVideoSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const body = parsed.data;

  const id = crypto.randomUUID();
  const upload = await createVideoUpload(id);

  await db.insert(care_videos).values({
    id,
    title: body.title,
    status: 'draft',
    playback_id: upload.path, // storage path; signed playback URLs are minted on read
    regions: body.regions ?? null,
    conditions: body.conditions ?? null,
    language: body.language ?? 'en',
    visibility: body.visibility ?? 'all',
  });

  return NextResponse.json({
    data: {
      video: { id, title: body.title, status: 'draft' },
      upload: { signed_url: upload.signed_url, path: upload.path, stubbed: upload.stubbed },
    },
    error: null,
  }, { status: 201 });
});

/**
 * GET /api/v1/videos — feature 3a · the library. Ops sees all; everyone else sees
 * only `published`. Optional `region` / `condition` filters. Read-only.
 */
export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  const url = new URL(request.url);
  const region = url.searchParams.get('region')?.trim() || undefined;
  const condition = url.searchParams.get('condition')?.trim() || undefined;

  const conds = [];
  if (user.role !== 'ops') conds.push(eq(care_videos.status, 'published'));
  if (region) conds.push(ilike(care_videos.regions, `%${region}%`));
  if (condition) conds.push(ilike(care_videos.conditions, `%${condition}%`));

  const rows = await db.select().from(care_videos)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(care_videos.created_at));

  return NextResponse.json({ data: rows, error: null, meta: { count: rows.length } });
});
