/**
 * Cloudflare Workers entrypoint.
 *
 * The API is written against Hono's runtime-agnostic interfaces so the same
 * application can be deployed to Workers with D1, R2 and Queues:
 *
 *   - swap `better-sqlite3` for `drizzle-orm/d1` in `src/db/index.ts`
 *   - set STORAGE_DRIVER=r2
 *   - expose a Queue consumer that calls `handlers[job.type]`
 *
 * See docs/ARCHITECTURE.md for the full deployment matrix. The default
 * deployment target remains a single Node process, which is the cheapest way
 * to reach first revenue.
 */
import app from './app.js';

export default {
  fetch: app.fetch,
  async scheduled(_event: unknown, _env: unknown, _ctx: unknown): Promise<void> {
    // Cron: refresh vulnerability intelligence and run scheduled scans.
    const { enqueue } = await import('./jobs/queue.js');
    enqueue({ type: 'intel.kev.sync', payload: {}, dedupeKey: 'intel.kev.sync' });
  },
};
