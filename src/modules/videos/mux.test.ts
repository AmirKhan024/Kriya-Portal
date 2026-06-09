import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { createDirectUpload, verifyWebhookSignature } from './mux';

afterEach(() => { delete process.env.MUX_WEBHOOK_SECRET; });

describe('createDirectUpload (stub)', () => {
  it('returns an instant-ready stub asset', async () => {
    const up = await createDirectUpload({ title: 'Knee mobility', passthrough: { video_id: 'v1' } });
    expect(up.status).toBe('ready');
    expect(up.stubbed).toBe(true);
    expect(up.playback_id).toMatch(/^stub-pb-/);
    expect(up.upload_url).toMatch(/^stub:\/\//);
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts everything when MUX_WEBHOOK_SECRET is unset (stub mode)', () => {
    expect(verifyWebhookSignature('{}', null)).toBe(true);
  });

  it('verifies a real HMAC when the secret is set', () => {
    process.env.MUX_WEBHOOK_SECRET = 'shh';
    const body = '{"type":"video.asset.ready"}';
    const ts = '1700000000';
    const good = createHmac('sha256', 'shh').update(`${ts}.${body}`).digest('hex');
    expect(verifyWebhookSignature(body, `t=${ts},v1=${good}`)).toBe(true);
    expect(verifyWebhookSignature(body, `t=${ts},v1=deadbeef`)).toBe(false);
    expect(verifyWebhookSignature(body, null)).toBe(false);
  });
});
