import type { Context, Next } from 'hono';
import { env } from '../env.js';
import { AppError } from './errors.js';
import { clientIp } from './http.js';

/**
 * Fixed-window rate limiter.
 *
 * In-memory by design: it is correct for single-node and Works-on-Workers
 * deployments where each isolate handles a slice of traffic, and it degrades to
 * "no shared state" rather than to "broken". For multi-region deployments,
 * swap `store` for Cloudflare KV / Durable Objects — the interface is the
 * only thing that needs to change.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(): void {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitOptions {
  limit?: number;
  windowSeconds?: number;
  /** Included in the key so login and API limits don't share a bucket. */
  scope: string;
  keyExtra?: (c: Context) => string;
}

export function rateLimit(opts: RateLimitOptions) {
  const limit = opts.limit ?? env.RATE_LIMIT_REQUESTS;
  const windowMs = (opts.windowSeconds ?? env.RATE_LIMIT_WINDOW_S) * 1000;

  return async (c: Context, next: Next): Promise<Response | void> => {
    sweep();
    const identity = opts.keyExtra ? opts.keyExtra(c) : clientIp(c);
    const key = `${opts.scope}:${identity}`;
    const now = Date.now();
    const bucket = store.get(key);

    if (!bucket || bucket.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      c.header('X-RateLimit-Limit', String(limit));
      c.header('X-RateLimit-Remaining', String(limit - 1));
      return next();
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      throw AppError.badRequest('Too many requests. Please slow down and retry shortly.');
    }

    return next();
  };
}

/** Stricter limiter for credential endpoints (login, signup, magic link). */
export const authRateLimit = () =>
  rateLimit({ scope: 'auth', limit: 10, windowSeconds: 60 });

export const expensiveRateLimit = () =>
  rateLimit({ scope: 'expensive', limit: 20, windowSeconds: 60 });

export function resetRateLimits(): void {
  store.clear();
}
