/**
 * Register (or clear) the Telegram bot webhook.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=... [TELEGRAM_WEBHOOK_SECRET=...] node scripts/set-telegram-webhook.mjs <base-url>
 * Example:
 *   node scripts/set-telegram-webhook.mjs https://kriya-portal.vercel.app
 *   node scripts/set-telegram-webhook.mjs --delete      # remove the webhook
 *
 * Loads .env.local automatically if present.
 */
import { readFileSync } from 'node:fs';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env.local — rely on real env */ }

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error('TELEGRAM_BOT_TOKEN is required'); process.exit(1); }

const arg = process.argv[2];
const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());

const result = arg === '--delete'
  ? await api('deleteWebhook', { drop_pending_updates: true })
  : await api('setWebhook', {
      url: `${arg.replace(/\/$/, '')}/api/v1/webhooks/telegram`,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
      allowed_updates: ['message'],
    });

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
