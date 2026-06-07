import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * Live-DB tests for feature 2c (Nudges) — gated by RUN_DB_TESTS=true (npm run
 * test:db, serial). Only getAuthedUser is mocked; db + emit hit real Supabase, so
 * tenant + assignment scoping is exercised against the seed data. All rows created
 * here are cleaned up afterwards (and pre-cleaned, so the daily cap can't wedge re-runs).
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

const SEED_CLINIC = '00000000-0000-0000-0000-000000000001';
const SEED_MEMBER = '00000000-0000-0000-0000-000000000010';
const SEED_CLINICIAN = '00000000-0000-0000-0000-000000000012';
const UNASSIGNED_CLINICIAN = '00000000-0000-0000-0000-0000000000fe';
const EMPTY_CLINIC = '00000000-0000-0000-0000-0000000000ff';

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

describe.skipIf(!RUN)('2c nudges · live tenant + assignment scope', () => {
  let db: any; let schema: any; let eq: any; let and: any; let inArray: any;
  let createNudge: typeof import('@/app/api/v1/nudges/route').POST;
  let listNudges: typeof import('@/app/api/v1/nudges/route').GET;
  let autoScan: typeof import('@/app/api/v1/nudges/auto-scan/route').POST;
  let createdId = '';

  async function cleanup() {
    if (!db) return;
    await db.delete(schema.nudges).where(eq(schema.nudges.member_id, SEED_MEMBER));
    await db.delete(schema.events).where(and(
      eq(schema.events.subject, `member:${SEED_MEMBER}`),
      inArray(schema.events.type, ['nudge.scheduled', 'nudge.sent', 'nudge.responded']),
    ));
  }

  beforeAll(async () => {
    db = (await import('@/server/db')).db;
    schema = await import('@/server/db/schema');
    ({ eq, and, inArray } = await import('drizzle-orm'));
    createNudge = (await import('@/app/api/v1/nudges/route')).POST;
    listNudges = (await import('@/app/api/v1/nudges/route')).GET;
    autoScan = (await import('@/app/api/v1/nudges/auto-scan/route')).POST;

    await cleanup(); // clean slate so the 1/day cap can't block this run

    // Send a nudge to the seed member as admin (real insert + emit).
    getAuthedUser.mockResolvedValue({ id: SEED_CLINICIAN, clinic_id: SEED_CLINIC, branch_id: null, role: 'clinic_admin' });
    const res = await createNudge(new Request('http://x/api/v1/nudges', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ member_id: SEED_MEMBER, message: 'DB test nudge' }),
    }));
    const json = await res.json();
    createdId = json.data?.id ?? '';
  }, 30000);

  afterAll(async () => {
    if (RUN) await cleanup();
  });

  function listFor(u: { id: string; clinic_id: string; role: string }, memberId = SEED_MEMBER) {
    getAuthedUser.mockResolvedValue({ ...u, branch_id: null });
    return listNudges(new Request(`http://x/api/v1/nudges?member_id=${memberId}`, { headers: { authorization: 'Bearer t' } }));
  }

  it('created the nudge', () => {
    expect(createdId).toMatch(/[0-9a-f-]{36}/);
  });

  it('the seed-clinic admin sees the nudge', async () => {
    const json = await (await listFor({ id: 'admin', clinic_id: SEED_CLINIC, role: 'clinic_admin' })).json();
    expect(json.data.some((n: { id: string }) => n.id === createdId)).toBe(true);
  }, 30000);

  it('the assigned clinician sees the nudge', async () => {
    const json = await (await listFor({ id: SEED_CLINICIAN, clinic_id: SEED_CLINIC, role: 'physio' })).json();
    expect(json.data.some((n: { id: string }) => n.id === createdId)).toBe(true);
  }, 30000);

  it('an unassigned clinician gets 404 for that member (assignment scoping)', async () => {
    const res = await listFor({ id: UNASSIGNED_CLINICIAN, clinic_id: SEED_CLINIC, role: 'physio' });
    expect(res.status).toBe(404);
  }, 30000);

  it('auto-scan dry-run scans the seed clinic; an empty clinic scans nothing (isolation)', async () => {
    getAuthedUser.mockResolvedValue({ id: 'admin', clinic_id: SEED_CLINIC, branch_id: null, role: 'clinic_admin' });
    const seed = await (await autoScan(new Request('http://x/api/v1/nudges/auto-scan', { method: 'POST', headers: { authorization: 'Bearer t' } }))).json();
    expect(seed.data.dry_run).toBe(true);
    expect(seed.data.scanned).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(seed.data.candidates)).toBe(true);

    getAuthedUser.mockResolvedValue({ id: 'admin2', clinic_id: EMPTY_CLINIC, branch_id: null, role: 'clinic_admin' });
    const empty = await (await autoScan(new Request('http://x/api/v1/nudges/auto-scan', { method: 'POST', headers: { authorization: 'Bearer t' } }))).json();
    expect(empty.data.scanned).toBe(0);
  }, 30000);
});
