import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route-level integration tests for feature 2d (Appointments). DB + emit mocked;
 * getAuthedUser mocked. assertMemberVisible / requireRole / requireEntitlement /
 * withApiHandler use REAL implementations (run against the mocked db).
 */
const h = vi.hoisted(() => {
  const select = new Map<unknown, unknown[]>();
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { table: unknown; set?: unknown }[] = [];
  const deletes: unknown[] = [];

  function selectChain() {
    let table: unknown;
    const c: Record<string, unknown> = {
      from(t: unknown) { table = t; return c; },
      leftJoin() { return c; },
      where() { return c; },
      limit() { return c; },
      orderBy() { return c; },
      then(res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(select.get(table) ?? []).then(res, rej);
      },
    };
    return c;
  }
  const db = {
    select() { return selectChain(); },
    insert(table: unknown) {
      const c: Record<string, unknown> = {
        values(v: unknown) { inserts.push({ table, values: v }); return c; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(undefined).then(res, rej); },
      };
      return c;
    },
    update(table: unknown) {
      const rec: { table: unknown; set?: unknown } = { table };
      const c: Record<string, unknown> = {
        set(s: unknown) { rec.set = s; return c; },
        where() { updates.push(rec); return c; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(undefined).then(res, rej); },
      };
      return c;
    },
    delete(table: unknown) {
      const c: Record<string, unknown> = {
        where() { deletes.push(table); return c; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(undefined).then(res, rej); },
      };
      return c;
    },
  };
  return {
    select, inserts, updates, deletes, db,
    getAuthedUser: vi.fn(),
    emit: vi.fn().mockResolvedValue(undefined),
    reset() {
      select.clear(); inserts.length = 0; updates.length = 0; deletes.length = 0;
      this.getAuthedUser.mockReset(); this.emit.mockReset(); this.emit.mockResolvedValue(undefined);
    },
  };
});

vi.mock('@/server/db', () => ({ db: h.db }));
vi.mock('@/server/db/emit', () => ({ emit: h.emit }));
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser: h.getAuthedUser };
});

import { appointments, members, users, entitlements, clinician_availability, nudges } from '@/server/db/schema';
import { invalidateEntitlementCache } from '@/server/auth/middleware';
import { POST as createAppt, GET as listAppts } from '@/app/api/v1/appointments/route';
import { PATCH as patchAppt } from '@/app/api/v1/appointments/[id]/route';
import { POST as remindersScan } from '@/app/api/v1/appointments/reminders-scan/route';
import { GET as getAvail, POST as setAvail } from '@/app/api/v1/clinicians/[id]/availability/route';

const CLINIC_A = '00000000-0000-4000-8000-00000000000a';
const CLINIC_B = '00000000-0000-4000-8000-00000000000b';
const ADMIN = '00000000-0000-4000-8000-0000000000c1';
const CLINICIAN = '00000000-0000-4000-8000-0000000000c2';
const MEMBER = '00000000-0000-4000-8000-0000000000a1';
const APPT = '00000000-0000-4000-8000-0000000000f1';

function admin(clinic = CLINIC_A) { return { id: ADMIN, clinic_id: clinic, branch_id: null, role: 'clinic_admin' as const }; }
function jsonReq(body: unknown, method = 'POST', url = 'http://x/api/v1/appointments') {
  return new Request(url, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify(body) });
}
function getReq(url = 'http://x/api/v1/appointments') { return new Request(url, { headers: { authorization: 'Bearer t' } }); }

const FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString();

beforeEach(() => { h.reset(); invalidateEntitlementCache(CLINIC_A); invalidateEntitlementCache(CLINIC_B); });

