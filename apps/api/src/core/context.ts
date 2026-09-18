import type { Context } from 'hono';
import type { Role } from './tenant.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isSystemAdmin: boolean;
}

export interface AuthContext {
  user: SessionUser;
  sessionId: string | null;
  /** 'session' = interactive browser login; 'api_key' = machine access. */
  via: 'session' | 'api_key';
  apiKeyId?: string;
  scopes?: string[];
  /** Present only when the request is scoped to an organization. */
  orgId?: string;
  role?: Role;
}

export type AppVariables = {
  auth?: AuthContext;
  requestId?: string;
  orgId?: string;
};

/** Hono environment shared by every router in the application. */
export type AppEnv = { Variables: AppVariables };

export type AppContext = Context<AppEnv>;

/** Any Hono context — used by helpers that are environment-agnostic. */
export type AnyContext = Context<any, any, any>;

export function authOrThrow(c: AppContext): AuthContext {
  const ctx = c.get('auth');
  if (!ctx) throw new Error('auth context missing — route is not behind requireAuth');
  return ctx;
}

export function currentUser(c: AppContext): SessionUser {
  return authOrThrow(c).user;
}

/** Resolves the org for the request: explicit scope, else the user's default. */
export function currentOrgId(c: AppContext): string {
  const ctx = authOrThrow(c);
  if (ctx.orgId) return ctx.orgId;
  throw new Error('organization scope missing — route is not behind requireOrg');
}

export function currentRole(c: AppContext): Role {
  const ctx = authOrThrow(c);
  if (!ctx.role) throw new Error('role missing — route is not behind requireOrg');
  return ctx.role;
}
