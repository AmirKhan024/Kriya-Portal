import type { Config } from 'drizzle-kit';

// drizzle-kit requires a session-mode connection (port 5432); the app uses the
// PgBouncer transaction-mode pooler (port 6543) via DATABASE_URL.
export default {
  schema: './src/server/db/schema/index.ts',
  out: './src/server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL! },
} satisfies Config;
