import { and, eq, lte, sql, asc , inArray } from 'drizzle-orm';
import { getDb, tx } from '../db/index.js';
import { jobEvents, jobs } from '../db/schema.js';
import { newId } from '../core/ids.js';
import { log } from '../core/logger.js';
import { AppError } from '../core/errors.js';

/**
 * Durable background job queue.
 *
 * Long-running work (repository scans, advisory ingestion, report generation)
 * must never block an HTTP request, so every expensive action enqueues a job
 * and returns immediately. The UI polls job progress, which is written by the
 * worker at each pipeline step — no simulated progress bars anywhere.
 *
 * Backed by SQLite here; the same interface maps onto Cloudflare Queues for the
 * edge deployment (see `docs/ARCHITECTURE.md`).
 */

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'dead';

export interface EnqueueInput<T = unknown> {
  type: string;
  orgId?: string;
  payload: T;
  /** Only one pending/running job per key at a time. */
  dedupeKey?: string;
  runAt?: number;
  maxAttempts?: number;
}

export interface JobRecord<T = unknown> {
  id: string;
  type: string;
  orgId: string | null;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
}

export function enqueue<T>(input: EnqueueInput<T>): JobRecord<T> {
  return tx(() => {
    const db = getDb();

    if (input.dedupeKey) {
      const existing = db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.dedupeKey, input.dedupeKey),
            sql`${jobs.status} in ('pending','running')`,
          ),
        )
        .get();
      if (existing) {
        return {
          id: existing.id,
          type: existing.type,
          orgId: existing.orgId,
          payload: JSON.parse(existing.payloadJson) as T,
          status: existing.status as JobStatus,
          attempts: existing.attempts,
          maxAttempts: existing.maxAttempts,
        };
      }
    }

    const id = newId('job');
    db.insert(jobs)
      .values({
        id,
        orgId: input.orgId ?? null,
        type: input.type,
        payloadJson: JSON.stringify(input.payload ?? {}),
        status: 'pending',
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        dedupeKey: input.dedupeKey ?? null,
        runAt: input.runAt ?? Date.now(),
        progressPct: 0,
        progressMessage: 'Queued',
        createdAt: Date.now(),
      })
      .run();

    emitEvent(id, input.orgId ?? null, 'pending', 0, 'Queued');

    return {
      id,
      type: input.type,
      orgId: input.orgId ?? null,
      payload: input.payload,
      status: 'pending' as JobStatus,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
    };
  });
}

function emitEvent(jobId: string, orgId: string | null, status: string, pct: number, message?: string): void {
  try {
    getDb()
      .insert(jobEvents)
      .values({
        id: newId('jev'),
        jobId,
        orgId,
        status,
        progressPct: pct,
        message: message ?? null,
        createdAt: Date.now(),
      })
      .run();
  } catch (err) {
    log.error('job event write failed', { jobId, error: String(err) });
  }
}

/** Public API for workers: updates progress and the user-visible message. */
export function progress(jobId: string, pct: number, message: string): void {
  getDb()
    .update(jobs)
    .set({ progressPct: Math.max(0, Math.min(100, Math.round(pct))), progressMessage: message })
    .where(eq(jobs.id, jobId))
    .run();
  const job = getJob(jobId);
  emitEvent(jobId, job?.orgId ?? null, 'running', pct, message);
}

export function getJob<T = unknown>(jobId: string): JobRecord<T> | null {
  const row = getDb().select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    orgId: row.orgId,
    payload: JSON.parse(row.payloadJson) as T,
    status: row.status as JobStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
  };
}

export function getJobDetail(jobId: string) {
  const row = getDb().select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!row) return null;
  const events = getDb()
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(asc(jobEvents.createdAt))
    .all();
  return { ...row, events };
}

