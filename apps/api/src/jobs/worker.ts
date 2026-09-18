import { claimNext, completeJob, failJob, getJob } from './queue.js';
import { log } from '../core/logger.js';
import { runRepositoryScan, generateSbomForScan, type ScanJobPayload } from '../scan/service.js';
import { syncKev } from '../intel/kev.js';
import { settleUsage } from '../modules/billing/ledger.js';

/**
 * Background worker.
 *
 * Runs in-process in development and single-node deployments, and as its own
 * process (`npm run worker`) in production. On Cloudflare this maps onto a
 * Queue consumer with identical handler semantics.
 */

export type JobHandler = (jobId: string, payload: any) => Promise<unknown>;

export const handlers: Record<string, JobHandler> = {
  'scan.repository': async (jobId, payload: ScanJobPayload) => {
    const usageEventId = payload.usageEventId ?? null;

    try {
      const result = await runRepositoryScan(jobId, payload);

      // An unchanged repository is never charged: the reservation is released.
      if (result && (result as { skipped?: boolean }).skipped && usageEventId) {
        settleUsage(usageEventId, 'release', 'repository unchanged');
      } else if (usageEventId) {
        settleUsage(usageEventId, 'commit');
      }

      return result;
    } catch (err) {
      if (usageEventId) settleUsage(usageEventId, 'release', 'scan failed');
      throw err;
    }
  },

  'sbom.generate': async (_jobId, payload: { orgId: string; scanId: string }) =>
    generateSbomForScan(payload.orgId, payload.scanId),

  'intel.kev.sync': async () => syncKev(),

  'billing.expire_credits': async () => {
    const { expireCredits } = await import('../modules/billing/ledger.js');
    return { expired: expireCredits() };
  },
};

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  if (running) return;
  running = true;

  try {
    // Process all immediately-available jobs in this tick.
    for (let i = 0; i < 5; i += 1) {
      const job = claimNext(Object.keys(handlers));
      if (!job) break;

      const handler = handlers[job.type];
      if (!handler) {
        failJob(job.id, new Error(`No handler registered for job type "${job.type}"`));
        continue;
      }

      try {
        const result = await handler(job.id, job.payload);
        completeJob(job.id, result);
      } catch (err) {
        failJob(job.id, err);
      }
    }
  } catch (err) {
    log.error('worker tick failed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}

export function startWorker(intervalMs = Number(process.env.WORKER_POLL_MS ?? 1500)): () => void {
  log.info('worker started', { intervalMs, handlers: Object.keys(handlers) });
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  if (timer.unref) timer.unref();
  return () => stopWorker();
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  log.info('worker stopped');
}

/** Runs one job to completion. Used by tests and by the admin "run now" action. */
export async function runJobNow(jobId: string): Promise<unknown> {
  const job = getJob(jobId);
  if (!job) throw new Error('Job not found');
  const handler = handlers[job.type];
  if (!handler) throw new Error(`No handler for ${job.type}`);
  try {
    const result = await handler(job.id, job.payload);
    completeJob(job.id, result);
    return result;
  } catch (err) {
    failJob(job.id, err);
    throw err;
  }
}

export function jobTypeFor(type: string): JobHandler | null {
  return handlers[type] ?? null;
}
