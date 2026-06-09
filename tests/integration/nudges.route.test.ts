import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route-level integration tests for feature 2c (Nudges). DB + emit mocked;
 * getAuthedUser mocked to control the caller. assertMemberVisible / requireRole /
 * withApiHandler / ApiError use REAL implementations (the visibility scoping runs
 * against the mocked db), so envelope shape, RBAC and tenant 404s are exercised.
 */

const h = vi.hoisted(() => {
  const select = new Map<unknown, unknown[]>();
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { table: unknown; set?: unknown }[] = [];

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
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          return Promise.resolve(undefined).then(res, rej);
        },
      };
      return c;
    },
    update(table: unknown) {
      const rec: { table: unknown; set?: unknown } = { table };
      const c: Record<string, unknown> = {
        set(s: unknown) { rec.set = s; return c; },
        where() { updates.push(rec); return c; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          return Promise.resolve(undefined).then(res, rej);
        },
      };
      return c;
    },
  };

  return {
    select, inserts, updates, db,
    getAuthedUser: vi.fn(),
    emit: vi.fn().mockResolvedValue(undefined),
    reset() {
      select.clear(); inserts.length = 0; updates.length = 0;
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

import { nudges, members, member_assignments, notifications, activity_sessions } from '@/server/db/schema';
import { POST as createNudge, GET as listNudges } from '@/app/api/v1/nudges/route';
import { PATCH as patchNudge } from '@/app/api/v1/nudges/[id]/route';
import { POST as autoScan } from '@/app/api/v1/nudges/auto-scan/route';

const CLINIC_A = '00000000-0000-4000-8000-00000000000a';
const CLINIC_B = '00000000-0000-4000-8000-00000000000b';
const USER_ID = '00000000-0000-4000-8000-0000000000c1';
const CLINICIAN = '00000000-0000-4000-8000-0000000000c2';
const MEMBER_ID = '00000000-0000-4000-8000-0000000000a1';
const NUDGE_ID = '00000000-0000-4000-8000-0000000000e1';

function admin(clinic = CLINIC_A) { return { id: USER_ID, clinic_id: clinic, branch_id: null, role: 'clinic_admin' as const }; }
function physio(clinic = CLINIC_A, id = USER_ID) { return { id, clinic_id: clinic, branch_id: null, role: 'physio' as const }; }

function jsonReq(body: unknown, method = 'POST', url = 'http://localhost/api/v1/nudges') {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify(body),
  });
}
function getReq(url = 'http://localhost/api/v1/nudges') {
  return new Request(url, { headers: { authorization: 'Bearer t' } });
}

beforeEach(() => h.reset());

describe('POST /v1/nudges', () => {
  it('rejects invalid body with 400', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    const res = await createNudge(jsonReq({ member_id: MEMBER_ID })); // no message
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('forbids ops (not an engagement role) with 403', async () => {
    h.getAuthedUser.mockResolvedValue({ id: USER_ID, clinic_id: null, branch_id: null, role: 'ops' });
    const res = await createNudge(jsonReq({ member_id: MEMBER_ID, message: 'hi' }));
    expect(res.status).toBe(403);
    expect(h.inserts).toHaveLength(0);
  });

  it('returns 404 for a cross-tenant member (no existence leak)', async () => {
    h.getAuthedUser.mockResolvedValue(admin(CLINIC_A));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_B, status: 'on_program' }]);
    const res = await createNudge(jsonReq({ member_id: MEMBER_ID, message: 'hi' }));
    expect(res.status).toBe(404);
    expect(h.inserts).toHaveLength(0);
  });

  it('sends a nudge: inserts, dispatches, marks sent, emits scheduled+sent', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(nudges, []); // no recent → cap allows
    const res = await createNudge(jsonReq({ member_id: MEMBER_ID, message: 'Time for your session' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.status).toBe('sent');
    expect(json.data.channel).toBe('whatsapp'); // priority pick
    expect(json.data.provider_message_id).toMatch(/^stub:whatsapp:/);
    expect(h.inserts.map((i) => i.table)).toContain(nudges);
    expect(h.updates.map((u) => u.table)).toContain(nudges); // scheduled → sent
    expect(h.emit.mock.calls.map((c) => c[0])).toEqual(['nudge.scheduled', 'nudge.sent']);
  });

  it('honours a requested channel', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(nudges, []);
    const res = await createNudge(jsonReq({ member_id: MEMBER_ID, message: 'hi', channel: 'sms' }));
    expect((await res.json()).data.channel).toBe('sms');
  });

  it('blocks with 409 when the frequency cap is reached', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, status: 'on_program' }]);
    const recent = new Date();
    h.select.set(nudges, [{ status: 'sent', sent_at: recent, responded_at: null, created_at: recent }]);
    const res = await createNudge(jsonReq({ member_id: MEMBER_ID, message: 'again' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
    expect(h.inserts).toHaveLength(0);
  });
});

