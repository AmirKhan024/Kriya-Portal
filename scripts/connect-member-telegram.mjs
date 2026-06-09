/**
 * DEV helper: manually link a member to a Telegram chat id (so you can test the
 * *send* path locally without deploying the webhook).
 *
 * Get your chat id: message your bot once, then open
 *   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
 * and read `result[].message.chat.id`  (or message @userinfobot).
 *
 * Usage:
 *   node scripts/connect-member-telegram.mjs <memberId> <chatId>
 *
 * Loads .env.local for DATABASE_URL.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* rely on real env */ }

const [memberId, chatId] = process.argv.slice(2);
if (!memberId || !chatId) { console.error('Usage: node scripts/connect-member-telegram.mjs <memberId> <chatId>'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });
const rows = await sql`update members set telegram_chat_id = ${chatId}, updated_at = now() where id = ${memberId} returning id, name, telegram_chat_id`;
console.log(rows.length ? `Connected: ${JSON.stringify(rows[0])}` : 'No member with that id');
await sql.end();
process.exit(rows.length ? 0 : 1);
