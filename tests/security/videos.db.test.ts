import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * Live-DB tests for feature 3a (Care Video, Supabase Storage) — gated by
 * RUN_DB_TESTS=true (npm run test:db, serial). Only getAuthedUser mocked. Exercises
 * create → ready → publish → assign → activity-session (≥90% watch) against Supabase.
 * The create step mints a real signed Storage upload URL (no file is uploaded).
 * All created rows are cleaned up afterward.
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

const SEED_CLINIC = '00000000-0000-0000-0000-000000000001';
const SEED_MEMBER = '00000000-0000-0000-0000-000000000010';
const SEED_CLINICIAN = '00000000-0000-0000-0000-000000000012';
const SEED_OPS = '00000000-0000-0000-0000-000000000003';
const EMPTY_CLINIC = '00000000-0000-0000-0000-0000000000ff';

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

describe.skipIf(!RUN)('3a care video · live create→ready→publish→assign→watch', () => {
  let db: any; let schema: any; let eq: any; let and: any; let inArray: any;
  let createVideo: typeof import('@/app/api/v1/videos/route').POST;
  let readyVideo: typeof import('@/app/api/v1/videos/[id]/ready/route').POST;
  let publishVideo: typeof import('@/app/api/v1/videos/[id]/publish/route').POST;
  let assignVideo: typeof import('@/app/api/v1/members/[id]/video-assignments/route').POST;
  let getAssignments: typeof import('@/app/api/v1/members/[id]/video-assignments/route').GET;
  let recordActivity: typeof import('@/app/api/v1/activity-sessions/route').POST;
  let videoId = '';

  async function cleanup() {
    if (!db) return;
    await db.delete(schema.video_assignments).where(eq(schema.video_assignments.member_id, SEED_MEMBER));
    await db.delete(schema.activity_sessions).where(and(eq(schema.activity_sessions.member_id, SEED_MEMBER), eq(schema.activity_sessions.type, 'video')));
    if (videoId) await db.delete(schema.care_videos).where(eq(schema.care_videos.id, videoId));
    await db.delete(schema.events).where(and(
      eq(schema.events.subject, `member:${SEED_MEMBER}`),
      inArray(schema.events.type, ['video.assigned', 'activity.completed']),
    ));
  }

  beforeAll(async () => {
    db = (await import('@/server/db')).db;
    schema = await import('@/server/db/schema');
    ({ eq, and, inArray } = await import('drizzle-orm'));
    createVideo = (await import('@/app/api/v1/videos/route')).POST;
    readyVideo = (await import('@/app/api/v1/videos/[id]/ready/route')).POST;
    publishVideo = (await import('@/app/api/v1/videos/[id]/publish/route')).POST;
    assignVideo = (await import('@/app/api/v1/members/[id]/video-assignments/route')).POST;
    getAssignments = (await import('@/app/api/v1/members/[id]/video-assignments/route')).GET;
    recordActivity = (await import('@/app/api/v1/activity-sessions/route')).POST;

    getAuthedUser.mockResolvedValue({ id: SEED_OPS, clinic_id: null, branch_id: null, role: 'ops' });
    const res = await createVideo(new Request('http://x/api/v1/videos', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'DB test video', regions: 'lower_back' }),
    }));
    videoId = (await res.json()).data?.video?.id ?? '';
    await db.delete(schema.video_assignments).where(eq(schema.video_assignments.member_id, SEED_MEMBER));
    await db.delete(schema.activity_sessions).where(and(eq(schema.activity_sessions.member_id, SEED_MEMBER), eq(schema.activity_sessions.type, 'video')));
  }, 30000);

  afterAll(async () => { if (RUN) await cleanup(); });

  it('creates a draft video + signed upload URL', () => {
    expect(videoId).toMatch(/[0-9a-f-]{36}/);
  });

  it('ready → publish → assign → record a ≥90% watch → shows in assignments', async () => {
    getAuthedUser.mockResolvedValue({ id: SEED_OPS, clinic_id: null, branch_id: null, role: 'ops' });
    const rdy = await readyVideo(new Request(`http://x/api/v1/videos/${videoId}/ready`, { method: 'POST', headers: { authorization: 'Bearer t' } }), { params: { id: videoId } });
    expect(rdy.status).toBe(200);
    const pub = await publishVideo(new Request(`http://x/api/v1/videos/${videoId}/publish`, { method: 'POST', headers: { authorization: 'Bearer t' } }), { params: { id: videoId } });
    expect(pub.status).toBe(200);

    // assign + record the watch as the assigned clinician
    getAuthedUser.mockResolvedValue({ id: SEED_CLINICIAN, clinic_id: SEED_CLINIC, branch_id: null, role: 'physio' });
    const asg = await assignVideo(new Request(`http://x/api/v1/members/${SEED_MEMBER}/video-assignments`, {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ video_id: videoId }),
    }), { params: { id: SEED_MEMBER } });
    expect(asg.status).toBe(201);

    const act = await recordActivity(new Request('http://x/api/v1/activity-sessions', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ member_id: SEED_MEMBER, video_id: videoId, type: 'video', score: 95, duration_sec: 60 }),
    }));
    expect(act.status).toBe(201);

    const get = await getAssignments(new Request(`http://x/api/v1/members/${SEED_MEMBER}/video-assignments`, { headers: { authorization: 'Bearer t' } }), { params: { id: SEED_MEMBER } });
    const json = await get.json();
    const row = json.data.find((a: { video_id: string }) => a.video_id === videoId);
    expect(row).toBeTruthy();
    expect(row.watched_pct).toBeGreaterThanOrEqual(90);
  }, 30000);

  it('a cross-tenant admin cannot read the seed member assignments (404)', async () => {
    getAuthedUser.mockResolvedValue({ id: 'x', clinic_id: EMPTY_CLINIC, branch_id: null, role: 'clinic_admin' });
    const get = await getAssignments(new Request(`http://x/api/v1/members/${SEED_MEMBER}/video-assignments`, { headers: { authorization: 'Bearer t' } }), { params: { id: SEED_MEMBER } });
    expect(get.status).toBe(404);
  }, 30000);
});