describe('POST /v1/appointments', () => {
  function setupOk() {
    h.select.set(members, [{ id: MEMBER, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(entitlements, [{ care_programs: true }]);
    h.select.set(users, [{ id: CLINICIAN, clinic_id: CLINIC_A }]);
    h.select.set(appointments, []); // no existing booked
  }

  it('books an appointment and emits appointment.booked', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    setupOk();
    const res = await createAppt(jsonReq({ member_id: MEMBER, clinician_id: CLINICIAN, slot: FUTURE, type: 'consultation' }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe('booked');
    expect(h.inserts.map((i) => i.table)).toContain(appointments);
    expect(h.emit.mock.calls.map((c) => c[0])).toContain('appointment.booked');
  });

  it('forbids a trainer (RBAC)', async () => {
    h.getAuthedUser.mockResolvedValue({ id: ADMIN, clinic_id: CLINIC_A, branch_id: null, role: 'trainer' });
    const res = await createAppt(jsonReq({ member_id: MEMBER, clinician_id: CLINICIAN, slot: FUTURE, type: 'consultation' }));
    expect(res.status).toBe(403);
  });

  it('403s when care_programs entitlement is disabled', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(entitlements, [{ care_programs: false }]);
    const res = await createAppt(jsonReq({ member_id: MEMBER, clinician_id: CLINICIAN, slot: FUTURE, type: 'consultation' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ENTITLEMENT_REQUIRED');
  });

  it('404s for a cross-tenant member', async () => {
    h.getAuthedUser.mockResolvedValue(admin(CLINIC_A));
    h.select.set(entitlements, [{ care_programs: true }]);
    h.select.set(members, [{ id: MEMBER, clinic_id: CLINIC_B, status: 'on_program' }]);
    const res = await createAppt(jsonReq({ member_id: MEMBER, clinician_id: CLINICIAN, slot: FUTURE, type: 'consultation' }));
    expect(res.status).toBe(404);
  });

  it('409s on a double-booked clinician slot', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    setupOk();
    h.select.set(appointments, [{ slot: new Date(FUTURE) }]); // clinician already booked at that slot
    const res = await createAppt(jsonReq({ member_id: MEMBER, clinician_id: CLINICIAN, slot: FUTURE, type: 'consultation' }));
    expect(res.status).toBe(409);
    expect(h.inserts).toHaveLength(0);
  });
});

describe('PATCH /v1/appointments/:id', () => {
  it('completed → emits appointment.completed', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(appointments, [{ id: APPT, clinic_id: CLINIC_A, member_id: MEMBER, clinician_id: CLINICIAN }]);
    const res = await patchAppt(jsonReq({ status: 'completed' }, 'PATCH', `http://x/api/v1/appointments/${APPT}`), { params: { id: APPT } });
    expect(res.status).toBe(200);
    expect(h.emit.mock.calls.map((c) => c[0])).toContain('appointment.completed');
  });

  it('no_show → flips the member to at_risk (no event)', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(appointments, [{ id: APPT, clinic_id: CLINIC_A, member_id: MEMBER, clinician_id: CLINICIAN }]);
    const res = await patchAppt(jsonReq({ status: 'no_show' }, 'PATCH', `http://x/api/v1/appointments/${APPT}`), { params: { id: APPT } });
    expect(res.status).toBe(200);
    const memberUpdate = h.updates.find((u) => u.table === members);
    expect((memberUpdate?.set as { status?: string })?.status).toBe('at_risk');
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('403s a cross-tenant appointment', async () => {
    h.getAuthedUser.mockResolvedValue(admin(CLINIC_A));
    h.select.set(appointments, [{ id: APPT, clinic_id: CLINIC_B, member_id: MEMBER, clinician_id: CLINICIAN }]);
    const res = await patchAppt(jsonReq({ status: 'completed' }, 'PATCH', `http://x/api/v1/appointments/${APPT}`), { params: { id: APPT } });
    expect(res.status).toBe(403);
  });
});

describe('GET /v1/appointments', () => {
  it('lists clinic-wide for an admin (no emit)', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(appointments, [{ id: APPT, member_id: MEMBER, clinician_id: CLINICIAN, clinic_id: CLINIC_A, slot: new Date(FUTURE), type: 'consultation', status: 'booked' }]);
    const res = await listAppts(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    expect(h.emit).not.toHaveBeenCalled();
  });
});

describe('availability GET/POST', () => {
  it('returns availability + computed slots', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(users, [{ id: CLINICIAN, clinic_id: CLINIC_A }]);
    h.select.set(clinician_availability, [{ day_of_week: 'Monday', start_time: '09:00', end_time: '10:00', is_available: 'true' }]);
    h.select.set(appointments, []);
    const res = await getAvail(getReq(`http://x/api/v1/clinicians/${CLINICIAN}/availability`), { params: { id: CLINICIAN } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.availability).toHaveLength(1);
    expect(Array.isArray(json.data.slots)).toBe(true);
  });

  it('replaces availability (delete + insert) for the clinician themselves', async () => {
    h.getAuthedUser.mockResolvedValue({ id: CLINICIAN, clinic_id: CLINIC_A, branch_id: null, role: 'physio' });
    h.select.set(users, [{ id: CLINICIAN, clinic_id: CLINIC_A }]);
    const res = await setAvail(jsonReq({ slots: [{ day_of_week: 'Monday', start_time: '09:00', end_time: '17:00' }] }, 'POST', `http://x/api/v1/clinicians/${CLINICIAN}/availability`), { params: { id: CLINICIAN } });
    expect(res.status).toBe(200);
    expect(h.deletes).toContain(clinician_availability);
    expect(h.inserts.map((i) => i.table)).toContain(clinician_availability);
  });
});

describe('POST /v1/appointments/reminders-scan', () => {
  it('dry-run lists due reminders and emits nothing', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(appointments, [{ id: APPT, member_id: MEMBER, clinician_id: CLINICIAN, clinic_id: CLINIC_A, slot: new Date(Date.now() + 60 * 60 * 1000), status: 'booked' }]);
    const res = await remindersScan(jsonReq({}, 'POST', 'http://x/api/v1/appointments/reminders-scan'));
    const json = await res.json();
    expect(json.data.dry_run).toBe(true);
    expect(json.data.due).toBe(1);
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('execute=true sends a reminder via the nudge dispatcher', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(appointments, [{ id: APPT, member_id: MEMBER, clinician_id: CLINICIAN, clinic_id: CLINIC_A, slot: new Date(Date.now() + 60 * 60 * 1000), status: 'booked' }]);
    h.select.set(members, [{ id: MEMBER, telegram_chat_id: '12345' }]); // connected → reminder sends
    const res = await remindersScan(jsonReq({}, 'POST', 'http://x/api/v1/appointments/reminders-scan?execute=true'));
    const json = await res.json();
    expect(json.data.sent).toBe(1);
    expect(h.inserts.map((i) => i.table)).toContain(nudges);
    expect(h.emit.mock.calls.map((c) => c[0])).toEqual(['nudge.scheduled', 'nudge.sent']);
  });
});
