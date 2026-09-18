/**
 * Standalone worker process.
 *
 * In production you usually want the worker isolated from request handling so a
 * burst of scans cannot slow down the API:
 *
 *   npm run worker
 */
import { startWorker } from './jobs/worker.js';
import { log } from './core/logger.js';
import { enqueue } from './jobs/queue.js';
import { getDb } from './db/index.js';
import { intelSources } from './db/schema.js';
import { eq } from 'drizzle-orm';

log.info('worker process starting');

// Schedule recurring ingestion the first time this process starts.
const kev = getDb().select().from(intelSources).where(eq(intelSources.key, 'kev')).get();
if (!kev) {
  enqueue({ type: 'intel.kev.sync', payload: {}, dedupeKey: 'intel.kev.sync' });
  log.info('queued initial KEV ingestion');
}

const stop = startWorker();

const shutdown = (): void => {
  log.info('worker shutting down');
  stop();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
