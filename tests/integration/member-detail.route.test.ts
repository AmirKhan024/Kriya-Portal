import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Integration tests for feature 1f member-detail: scans / trends / activities (GET) and
 * POST /v1/activity-sessions. DB + auth mocked; visibility helper + RBAC run for real.
 */
const h = vi.hoisted(() => {
  const select = new Map<unknown, unknown[]>();
  const inserts: { table: unknown; values: unknown }[] = [];
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
  const db = {
    select() { return selectChain(); },
    insert(table: unknown) {
      const c: Record<string, unknown> = {
        values(v: unknown) { inserts.push({ table, values: v }); return c; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(undefined).then(res, rej); },
      };
      return c;
    },
  };
  return {
    select, inserts, db, getAuthedUser: vi.fn(), emit: vi.fn().mockResolvedValue(undefined),
    reset() { select.clear(); inserts.length = 0; this.getAuthedUser.mockReset(); this.emit.mockReset(); this.emit.mockResolvedValue(undefined); },
  };
});

vi.mock('@/server/db', () => ({ db: h.db }));
vi.mock('@/server/db/emit', () => ({ emit: h.emit }));
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser: h.getAuthedUser };
});

import { members, assessments, activity_sessions } from '@/server/db/schema';
import { GET as getScans } from '@/app/api/v1/members/[id]/scans/route';
import { GET as getTrends } from '@/app/api/v1/members/[id]/trends/route';
import { GET as getActivities } from '@/app/api/v1/members/[id]/activities/route';
import { POST as postActivity } from '@/app/api/v1/activity-sessions/route';

const CLINIC_A = '00000000-0000-0000-0000-00000000000a';
const CLINIC_B = '00000000-0000-0000-0000-00000000000b';
const MEMBER_ID = '11111111-1111-4111-8111-111111111111';

function user(role: string, clinic: string | null = CLINIC_A) {
  return { id: 'u1', clinic_id: clinic, branch_id: null, role };
}
function getReq() { return new Request(`http://localhost/x/${MEMBER_ID}`, { headers: { authorization: 'Bearer t' } }); }
function postReq(body: unknown) {
  return new Request('http://localhost/api/v1/activity-sessions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify(body),
  });
}
const ctx = { params: { id: MEMBER_ID } };

beforeEach(() => h.reset());

describe('GET member-detail reads', () => {
  it('scans: returns assessment history for a visible member', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(assessments, [{ id: 'a1', type: 'deep', status: 'completed', musculage: 44, created_at: new Date(), completed_at: new Date() }]);
    const res = await getScans(getReq(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  it('scans: cross-tenant member → 404', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin', CLINIC_A));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_B }]);
    const res = await getScans(getReq(), ctx);
    expect(res.status).toBe(404);
  });

  it('trends: only completed assessments with a musculage, ascending', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(assessments, [
      { musculage: 44, completed_at: new Date('2026-01-01') },
      { musculage: null, completed_at: new Date('2026-02-01') },
    ]);
    const res = await getTrends(getReq(), ctx);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].musculage).toBe(44);
  });

  it('activities: returns the session feed', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(activity_sessions, [{ id: 's1', type: 'game', score: 80, duration_sec: 30, completed_at: new Date(), game_id: 'g1', game_name: 'Bird Dog', video_id: null }]);
    const res = await getActivities(getReq(), ctx);
    const json = await res.json();
    expect(json.data[0].game_name).toBe('Bird Dog');
  });
});

describe('POST /v1/activity-sessions', () => {
  it('records a session and emits activity.completed', async () => {
    h.getAuthedUser.mockResolvedValue(user('trainer'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    const res = await postActivity(postReq({ member_id: MEMBER_ID, type: 'game', game_id: '22222222-2222-4222-8222-222222222222', score: 80 }));
    expect(res.status).toBe(201);
    expect(h.inserts.map((i) => i.table)).toContain(activity_sessions);
    expect(h.emit.mock.calls.map((c) => c[0])).toContain('activity.completed');
  });

  it('forbids front_desk (not a record role)', async () => {
    h.getAuthedUser.mockResolvedValue(user('front_desk'));
    const res = await postActivity(postReq({ member_id: MEMBER_ID, type: 'game' }));
    expect(res.status).toBe(403);
  });

  it('400 on invalid body', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    const res = await postActivity(postReq({ member_id: 'not-a-uuid', type: 'game' }));
    expect(res.status).toBe(400);
  });

  it('404 for a cross-tenant member', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio', CLINIC_A));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_B }]);
    const res = await postActivity(postReq({ member_id: MEMBER_ID, type: 'game' }));
    expect(res.status).toBe(404);
  });
});
