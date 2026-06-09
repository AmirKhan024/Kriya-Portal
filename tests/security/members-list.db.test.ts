import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Live-DB scoping test for feature 1f · GET /v1/members. SKIPPED unless RUN_DB_TESTS=true.
 * Verifies admin sees the seed member and an unassigned clinician sees none.
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

const SEED_CLINIC = '00000000-0000-0000-0000-000000000001';
const SEED_MEMBER = '00000000-0000-0000-0000-000000000010';
const UNASSIGNED_CLINICIAN = '00000000-0000-0000-0000-0000000000fe';

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

describe.skipIf(!RUN)('1f · GET /v1/members live scoping', () => {
  let list: typeof import('@/app/api/v1/members/route').GET;
  beforeAll(async () => { list = (await import('@/app/api/v1/members/route')).GET; });

  function req() { return new Request('http://localhost/api/v1/members', { headers: { authorization: 'Bearer t' } }); }

  it('admin sees the seed member', async () => {
    getAuthedUser.mockResolvedValue({ id: 'admin', clinic_id: SEED_CLINIC, branch_id: null, role: 'clinic_admin' });
    const res = await list(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.some((m: { id: string }) => m.id === SEED_MEMBER)).toBe(true);
  });

  it('an unassigned clinician sees no members', async () => {
    getAuthedUser.mockResolvedValue({ id: UNASSIGNED_CLINICIAN, clinic_id: SEED_CLINIC, branch_id: null, role: 'physio' });
    const res = await list(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });
});