describe('GET /v1/nudges', () => {
  it('lists clinic-wide for an admin (no emit)', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(nudges, [
      { id: NUDGE_ID, member_id: MEMBER_ID, clinic_id: CLINIC_A, channel: 'whatsapp', message: 'hi', status: 'sent', sent_by_name: 'Dr X' },
    ]);
    const res = await listNudges(getReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].sent_by_name).toBe('Dr X');
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('forbids a clinician listing without a member_id (cannot widen)', async () => {
    h.getAuthedUser.mockResolvedValue(physio());
    const res = await listNudges(getReq());
    expect(res.status).toBe(403);
  });

  it('scopes a clinician to an assigned member via member_id', async () => {
    h.getAuthedUser.mockResolvedValue(physio(CLINIC_A, CLINICIAN));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(member_assignments, [{ id: 'a1' }]); // assigned → visible
    h.select.set(nudges, [{ id: NUDGE_ID, member_id: MEMBER_ID, clinic_id: CLINIC_A, channel: 'push', status: 'sent' }]);
    const res = await listNudges(getReq(`http://localhost/api/v1/nudges?member_id=${MEMBER_ID}`));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  it('returns 404 when a clinician requests an unassigned member', async () => {
    h.getAuthedUser.mockResolvedValue(physio(CLINIC_A, CLINICIAN));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(member_assignments, []); // not assigned
    const res = await listNudges(getReq(`http://localhost/api/v1/nudges?member_id=${MEMBER_ID}`));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /v1/nudges/:id', () => {
  it('marks responded and emits nudge.responded', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(nudges, [{ id: NUDGE_ID, clinic_id: CLINIC_A, member_id: MEMBER_ID, channel: 'whatsapp' }]);
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, status: 'on_program' }]);
    const res = await patchNudge(jsonReq({ status: 'responded' }, 'PATCH', `http://localhost/api/v1/nudges/${NUDGE_ID}`), { params: { id: NUDGE_ID } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('responded');
    expect(h.updates.map((u) => u.table)).toContain(nudges);
    expect(h.emit.mock.calls.map((c) => c[0])).toContain('nudge.responded');
  });

  it('returns 403 for a cross-tenant nudge', async () => {
    h.getAuthedUser.mockResolvedValue(admin(CLINIC_A));
    h.select.set(nudges, [{ id: NUDGE_ID, clinic_id: CLINIC_B, member_id: MEMBER_ID, channel: 'whatsapp' }]);
    const res = await patchNudge(jsonReq({ status: 'responded' }, 'PATCH', `http://localhost/api/v1/nudges/${NUDGE_ID}`), { params: { id: NUDGE_ID } });
    expect(res.status).toBe(403);
    expect(h.updates).toHaveLength(0);
  });
});

describe('POST /v1/nudges/auto-scan', () => {
  it('dry-run returns inactive candidates and emits nothing', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(activity_sessions, []); // no activity → inactive
    h.select.set(nudges, []);
    const res = await autoScan(jsonReq({}, 'POST', 'http://localhost/api/v1/nudges/auto-scan'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.dry_run).toBe(true);
    expect(json.data.inactive).toBe(1);
    expect(json.data.candidates[0].member_id).toBe(MEMBER_ID);
    expect(h.inserts).toHaveLength(0);
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('execute=true schedules a nudge for an eligible inactive member', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(activity_sessions, []);
    h.select.set(nudges, []);
    const res = await autoScan(jsonReq({}, 'POST', 'http://localhost/api/v1/nudges/auto-scan?execute=true'));
    const json = await res.json();
    expect(json.data.scheduled).toBe(1);
    expect(h.inserts.map((i) => i.table)).toContain(nudges);
    expect(h.emit.mock.calls.map((c) => c[0])).toEqual(['nudge.scheduled', 'nudge.sent']);
  });

  it('execute=true escalates a long non-responder to the assigned clinician', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, status: 'lapsed' }]);
    h.select.set(activity_sessions, []);
    // 3 sent-unresponded older than 24h, within 7d → streak 3 (escalate) AND weekly cap hit (not eligible)
    const day = 24 * 60 * 60 * 1000;
    const t = (n: number) => new Date(Date.now() - n * day);
    h.select.set(nudges, [2, 3, 4].map((n) => ({ member_id: MEMBER_ID, status: 'sent', sent_at: t(n), responded_at: null, created_at: t(n) })));
    h.select.set(member_assignments, [{ member_id: MEMBER_ID, clinician_id: CLINICIAN }]);
    const res = await autoScan(jsonReq({}, 'POST', 'http://localhost/api/v1/nudges/auto-scan?execute=true'));
    const json = await res.json();
    expect(json.data.scheduled).toBe(0); // capped → not re-nudged
    expect(json.data.escalated).toBe(1);
    expect(h.inserts.map((i) => i.table)).toContain(notifications);
    expect(h.emit.mock.calls.some((c) => c[0] === 'nudge.scheduled')).toBe(true);
  });
});
