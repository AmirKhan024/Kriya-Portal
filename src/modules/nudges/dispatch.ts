/**
 * Nudge dispatcher — feature 2c.
 *
 * Real free-tier channel: **Telegram Bot**. The caller resolves the member's
 * `telegram_chat_id` and passes it as `to`.
 *   - `TELEGRAM_BOT_TOKEN` set + `to` present → real Telegram sendMessage.
 *   - token unset                            → stub result (offline-safe; never throws).
 *   - `to` null (member not connected)       → status 'failed', reason 'not_connected'.
 *
 * This is the single external boundary; it never throws, so the nudge flow always completes.
 */

export type DispatchInput = {
  /** The member's telegram_chat_id, or null if they haven't connected the bot. */
  to: string | null;
  message: string;
};

export type DispatchResult = {
  provider: 'telegram';
  status: 'sent' | 'failed';
  provider_message_id: string | null;
  stubbed: boolean;
  reason?: string;
};

export async function dispatchNudge({ to, message }: DispatchInput): Promise<DispatchResult> {
  if (!to) {
    return { provider: 'telegram', status: 'failed', provider_message_id: null, stubbed: false, reason: 'not_connected' };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    // Offline/dev: no token configured → stub (so the flow is testable without Telegram).
    return { provider: 'telegram', status: 'sent', provider_message_id: `stub:telegram:${crypto.randomUUID()}`, stubbed: true };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: to, text: message }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
    if (!res.ok || !json?.ok) {
      return { provider: 'telegram', status: 'failed', provider_message_id: null, stubbed: false, reason: json?.description ?? `http_${res.status}` };
    }
    return { provider: 'telegram', status: 'sent', provider_message_id: String(json.result?.message_id ?? ''), stubbed: false };
  } catch {
    return { provider: 'telegram', status: 'failed', provider_message_id: null, stubbed: false, reason: 'network_error' };
  }
}
