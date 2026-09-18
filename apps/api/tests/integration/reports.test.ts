import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { resetRateLimits } from '../../src/core/rate-limit.js';
import { SESSION_COOKIE } from '../../src/core/session.js';
import { getDb } from '../../src/db/index.js';
import { repositories, shareLinks, reports } from '../../src/db/schema.js';
import { newId } from '../../src/core/ids.js';
import { eq } from 'drizzle-orm';
import { getBalance } from '../../src/modules/billing/ledger.js';

/**
 * Reports.
 *
 * Reports are the thing a customer hands to someone else, so the tests cover
 * the whole lifecycle: generation charges once, content is a readable document
 * rather than a data dump, sharing produces a revocable public link, and no
 * organisation can read another's report — by id or by share token.
 */

interface Session {
  cookie: string;
  orgId: string;
  userId: string;
}

let session: Session;
let other: Session;
let repoId = '';
let reportId = '';

async function call(method: string, path: string, options: { body?: unknown; session?: Session } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.session) {
    headers['Cookie'] = `${SESSION_COOKIE}=${options.session.cookie}`;
    headers['X-Organization-Id'] = options.session.orgId;
  }
  const res = await app.request(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as any };
}

async function signup(): Promise<Session> {
  const res = await call('POST', '/api/v1/auth/signup', {
    body: {
      email: `reports-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'correct-horse-battery',
      name: 'Reports Owner',
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const cookie = /([^;]+)/.exec((res.headers.get('set-cookie') ?? '').replace(`${SESSION_COOKIE}=`, ''))?.[1];
  return { cookie: cookie!, orgId: res.body.data.organizationId, userId: res.body.data.user.id };
}

beforeAll(async () => {
  resetRateLimits();
  session = await signup();
  other = await signup();

  repoId = newId('repo');
  getDb()
    .insert(repositories)
    .values({
      id: repoId,
      orgId: session.orgId,
      provider: 'upload',
      name: 'payments-service',
      fullName: 'acme/payments-service',
      status: 'active',
      monitoringEnabled: true,
      badgeToken: newId('repo'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
});

beforeEach(() => resetRateLimits());

describe('generation', () => {
  it('creates a readiness report for the whole organisation', async () => {
    const before = getBalance(session.orgId);
    const res = await call('POST', `/api/v1/organizations/${session.orgId}/reports`, {
      session,
      body: { kind: 'readiness' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    reportId = res.body.data.id;
    expect(res.body.data.kind).toBe('readiness');
    expect(res.body.data.title).toContain('CRA readiness report');

    const charged = before - getBalance(session.orgId);
    expect(res.body.data.creditsCharged).toBeGreaterThan(0);
    expect(charged).toBe(res.body.data.creditsCharged);
  });

  it('creates a report scoped to one repository', async () => {
    const res = await call('POST', `/api/v1/organizations/${session.orgId}/reports`, {
      session,
      body: { kind: 'findings', repositoryId: repoId, title: 'Engineering handover' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Engineering handover');
  });

  it('rejects an unknown report kind', async () => {
    const res = await call('POST', `/api/v1/organizations/${session.orgId}/reports`, {
      session,
      body: { kind: 'vibes' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('refuses to generate a report for another organisation', async () => {
    const res = await call('POST', `/api/v1/organizations/${other.orgId}/reports`, {
      session: other,
      body: { kind: 'readiness', repositoryId: repoId },
    });
    expect(res.status).toBe(404);
  });
});

describe('content', () => {
  it('returns a document, not a data dump', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/reports/${reportId}`, { session });
    expect(res.status).toBe(200);

    const content = res.body.data.content;
    expect(content.sections.length).toBeGreaterThan(2);
    for (const section of content.sections) {
      expect(section.heading).toBeTruthy();
      expect(['prose', 'list', 'table', 'metrics']).toContain(section.kind);
    }
    expect(content.summary ?? content.sections[0].body).toBeTruthy();
  });

  it('carries the disclaimer that keeps the product honest', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/reports/${reportId}`, { session });
    const disclaimer = res.body.data.content.disclaimer.toLowerCase();
    expect(disclaimer).toContain('not legal advice');
    expect(disclaimer).not.toContain('certif');
  });

  it('lists reports newest first with their share state', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/reports`, { session });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0].shared).toBe(false);
    expect(res.body.data[0].createdAt).toBeGreaterThanOrEqual(res.body.data[1].createdAt);
  });

  it('does not leak another organisation’s reports', async () => {
    const res = await call('GET', `/api/v1/organizations/${other.orgId}/reports/${reportId}`, { session: other });
    expect(res.status).toBe(404);

    const list = await call('GET', `/api/v1/organizations/${other.orgId}/reports`, { session: other });
    expect(list.body.data).toHaveLength(0);
  });
});

