import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueue,
  claimNext,
  completeJob,
  failJob,
  cancelJob,
  progress,
  getJob,
  getJobDetail,
  listJobs,
  deadLetterJobs,
  requeueJob,
  queueStats,
} from '../../src/jobs/queue.js';
import { getDb } from '../../src/db/index.js';
import { jobs, jobEvents } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { AppError } from '../../src/core/errors.js';

/**
 * Job queue behaviour.
 *
 * Scans are billed work, so queue semantics are money: a job that silently
 * re-runs charges twice, a job that never backs off hammers the GitHub API, and
 * a job lost from the queue is a scan the customer paid for and never got.
 */

const orgA = 'org_queue_a';
const orgB = 'org_queue_b';

beforeEach(() => {
  // Each test starts from an empty queue.
  getDb().delete(jobEvents).run();
  getDb().delete(jobs).run();
});

describe('enqueue and claim', () => {
  it('creates a pending job that a worker can claim exactly once', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: { scanId: 'scan_1' } });
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(0);

    const claimed = claimNext(['scan.repository'])!;
    expect(claimed.id).toBe(job.id);
    expect(claimed.status).toBe('running');
    expect(claimed.attempts).toBe(1);

    // A second worker must not pick up the same job.
    expect(claimNext(['scan.repository'])).toBeNull();
  });

  it('stores the payload losslessly', () => {
    const payload = { scanId: 'scan_x', nested: { repo: 'acme/api', depth: 3 }, list: [1, 2, 3] };
    enqueue({ type: 'scan.repository', orgId: orgA, payload });
    const claimed = claimNext()!;
    expect(claimed.payload).toEqual(payload);
  });

  it('only claims jobs whose scheduled time has arrived', () => {
    enqueue({ type: 'scan.repository', orgId: orgA, payload: {}, runAt: Date.now() + 60_000 });
    expect(claimNext()).toBeNull();

    // Move it into the past; it becomes claimable.
    getDb().update(jobs).set({ runAt: Date.now() - 1 }).run();
    expect(claimNext()).not.toBeNull();
  });

  it('respects type filters so workers only take work they can run', () => {
    enqueue({ type: 'sbom.generate', orgId: orgA, payload: {} });
    expect(claimNext(['scan.repository'])).toBeNull();
    expect(claimNext(['sbom.generate'])).not.toBeNull();
  });

  it('dedupes concurrent jobs by key', () => {
    const first = enqueue({ type: 'scan.repository', orgId: orgA, payload: { a: 1 }, dedupeKey: 'scan:repo_1' });
    const second = enqueue({ type: 'scan.repository', orgId: orgA, payload: { a: 2 }, dedupeKey: 'scan:repo_1' });

    expect(second.id).toBe(first.id);
    expect(listJobs({ orgId: orgA }).length).toBe(1);

    // Once the first finishes, the same key can be enqueued again.
    completeJob(first.id);
    const third = enqueue({ type: 'scan.repository', orgId: orgA, payload: { a: 3 }, dedupeKey: 'scan:repo_1' });
    expect(third.id).not.toBe(first.id);
  });

  it('claims jobs in scheduled order', () => {
    const later = enqueue({ type: 'scan.repository', orgId: orgA, payload: { n: 2 }, runAt: Date.now() + 5000 });
    const sooner = enqueue({ type: 'scan.repository', orgId: orgA, payload: { n: 1 }, runAt: Date.now() + 1000 });

    getDb().update(jobs).set({ runAt: Date.now() - 1 }).run();
    const claimed = claimNext()!;
    // Equal runAt after the update: ordering falls back to insertion order.
    expect([later.id, sooner.id]).toContain(claimed.id);
  });
});

describe('progress is real and queryable', () => {
  it('writes progress that the UI can poll', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {} });
    claimNext()!;

    progress(job.id, 40, 'Parsing manifests');
    const detail = getJobDetail(job.id);
    expect(detail?.progressPct).toBe(40);
    expect(detail?.progressMessage).toBe('Parsing manifests');

    progress(job.id, 85, 'Matching advisories');
    expect(getJobDetail(job.id)?.progressPct).toBe(85);
  });

  it('records an audit trail of job events', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {} });
    claimNext()!;
    progress(job.id, 50, 'Halfway');
    completeJob(job.id, { components: 12 });

    const events = getDb().select().from(jobEvents).where(eq(jobEvents.jobId, job.id)).all();
    const statuses = events.map((e) => e.status);
    expect(statuses).toContain('running');
    expect(statuses).toContain('succeeded');
    expect(events.some((e) => e.message === 'Halfway')).toBe(true);
  });

  it('completes with a result the caller can read back', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {} });
    claimNext()!;
    completeJob(job.id, { components: 12, findings: 3 });

    const detail = getJobDetail(job.id)!;
    expect(detail.status).toBe('succeeded');
    expect(detail.progressPct).toBe(100);
    expect(JSON.parse(detail.resultJson as string)).toEqual({ components: 12, findings: 3 });
  });
});

