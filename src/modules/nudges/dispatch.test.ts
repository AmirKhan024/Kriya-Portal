import { describe, it, expect, vi, afterEach } from 'vitest';
import { dispatchNudge } from './dispatch';

afterEach(() => { delete process.env.TELEGRAM_BOT_TOKEN; vi.restoreAllMocks(); });

describe('dispatchNudge (Telegram)', () => {
  it('fails (not_connected) when the member has no chat id', async () => {
    const r = await dispatchNudge({ to: null, message: 'hi' });
    expect(r).toMatchObject({ provider: 'telegram', status: 'failed', reason: 'not_connected', provider_message_id: null });
  });

  it('stubs (sent) when no bot token is configured', async () => {
    const r = await dispatchNudge({ to: '123', message: 'hi' });
    expect(r.status).toBe('sent');
    expect(r.stubbed).toBe(true);
    expect(r.provider_message_id).toMatch(/^stub:telegram:/);
  });

  it('calls the Telegram sendMessage API when token + chat id present', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'TKN';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) });
    vi.stubGlobal('fetch', fetchMock);
    const r = await dispatchNudge({ to: '999', message: 'hello' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.telegram.org/botTKN/sendMessage', expect.objectContaining({ method: 'POST' }));
    expect(r).toMatchObject({ status: 'sent', stubbed: false, provider_message_id: '42' });
  });

  it('fails gracefully when Telegram responds not-ok', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'TKN';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, description: 'chat not found' }) }));
    const r = await dispatchNudge({ to: '999', message: 'hello' });
    expect(r).toMatchObject({ status: 'failed', reason: 'chat not found' });
  });
});
