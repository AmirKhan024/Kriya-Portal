import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Integration tests for feature 2e · GET /v1/events + POST export. DB/auth mocked;
 * the route wiring (scope application, pagination cursor, payload parsing) runs for real.
 * (Scope correctness itself is unit-tested in modules/events/query.test.ts.)
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
  return { select, db, getAuthedUser: vi.fn(), emit: vi.fn().mockResolvedValue(undefined), reset() { select.clear(); this.getAuthedUser.mockReset(); this.emit.mockReset(); } };
});

vi.mock('@/server/db', () => ({ db: h.db }));
vi.mock('@/server/db/emit', () => ({ emit: h.emit }));
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser: h.getAuthedUser };
});

import { events } from '@/server/db/schema';
import { GET as listEvents } from '@/app/api/v1/events/route';
import { POST as exportEvents } from '@/app/api/v1/events/export/route';

const CLINIC_A = '00000000-0000-0000-0000-00000000000a';
function user(role: string) { return { id: 'u1', clinic_id: CLINIC_A, branch_id: null, role }; }
function ev(over: Partial<Record<string, unknown>> = {}) {
  return { id: 'e1', type: 'member.created', actor: 'u1', actor_name: 'Dr. X', clinic_id: CLINIC_A, subject: 'member:m1', payload: '{"name":"Ravi"}', ts: new Date('2026-06-07T08:00:00Z'), ...over };
}

beforeEach(() => h.reset());

describe('GET /v1/events', () => {
  it('returns rows with parsed payload + actor_name, no cursor when few rows', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(events, [ev()]);
    const res = await listEvents(new Request('http://x/api/v1/events', { headers: { authorization: 'Bearer t' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].payload).toEqual({ name: 'Ravi' });
    expect(json.data[0].actor_name).toBe('Dr. X');
    expect(json.meta.cursor).toBeNull();
    expect(h.emit).not.toHaveBeenCalled(); // read-only
  });

  it('paginates: returns a cursor when more rows than the limit', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(events, [ev({ id: 'e1' }), ev({ id: 'e2' }), ev({ id: 'e3' })]);
    const res = await listEvents(new Request('http://x/api/v1/events?limit=2', { headers: { authorization: 'Bearer t' } }));
    const json = await res.json();
    expect(json.data).toHaveLength(2);          // limit applied (mock returns 3, route slices)
    expect(json.meta.cursor).toBeTruthy();      // hasMore
  });
});

describe('POST /v1/events/export', () => {
  it('returns CSV text with a header row', async () => {
    h.getAuthedUser.mockResolvedValue(user('clinic_admin'));
    h.select.set(events, [ev()]);
    const res = await exportEvents(new Request('http://x/api/v1/events/export', { method: 'POST', headers: { authorization: 'Bearer t' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.csv.split('\n')[0]).toBe('ts,type,actor,actor_name,subject,payload');
    expect(json.data.count).toBe(1);
    expect(json.data.csv).toContain('member.created');
  });
});
