import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * Live-DB end-to-end for feature 1c-b. SKIPPED unless RUN_DB_TESTS=true.
 * Creates a throwaway consented member, walks create → results → complete via the
 * real route handlers + real DB (only getAuthedUser is mocked), then cleans up.
 */
const RUN = process.env.RUN_DB_TESTS === 'true';

const SEED_CLINIC = '00000000-0000-0000-0000-000000000001';
const SEED_BRANCH = '00000000-0000-0000-0000-000000000002';
const CLINICIAN = '00000000-0000-0000-0000-000000000012';

const getAuthedUser = vi.fn();
vi.mock('@/server/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/middleware')>();
  return { ...actual, getAuthedUser };
});

function jreq(url: string, body?: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skipIf(!RUN)('1c-b assessments · live create→results→complete', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any; let schema: any; let eq: any;
  let createA: typeof import('@/app/api/v1/assessments/route').POST;
  let postResult: typeof import('@/app/api/v1/assessments/[id]/results/route').POST;
  let completeA: typeof import('@/app/api/v1/assessments/[id]/complete/route').POST;
  const memberId = crypto.randomUUID();
  let assessmentId = '';

  beforeAll(async () => {
    db = (await import('@/server/db')).db;
    schema = await import('@/server/db/schema');
    ({ eq } = await import('drizzle-orm'));
    createA = (await import('@/app/api/v1/assessments/route')).POST;
    postResult = (await import('@/app/api/v1/assessments/[id]/results/route')).POST;
    completeA = (await import('@/app/api/v1/assessments/[id]/complete/route')).POST;

    await db.insert(schema.members).values({
      id: memberId, clinic_id: SEED_CLINIC, branch_id: SEED_BRANCH,
      mobile: '9111100000', name: 'Scan Test (auto)', age: 40, segment: 'care', status: 'new',
    });
    await db.insert(schema.consents).values({ member_id: memberId, clinic_id: SEED_CLINIC, type: 'clinical', method: 'verbal' });
    getAuthedUser.mockResolvedValue({ id: CLINICIAN, clinic_id: SEED_CLINIC, branch_id: SEED_BRANCH, role: 'ortho' });
  });

  afterAll(async () => {
    if (!RUN || !db) return;
    if (assessmentId) {
      await db.delete(schema.category_scores).where(eq(schema.category_scores.assessment_id, assessmentId));
      await db.delete(schema.assessments).where(eq(schema.assessments.id, assessmentId));
    }
    await db.delete(schema.consents).where(eq(schema.consents.member_id, memberId));
    await db.delete(schema.members).where(eq(schema.members.id, memberId));
  });

  it('produces a musculage and advances the member to assessed', async () => {
    const cRes = await createA(jreq('http://x/api/v1/assessments', { member_id: memberId, type: 'deep' }));
    expect(cRes.status).toBe(201);
    assessmentId = (await cRes.json()).data.assessment.id;

    for (const body of [
      { test_id: 'BB1', breachCount: 1, maxSwayDegrees: 5 },
      { test_id: 'NN1', customMetrics: { catches_first20: 20, catches_last10: 8 } },
    ]) {
      const rRes = await postResult(jreq(`http://x/api/v1/assessments/${assessmentId}/results`, body), { params: { id: assessmentId } });
      expect(rRes.status).toBe(201);
    }

    const compRes = await completeA(jreq(`http://x/api/v1/assessments/${assessmentId}/complete`), { params: { id: assessmentId } });
    expect(compRes.status).toBe(200);
    const cj = await compRes.json();
    expect(typeof cj.data.musculage).toBe('number');
    expect(cj.data.count).toBe(2);

    const m = await db.select().from(schema.members).where(eq(schema.members.id, memberId)).limit(1);
    expect(m[0].status).toBe('assessed');
  }, 30000); // many sequential live round-trips to Supabase
});
