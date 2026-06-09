import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * Live-DB test for feature 1f member-detail. SKIPPED unless RUN_DB_TESTS=true.
 * Verifies seed scans, and POST activity-session → appears in activities. Cleans up.
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

const SEED_CLINIC = '00000000-0000-0000-0000-000000000001';
const SEED_MEMBER = '00000000-0000-0000-0000-000000000010';
const SEED_GAME = '10000000-0000-0000-0000-000000000001'; // Bird Dog (from seed)

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

describe.skipIf(!RUN)('1f member-detail live', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any; let schema: any; let eq: any; let and: any;
  let getScans: typeof import('@/app/api/v1/members/[id]/scans/route').GET;
  let getActivities: typeof import('@/app/api/v1/members/[id]/activities/route').GET;
  let postActivity: typeof import('@/app/api/v1/activity-sessions/route').POST;

  beforeAll(async () => {
    db = (await import('@/server/db')).db;
    schema = await import('@/server/db/schema');
    ({ eq, and } = await import('drizzle-orm'));
    getScans = (await import('@/app/api/v1/members/[id]/scans/route')).GET;
    getActivities = (await import('@/app/api/v1/members/[id]/activities/route')).GET;
    postActivity = (await import('@/app/api/v1/activity-sessions/route')).POST;
    // Use the seed admin's real UUID — POST activity-session emits an event whose
    // actor is a uuid FK to users, so it must be a real user id.
    getAuthedUser.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000004', clinic_id: SEED_CLINIC, branch_id: null, role: 'clinic_admin' });
  });

  afterAll(async () => {
    if (!RUN || !db) return;
    await db.delete(schema.activity_sessions).where(eq(schema.activity_sessions.member_id, SEED_MEMBER));
    await db.delete(schema.events).where(and(eq(schema.events.subject, `member:${SEED_MEMBER}`), eq(schema.events.type, 'activity.completed')));
  });

  function getReq() { return new Request(`http://x/${SEED_MEMBER}`, { headers: { authorization: 'Bearer t' } }); }

  it('scans returns the seed assessment (musculage 44)', async () => {
    const res = await getScans(getReq(), { params: { id: SEED_MEMBER } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.some((s: { musculage: number | null }) => s.musculage === 44)).toBe(true);
  });

  it('records an activity session that then shows in the feed', async () => {
    const postRes = await postActivity(new Request('http://x/api/v1/activity-sessions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
      body: JSON.stringify({ member_id: SEED_MEMBER, type: 'game', game_id: SEED_GAME, score: 77 }),
    }));
    expect(postRes.status).toBe(201);

    const feed = await getActivities(getReq(), { params: { id: SEED_MEMBER } });
    const json = await feed.json();
    expect(json.data.some((a: { score: number | null }) => a.score === 77)).toBe(true);
  }, 20000);
});
