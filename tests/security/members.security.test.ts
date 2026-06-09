import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Live-DB security tests for feature 1b (multi-tenant isolation + consent gating).
 *
 * SKIPPED by default. To run: connect a real Supabase DB (DATABASE_URL), run
 * `npm run db:migrate` + `npm run seed`, then `RUN_DB_TESTS=true npm test`.
 *
 * These use the REAL db (no db mock) against seed data; only getAuthedUser is mocked
 * so we can simulate callers from different clinics without forging JWTs. Per the
 * security gate (brief §12): a Clinic B user must not be able to read a Clinic A member.
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

// Seed identifiers from src/server/db/seed.ts
const SEED_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const SEED_MEMBER_ID = '00000000-0000-0000-0000-000000000010';
const OTHER_CLINIC_ID = '00000000-0000-0000-0000-0000000000ff';

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

describe.skipIf(!RUN)('1b security · multi-tenant isolation (live DB)', () => {
  let getMember: typeof import('@/app/api/v1/members/[id]/route').GET;

  beforeAll(async () => {
    getMember = (await import('@/app/api/v1/members/[id]/route')).GET;
  });

  function getReq() {
    return new Request(`http://localhost/api/v1/members/${SEED_MEMBER_ID}`, {
      headers: { authorization: 'Bearer test' },
    });
  }

  it('a Clinic B user cannot read a Clinic A member (404)', async () => {
    getAuthedUser.mockResolvedValue({ id: 'x', clinic_id: OTHER_CLINIC_ID, branch_id: null, role: 'clinic_admin' });
    const res = await getMember(getReq(), { params: { id: SEED_MEMBER_ID } });
    expect(res.status).toBe(404);
  });

  it('a same-clinic admin can read the member', async () => {
    getAuthedUser.mockResolvedValue({ id: 'x', clinic_id: SEED_CLINIC_ID, branch_id: null, role: 'clinic_admin' });
    const res = await getMember(getReq(), { params: { id: SEED_MEMBER_ID } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.member.id).toBe(SEED_MEMBER_ID);
    expect(json.data.has_consent).toBe(true); // seed member has clinical consent
  });
});
