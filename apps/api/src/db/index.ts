import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

/** Repository root — migrations, drizzle metadata and `data/` live here. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const MIGRATIONS_DIR = resolve(REPO_ROOT, 'drizzle');

let sqlite: Database.Database | null = null;
let dbInstance: Db | null = null;

function open(): { sqlite: Database.Database; db: Db } {
  const isMemory = env.DATABASE_PATH === ':memory:';

  if (!isMemory) {
    const absolute = resolve(process.cwd(), env.DATABASE_PATH);
    mkdirSync(dirname(absolute), { recursive: true });
    const conn = new Database(absolute);
    conn.pragma('journal_mode = WAL');
    conn.pragma('foreign_keys = ON');
    conn.pragma('busy_timeout = 5000');
    conn.pragma('synchronous = NORMAL');
    const instance = drizzle(conn, { schema });
    return { sqlite: conn, db: instance };
  }

  const conn = new Database(':memory:');
  conn.pragma('foreign_keys = ON');
  const instance = drizzle(conn, { schema });
  return { sqlite: conn, db: instance };
}

/** Lazily-initialised singleton database handle. */
export function getDb(): Db {
  if (!dbInstance) {
    const opened = open();
    sqlite = opened.sqlite;
    dbInstance = opened.db;
  }
  return dbInstance;
}

/** Raw driver handle, needed for pragmas and multi-statement migrations. */
export function getSqlite(): Database.Database {
  getDb();
  return sqlite!;
}

/** Runs a callback inside a transaction, retrying on SQLITE_BUSY. */
export function tx<T>(fn: (db: Db) => T): T {
  const database = getDb();
  return database.transaction(fn) as unknown as T;
}

export async function dbHealthCheck(): Promise<{ ok: boolean; latencyMs: number; tables: number }> {
  const start = Date.now();
  try {
    const row = getDb()
      .all<{ count: number }>(
        sql.raw(`SELECT count(*) AS count FROM sqlite_master WHERE type='table'`),
      )
      .at(0);
    return { ok: true, latencyMs: Date.now() - start, tables: row?.count ?? 0 };
  } catch {
    return { ok: false, latencyMs: Date.now() - start, tables: 0 };
  }
}

export function closeDb(): void {
  try {
    sqlite?.close();
  } catch {
    /* already closed */
  }
  sqlite = null;
  dbInstance = null;
}

export { schema };
