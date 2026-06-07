/**
 * Mux webhook parsing + watch-completion logic (feature 3a). Pure + unit-tested.
 *
 * Mux carries our own ids in the asset's `passthrough` field (set at upload time),
 * so a server-to-server view webhook can be mapped back to member/video/clinic.
 */
import { WATCH_COMPLETE_PCT } from './constants';

export function isWatchComplete(percent: number): boolean {
  return percent >= WATCH_COMPLETE_PCT;
}

export type MuxEvent =
  | { kind: 'asset.ready'; assetId: string | null; playbackId: string | null; videoId: string | null }
  | { kind: 'view.completed'; percent: number; memberId: string | null; videoId: string | null; clinicId: string | null }
  | { kind: 'other' };

function readPassthrough(data: Record<string, unknown>): Record<string, unknown> {
  const p = data.passthrough;
  if (!p) return {};
  if (typeof p === 'object') return p as Record<string, unknown>;
  if (typeof p === 'string') { try { return JSON.parse(p); } catch { return {}; } }
  return {};
}

/** Normalise a raw Mux webhook body into a discriminated event we act on. */
export function parseMuxEvent(body: unknown): MuxEvent {
  if (!body || typeof body !== 'object') return { kind: 'other' };
  const { type, data } = body as { type?: string; data?: Record<string, unknown> };
  const d = data ?? {};
  const pass = readPassthrough(d);

  if (type === 'video.asset.ready') {
    const playbacks = (d.playback_ids as { id?: string }[] | undefined) ?? [];
    return {
      kind: 'asset.ready',
      assetId: (d.id as string) ?? null,
      playbackId: playbacks[0]?.id ?? (d.playback_id as string) ?? null,
      videoId: (pass.video_id as string) ?? null,
    };
  }

  // A completed view — either an explicit percent or watch_time / asset_duration.
  if (type === 'video.view' || type === 'kriya.view.completed') {
    let percent = Number(d.percent);
    if (!Number.isFinite(percent)) {
      const watched = Number(d.view_watch_time ?? d.watch_time);
      const total = Number(d.asset_duration ?? d.duration);
      percent = total > 0 ? Math.round((watched / total) * 100) : 0;
    }
    return {
      kind: 'view.completed',
      percent: Number.isFinite(percent) ? percent : 0,
      memberId: (pass.member_id as string) ?? null,
      videoId: (pass.video_id as string) ?? null,
      clinicId: (pass.clinic_id as string) ?? null,
    };
  }

  return { kind: 'other' };
}
