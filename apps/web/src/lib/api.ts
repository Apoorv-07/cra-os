/**
 * Typed API client.
 *
 * Every response uses the `{ data, meta }` envelope and every error uses
 * `{ error: { code, message, details, hint } }`. Unwrapping both in one place
 * means screens deal in domain objects and never in transport shape.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly hint: string | null;

  constructor(status: number, code: string, message: string, details: unknown, hint: string | null) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }

  /** True when the failure is "you cannot afford this", which the UI treats specially. */
  get isCreditError(): boolean {
    return this.code === 'insufficient_credits';
  }
}

const BASE = '/api/v1';

let orgId: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setActiveOrg(id: string | null): void {
  orgId = id;
}

export function onAuthFailure(handler: () => void): void {
  onUnauthorized = handler;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (orgId) headers['X-Organization-Id'] = orgId;
  return headers;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const hasBody = body !== undefined && body !== null;
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include', // session cookie
    headers: {
      ...authHeaders(),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-Requested-With': 'fetch' } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    const err = (payload.error ?? {}) as { code?: string; message?: string; details?: unknown; hint?: string | null };
    const error = new ApiError(
      res.status,
      err.code ?? 'unknown_error',
      err.message ?? 'Something went wrong.',
      err.details ?? null,
      err.hint ?? null,
    );
    if (res.status === 401 && path !== '/auth/me') onUnauthorized?.();
    throw error;
  }

  return (payload.data ?? payload) as T;
}

/** Multipart upload (evidence, source archives). */
async function requestForm<T>(method: string, path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: authHeaders(),
    body: form,
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const err = (payload.error ?? {}) as { code?: string; message?: string; hint?: string | null };
    throw new ApiError(res.status, err.code ?? 'unknown_error', err.message ?? 'Upload failed.', null, err.hint ?? null);
  }
  return payload.data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => requestForm<T>('POST', path, form),
};

/** Builds a URL for a binary download (uses the same session cookie). */
export function downloadUrl(path: string): string {
  return `${BASE}${path}`;
}
