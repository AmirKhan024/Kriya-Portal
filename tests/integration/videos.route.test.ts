import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route-level integration tests for feature 3a (Care Video). DB + emit mocked;
 * getAuthedUser mocked. requireRole / requireEntitlement / assertMemberVisible /
 * withApiHandler use REAL implementations. The Mux webhook needs no auth.
 */
const h = vi.hoisted(() => {
  const select = new Map<unknown, unknown[]>();
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { table: unknown; set?: unknown }[] = [];
  function selectChain() {
    let table: unknown;
    const c: Record<string, unknown> = {
      from(t: unknown) { table = t; return c; },
      leftJoin() { return c; },
      where() { return c; },
      limit() { return c; },
      orderBy() { return c; },
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
// Don't hit real Supabase Storage in unit tests.
vi.mock('@/server/lib/supabase-storage', () => ({
  videoPath: (id: string) => `videos/${id}`,
  createVideoUpload: vi.fn(async (id: string) => ({ path: `videos/${id}`, signed_url: 'https://signed-upload', token: 'tok', stubbed: false })),
  getPlaybackUrl: vi.fn(async (p: string | null) => (p ? `https://signed-play/${p}` : null)),
}));

import { care_videos, video_assignments, activity_sessions, members, member_assignments, entitlements } from '@/server/db/schema';
import { invalidateEntitlementCache } from '@/server/auth/middleware';
import { POST as createVideo, GET as listVideos } from '@/app/api/v1/videos/route';
import { POST as publishVideo } from '@/app/api/v1/videos/[id]/publish/route';
import { POST as assignVideo, GET as getAssignments } from '@/app/api/v1/members/[id]/video-assignments/route';
import { POST as readyVideo } from '@/app/api/v1/videos/[id]/ready/route';

const CLINIC_A = '00000000-0000-4000-8000-00000000000a';
const CLINIC_B = '00000000-0000-4000-8000-00000000000b';
const MEMBER = '00000000-0000-4000-8000-0000000000a1';
const VIDEO = '00000000-0000-4000-8000-0000000000d1';

function ops() { return { id: '00000000-0000-4000-8000-0000000000c0', clinic_id: null, branch_id: null, role: 'ops' as const }; }
function physio(clinic = CLINIC_A) { return { id: '00000000-0000-4000-8000-0000000000c2', clinic_id: clinic, branch_id: null, role: 'physio' as const }; }
function jsonReq(body: unknown, url = 'http://x/api/v1/videos') {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify(body) });
}
beforeEach(() => { h.reset(); invalidateEntitlementCache(CLINIC_A); });

describe('POST /v1/videos (ops only)', () => {
  it('creates a draft + returns a signed upload URL for ops', async () => {
    h.getAuthedUser.mockResolvedValue(ops());
    const res = await createVideo(jsonReq({ title: 'Knee mobility', regions: 'knee' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.video.status).toBe('draft');
    expect(json.data.upload.signed_url).toBe('https://signed-upload');
    expect(h.inserts.map((i) => i.table)).toContain(care_videos);
  });

  it('forbids a clinic_admin (ops-only)', async () => {
    h.getAuthedUser.mockResolvedValue({ id: 'a', clinic_id: CLINIC_A, branch_id: null, role: 'clinic_admin' });
    const res = await createVideo(jsonReq({ title: 'x' }));
    expect(res.status).toBe(403);
  });
});

describe('POST /v1/videos/:id/ready (ops)', () => {
  it('flips a draft video to ready', async () => {
    h.getAuthedUser.mockResolvedValue(ops());
    h.select.set(care_videos, [{ id: VIDEO, status: 'draft', title: 'Knee' }]);
    const res = await readyVideo(jsonReq({}, `http://x/api/v1/videos/${VIDEO}/ready`), { params: { id: VIDEO } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('ready');
    expect(h.updates.map((u) => u.table)).toContain(care_videos);
  });
});

describe('POST /v1/videos/:id/publish', () => {
  it('publishes a ready video and emits video.published', async () => {
    h.getAuthedUser.mockResolvedValue(ops());
    h.select.set(care_videos, [{ id: VIDEO, status: 'ready', title: 'Knee' }]);
    const res = await publishVideo(jsonReq({}, `http://x/api/v1/videos/${VIDEO}/publish`), { params: { id: VIDEO } });
    expect(res.status).toBe(200);
    expect(h.emit.mock.calls.map((c) => c[0])).toContain('video.published');
  });

  it('409s when the video is not ready', async () => {
    h.getAuthedUser.mockResolvedValue(ops());
    h.select.set(care_videos, [{ id: VIDEO, status: 'draft', title: 'Knee' }]);
    const res = await publishVideo(jsonReq({}, `http://x/api/v1/videos/${VIDEO}/publish`), { params: { id: VIDEO } });
    expect(res.status).toBe(409);
  });
});

describe('GET /v1/videos', () => {
  it('lists for ops (no emit)', async () => {
    h.getAuthedUser.mockResolvedValue(ops());
    h.select.set(care_videos, [{ id: VIDEO, title: 'Knee', status: 'published' }]);
    const res = await listVideos(new Request('http://x/api/v1/videos', { headers: { authorization: 'Bearer t' } }));
    expect((await res.json()).data).toHaveLength(1);
    expect(h.emit).not.toHaveBeenCalled();
  });
});

describe('POST /v1/members/:id/video-assignments', () => {
  function setupOk() {
    h.select.set(members, [{ id: MEMBER, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(member_assignments, [{ id: 'a1' }]); // physio is assigned → visible
    h.select.set(entitlements, [{ care_programs: true }]);
    h.select.set(care_videos, [{ id: VIDEO, status: 'published', title: 'Knee' }]);
  }
  it('assigns a published video and emits video.assigned', async () => {
    h.getAuthedUser.mockResolvedValue(physio());
    setupOk();
    const res = await assignVideo(jsonReq({ video_id: VIDEO }, `http://x/api/v1/members/${MEMBER}/video-assignments`), { params: { id: MEMBER } });
    expect(res.status).toBe(201);
    expect(h.inserts.map((i) => i.table)).toContain(video_assignments);
    expect(h.emit.mock.calls.map((c) => c[0])).toContain('video.assigned');
  });

  it('403s when care_programs entitlement is disabled', async () => {
    h.getAuthedUser.mockResolvedValue(physio());
    h.select.set(members, [{ id: MEMBER, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(entitlements, [{ care_programs: false }]);
    const res = await assignVideo(jsonReq({ video_id: VIDEO }, `http://x/api/v1/members/${MEMBER}/video-assignments`), { params: { id: MEMBER } });
    expect(res.status).toBe(403);
  });

  it('404s for a cross-tenant member', async () => {
    h.getAuthedUser.mockResolvedValue(physio(CLINIC_A));
    h.select.set(members, [{ id: MEMBER, clinic_id: CLINIC_B, status: 'on_program' }]);
    h.select.set(entitlements, [{ care_programs: true }]);
    const res = await assignVideo(jsonReq({ video_id: VIDEO }, `http://x/api/v1/members/${MEMBER}/video-assignments`), { params: { id: MEMBER } });
    expect(res.status).toBe(404);
  });

  it('409s when the video is not published', async () => {
    h.getAuthedUser.mockResolvedValue(physio());
    h.select.set(members, [{ id: MEMBER, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(member_assignments, [{ id: 'a1' }]);
    h.select.set(entitlements, [{ care_programs: true }]);
    h.select.set(care_videos, [{ id: VIDEO, status: 'ready', title: 'Knee' }]);
    const res = await assignVideo(jsonReq({ video_id: VIDEO }, `http://x/api/v1/members/${MEMBER}/video-assignments`), { params: { id: MEMBER } });
    expect(res.status).toBe(409);
  });
});

describe('GET /v1/members/:id/video-assignments', () => {
  it('returns assignments with a signed playback URL', async () => {
    h.getAuthedUser.mockResolvedValue(physio());
    h.select.set(members, [{ id: MEMBER, clinic_id: CLINIC_A, status: 'on_program' }]);
    h.select.set(member_assignments, [{ id: 'a1' }]);
    h.select.set(video_assignments, [{ id: 'va1', video_id: VIDEO, assigned_at: new Date(), title: 'Knee', status: 'published', playback_id: `videos/${VIDEO}` }]);
    h.select.set(activity_sessions, []);
    const res = await getAssignments(new Request(`http://x/api/v1/members/${MEMBER}/video-assignments`, { headers: { authorization: 'Bearer t' } }), { params: { id: MEMBER } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].playback_url).toBe(`https://signed-play/videos/${VIDEO}`);
    expect(json.data[0].watched_pct).toBe(0);
  });
});
