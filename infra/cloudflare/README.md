# Cloudflare target architecture — blueprint, not yet wired

**Status: plan.** The application layer (`apps/api/src/app.ts`) is deliberately
runtime-agnostic: it is a Hono app that never touches `node:*` APIs directly.
Everything Node-specific lives behind three interfaces, and this directory
documents what a Workers deployment would bind them to.

**Nothing here runs today.** The production deployment is the single Node
process described in [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md). This
blueprint exists so the port is a scheduled piece of work rather than a rewrite,
and it should not be treated as a deployed environment.

## What would have to change

| Interface | Today | On Cloudflare |
|---|---|---|
| `src/db/index.ts` | better-sqlite3, synchronous, one file | **D1**, async. Every query site becomes `await`; transactions become D1 batches. |
| `src/core/storage.ts` | local filesystem | **R2** bucket binding |
| `src/jobs/queue.ts` | `jobs` table + polling worker | **Queues** producer/consumer; handler signatures already match `(jobId, payload)` |
| `src/core/session.ts` | in-database sessions | D1, or **KV** for hot session reads |
| Cron (KEV sync, credit expiry) | in-process scheduled job | **Cron Triggers** |
| Static frontend | served by the API | **Workers Assets** or Pages |

## Why it is not the default yet

1. **Correctness first.** SQLite with synchronous transactions gives us exactly
   the durability guarantees the credit ledger needs, with no eventual
   consistency to reason about. D1 is replicated and read-your-writes is scoped
   per session — that changes the ledger's concurrency story and must be
   designed, not assumed.
2. **Debuggability.** Before product-market fit, being able to open the database
   file and read the row is worth more than edge latency.
3. **Cost.** Cloudflare's free tier is genuinely free, but the Node deployment
   on one small VM is also near-free at this volume, and the port has a real
   engineering cost.

## Ordering

Do this when a single node stops being enough — not before. The adapters are the
work; the application does not change. See `docs/ROADMAP.md`.
