import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import { care_videos, video_assignments, activity_sessions, members, member_assignments, entitlements } from '@/server/db/schema';
import { invalidateEntitlementCache } from '@/server/auth/middleware';
import { POST as createVideo, GET as listVideos } from '@/app/api/v1/videos/route';
import { POST as publishVideo } from '@/app/api/v1/videos/[id]/publish/route';
import { POST as assignVideo } from '@/app/api/v1/members/[id]/video-assignments/route';
import { POST as muxWebhook } from '@/app/api/v1/webhooks/mux/route';

const CLINIC_A = '00000000-0000-4000-8000-00000000000a';
const CLINIC_B = '00000000-0000-4000-8000-00000000000b';
const MEMBER = '00000000-0000-4000-8000-0000000000a1';
const VIDEO = '00000000-0000-4000-8000-0000000000d1';

function ops() { return { id: '00000000-0000-4000-8000-0000000000c0', clinic_id: null, branch_id: null, role: 'ops' as const }; }
function physio(clinic = CLINIC_A) { return { id: '00000000-0000-4000-8000-0000000000c2', clinic_id: clinic, branch_id: null, role: 'physio' as const }; }
function jsonReq(body: unknown, url = 'http://x/api/v1/videos') {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify(body) });
}
function noAuthReq(body: unknown) {
  return new Request('http://x/api/v1/webhooks/mux', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => { h.reset(); invalidateEntitlementCache(CLINIC_A); });
afterEach(() => { delete process.env.MUX_WEBHOOK_SECRET; });

describe('POST /v1/videos (ops only)', () => {
  it('creates a stub-ready video for ops', async () => {
    h.getAuthedUser.mockResolvedValue(ops());
    const res = await createVideo(jsonReq({ title: 'Knee mobility', regions: 'knee' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.video.status).toBe('ready');
    expect(json.data.video.playback_id).toMatch(/^stub-pb-/);
    expect(h.inserts.map((i) => i.table)).toContain(care_videos);
  });

  it('forbids a clinic_admin (ops-only)', async () => {
    h.getAuthedUser.mockResolvedValue({ id: 'a', clinic_id: CLINIC_A, branch_id: null, role: 'clinic_admin' });
    const res = await createVideo(jsonReq({ title: 'x' }));
    expect(res.status).toBe(403);
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

describe('POST /v1/webhooks/mux (no auth, signature-verified)', () => {
  it('asset.ready marks the video ready + stores playback id', async () => {
    const res = await muxWebhook(noAuthReq({ type: 'video.asset.ready', data: { id: 'a1', playback_ids: [{ id: 'pb1' }], passthrough: JSON.stringify({ video_id: VIDEO }) } }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.handled).toBe('asset.ready');
    expect(h.updates.map((u) => u.table)).toContain(care_videos);
  });

  it('a >=90% view records an activity session + emits video.watched', async () => {
    h.select.set(members, [{ clinic_id: CLINIC_A }]);
    h.select.set(activity_sessions, []); // not yet logged
    const res = await muxWebhook(noAuthReq({ type: 'video.view', data: { percent: 95, passthrough: { member_id: MEMBER, video_id: VIDEO, clinic_id: CLINIC_A } } }));
    expect((await res.json()).data.handled).toBe('view.completed');
    expect(h.inserts.map((i) => i.table)).toContain(activity_sessions);
    const events = h.emit.mock.calls.map((c) => c[0]);
    expect(events).toEqual(expect.arrayContaining(['video.watched', 'activity.completed']));
  });

  it('a <90% view records nothing', async () => {
    const res = await muxWebhook(noAuthReq({ type: 'video.view', data: { percent: 40, passthrough: { member_id: MEMBER, video_id: VIDEO } } }));
    expect((await res.json()).data.handled).toBe('view.incomplete');
    expect(h.inserts).toHaveLength(0);
  });

  it('rejects a bad signature when MUX_WEBHOOK_SECRET is set', async () => {
    process.env.MUX_WEBHOOK_SECRET = 'shh';
    const res = await muxWebhook(new Request('http://x/api/v1/webhooks/mux', { method: 'POST', headers: { 'content-type': 'application/json', 'mux-signature': 't=1,v1=bad' }, body: '{}' }));
    expect(res.status).toBe(401);
  });
});
