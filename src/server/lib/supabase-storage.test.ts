import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage = {
  from: vi.fn(() => storage),
  createSignedUploadUrl: vi.fn(),
  createSignedUrl: vi.fn(),
};
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ storage })) }));

import { createVideoUpload, getPlaybackUrl, videoPath } from './supabase-storage';

const ORIG = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG.url ?? 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIG.key ?? 'svc';
});

describe('supabase-storage helpers', () => {
  it('videoPath is deterministic', () => {
    expect(videoPath('abc')).toBe('videos/abc');
  });

  it('createVideoUpload returns a signed upload URL when configured', async () => {
    storage.createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: 'https://up', token: 'tok', path: 'videos/v1' }, error: null });
    const r = await createVideoUpload('v1');
    expect(storage.from).toHaveBeenCalledWith('care-videos');
    expect(r).toMatchObject({ path: 'videos/v1', signed_url: 'https://up', token: 'tok', stubbed: false });
  });

  it('getPlaybackUrl returns a signed URL', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://play' }, error: null });
    expect(await getPlaybackUrl('videos/v1')).toBe('https://play');
    expect(await getPlaybackUrl(null)).toBeNull();
  });

  it('is stub-safe when Supabase env is missing (no throw)', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const up = await createVideoUpload('v2');
    expect(up).toMatchObject({ path: 'videos/v2', signed_url: null, stubbed: true });
    expect(await getPlaybackUrl('videos/v2')).toBeNull();
  });
});
