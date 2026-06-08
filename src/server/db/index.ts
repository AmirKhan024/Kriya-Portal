import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Singleton pattern: prevents multiple pool instances during Next.js hot-reload
declare global {
  // eslint-disable-next-line no-var
  var _pgClient: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[DB] DATABASE_URL is not set. All DB queries will fail. Check .env.local');
    return postgres('postgresql://localhost/kriya_placeholder', {
      max: 1,
      prepare: false,
    });
  }
  return postgres(url, {
    max: 1,
    prepare: false,        // REQUIRED: Supabase PgBouncer (port 6543) does not support prepared statements
    ssl: 'require',        // Supabase requires SSL on all connections
    idle_timeout: 20,
    connect_timeout: 30,
  });
}

const client = globalThis._pgClient ?? createClient();
if (process.env.NODE_ENV !== 'production') globalThis._pgClient = client;

export const db = drizzle(client, { schema });
export type DB = typeof db;
