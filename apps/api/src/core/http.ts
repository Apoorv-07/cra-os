import type { AnyContext } from './context.js';
import { z } from 'zod';
import { AppError, toAppError } from './errors.js';
import { log } from './logger.js';

/** Standard success envelope. Every list endpoint returns `{ data, meta }`. */
export interface ApiMeta {
  page?: number;
  perPage?: number;
  total?: number;
  [k: string]: unknown;
}

export function ok<T>(c: AnyContext, data: T, meta?: ApiMeta, status: 200 | 201 = 200) {
  return c.json(meta ? { data, meta } : { data }, status);
}

export function created<T>(c: AnyContext, data: T) {
  return ok(c, data, undefined, 201);
}

export function noContent(c: AnyContext) {
  return c.body(null, 204);
}

/**
 * Returns binary content with an explicit content type and disposition.
 * Buffers are copied into a plain ArrayBuffer so the response is portable
 * across runtimes (Node, Workers) rather than tied to Buffer.
 */
export function binaryBody(c: AnyContext, data: Uint8Array, contentType: string, filename?: string): Response {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  c.header('Content-Type', contentType);
  if (filename) {
    c.header('Content-Disposition', `attachment; filename="${filename.replace(/["\\\n\r]/g, '_')}"`);
  }
  return c.body(buffer);
}

/** Normalises any thrown value into the public error contract. */
export function errorResponse(c: AnyContext, err: unknown) {
  const appErr = toAppError(err);
  const isServer = appErr.status >= 500;

  if (isServer) {
    log.error('request failed', {
      code: appErr.code,
      message: appErr.message,
      path: c.req.path,
      stack: appErr.stack,
    });
  }

  return c.json(
    {
      error: {
        code: appErr.code,
        message: isServer && process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred. The incident has been logged.'
          : appErr.message,
        details: appErr.details ?? null,
        hint: appErr.hint ?? null,
      },
    },
    appErr.status as 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500 | 502 | 503,
  );
}

/**
 * Parses and validates a request body.
 * Validation errors are returned as 400 with the failing field paths, which the
 * frontend renders inline next to the offending input.
 */
export async function parseBody<T extends z.ZodType>(c: AnyContext, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw AppError.badRequest('Request body must be valid JSON.');
  }
  return validate(schema, raw);
}

export function validate<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    }));
    throw AppError.badRequest('Some fields need attention.', details);
  }
  return result.data;
}

export function parseQuery<T extends z.ZodType>(c: AnyContext, schema: T): z.infer<T> {
  const raw = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  return validate(schema, raw);
}

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(25),
});

export function paginate(total: number, page: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  return { page, perPage, total, pages };
}

export function clientIp(c: AnyContext): string {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'unknown';
}

/** Cursor/offset helper shared by every list endpoint. */
export function offset(page: number, perPage: number): number {
  return (page - 1) * perPage;
}
