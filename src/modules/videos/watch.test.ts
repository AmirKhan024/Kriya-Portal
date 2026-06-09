import { describe, it, expect } from 'vitest';
import { isWatchComplete, parseMuxEvent } from './watch';

describe('isWatchComplete (>= 90%)', () => {
  it('is true at/above the threshold, false below', () => {
    expect(isWatchComplete(89)).toBe(false);
    expect(isWatchComplete(90)).toBe(true);
    expect(isWatchComplete(100)).toBe(true);
  });
});

describe('parseMuxEvent', () => {
  const VID = '11111111-1111-4111-8111-111111111111';
  const MEM = '22222222-2222-4222-8222-222222222222';
  const CLI = '33333333-3333-4333-8333-333333333333';

  it('maps video.asset.ready with playback id + passthrough video_id', () => {
    const e = parseMuxEvent({
      type: 'video.asset.ready',
      data: { id: 'asset1', playback_ids: [{ id: 'pb1' }], passthrough: JSON.stringify({ video_id: VID }) },
    });
    expect(e).toEqual({ kind: 'asset.ready', assetId: 'asset1', playbackId: 'pb1', videoId: VID });
  });

  it('maps a view with an explicit percent + object passthrough', () => {
    const e = parseMuxEvent({
      type: 'video.view',
      data: { percent: 95, passthrough: { member_id: MEM, video_id: VID, clinic_id: CLI } },
    });
    expect(e).toEqual({ kind: 'view.completed', percent: 95, memberId: MEM, videoId: VID, clinicId: CLI });
  });

  it('computes percent from watch_time / duration when no percent', () => {
    const e = parseMuxEvent({
      type: 'kriya.view.completed',
      data: { view_watch_time: 90, asset_duration: 100, passthrough: `{"member_id":"${MEM}","video_id":"${VID}"}` },
    });
    expect(e.kind).toBe('view.completed');
    if (e.kind === 'view.completed') expect(e.percent).toBe(90);
  });

  it('returns other for unhandled types and non-objects', () => {
    expect(parseMuxEvent({ type: 'video.asset.created' }).kind).toBe('other');
    expect(parseMuxEvent(null).kind).toBe('other');
  });

  it('nulls out malformed (non-uuid) passthrough ids so the route skips, never 500s', () => {
    const ready = parseMuxEvent({ type: 'video.asset.ready', data: { id: 'a', playback_ids: [{ id: 'pb' }], passthrough: '{"video_id":"00000000-0000-0000-0000-0000000000zz"}' } });
    expect(ready).toEqual({ kind: 'asset.ready', assetId: 'a', playbackId: 'pb', videoId: null });

    const view = parseMuxEvent({ type: 'video.view', data: { percent: 95, passthrough: { member_id: 'not-a-uuid', video_id: 'also-bad', clinic_id: 'x' } } });
    expect(view).toMatchObject({ kind: 'view.completed', memberId: null, videoId: null, clinicId: null });
  });
});
