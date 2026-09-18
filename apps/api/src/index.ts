import { serve } from '@hono/node-server';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from './env.js';
import { log } from './core/logger.js';
import { getSqlite, dbHealthCheck } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { startWorker } from './jobs/worker.js';
import app from './app.js';

/**
 * Node entrypoint.
 *
 * Boot sequence is deliberately strict: migrations run before the server
 * accepts traffic, so the process is either fully ready or not listening at
 * all. That removes a whole class of "half-deployed" states in production.
 */

async function main(): Promise<void> {
  mkdirSync(dirname(resolve(process.cwd(), env.DATABASE_PATH)), { recursive: true });
  mkdirSync(resolve(process.cwd(), env.STORAGE_DIR), { recursive: true });

  // 1. Migrations
  runMigrations();
  const health = await dbHealthCheck();
  log.info('database ready', health);

  // 2. Reference data (controls, pricing catalogue, welcome credits)
  seedDatabase();

  // 3. Background jobs
  if (env.RUN_WORKER_IN_PROCESS) {
    startWorker();
  }

  // 4. Static frontend, if it has been built (production single-process mode)
  const webDist = resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    const { serveStatic } = await import('@hono/node-server/serve-static');
    const { readFile } = await import('node:fs/promises');

    // Hashed assets are immutable: cache them hard.
    app.use('/assets/*', serveStatic({ root: webDist }));
    app.use('/*', serveStatic({ root: webDist }));

    // Cache policy: immutable for hashed assets, revalidated for index.html.
    app.use('*', async (c, next) => {
      await next();
      if (c.req.path.startsWith('/assets/')) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    });
    // SPA fallback: unknown paths render the client router.
    app.notFound(async (c) => {
      const index = await readFile(resolve(webDist, 'index.html'), 'utf8');
      return c.html(index);
    });
    log.info('serving built frontend', { root: webDist });
  }

  const port = env.PORT;
  const host = env.HOST;

  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    log.info(`CRA Compliance OS listening`, { url: `http://${host}:${info.port}`, env: env.NODE_ENV });
  });

  const shutdown = (signal: string): void => {
    log.info('shutting down', { signal });
    try {
      getSqlite().close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('fatal startup error', { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
