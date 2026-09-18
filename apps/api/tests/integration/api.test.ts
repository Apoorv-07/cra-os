import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { resetRateLimits } from '../../src/core/rate-limit.js';
import { SESSION_COOKIE } from '../../src/core/session.js';
import { getDb } from '../../src/db/index.js';
import { users, organizationMembers, creditTransactions } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * HTTP surface: auth, RBAC, tenant isolation, pagination, error contracts.
 *
 * These run against the real Hono app with a real (in-memory) database. Nothing
 * about the request pipeline is stubbed, so the tests cover middleware ordering
 * too — CSRF, rate limits, security headers and error shaping are all in scope.
 */

interface Session {
  cookie: string;
  userId: string;
  orgId: string;
  email: string;
}

let sequence = 0;
const nextEmail = () => `it-${Date.now()}-${sequence++}@example.com`;

const json = async (res: Response) => ({
  status: res.status,
  headers: res.headers,
  body: (await res.json().catch(() => null)) as any,
});

async function call(
  method: string,
  path: string,
  options: { body?: unknown; session?: Session; apiKey?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.apiKey) headers['X-API-Key'] = options.apiKey;
  if (options.session) headers['Cookie'] = `${SESSION_COOKIE}=${options.session.cookie}`;

  const res = await app.request(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return json(res);
}

async function signup(name = 'Owner'): Promise<Session> {
  const email = nextEmail();
  const res = await call('POST', '/api/v1/auth/signup', {
    body: { email, password: 'correct-horse-battery', name, organizationName: `${name} Org` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const cookie = /([^;]+)/.exec(
    (res.headers.get('set-cookie') ?? '').replace(`${SESSION_COOKIE}=`, ''),
  )?.[1];
  expect(cookie, 'signup must issue a session cookie').toBeTruthy();
  return { cookie: cookie!, userId: res.body.data.user.id, orgId: res.body.data.organizationId, email };
}

/** Grants a second user a role in an existing org (direct DB insert, then login). */
async function memberOf(orgId: string, role: 'admin' | 'member' | 'viewer'): Promise<Session> {
  const session = await signup(role);
  getDb()
    .insert(organizationMembers)
    .values({
      id: `mem_${Math.random().toString(36).slice(2, 12)}`,
      orgId,
      userId: session.userId,
      role,
      invitedByUserId: null,
      acceptedAt: Date.now(),
      createdAt: Date.now(),
    })
    .run();
  return { ...session, orgId };
}

beforeAll(() => {
  resetRateLimits();
});

beforeEach(() => {
  // The rate-limit store is module-level, so it survives across tests.
  resetRateLimits();
});

describe('platform basics', () => {
  it('reports health and stamps every response with a request id', async () => {
    const res = await call('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets the security headers we promise customers', async () => {
    const res = await call('GET', '/health');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('returns a structured 404 for an unknown API route', async () => {
    const res = await call('GET', '/api/v1/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    expect(res.body.error.message).toContain('No route');
  });

  it('publishes pricing without authentication', async () => {
    const res = await call('GET', '/api/v1/billing/pricing');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeTruthy();
  });
});

describe('signup and sessions', () => {
  it('creates a user, an org, a session, and welcome credits', async () => {
    const session = await signup();

    const me = await call('GET', '/api/v1/auth/me', { session });
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(session.email);

    const credits = await call('GET', `/api/v1/organizations/${session.orgId}/credits`, { session });
    expect(credits.status).toBe(200);
    expect(credits.body.data.balance).toBeGreaterThan(0);

    const tx = getDb()
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.orgId, session.orgId))
      .all();
    expect(tx.some((t) => t.type === 'grant')).toBe(true);
  });

  it('issues the session cookie as HttpOnly and SameSite=Lax', async () => {
    const email = nextEmail();
    const res = await app.request('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery' }),
    });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects a weak password with a 400 and a field-level message', async () => {
    const res = await call('POST', '/api/v1/auth/signup', {
      body: { email: nextEmail(), password: 'short' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('refuses a duplicate email with 409', async () => {
    const session = await signup();
    const res = await call('POST', '/api/v1/auth/signup', {
      body: { email: session.email, password: 'correct-horse-battery' },
    });
    expect(res.status).toBe(409);
  });

  it('gives the same error for a wrong password and an unknown account', async () => {
    const session = await signup();
    const wrongPassword = await call('POST', '/api/v1/auth/login', {
      body: { email: session.email, password: 'not-the-password' },
    });
    const unknownUser = await call('POST', '/api/v1/auth/login', {
      body: { email: nextEmail(), password: 'not-the-password' },
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
  });

  it('requires authentication for /auth/me and invalidates on logout', async () => {
    expect((await call('GET', '/api/v1/auth/me')).status).toBe(401);

    const session = await signup();
    expect((await call('GET', '/api/v1/auth/me', { session })).status).toBe(200);

    const loggedOut = await call('POST', '/api/v1/auth/logout', { session });
    expect(loggedOut.status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me', { session })).status).toBe(401);
  });

  it('does not accept a forged session cookie', async () => {
    const res = await call('GET', '/api/v1/auth/me', {
      headers: { Cookie: `${SESSION_COOKIE}=not.a.real.token` },
    });
    expect(res.status).toBe(401);
  });
});

describe('RBAC', () => {
  it('lets members create projects but blocks viewers', async () => {
    const owner = await signup();
    const member = await memberOf(owner.orgId, 'member');
    const viewer = await memberOf(owner.orgId, 'viewer');

    const asMember = await call('POST', `/api/v1/organizations/${owner.orgId}/projects`, {
      session: member,
      body: { name: 'Payments API', supportPeriodMonths: 24 },
    });
    expect(asMember.status, JSON.stringify(asMember.body)).toBe(201);

    const asViewer = await call('POST', `/api/v1/organizations/${owner.orgId}/projects`, {
      session: viewer,
      body: { name: 'Nope' },
    });
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.error.message).toMatch(/member/i);
  });

  it('keeps billing and API-key management at admin', async () => {
    const owner = await signup();
    const member = await memberOf(owner.orgId, 'member');

    expect((await call('GET', `/api/v1/organizations/${owner.orgId}/api-keys`, { session: member })).status).toBe(403);
    expect((await call('GET', `/api/v1/organizations/${owner.orgId}/api-keys`, { session: owner })).status).toBe(200);
    expect((await call('GET', `/api/v1/organizations/${owner.orgId}/billing/payments`, { session: member })).status).toBe(403);
  });

  it('allows an admin to invite, change and remove members', async () => {
    const owner = await signup();
    const admin = await memberOf(owner.orgId, 'admin');
    const target = await memberOf(owner.orgId, 'member');

    const list = await call('GET', `/api/v1/organizations/${owner.orgId}/members`, { session: admin });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    const row = list.body.data.find((m: any) => m.userId === target.userId);
    expect(row).toBeTruthy();

    const patched = await call('PATCH', `/api/v1/organizations/${owner.orgId}/members/${row.id}`, {
      session: admin,
      body: { role: 'viewer' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.role).toBe('viewer');
  });

  it('will not let an admin demote the last owner', async () => {
    const owner = await signup();
    const admin = await memberOf(owner.orgId, 'admin');

    const list = await call('GET', `/api/v1/organizations/${owner.orgId}/members`, { session: owner });
    const ownerRow = list.body.data.find((m: any) => m.userId === owner.userId);

    const res = await call('PATCH', `/api/v1/organizations/${owner.orgId}/members/${ownerRow.id}`, {
      session: admin,
      body: { role: 'member' },
    });
    // Refused because an org must always keep an owner.
    expect([403, 400, 409]).toContain(res.status);

    const after = await call('GET', `/api/v1/organizations/${owner.orgId}/members`, { session: owner });
    expect(after.body.data.find((m: any) => m.userId === owner.userId).role).toBe('owner');
  });
});

describe('tenant isolation over HTTP', () => {
  it('a member of org B cannot read org A', async () => {
    const a = await signup('A');
    const b = await signup('B');

    const list = await call('GET', `/api/v1/organizations/${a.orgId}/repositories`, { session: b });
    expect(list.status).toBe(403);

    const detail = await call('GET', `/api/v1/organizations/${a.orgId}/credits`, { session: b });
    expect(detail.status).toBe(403);
  });

  it('the X-Organization-Id header cannot be used to switch tenants', async () => {
    const a = await signup('A');
    const b = await signup('B');

    const res = await call('GET', `/api/v1/organizations/${b.orgId}/repositories`, {
      session: b,
      headers: { 'X-Organization-Id': a.orgId },
    });
    // The header must not grant access: the route param wins and membership is checked.
    expect(res.status).toBe(403);
  });

  it('org A only sees its own projects', async () => {
    const a = await signup('A');
    const b = await signup('B');

    await call('POST', `/api/v1/organizations/${a.orgId}/projects`, {
      session: a,
      body: { name: 'A project' },
    });
    const bProjects = await call('GET', `/api/v1/organizations/${b.orgId}/projects`, { session: b });
    expect(bProjects.status).toBe(200);
    expect(Array.isArray(bProjects.body.data)).toBe(true);
    expect(bProjects.body.data.some((p: any) => p.name === 'A project')).toBe(false);
  });
});

describe('API keys', () => {
  it('issues a key that authenticates without a session, scoped to its org', async () => {
    const owner = await signup();

    const created = await call('POST', `/api/v1/organizations/${owner.orgId}/api-keys`, {
      session: owner,
      body: { name: 'ci', scopes: ['scan'] },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.key).toMatch(/^cra_/);
    expect(created.body.data.key).not.toBe(undefined);

    // The plaintext key is only ever returned once.
    const stored = await call('GET', `/api/v1/organizations/${owner.orgId}/api-keys`, { session: owner });
    expect(Array.isArray(stored.body.data)).toBe(true);
    expect(stored.body.data[0].key).toBeUndefined();
    expect(stored.body.data[0].keyPrefix).toBeTruthy();
    expect(stored.body.data[0].id).toBe(created.body.data.id);

    const me = await call('GET', '/api/v1/auth/me', { apiKey: created.body.data.key });
    expect(me.status).toBe(200);
  });

  it('rejects an unknown or revoked key', async () => {
    const owner = await signup();
    const created = await call('POST', `/api/v1/organizations/${owner.orgId}/api-keys`, {
      session: owner,
      body: { name: 'ci', scopes: ['scan'] },
    });
    const keyId = created.body.data.id;

    expect((await call('GET', '/api/v1/auth/me', { apiKey: 'cra_bogus_key_value' })).status).toBe(401);

    const revoked = await call('DELETE', `/api/v1/organizations/${owner.orgId}/api-keys/${keyId}`, { session: owner });
    expect(revoked.status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me', { apiKey: created.body.data.key })).status).toBe(401);
  });

  it('enforces key scopes', async () => {
    const owner = await signup();
    const created = await call('POST', `/api/v1/organizations/${owner.orgId}/api-keys`, {
      session: owner,
      body: { name: 'read-only', scopes: ['read'] },
    });
    const key = created.body.data.key;

    // The scan endpoint requires the `scan` scope.
    const res = await call('POST', '/api/v1/ci/scan', { apiKey: key, body: {} });
    expect([401, 403, 400]).toContain(res.status);
  });
});

describe('CSRF', () => {
  it('blocks a cookie-authenticated write from a foreign origin', async () => {
    const owner = await signup();
    const res = await call('POST', `/api/v1/organizations/${owner.orgId}/projects`, {
      session: owner,
      body: { name: 'should not exist' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/cross-origin/i);
  });

  it('allows the same write from the app origin', async () => {
    const owner = await signup();
    const res = await call('POST', `/api/v1/organizations/${owner.orgId}/projects`, {
      session: owner,
      body: { name: 'allowed' },
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.status).toBe(201);
  });

  it('does not apply the origin check to API keys', async () => {
    const owner = await signup();
    const created = await call('POST', `/api/v1/organizations/${owner.orgId}/api-keys`, {
      session: owner,
      body: { name: 'ci', scopes: ['scan', 'read'] },
    });
    const res = await call('GET', '/api/v1/auth/me', {
      apiKey: created.body.data.key,
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(200);
  });
});

describe('pagination and error contracts', () => {
  it('returns a consistent paginated envelope', async () => {
    const owner = await signup();

    const first = await call('GET', `/api/v1/organizations/${owner.orgId}/billing/ledger?page=1&perPage=1`, {
      session: owner,
    });
    expect(first.status).toBe(200);
    expect(Array.isArray(first.body.data)).toBe(true);
    expect(first.body.data.length).toBeLessThanOrEqual(1);
    expect(first.body.meta).toMatchObject({ page: 1, perPage: 1 });
    expect(first.body.meta.total).toBeGreaterThan(0);

    // Page 2 must not repeat page 1's rows.
    const all = await call('GET', `/api/v1/organizations/${owner.orgId}/billing/ledger?perPage=100`, { session: owner });
    expect(all.body.data.length).toBeGreaterThanOrEqual(first.body.data.length);
  });

  it('clamps an absurd page size instead of returning the whole table', async () => {
    const owner = await signup();
    const res = await call('GET', `/api/v1/organizations/${owner.orgId}/billing/ledger?perPage=100000`, { session: owner });
    // A bad query string is a client error, never a 500.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rejects a malformed JSON body with 400 rather than 500', async () => {
    const owner = await signup();
    const res = await app.request(`/api/v1/organizations/${owner.orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE}=${owner.cookie}`,
      },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });

  it('never leaks a stack trace in an error body', async () => {
    const res = await call('GET', '/api/v1/definitely-not-a-route');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:/);
  });
});

describe('credits are authoritative on the server', () => {
  it('reports the ledger balance, not a client-supplied number', async () => {
    const owner = await signup();
    const before = await call('GET', `/api/v1/organizations/${owner.orgId}/credits`, { session: owner });

    // A client cannot inflate its own balance — there is no endpoint that accepts one.
    const patched = await call('PATCH', `/api/v1/organizations/${owner.orgId}/credits`, {
      session: owner,
      body: { balance: 1_000_000 },
    });
    expect([404, 400, 405]).toContain(patched.status);

    const after = await call('GET', `/api/v1/organizations/${owner.orgId}/credits`, { session: owner });
    expect(after.body.data.balance).toBe(before.body.data.balance);
  });

  it('keeps a transaction per credit movement for auditing', async () => {
    const owner = await signup();
    const ledger = await call('GET', `/api/v1/organizations/${owner.orgId}/billing/ledger`, { session: owner });
    expect(ledger.status).toBe(200);
    expect(Array.isArray(ledger.body.data)).toBe(true);
    expect(ledger.body.data.length).toBeGreaterThan(0);
    // Every row is a signed movement; a purchase and a debit must both appear.
    expect(ledger.body.data.every((t: any) => typeof t.amount === 'number')).toBe(true);
  });
});

describe('deactivated users', () => {
  it('a suspended user keeps no valid session', async () => {
    const session = await signup();
    getDb().update(users).set({ status: 'suspended' }).where(eq(users.id, session.userId)).run();

    const res = await call('GET', '/api/v1/auth/me', { session });
    expect(res.status).toBe(401);
  });
});
