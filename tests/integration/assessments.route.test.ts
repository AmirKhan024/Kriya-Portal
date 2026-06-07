import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route-level integration tests for feature 1c-b (assessments). DB/auth/emit mocked;
 * requireRole, requireEntitlement, withApiHandler, ApiError, and the ported score
 * engine run for real.
 */
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

import { members, consents, assessments, category_scores, entitlements } from '@/server/db/schema';
import { invalidateEntitlementCache } from '@/server/auth/middleware';
import { POST as createAssessment } from '@/app/api/v1/assessments/route';
import { POST as postResult } from '@/app/api/v1/assessments/[id]/results/route';
import { POST as completeAssessment } from '@/app/api/v1/assessments/[id]/complete/route';

const CLINIC_A = '00000000-0000-0000-0000-00000000000a';
const CLINIC_B = '00000000-0000-0000-0000-00000000000b';
const USER_ID = '00000000-0000-0000-0000-0000000000c1';
const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const ASSESS_ID = '22222222-2222-4222-8222-222222222222';

function user(role: string, clinic = CLINIC_A) {
  return { id: USER_ID, clinic_id: clinic, branch_id: null, role };
}
function postReq(body: unknown) {
  return new Request('http://localhost/api/v1/assessments', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify(body),
  });
}

beforeEach(() => { h.reset(); invalidateEntitlementCache(CLINIC_A); });

describe('POST /v1/assessments', () => {
  it('forbids front_desk (not a scan role) → 403', async () => {
    h.getAuthedUser.mockResolvedValue(user('front_desk'));
    const res = await createAssessment(postReq({ member_id: MEMBER_ID, type: 'quick' }));
    expect(res.status).toBe(403);
  });

  it('404 for a cross-tenant member', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio', CLINIC_A));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_B }]);
    const res = await createAssessment(postReq({ member_id: MEMBER_ID, type: 'quick' }));
    expect(res.status).toBe(404);
  });

  it('403 when consent is missing', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(consents, []);
    const res = await createAssessment(postReq({ member_id: MEMBER_ID, type: 'quick' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('403 ENTITLEMENT_REQUIRED when deep_scan is off', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(consents, [{ id: 'c1' }]);
    h.select.set(entitlements, [{ deep_scan: false, quick_scan: true }]);
    const res = await createAssessment(postReq({ member_id: MEMBER_ID, type: 'deep' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ENTITLEMENT_REQUIRED');
    expect(h.inserts).toHaveLength(0);
  });

  it('creates a deep assessment and emits assessment.started', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(consents, [{ id: 'c1' }]);
    h.select.set(entitlements, [{ deep_scan: true, quick_scan: true }]);
    const res = await createAssessment(postReq({ member_id: MEMBER_ID, type: 'deep' }));
    expect(res.status).toBe(201);
    expect(h.inserts.map((i) => i.table)).toContain(assessments);
    expect(h.emit.mock.calls.map((c) => c[0])).toContain('assessment.started');
  });
});

describe('POST /v1/assessments/:id/results', () => {
  function resReq(body: unknown) {
    return new Request(`http://localhost/api/v1/assessments/${ASSESS_ID}/results`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify(body),
    });
  }

  it('400 for an unknown test_id', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(assessments, [{ id: ASSESS_ID, clinic_id: CLINIC_A, member_id: MEMBER_ID, status: 'in_progress' }]);
    const res = await postResult(resReq({ test_id: 'ZZ9' }), { params: { id: ASSESS_ID } });
    expect(res.status).toBe(400);
  });

  it('409 when the assessment is already completed', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(assessments, [{ id: ASSESS_ID, clinic_id: CLINIC_A, member_id: MEMBER_ID, status: 'completed' }]);
    const res = await postResult(resReq({ test_id: 'BB1' }), { params: { id: ASSESS_ID } });
    expect(res.status).toBe(409);
  });

  it('scores a balance game and stores a category_scores row', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(assessments, [{ id: ASSESS_ID, clinic_id: CLINIC_A, member_id: MEMBER_ID, status: 'in_progress' }]);
    h.select.set(members, [{ age: 40 }]);
    const res = await postResult(resReq({ test_id: 'BB1', breachCount: 0, maxSwayDegrees: 0 }), { params: { id: ASSESS_ID } });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.category).toBe('balance');
    expect(typeof json.data.score).toBe('number');
    expect(typeof json.data.musculage).toBe('number');
    expect(h.inserts.map((i) => i.table)).toContain(category_scores);
  });
});

describe('POST /v1/assessments/:id/complete', () => {
  function compReq() {
    return new Request(`http://localhost/api/v1/assessments/${ASSESS_ID}/complete`, {
      method: 'POST', headers: { authorization: 'Bearer t' },
    });
  }

  it('400 when there are no results', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(assessments, [{ id: ASSESS_ID, clinic_id: CLINIC_A, member_id: MEMBER_ID, status: 'in_progress' }]);
    h.select.set(category_scores, []);
    const res = await completeAssessment(compReq(), { params: { id: ASSESS_ID } });
    expect(res.status).toBe(400);
  });

  it('aggregates, sets musculage, advances member to assessed, emits completed', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(assessments, [{ id: ASSESS_ID, clinic_id: CLINIC_A, member_id: MEMBER_ID, status: 'in_progress' }]);
    h.select.set(category_scores, [
      { category: 'balance', score: 80, raw_metrics: JSON.stringify({ musculage: 30 }) },
      { category: 'reflex', score: 60, raw_metrics: JSON.stringify({ musculage: 50 }) },
    ]);
    h.select.set(members, [{ status: 'new' }]);
    const res = await completeAssessment(compReq(), { params: { id: ASSESS_ID } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.musculage).toBe(40);            // mean(30,50)
    expect(json.data.categories.balance).toBe(80);
    expect(h.updates.map((u) => u.table)).toContain(assessments); // assessment completed
    expect(h.updates.map((u) => u.table)).toContain(members);     // member → assessed
    expect(h.emit.mock.calls.map((c) => c[0])).toContain('assessment.completed');
  });
});
