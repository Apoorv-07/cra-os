import { ZodError } from 'zod';

/**
 * Application error taxonomy.
 *
 * Every thrown AppError maps to a stable, machine-readable `code` that the
 * frontend and the public API can branch on. Nothing leaks stack traces to
 * clients in production.
 */

export type ErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'insufficient_credits'
  | 'dependency_unavailable'
  | 'integration_error'
  | 'job_failed'
  | 'internal_error';

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  insufficient_credits: 402,
  dependency_unavailable: 503,
  integration_error: 502,
  job_failed: 500,
  internal_error: 500,
};

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;
  /** Set for user-facing recovery hints, e.g. "Reconnect GitHub". */
  public readonly hint?: string;

  constructor(code: ErrorCode, message: string, opts?: { details?: unknown; hint?: string; cause?: unknown }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = opts?.details;
    this.hint = opts?.hint;
    if (opts?.cause) (this as { cause?: unknown }).cause = opts.cause;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError('validation_failed', message, { details });
  }
  static unauthenticated(message = 'You must be signed in to do that.') {
    return new AppError('unauthenticated', message);
  }
  static forbidden(message = 'You do not have permission to perform this action.') {
    return new AppError('forbidden', message);
  }
  static notFound(what = 'Resource') {
    return new AppError('not_found', `${what} not found.`);
  }
  static conflict(message: string) {
    return new AppError('conflict', message);
  }
  static insufficientCredits(required: number, balance: number) {
    return new AppError(
      'insufficient_credits',
      `This action needs ${required} credits but your balance is ${balance}.`,
      { details: { required, balance }, hint: 'Top up your credits to continue.' },
    );
  }
  static integration(message: string, hint?: string) {
    return new AppError('integration_error', message, { hint });
  }
  static unavailable(message: string) {
    return new AppError('dependency_unavailable', message);
  }
}

/** Wraps unknown throwables so routers can always return a clean contract. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  // A malformed query string or body is the caller's fault, not a server fault.
  // Without this branch every bad `?perPage=` would surface as a 500 and page
  // our on-call for a client mistake.
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path?.length ? `${first.path.join('.')}: ` : '';
    return new AppError('validation_failed', `${path}${first?.message ?? 'Invalid request'}`, {
      details: { issues: err.issues },
      hint: 'Check the request parameters and try again.',
    });
  }

  const message = err instanceof Error ? err.message : 'Unexpected error';
  return new AppError('internal_error', message);
}
