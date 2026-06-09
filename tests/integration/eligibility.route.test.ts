import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route-level integration tests for feature 1c · GET /v1/members/:id/game-eligibility.
 * DB + auth are mocked; the engine, requireRole/withApiHandler/ApiError, and the
 * visibility helper run for real.
 */
const h = vi.hoisted(() => {
  const select = new Map<unknown, unknown[]>();
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
  const db = { select() { return selectChain(); } };
  return { select, db, getAuthedUser: vi.fn(), reset() { select.clear(); this.getAuthedUser.mockReset(); } };
});

vi.mock('@/server/db', () => ({ db: h.db }));
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser: h.getAuthedUser };
});

import { members, member_assignments, games, pain_flags } from '@/server/db/schema';
import { GET as getEligibility } from '@/app/api/v1/members/[id]/game-eligibility/route';

const CLINIC_A = '00000000-0000-0000-0000-00000000000a';
const CLINIC_B = '00000000-0000-0000-0000-00000000000b';
const USER_ID = '00000000-0000-0000-0000-0000000000c1';
const MEMBER_ID = '00000000-0000-0000-0000-0000000000m1';

const GAMES = [
  { id: 'g1', name: 'Bird Dog', slug: 'bird-dog', category: 'stability', regions: '["lower_back","core"]' },
  { id: 'g2', name: 'Standing Balance', slug: 'standing-balance', category: 'balance', regions: '["ankle","knee"]' },
];

function user(role: string, clinic = CLINIC_A) {
  return { id: USER_ID, clinic_id: clinic, branch_id: null, role };
}
function req() {
  return new Request(`http://localhost/api/v1/members/${MEMBER_ID}/game-eligibility`, {
    headers: { authorization: 'Bearer test' },
  });
}

beforeEach(() => h.reset());

describe('GET /v1/members/:id/game-eligibility', () => {
  it('computes verdicts; physio sees can_override = true', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(member_assignments, [{ id: 'a1' }]); // assigned → visible
    h.select.set(games, GAMES);
    h.select.set(pain_flags, [{ region: 'lower_back', severity: 6, type: 'acute', active: 'true' }]);

    const res = await getEligibility(req(), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(200);
    const json = await res.json();
    const byId = Object.fromEntries(json.data.map((g: { game_id: string }) => [g.game_id, g]));
    expect(byId.g1.verdict).toBe('blocked');   // touches lower_back
    expect(byId.g2.verdict).toBe('eligible');  // ankle/knee
    expect(json.meta.can_override).toBe(true);
  });

  it('trainer (assigned) sees verdicts but can_override = false', async () => {
    h.getAuthedUser.mockResolvedValue(user('trainer'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(member_assignments, [{ id: 'a1' }]);
    h.select.set(games, GAMES);
    h.select.set(pain_flags, []);

    const res = await getEligibility(req(), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta.can_override).toBe(false);
    expect(json.data.every((g: { verdict: string }) => g.verdict === 'eligible')).toBe(true);
  });

  it('clinic_admin sees all members (no assignment needed)', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(games, GAMES);
    h.select.set(pain_flags, []);
    const res = await getEligibility(req(), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(200);
  });

  it('returns 404 for a cross-tenant member', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio', CLINIC_B));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    const res = await getEligibility(req(), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unassigned clinician', async () => {
    h.getAuthedUser.mockResolvedValue(user('physio'));
    h.select.set(members, [{ id: MEMBER_ID, clinic_id: CLINIC_A }]);
    h.select.set(member_assignments, []); // not assigned
    const res = await getEligibility(req(), { params: { id: MEMBER_ID } });
    expect(res.status).toBe(404);
  });
});
