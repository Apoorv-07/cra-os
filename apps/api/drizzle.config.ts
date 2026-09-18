import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 * Generated SQL migrations live in ../../drizzle and are applied at boot and
 * by `npm run db:migrate`, so deployments are deterministic.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: '../../drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? 'data/cra.db',
  },
  strict: true,
  verbose: false,
});
