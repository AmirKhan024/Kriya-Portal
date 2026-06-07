import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * Live-DB test for feature 2e · GET /v1/events RLS lens. SKIPPED unless RUN_DB_TESTS=true.
 * Inserts one known event, then verifies: admin (own clinic) sees it, the matching-actor
 * clinician sees it, a different clinician does NOT. Cleans up.
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

const SEED_CLINIC = '00000000-0000-0000-0000-000000000001';
const SEED_CLINICIAN = '00000000-0000-0000-0000-000000000012';
const OTHER_CLINICIAN = '00000000-0000-0000-0000-0000000000fe';
const SUBJECT = 'member:evt-test-2e';

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

describe.skipIf(!RUN)('2e activity log · live RLS lens', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any; let schema: any; let eq: any;
  let list: typeof import('@/app/api/v1/events/route').GET;
  const eventId = crypto.randomUUID();

  beforeAll(async () => {
    db = (await import('@/server/db')).db;
    schema = await import('@/server/db/schema');
    ({ eq } = await import('drizzle-orm'));
    list = (await import('@/app/api/v1/events/route')).GET;
    await db.insert(schema.events).values({
      id: eventId, type: 'member.created', actor: SEED_CLINICIAN, clinic_id: SEED_CLINIC, subject: SUBJECT, payload: '{}',
    });
  });

  afterAll(async () => {
    if (!RUN || !db) return;
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
  });

  function req() { return new Request(`http://x/api/v1/events?subject=${encodeURIComponent(SUBJECT)}`, { headers: { authorization: 'Bearer t' } }); }
  async function idsFor(u: { id: string; role: string }) {
    getAuthedUser.mockResolvedValue({ id: u.id, clinic_id: SEED_CLINIC, branch_id: null, role: u.role });
    const res = await list(req());
    const json = await res.json();
    return (json.data as { id: string }[]).map((e) => e.id);
  }

  it('admin (own clinic) sees the event', async () => {
    expect(await idsFor({ id: 'admin', role: 'clinic_admin' })).toContain(eventId);
  });

  it('the matching-actor clinician sees the event', async () => {
    expect(await idsFor({ id: SEED_CLINICIAN, role: 'physio' })).toContain(eventId);
  });

  it('a different clinician does NOT see the event', async () => {
    expect(await idsFor({ id: OTHER_CLINICIAN, role: 'physio' })).not.toContain(eventId);
  });
});
