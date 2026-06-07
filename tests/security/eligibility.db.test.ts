import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Live-DB test for feature 1c · pain-gating against seed data.
 *
 * SKIPPED unless RUN_DB_TESTS=true (needs migrated + seeded Supabase). Seed member
 * "Ravi" has an acute lower_back flag at severity 6, so every game touching lower_back
 * must be BLOCKED and the rest ELIGIBLE.
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

const SEED_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const SEED_MEMBER_ID = '00000000-0000-0000-0000-000000000010';

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

describe.skipIf(!RUN)('1c pain-gating · live eligibility (seed: acute lower_back 6)', () => {
  let getEligibility: typeof import('@/app/api/v1/members/[id]/game-eligibility/route').GET;

  beforeAll(async () => {
    getEligibility = (await import('@/app/api/v1/members/[id]/game-eligibility/route')).GET;
    getAuthedUser.mockResolvedValue({ id: 'admin', clinic_id: SEED_CLINIC_ID, branch_id: null, role: 'clinic_admin' });
  });

  it('blocks lower_back games and leaves the rest eligible', async () => {
    const res = await getEligibility(
      new Request(`http://localhost/api/v1/members/${SEED_MEMBER_ID}/game-eligibility`, {
        headers: { authorization: 'Bearer test' },
      }),
      { params: { id: SEED_MEMBER_ID } },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const bySlug = Object.fromEntries(json.data.map((g: { slug: string; verdict: string }) => [g.slug, g.verdict]));

    // lower_back games → blocked
    for (const slug of ['bird-dog', 'dead-bug', 'hip-hinge', 'squat']) {
      expect(bySlug[slug], slug).toBe('blocked');
    }
    // non-lower_back games → eligible
    for (const slug of ['pallof-press', 'standing-balance', 'shoulder-press', 'lateral-raise']) {
      expect(bySlug[slug], slug).toBe('eligible');
    }
    expect(json.meta.can_override).toBe(false); // clinic_admin is not Ortho/Physio
  });
});
