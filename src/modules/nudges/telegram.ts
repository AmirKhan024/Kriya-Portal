/**
 * Telegram connect-flow helpers (feature 2c messaging). Pure + unit-tested.
 *
 * A member connects by tapping `https://t.me/<bot>?start=<memberId>` → Telegram sends
 * the bot a `/start <memberId>` message; the webhook captures the chat id and stores it
 * on the member, so future nudges/reminders can reach them.
 */
const PG_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type TelegramConnect = { memberId: string; chatId: string };

/** Extract { memberId, chatId } from a Telegram update if it's a valid `/start <uuid>`. */
export function parseTelegramStart(update: unknown): TelegramConnect | null {
  if (!update || typeof update !== 'object') return null;
  const msg = (update as { message?: { text?: unknown; chat?: { id?: unknown } } }).message;
  const text = typeof msg?.text === 'string' ? msg.text : '';
  const rawChat = msg?.chat?.id;
  if (typeof rawChat !== 'number' && typeof rawChat !== 'string') return null;

  const m = /^\/start\s+(\S+)/.exec(text.trim());
  if (!m) return null;
  const memberId = m[1];
  if (!PG_UUID.test(memberId)) return null;

  return { memberId, chatId: String(rawChat) };
}

/** Deep-link a member uses to connect their Telegram to the bot. */
export function telegramConnectLink(botUsername: string, memberId: string): string {
  return `https://t.me/${botUsername}?start=${memberId}`;
}
