import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Live-DB test for feature 2f-A · analytics tenant scoping. SKIPPED unless
 * RUN_DB_TESTS=true. Read-only (no rows created/mutated → no cleanup): asserts the
 * seed-clinic admin sees its members, the activity dashboard has the right shape, and
 * an empty clinic id sees zero members (clinic scoping holds).
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

const SEED_CLINIC = '00000000-0000-0000-0000-000000000001';
const EMPTY_CLINIC = '00000000-0000-0000-0000-0000000000ff';

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

describe.skipIf(!RUN)('2f-A analytics · live tenant scope', () => {
  let GET: typeof import('@/app/api/v1/analytics/[dashboard]/route').GET;

  beforeAll(async () => {
    GET = (await import('@/app/api/v1/analytics/[dashboard]/route')).GET;
  });

  function call(dashboard: string, u: { id: string; clinic_id: string | null; role: string }) {
    getAuthedUser.mockResolvedValue({ ...u, branch_id: null });
    return GET(
      new Request(`http://x/api/v1/analytics/${dashboard}`, { headers: { authorization: 'Bearer t' } }),
      { params: { dashboard } },
    );
  }
  const admin = (clinic: string | null) => ({ id: 'admin', clinic_id: clinic, role: 'clinic_admin' });

  it('seed-clinic admin sees its own members on the patient dashboard', async () => {
    const res = await call('patient', admin(SEED_CLINIC));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total).toBeGreaterThanOrEqual(1);
    expect(json.data.segment_mix.care + json.data.segment_mix.wellness).toBeLessThanOrEqual(json.data.total);
    expect(json.meta.scope).toBe('clinic');
  }, 30000);

  it('activity dashboard returns the expected shape', async () => {
    const res = await call('activity', admin(SEED_CLINIC));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.data.sessions_total).toBe('number');
    expect(typeof json.data.active_30d).toBe('number');
    expect(Array.isArray(json.data.musculage_trend)).toBe(true);
  }, 30000);

  it('an empty clinic id sees zero members (tenant isolation)', async () => {
    const res = await call('patient', admin(EMPTY_CLINIC));
    const json = await res.json();
    expect(json.data.total).toBe(0);
  }, 30000);
});