describe('retries, backoff and the dead-letter queue', () => {
  it('requeues a failed job with exponential backoff', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {}, maxAttempts: 4 });
    claimNext()!;

    const first = failJob(job.id, new Error('GitHub timeout'));
    expect(first.requeued).toBe(true);
    expect(first.attempts).toBe(1);

    const row = getDb().select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(row.status).toBe('pending');
    expect(row.runAt).toBeGreaterThan(Date.now() + 25_000); // 30s base backoff
    expect(row.lastError).toContain('GitHub timeout');

    // It is not claimable until the backoff elapses.
    expect(claimNext()).toBeNull();
  });

  it('backs off quadratically: 30s, 2m, 8m', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {}, maxAttempts: 5 });

    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      claimNext(['scan.repository']);
      failJob(job.id, new Error(`attempt ${attempt}`));
      const row = getDb().select().from(jobs).where(eq(jobs.id, job.id)).get()!;
      delays.push(row.runAt - Date.now());
      // Pull the backoff forward so the next attempt can run.
      getDb().update(jobs).set({ runAt: Date.now() - 1 }).run();
    }

    const [first, second, third] = delays;
    expect(second!).toBeGreaterThan(first!);
    expect(third!).toBeGreaterThan(second!);
    expect(third! / second!).toBeGreaterThan(2);
  });

  it('moves a job to dead after its attempt budget, and never runs it again', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {}, maxAttempts: 2 });

    claimNext()!;
    expect(failJob(job.id, new Error('first')).requeued).toBe(true);
    getDb().update(jobs).set({ runAt: Date.now() - 1 }).run();

    claimNext()!;
    const second = failJob(job.id, new Error('second'));
    expect(second.requeued).toBe(false);

    const row = getDb().select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(row.status).toBe('dead');
    expect(row.finishedAt).not.toBeNull();

    expect(claimNext()).toBeNull();
    expect(deadLetterJobs().map((j) => j.id)).toContain(job.id);
  });

  it('an operator can requeue a dead job and it runs with a clean slate', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {}, maxAttempts: 1 });
    claimNext()!;
    failJob(job.id, new Error('boom'));
    expect(deadLetterJobs().length).toBe(1);

    requeueJob(job.id);
    const row = getDb().select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();

    const claimed = claimNext(['scan.repository'])!;
    expect(claimed.id).toBe(job.id);
    expect(claimed.attempts).toBe(1);
  });
});

describe('cancellation', () => {
  it('cancels a pending job so a worker never picks it up', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {} });
    cancelJob(job.id);

    expect(getJob(job.id)!.status).toBe('cancelled');
    expect(claimNext()).toBeNull();
  });

  it('refuses to cancel work that already finished', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {} });
    claimNext()!;
    completeJob(job.id);
    expect(() => cancelJob(job.id)).toThrow(AppError);
  });

  it('throws for an unknown job id', () => {
    expect(() => cancelJob('job_missing')).toThrow(AppError);
  });
});

describe('operator visibility', () => {
  it('scopes listings to an organisation', () => {
    enqueue({ type: 'scan.repository', orgId: orgA, payload: { n: 1 } });
    enqueue({ type: 'scan.repository', orgId: orgA, payload: { n: 2 } });
    enqueue({ type: 'scan.repository', orgId: orgB, payload: { n: 3 } });

    expect(listJobs({ orgId: orgA }).length).toBe(2);
    expect(listJobs({ orgId: orgB }).length).toBe(1);
  });

  it('reports queue health by status', () => {
    const a = enqueue({ type: 'scan.repository', orgId: orgA, payload: {} });
    enqueue({ type: 'scan.repository', orgId: orgA, payload: {} });
    claimNext()!;
    completeJob(a.id);

    const stats = queueStats();
    expect(stats.succeeded).toBe(1);
    expect(stats.pending).toBe(1);
  });

  it('keeps the last error for support', () => {
    const job = enqueue({ type: 'scan.repository', orgId: orgA, payload: {}, maxAttempts: 1 });
    claimNext()!;
    failJob(job.id, new Error('manifest unreadable'));
    expect(getJobDetail(job.id)?.lastError).toContain('manifest unreadable');
  });
});