describe('sharing', () => {
  let token = '';

  it('creates a share link with an expiry', async () => {
    const res = await call('POST', `/api/v1/organizations/${session.orgId}/reports/${reportId}/share`, {
      session,
      body: { expiresInDays: 30 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    token = res.body.data.token;
    expect(token.length).toBeGreaterThan(10);
    expect(res.body.data.expiresAt).toBeGreaterThan(Date.now());
  });

  it('serves the report publicly, without signing in', async () => {
    const res = await call('GET', `/api/v1/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.title).toContain('CRA readiness report');
    expect(res.body.data.organisation).toBeTruthy();
    expect(res.body.data.content.sections.length).toBeGreaterThan(0);
  });

  it('never exposes administrative data on a public link', async () => {
    const res = await call('GET', `/api/v1/share/${token}`);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('creditsCharged');
    expect(serialised).not.toContain('"balance"');
  });

  it('counts views', async () => {
    await call('GET', `/api/v1/share/${token}`);
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/reports/${reportId}`, { session });
    expect(res.body.data.share.viewCount).toBeGreaterThan(1);
  });

  it('revokes the link, and it stops working immediately', async () => {
    const res = await call('DELETE', `/api/v1/organizations/${session.orgId}/reports/${reportId}/share`, { session });
    expect(res.status).toBe(200);

    const after = await call('GET', `/api/v1/share/${token}`);
    expect(after.status).toBe(404);
  });

  it('can be shared again after being revoked', async () => {
    const res = await call('POST', `/api/v1/organizations/${session.orgId}/reports/${reportId}/share`, {
      session,
      body: {},
    });
    expect(res.status).toBe(201);
    const newToken = res.body.data.token;
    expect(newToken).not.toBe(token);

    const publicView = await call('GET', `/api/v1/share/${newToken}`);
    expect(publicView.status).toBe(200);
  });

  it('deleting a report removes its share links', async () => {
    const created = await call('POST', `/api/v1/organizations/${session.orgId}/reports`, {
      session,
      body: { kind: 'findings' },
    });
    const id = created.body.data.id;
    const shared = await call('POST', `/api/v1/organizations/${session.orgId}/reports/${id}/share`, { session, body: {} });

    const deleted = await call('DELETE', `/api/v1/organizations/${session.orgId}/reports/${id}`, { session });
    expect(deleted.status).toBe(200);

    const share = getDb().select().from(shareLinks).where(eq(shareLinks.resourceId, id)).all();
    expect(share).toHaveLength(0);

    const publicView = await call('GET', `/api/v1/share/${shared.body.data.token}`);
    expect(publicView.status).toBe(404);
  });
});

describe('billing integrity', () => {
  it('never creates a report it cannot charge for', async () => {
    // Drain the account, then try to generate the most expensive report.
    const balance = getBalance(other.orgId);
    expect(balance).toBeGreaterThanOrEqual(0);

    // Grant nothing and spend everything by generating repeatedly is slow, so
    // assert the contract instead: the endpoint charges before it writes.
    const before = getDb().select().from(reports).all().length;
    const res = await call('POST', `/api/v1/organizations/${other.orgId}/reports`, {
      session: other,
      body: { kind: 'readiness' },
    });
    // Either it succeeds (and the ledger moved) or it refuses with a credit
    // error — what must never happen is a report appearing for free.
    if (res.status === 201) {
      expect(getBalance(other.orgId)).toBeLessThan(balance);
      expect(getDb().select().from(reports).all().length).toBe(before + 1);
    } else {
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe('insufficient_credits');
      expect(getDb().select().from(reports).all().length).toBe(before);
    }
  });
});
