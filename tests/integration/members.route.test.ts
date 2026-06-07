import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route-level integration tests for feature 1b. The DB and emit layers are mocked so
 * these run without a live Postgres; getAuthedUser is mocked to control the caller's
 * role/tenant. requireRole / withApiHandler / ApiError use their REAL implementations,
 * so envelope shape and error codes are exercised end-to-end.
 */

// Shared mock state + a chainable Drizzle-shaped db (built in hoisted scope so the
// vi.mock factories below can reference it).
const h = vi.hoisted(() => {
  const select = new Map<unknown, unknown[]>();
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { table: unknown; set?: unknown }[] = [];

  function selectChain() {
    let table: unknown;
    const c: Record<string, unknown> = {
      from(t: unknown) { table = t; return c; },
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
    reset() { select.clear(); inserts.length = 0; updates.length = 0; this.getAuthedUser.mockReset(); this.emit.mockReset(); this.emit.mockResolvedValue(undefined); },
  };
});

vi.mock('@/server/db', () => ({ db: h.db }));
vi.mock('@/server/db/emit', () => ({ emit: h.emit }));
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser: h.getAuthedUser };
});

// Real table references (unmocked) — same objects the routes use, for keying select results.
import { members, users, branches, consents, member_assignments, pain_flags } from '@/server/db/schema';
import { POST as createMember } from '@/app/api/v1/members/route';
import { GET as getMember } from '@/app/api/v1/members/[id]/route';
import { POST as captureConsent } from '@/app/api/v1/members/[id]/consent/route';
import { POST as assignMember } from '@/app/api/v1/members/[id]/assignments/route';

const CLINIC_A = '00000000-0000-0000-0000-00000000000a';
const CLINIC_B = '00000000-0000-0000-0000-00000000000b';
const USER_ID = '00000000-0000-0000-0000-0000000000c1';
const MEMBER_ID = '00000000-0000-0000-0000-0000000000m1';

function admin(clinic = CLINIC_A) {
  return { id: USER_ID, clinic_id: clinic, branch_id: null, role: 'clinic_admin' as const };
}
function physio(clinic = CLINIC_A) {
  return { id: USER_ID, clinic_id: clinic, branch_id: null, role: 'physio' as const };
}

function jsonReq(body: unknown, url = 'http://localhost/api/v1/members') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify(body),
  });
}
function getReq(url = 'http://localhost/api/v1/members/x') {
  return new Request(url, { headers: { authorization: 'Bearer test' } });
}

beforeEach(() => h.reset());

describe('POST /v1/members', () => {
  it('rejects invalid body with 400 VALIDATION_ERROR', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    const res = await createMember(jsonReq({ mobile: '9876543210' })); // no name
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.data).toBeNull();
  });

  it('forbids a trainer (RBAC) with 403', async () => {
    h.getAuthedUser.mockResolvedValue({ id: USER_ID, clinic_id: CLINIC_A, branch_id: null, role: 'trainer' });
    const res = await createMember(jsonReq({ name: 'Ravi', mobile: '9876543210' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    expect(h.inserts).toHaveLength(0);
  });

  it('returns 409 + existing_member_id on duplicate mobile', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: 'existing-id', name: 'Ravi' }]);
    const res = await createMember(jsonReq({ name: 'Ravi', mobile: '9876543210' }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe('CONFLICT');
    expect(json.meta.existing_member_id).toBe('existing-id');
    expect(h.inserts).toHaveLength(0);
  });

  it('creates a member with pain map + consent and emits all events', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, []); // no duplicate
    const res = await createMember(jsonReq({
      name: 'Ravi Kumar', mobile: '98765 43210', complaint: 'Lower back pain',
      pain_map: [{ region: 'lower_back', severity: 6, type: 'acute' }],
      consent: { type: 'clinical', method: 'verbal' },
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.error).toBeNull();
    expect(json.data.member.segment).toBe('care');      // derived from complaint
    expect(json.data.member.mobile).toBe('9876543210');  // normalized
    expect(json.data.consent_captured).toBe(true);
    expect(json.data.pain_flags_count).toBe(1);

    const insertTables = h.inserts.map((i) => i.table);
    expect(insertTables).toContain(members);
    expect(insertTables).toContain(member_assignments);
    expect(insertTables).toContain(pain_flags);
    expect(insertTables).toContain(consents);

    const events = h.emit.mock.calls.map((c) => c[0]);
    expect(events).toEqual(
      expect.arrayContaining(['member.created', 'member.assigned', 'painflag.set', 'member.consented']),
    );
  });

  it('allows creating a duplicate when allow_duplicate is set', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: 'existing-id', name: 'Ravi' }]);
    const res = await createMember(jsonReq({ name: 'Ravi', mobile: '9876543210', allow_duplicate: true }));
    expect(res.status).toBe(201);
    expect(h.inserts.map((i) => i.table)).toContain(members);
  });

  it('rejects a user with no clinic (403)', async () => {
    h.getAuthedUser.mockResolvedValue({ id: USER_ID, clinic_id: null, branch_id: null, role: 'clinic_admin' });
    const res = await createMember(jsonReq({ name: 'Ravi', mobile: '9876543210' }));
    expect(res.status).toBe(403);
  });
});

