import type { MiddlewareHandler } from 'hono';
import {eq} from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { apiKeys, organizationMembers, organizations } from '../db/schema.js';
import { env } from '../env.js';
import { AppError } from './errors.js';
import { hashToken } from './crypto.js';
import { readSessionToken, userFromSessionToken } from './session.js';
import { requireMembership, assertRole, type Role } from './tenant.js';
import { audit } from './audit.js';
import { clientIp } from './http.js';
import type { AppContext } from './context.js';

const PUBLIC_PATH_PREFIXES = ['/api/v1/auth/', '/health', '/api/v1/public/'];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Resolves the caller from either a session cookie or an API key.
 * Does not reject unauthenticated requests — use `requireAuth` for that.
 */
export const resolveAuth: MiddlewareHandler = async (c, next) => {
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const apiKeyHeader = c.req.header('x-api-key') ?? bearer;

  if (apiKeyHeader && apiKeyHeader.startsWith('cra_')) {
    const row = getDb()
      .select({
        id: apiKeys.id,
        orgId: apiKeys.orgId,
        scopesJson: apiKeys.scopesJson,
        revokedAt: apiKeys.revokedAt,
        expiresAt: apiKeys.expiresAt,
        userId: apiKeys.createdByUserId,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hashToken(apiKeyHeader)))
      .get();

    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= Date.now())) {
      throw AppError.unauthenticated('That API key is invalid, revoked or expired.');
    }

    c.set('auth', {
      user: {
        id: row.userId ?? `apikey:${row.id}`,
        email: `api-key+${row.id}@internal`,
        name: `API key ${row.id.slice(-6)}`,
        avatarUrl: null,
        isSystemAdmin: false,
      },
      sessionId: null,
      via: 'api_key',
      apiKeyId: row.id,
      scopes: JSON.parse(row.scopesJson) as string[],
      orgId: row.orgId,
      role: 'admin',
    });

    getDb().update(apiKeys).set({ lastUsedAt: Date.now() }).where(eq(apiKeys.id, row.id)).run();
    return next();
  }

  const found = userFromSessionToken(readSessionToken(c));
  if (found) {
    c.set('auth', { user: found.user, sessionId: found.sessionId, via: 'session' });
  }
  return next();
};

/** Rejects unauthenticated callers. */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!c.get('auth')) throw AppError.unauthenticated();
  return next();
};

/**
 * CSRF defence for cookie-authenticated, state-changing requests.
 * Browsers always send `Origin` on cross-origin fetch, so verifying it is a
 * sufficient same-origin check for a cookie-based API.
 */
export const csrfGuard: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const auth = c.get('auth');
  if (!auth || auth.via !== 'session') return next(); // API keys are not ambient credentials

  const origin = c.req.header('origin');
  if (!origin) return next(); // non-browser client

  const allowed = new Set([
    env.APP_URL,
    env.WEB_URL,
    'http://localhost:5173',
    'http://localhost:8787',
  ]);
  if (process.env.ALLOWED_ORIGINS) {
    for (const o of process.env.ALLOWED_ORIGINS.split(',')) allowed.add(o.trim());
  }

  if (!allowed.has(origin)) {
    audit({ action: 'csrf_blocked', meta: { origin, path: c.req.path }, ip: clientIp(c as AppContext) });
    throw AppError.forbidden('Cross-origin request rejected.');
  }
  return next();
};

/**
 * Scopes the request to an organization and enforces a minimum role.
 * Resolution order: `X-Organization-Id` header → `:orgId` route param → default org.
 */
export function requireOrg(minimumRole: Role = 'viewer'): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw AppError.unauthenticated();

    const headerOrg = c.req.header('x-organization-id');
    const paramOrg = c.req.param('orgId');

    // The header exists so the web client can scope a request without
    // rebuilding URLs. When both are present they must agree: silently
    // preferring the header would let `/organizations/<someone-else>/…`
    // answer with the caller's own data, which is confusing at best and a
    // maintenance trap at worst.
    if (headerOrg && paramOrg && headerOrg !== paramOrg) {
      throw AppError.forbidden('The organization in this request does not match the one in the URL.');
    }

    const orgId = headerOrg ?? paramOrg;

    if (orgId) {
      const role = requireMembership(orgId, auth.user.id);
      assertRole(role, minimumRole);
      c.set('auth', { ...auth, orgId, role });
      c.set('orgId', orgId);
      return next();
    }

    // Fall back to the user's first active org so the dashboard always loads.
    const row = getDb()
      .select({ orgId: organizationMembers.orgId })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
      .where(eq(organizationMembers.userId, auth.user.id))
      .all();

    const defaultOrg = row.at(0)?.orgId;

    if (!defaultOrg) {
      throw AppError.forbidden('You do not belong to any organization yet.');
    }

    const role = requireMembership(defaultOrg, auth.user.id);
    assertRole(role, minimumRole);
    c.set('auth', { ...auth, orgId: defaultOrg, role });
    c.set('orgId', defaultOrg);
    return next();
  };
}

export function requireScope(scope: string): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw AppError.unauthenticated();
    if (auth.via === 'api_key') {
      const scopes = auth.scopes ?? [];
      if (!scopes.includes(scope) && !scopes.includes('*')) {
        throw AppError.forbidden(`This API key is missing the "${scope}" scope.`);
      }
    }
    return next();
  };
}

/** System-admin gate for the internal admin console. */
export const requireSystemAdmin: MiddlewareHandler = async (c, next) => {
  const auth = c.get('auth');
  if (!auth) throw AppError.unauthenticated();
  if (!auth.user.isSystemAdmin) {
    throw AppError.forbidden('System administrator access required.');
  }
  return next();
};