/** Atomically claims the next runnable job. */
export function claimNext(types?: string[]): JobRecord | null {
  return tx(() => {
    const db = getDb();
    const row = db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.status, 'pending'),
          lte(jobs.runAt, Date.now()),
          ...(types?.length ? [inArray(jobs.type, types)] : []),
        ),
      )
      .orderBy(asc(jobs.runAt))
      .limit(1)
      .get();

    if (!row) return null;

    db.update(jobs)
      .set({ status: 'running', startedAt: Date.now(), attempts: row.attempts + 1, progressMessage: 'Starting' })
      .where(eq(jobs.id, row.id))
      .run();

    emitEvent(row.id, row.orgId, 'running', 0, 'Starting');

    return {
      id: row.id,
      type: row.type,
      orgId: row.orgId,
      payload: JSON.parse(row.payloadJson) as unknown,
      status: 'running' as JobStatus,
      attempts: row.attempts + 1,
      maxAttempts: row.maxAttempts,
    };
  });
}

export function completeJob(jobId: string, result?: unknown): void {
  getDb()
    .update(jobs)
    .set({
      status: 'succeeded',
      finishedAt: Date.now(),
      progressPct: 100,
      progressMessage: 'Complete',
      resultJson: result === undefined ? null : JSON.stringify(result),
      lastError: null,
    })
    .where(eq(jobs.id, jobId))
    .run();
  const job = getJob(jobId);
  emitEvent(jobId, job?.orgId ?? null, 'succeeded', 100, 'Complete');
}

/**
 * Records a failure with exponential backoff (30s, 2m, 8m, 32m, ...).
 * After `maxAttempts` the job is moved to `dead` for operator inspection.
 */
export function failJob(jobId: string, error: unknown): { requeued: boolean; attempts: number } {
  const message = error instanceof Error ? error.message : String(error);
  const job = getJob(jobId);
  if (!job) return { requeued: false, attempts: 0 };

  const attempts = job.attempts;
  const dead = attempts >= job.maxAttempts;
  const backoffMs = 30_000 * Math.pow(4, Math.max(0, attempts - 1));

  getDb()
    .update(jobs)
    .set({
      status: dead ? 'dead' : 'pending',
      runAt: dead ? Date.now() : Date.now() + backoffMs,
      finishedAt: dead ? Date.now() : null,
      lastError: message,
      progressMessage: dead ? `Failed permanently: ${message}` : `Retrying after error: ${message}`,
    })
    .where(eq(jobs.id, jobId))
    .run();

  emitEvent(jobId, job.orgId, dead ? 'failed' : 'pending', job.attempts * 10, message);
  log.warn('job failed', { jobId, type: job.type, attempts, dead, message });

  return { requeued: !dead, attempts };
}

export function cancelJob(jobId: string): void {
  const job = getJob(jobId);
  if (!job) throw AppError.notFound('Job');
  if (job.status === 'succeeded') throw AppError.conflict('That job has already completed.');
  getDb()
    .update(jobs)
    .set({ status: 'cancelled', finishedAt: Date.now(), progressMessage: 'Cancelled' })
    .where(eq(jobs.id, jobId))
    .run();
  emitEvent(jobId, job.orgId, 'cancelled', 0, 'Cancelled');
}

export function listJobs(opts: { orgId?: string; status?: JobStatus; limit?: number } = {}) {
  const db = getDb();
  const clauses = [];
  if (opts.orgId) clauses.push(eq(jobs.orgId, opts.orgId));
  if (opts.status) clauses.push(eq(jobs.status, opts.status));
  return db
    .select()
    .from(jobs)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(sql`${jobs.createdAt} desc`)
    .limit(opts.limit ?? 50)
    .all();
}

/** Operator view: failures that need attention. */
export function deadLetterJobs(limit = 50) {
  return getDb()
    .select()
    .from(jobs)
    .where(eq(jobs.status, 'dead'))
    .orderBy(sql`${jobs.createdAt} desc`)
    .limit(limit)
    .all();
}

export function requeueJob(jobId: string): void {
  getDb()
    .update(jobs)
    .set({ status: 'pending', runAt: Date.now(), attempts: 0, lastError: null, progressMessage: 'Requeued' })
    .where(eq(jobs.id, jobId))
    .run();
  const job = getJob(jobId);
  emitEvent(jobId, job?.orgId ?? null, 'pending', 0, 'Requeued');
}

export function queueStats() {
  const db = getDb();
  const rows = db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();
  const stats: Record<string, number> = {};
  for (const r of rows) stats[r.status] = Number(r.count);
  return stats;
}
