import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Integration tests for feature 1f · GET /v1/members (cockpit list). DB + auth mocked;
 * requireRole/withApiHandler/ApiError + risk helpers run for real.
 */
const h = vi.hoisted(() => {
  const select = new Map<unknown, unknown[]>();
  function selectChain() {
    let table: unknown;
    const c: Record<string, unknown> = {
      from(t: unknown) { table = t; return c; },
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

import { members, member_assignments, assessments, pain_flags, activity_sessions } from '@/server/db/schema';
import { GET as listMembers } from '@/app/api/v1/members/route';

const CLINIC_A = '00000000-0000-0000-0000-00000000000a';
const USER_ID = '00000000-0000-0000-0000-0000000000c1';

function user(role: string, clinic: string | null = CLINIC_A) {
  return { id: USER_ID, clinic_id: clinic, branch_id: null, role };
}
function req(qs = '') {
  return new Request(`http://localhost/api/v1/members${qs}`, { headers: { authorization: 'Bearer t' } });
}
function member(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm1', name: 'Ravi', mobile: '9876543210', age: 40, sex: 'male',
    segment: 'care', status: 'new', branch_id: null, ...over,
  };
}

beforeEach(() => h.reset());

describe('GET /v1/members', () => {
  it('403 when the user has no clinic', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin', null));
    const res = await listMembers(req());
    expect(res.status).toBe(403);
  });

  it('a clinician with NO active assignments sees an empty list', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(member_assignments, []); // scope query → none
    const res = await listMembers(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it('a clinician sees assigned members with computed fields', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(member_assignments, [{ member_id: 'm1' }]);
    h.select.set(members, [member({ status: 'new' })]);
    const res = await listMembers(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe('m1');
    expect(json.data[0].musculage).toBeNull();
    expect(json.data[0].adherence).toBeNull(); // 'new' is not adherence-tracked
    expect(json.data[0].at_risk).toBe(false);
  });

  it('an admin sees all clinic members (no assignment scope)', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(members, [member({ id: 'm1' }), member({ id: 'm2', name: 'Sita' })]);
    const res = await listMembers(req());
    const json = await res.json();
    expect(json.data).toHaveLength(2);
  });

  it('attaches latest musculage and flags acute pain', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(members, [member({ id: 'm1', status: 'on_program' })]);
    h.select.set(assessments, [{ member_id: 'm1', musculage: 44, completed_at: new Date() }]);
    h.select.set(pain_flags, [{ member_id: 'm1', severity: 6, type: 'acute' }]);
    h.select.set(activity_sessions, []);
    const res = await listMembers(req());
    const json = await res.json();
    expect(json.data[0].musculage).toBe(44);
    expect(json.data[0].at_risk).toBe(true);
    expect(json.data[0].risk_reason).toBe('Acute pain');
  });

  it('risk=flagged filters to at-risk members only', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(members, [member({ id: 'm1', status: 'new' }), member({ id: 'm2', status: 'lapsed' })]);
    const res = await listMembers(req('?risk=flagged'));
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe('m2'); // lapsed → at-risk
  });
});
