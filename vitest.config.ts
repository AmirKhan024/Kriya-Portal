import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Load .env.local first so DB-gated tests (RUN_DB_TESTS=true) get DATABASE_URL.
    setupFiles: ['./tests/setup.env.ts'],
    env: { NODE_ENV: 'test' },
  },
});
