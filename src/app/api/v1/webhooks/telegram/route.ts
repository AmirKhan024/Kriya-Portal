import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { withApiHandler, ApiError } from '@/server/auth/middleware';
import { parseTelegramStart } from '@/modules/nudges/telegram';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/telegram — feature 2c · the Telegram bot webhook.
 *
 * NOT authed via JWT — Telegram posts updates here. Optionally verified by the
 * `X-Telegram-Bot-Api-Secret-Token` header (set when registering the webhook with a
 * `secret_token`); accepts when `TELEGRAM_WEBHOOK_SECRET` is unset (dev). On a
 * `/start <memberId>` it stores the sender's chat id on the member so future
 * nudges/reminders can reach them. Always returns 200 so Telegram doesn't retry.
 */
export const POST = withApiHandler(async (request) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    throw new ApiError('AUTH_REQUIRED', 'Invalid webhook secret', 401);
  }

  let update: unknown;
  try { update = await request.json(); } catch { return NextResponse.json({ data: { handled: 'bad_json' }, error: null }); }

  const connect = parseTelegramStart(update);
  if (!connect) {
    return NextResponse.json({ data: { handled: 'ignored' }, error: null });
  }

  // Store the chat id for the member (if the member exists). Don't leak existence.
  await db.update(members)
    .set({ telegram_chat_id: connect.chatId, updated_at: new Date() })
    .where(eq(members.id, connect.memberId));

  return NextResponse.json({ data: { handled: 'connected', member_id: connect.memberId }, error: null });
});
