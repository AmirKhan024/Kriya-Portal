/**
 * Create the private `care-videos` Supabase Storage bucket (idempotent).
 * Usage:  node scripts/create-storage-bucket.mjs    (loads .env.local)
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* rely on real env */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const supa = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await supa.storage.createBucket('care-videos', {
  public: false,
  fileSizeLimit: '50MB', // Supabase free-tier per-file cap; raise on a paid plan
  allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
});
if (error) {
  if (/already exists/i.test(error.message)) { console.log('Bucket care-videos already exists ✓'); process.exit(0); }
  console.error('Failed:', error.message); process.exit(1);
}
console.log('Created bucket:', data?.name ?? 'care-videos');
process.exit(0);
