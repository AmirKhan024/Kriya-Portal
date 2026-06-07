import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * Live-DB tests for feature 2d (Appointments) — gated by RUN_DB_TESTS=true
 * (npm run test:db, serial). Only getAuthedUser mocked. All created rows are
 * cleaned up and the seed member's status is restored (PATCH no-show mutates it).
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

const SEED_CLINIC = '00000000-0000-0000-0000-000000000001';
const SEED_MEMBER = '00000000-0000-0000-0000-000000000010';
const SEED_CLINICIAN = '00000000-0000-0000-0000-000000000012';
const EMPTY_CLINIC = '00000000-0000-0000-0000-0000000000ff';

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

describe.skipIf(!RUN)('2d appointments · live tenant + status', () => {
  let db: any; let schema: any; let eq: any; let and: any; let inArray: any;
  let createAppt: typeof import('@/app/api/v1/appointments/route').POST;
  let listAppts: typeof import('@/app/api/v1/appointments/route').GET;
  let patchAppt: typeof import('@/app/api/v1/appointments/[id]/route').PATCH;
  let setAvail: typeof import('@/app/api/v1/clinicians/[id]/availability/route').POST;
  let getAvail: typeof import('@/app/api/v1/clinicians/[id]/availability/route').GET;
  let remindersScan: typeof import('@/app/api/v1/appointments/reminders-scan/route').POST;
  let apptId = '';
  let originalStatus = 'new';

  const slot = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h ahead

  async function cleanup() {
    if (!db) return;
    await db.delete(schema.appointments).where(eq(schema.appointments.member_id, SEED_MEMBER));
    await db.delete(schema.clinician_availability).where(eq(schema.clinician_availability.clinician_id, SEED_CLINICIAN));
    await db.delete(schema.nudges).where(eq(schema.nudges.member_id, SEED_MEMBER));
    await db.delete(schema.events).where(and(
      eq(schema.events.subject, `member:${SEED_MEMBER}`),
      inArray(schema.events.type, ['appointment.booked', 'appointment.completed', 'nudge.scheduled', 'nudge.sent']),
    ));
    await db.update(schema.members).set({ status: originalStatus }).where(eq(schema.members.id, SEED_MEMBER));
  }

  beforeAll(async () => {
    db = (await import('@/server/db')).db;
    schema = await import('@/server/db/schema');
    ({ eq, and, inArray } = await import('drizzle-orm'));
    createAppt = (await import('@/app/api/v1/appointments/route')).POST;
    listAppts = (await import('@/app/api/v1/appointments/route')).GET;
    patchAppt = (await import('@/app/api/v1/appointments/[id]/route')).PATCH;
    setAvail = (await import('@/app/api/v1/clinicians/[id]/availability/route')).POST;
    getAvail = (await import('@/app/api/v1/clinicians/[id]/availability/route')).GET;
    remindersScan = (await import('@/app/api/v1/appointments/reminders-scan/route')).POST;

    const [m] = await db.select({ status: schema.members.status }).from(schema.members).where(eq(schema.members.id, SEED_MEMBER)).limit(1);
    originalStatus = m?.status ?? 'new';
    await cleanup();
  }, 30000);

  afterAll(async () => { if (RUN) await cleanup(); });

  function asAdmin(clinic = SEED_CLINIC) {
    // actor must be a real user uuid (emit writes it to events.actor, a uuid column).
    getAuthedUser.mockResolvedValue({ id: SEED_CLINICIAN, clinic_id: clinic, branch_id: null, role: 'clinic_admin' });
  }

  it('sets and reads clinician availability', async () => {
    asAdmin();
    const set = await setAvail(new Request(`http://x/api/v1/clinicians/${SEED_CLINICIAN}/availability`, {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ slots: [{ day_of_week: 'Monday', start_time: '09:00', end_time: '17:00' }] }),
    }), { params: { id: SEED_CLINICIAN } });
    expect(set.status).toBe(200);

    const get = await getAvail(new Request(`http://x/api/v1/clinicians/${SEED_CLINICIAN}/availability`, { headers: { authorization: 'Bearer t' } }), { params: { id: SEED_CLINICIAN } });
    const json = await get.json();
    expect(json.data.availability.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('books an appointment for the seed member', async () => {
    asAdmin();
    const res = await createAppt(new Request('http://x/api/v1/appointments', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ member_id: SEED_MEMBER, clinician_id: SEED_CLINICIAN, slot, type: 'consultation' }),
    }));
    expect(res.status).toBe(201);
    apptId = (await res.json()).data.id;
    expect(apptId).toMatch(/[0-9a-f-]{36}/);
  }, 30000);

  it('lists the appointment for the seed member; cross-tenant admin gets 404', async () => {
    asAdmin();
    const mine = await listAppts(new Request(`http://x/api/v1/appointments?member_id=${SEED_MEMBER}`, { headers: { authorization: 'Bearer t' } }));
    expect((await mine.json()).data.some((a: { id: string }) => a.id === apptId)).toBe(true);

    asAdmin(EMPTY_CLINIC);
    const cross = await listAppts(new Request(`http://x/api/v1/appointments?member_id=${SEED_MEMBER}`, { headers: { authorization: 'Bearer t' } }));
    expect(cross.status).toBe(404);
  }, 30000);

  it('reminders-scan dry-run finds the near appointment', async () => {
    asAdmin();
    const res = await remindersScan(new Request('http://x/api/v1/appointments/reminders-scan', { method: 'POST', headers: { authorization: 'Bearer t' } }));
    const json = await res.json();
    expect(json.data.dry_run).toBe(true);
    expect(json.data.due).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('no-show flips the seed member to at_risk', async () => {
    asAdmin();
    const res = await patchAppt(new Request(`http://x/api/v1/appointments/${apptId}`, {
      method: 'PATCH', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'no_show' }),
    }), { params: { id: apptId } });
    expect(res.status).toBe(200);
    const [m] = await db.select({ status: schema.members.status }).from(schema.members).where(eq(schema.members.id, SEED_MEMBER)).limit(1);
    expect(m.status).toBe('at_risk');
  }, 30000);
});
