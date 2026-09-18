import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDb, getSqlite, closeDb, MIGRATIONS_DIR } from './index.js';
import { log } from '../core/logger.js';

/**
 * Applies all pending migrations from `drizzle/`.
 * Safe to run repeatedly — drizzle tracks applied migrations in `__drizzle_migrations`.
 */
export function runMigrations(): void {
  const db = getDb();
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runMigrations();
    const tables = getSqlite()
      .prepare(`SELECT count(*) AS c FROM sqlite_master WHERE type='table'`)
      .get() as { c: number };
    log.info('Migrations applied', { tables: tables.c });
  } catch (err) {
    log.error('Migration failed', { error: err instanceof Error ? err.message : err });
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
