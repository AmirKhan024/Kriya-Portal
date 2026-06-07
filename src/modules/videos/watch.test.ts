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
  it('maps video.asset.ready with playback id + passthrough video_id', () => {
    const e = parseMuxEvent({
      type: 'video.asset.ready',
      data: { id: 'asset1', playback_ids: [{ id: 'pb1' }], passthrough: JSON.stringify({ video_id: 'v1' }) },
    });
    expect(e).toEqual({ kind: 'asset.ready', assetId: 'asset1', playbackId: 'pb1', videoId: 'v1' });
  });

  it('maps a view with an explicit percent + object passthrough', () => {
    const e = parseMuxEvent({
      type: 'video.view',
      data: { percent: 95, passthrough: { member_id: 'm1', video_id: 'v1', clinic_id: 'c1' } },
    });
    expect(e).toEqual({ kind: 'view.completed', percent: 95, memberId: 'm1', videoId: 'v1', clinicId: 'c1' });
  });

  it('computes percent from watch_time / duration when no percent', () => {
    const e = parseMuxEvent({
      type: 'kriya.view.completed',
      data: { view_watch_time: 90, asset_duration: 100, passthrough: '{"member_id":"m1","video_id":"v1"}' },
    });
    expect(e.kind).toBe('view.completed');
    if (e.kind === 'view.completed') expect(e.percent).toBe(90);
  });

  it('returns other for unhandled types and non-objects', () => {
    expect(parseMuxEvent({ type: 'video.asset.created' }).kind).toBe('other');
    expect(parseMuxEvent(null).kind).toBe('other');
  });
});