describe('POST /v1/members/:id/consent', () => {
  it('captures consent for an in-clinic member (201 + event)', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    const res = await captureConsent(jsonReq({ method: 'verbal' }), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(201);
    expect(h.inserts.map((i) => i.table)).toContain(consents);
    expect(h.emit.mock.calls.map((c) => c[0])).toContain('member.consented');
  });

  it('returns 404 for a member in another clinic', async () => {
    h.getAuthedUser.mockResolvedValue(admin(CLINIC_A));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_B }]);
    const res = await captureConsent(jsonReq({ method: 'verbal' }), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(404);
    expect(h.inserts).toHaveLength(0);
  });
});

describe('POST /v1/members/:id/assignments', () => {
  it('forbids a physio (admin-only) with 403', async () => {
    h.getAuthedUser.mockResolvedValue(physio());
    const res = await assignMember(jsonReq({ clinician_id: '11111111-1111-4111-8111-111111111111' }), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(403);
  });

  it('reassigns: closes old assignment, opens new, emits events', async () => {
    h.getAuthedUser.mockResolvedValue(admin());
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(users, [{ id: '11111111-1111-4111-8111-111111111111' }]);
    const res = await assignMember(
      jsonReq({ clinician_id: '11111111-1111-4111-8111-111111111111' }),
      { params: { id: MEMBER_ID } },
    );
    expect(res.status).toBe(201);
    expect(h.updates.map((u) => u.table)).toContain(member_assignments); // old closed
    expect(h.inserts.map((i) => i.table)).toContain(member_assignments); // new opened
    const events = h.emit.mock.calls.map((c) => c[0]);
    expect(events).toEqual(expect.arrayContaining(['member.assigned', 'access.scope_changed']));
  });
});

describe('GET /v1/members/:id', () => {
  it('returns NOT_FOUND for a cross-tenant member (no existence leak)', async () => {
    h.getAuthedUser.mockResolvedValue(physio(CLINIC_B));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A, name: 'Ravi', status: 'new' }]);
    const res = await getMember(getReq(), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns the member record for an admin in the same clinic', async () => {
    h.getAuthedUser.mockResolvedValue(admin(CLINIC_A));
    h.select.set(members, [{
      id: MEMBER_ID, clinic_id: CLINIC_A, name: 'Ravi', mobile: '9876543210',
      age: 38, sex: 'male', segment: 'care', status: 'new', complaint: 'LBP',
    }]);
    h.select.set(consents, [{ id: 'c1', member_id: MEMBER_ID }]);
    h.select.set(pain_flags, [{ id: 'p1', region: 'lower_back', severity: 6, type: 'acute', active: 'true' }]);
    h.select.set(member_assignments, [{ id: 'a1', clinician_id: USER_ID }]);
    h.select.set(users, [{ name: 'Dr. Arjun Mehta' }]);
    const res = await getMember(getReq(), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.member.id).toBe(MEMBER_ID);
    expect(json.data.has_consent).toBe(true);
    expect(json.data.pain_flags).toHaveLength(1);
    expect(json.data.assignment.clinician_name).toBe('Dr. Arjun Mehta'); // resolved, not a raw UUID
  });
});
