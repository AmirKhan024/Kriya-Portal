// Vitest global setup: load .env.local so DB-gated tests (RUN_DB_TESTS=true) can
// reach Supabase via DATABASE_URL. Harmless for unit/integration tests.
import { config } from 'dotenv';

config({ path: '.env.local' });
