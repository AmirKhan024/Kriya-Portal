/**
 * Create the private `care-videos` Supabase Storage bucket (idempotent).
 * Usage:  node scripts/create-storage-bucket.mjs    (loads .env.local)
 *
 * Uses the Storage REST API directly (no Supabase JS client) so it works on
 * Node.js 18/20 without a native WebSocket implementation.
 */
import { readFileSync } from 'node:fs';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* rely on real env */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const endpoint = `${url.replace(/\/$/, '')}/storage/v1/bucket`;

const res = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'apikey': key,
  },
  body: JSON.stringify({
    id: 'care-videos',
    name: 'care-videos',
    public: false,
    file_size_limit: 52428800,        // 50 MB — Supabase free-tier per-file cap
    allowed_mime_types: ['video/mp4', 'video/webm', 'video/quicktime'],
  }),
});

const json = await res.json().catch(() => null);

if (!res.ok) {
  const msg = json?.error ?? json?.message ?? `HTTP ${res.status}`;
  if (/already exists/i.test(msg)) { console.log('Bucket care-videos already exists ✓'); process.exit(0); }
  console.error('Failed:', msg); process.exit(1);
}

console.log('Created bucket:', json?.name ?? 'care-videos', '✓');
process.exit(0);
