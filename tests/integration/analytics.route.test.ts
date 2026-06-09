import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Integration tests for feature 2f-A · GET /v1/analytics/:dashboard. DB/auth mocked;
 * the route wiring (RBAC, dashboard validation, scope resolution, envelope + as_of)
 * runs for real. Pure metric maths are unit-tested in modules/analytics/*.test.ts.
 * (The mock ignores WHERE clauses, so true tenant isolation is covered by the
 * RUN_DB_TESTS live test — here we assert the meta.scope label the route derives.)
 */
const h = vi.hoisted(() => {
  const select = new Map<unknown, unknown[]>();
  function selectChain() {
    let table: unknown;
    const c: Record<string, unknown> = {
      from(t: unknown) { table = t; return c; },
      leftJoin() { return c; },
      where() { return c; },
      orderBy() { return c; },
      limit() { return c; },
      then(res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(select.get(table) ?? []).then(res, rej);
      },
    };
    return c;
  }
  const db = { select() { return selectChain(); } };
  return { select, db, getAuthedUser: vi.fn(), reset() { select.clear(); this.getAuthedUser.mockReset(); } };
});

vi.mock('@/server/db', () => ({ db: h.db }));
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser: h.getAuthedUser };
});

import { members, branches, pain_flags, assessments, activity_sessions } from '@/server/db/schema';
import { GET } from '@/app/api/v1/analytics/[dashboard]/route';

const CLINIC_A = '00000000-0000-0000-0000-00000000000a';
function user(role: string, clinic: string | null = CLINIC_A) {
  return { id: 'u1', clinic_id: clinic, branch_id: null, role };
}
function call(dashboard: string, qs = '', u = user('clinic_admin')) {
  h.getAuthedUser.mockResolvedValue(u);
  return GET(
    new Request(`http://x/api/v1/analytics/${dashboard}${qs}`, { headers: { authorization: 'Bearer t' } }),
    { params: { dashboard } },
  );
}

beforeEach(() => h.reset());

describe('GET /v1/analytics — RBAC + routing', () => {
  it('rejects clinicians with 403', async () => {
    const res = await call('patient', '', user('physio'));
    expect(res.status).toBe(403);
  });
  it('returns 404 for an unknown dashboard', async () => {
    const res = await call('bogus');
    expect(res.status).toBe(404);
  });
});

describe('GET /v1/analytics/patient', () => {
  it('returns the patient envelope with range + as_of + scope=clinic', async () => {
    h.select.set(members, [{ id: 'm1', segment: 'care', status: 'new', branch_id: null, created_at: new Date() }]);
    h.select.set(branches, []);
    h.select.set(pain_flags, []);
    const res = await call('patient', '?range=90d');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total).toBe(1);
    expect(json.data.segment_mix).toEqual({ care: 1, wellness: 0 });
    expect(json.data.range).toBe('90d');
    expect(json.data.as_of).toBeTruthy();
    expect(json.meta.scope).toBe('clinic');
  });

  it('forces a clinic_admin to its own clinic (query clinic_id ignored → still clinic scope)', async () => {
    h.select.set(members, []);
    h.select.set(branches, []);
    const res = await call('patient', '?clinic_id=someoneelse');
    const json = await res.json();
    expect(json.meta.scope).toBe('clinic');
  });
});

describe('GET /v1/analytics — ops scope', () => {
  it('ops with no clinic_id → platform scope', async () => {
    h.select.set(members, []);
    h.select.set(branches, []);
    const res = await call('patient', '', user('ops', null));
    expect((await res.json()).meta.scope).toBe('platform');
  });
  it('ops with ?clinic_id → drills into clinic scope', async () => {
    h.select.set(members, []);
    h.select.set(branches, []);
    const res = await call('patient', '?clinic_id=abc', user('ops', null));
    expect((await res.json()).meta.scope).toBe('clinic');
  });
});

describe('GET /v1/analytics/activity', () => {
  it('returns the activity envelope and computed metrics', async () => {
    h.select.set(members, [{ id: 'm1', status: 'on_program' }]);
    h.select.set(activity_sessions, [{ member_id: 'm1', completed_at: new Date() }]);
    h.select.set(assessments, [{ member_id: 'm1', musculage: 44, completed_at: new Date() }]);
    const res = await call('activity');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sessions_total).toBe(1);
    expect(json.data.musculage_avg).toBe(44);
    expect(json.data.as_of).toBeTruthy();
    expect(json.meta.scope).toBe('clinic');
  });

  it('returns zeroed metrics when the clinic has no members', async () => {
    h.select.set(members, []);
    const res = await call('activity');
    const json = await res.json();
    expect(json.data.sessions_total).toBe(0);
    expect(json.data.musculage_avg).toBeNull();
    expect(json.data.musculage_trend).toEqual([]);
  });
});
