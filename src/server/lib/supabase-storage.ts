import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Care-video storage on Supabase Storage (free tier) — replaces Mux (feature 3a).
 * Private bucket; uploads via signed upload URLs, playback via short-lived signed
 * URLs. Stub-safe: with Supabase env unset, returns stub values (never throws), so
 * the flow stays exercisable offline.
 */
export const VIDEO_BUCKET = 'care-videos';

let _client: SupabaseClient | null = null;
function client(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!_client) _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

/** Deterministic storage path for a video. */
export function videoPath(videoId: string): string {
  return `videos/${videoId}`;
}

export type UploadTarget = { path: string; signed_url: string | null; token: string | null; stubbed: boolean };

/** A signed URL the client PUTs the file to. */
export async function createVideoUpload(videoId: string): Promise<UploadTarget> {
  const path = videoPath(videoId);
  const c = client();
  if (!c) return { path, signed_url: null, token: null, stubbed: true };
  const { data, error } = await c.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { path, signed_url: null, token: null, stubbed: true };
  return { path, signed_url: data.signedUrl, token: data.token, stubbed: false };
}

/** A short-lived signed URL for playback (null if not configured/missing). */
export async function getPlaybackUrl(path: string | null, ttlSec = 3600): Promise<string | null> {
  if (!path) return null;
  const c = client();
  if (!c) return null;
  const { data, error } = await c.storage.from(VIDEO_BUCKET).createSignedUrl(path, ttlSec);
  if (error || !data) return null;
  return data.signedUrl;
}
