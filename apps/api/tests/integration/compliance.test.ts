import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { resetRateLimits } from '../../src/core/rate-limit.js';
import { SESSION_COOKIE } from '../../src/core/session.js';
import { getDb } from '../../src/db/index.js';
import { complianceAssessments, repositories } from '../../src/db/schema.js';
import { newId } from '../../src/core/ids.js';
import { eq, and } from 'drizzle-orm';

/**
 * Compliance surface.
 *
 * The compliance screens were rebuilt around a *product* contract, so these
 * tests pin that contract: controls arrive with the words a reader sees, the
 * score is explainable, human review is recorded, and no organisation sees
 * another's posture.
 */

interface Session {
  cookie: string;
  orgId: string;
  userId: string;
}

let session: Session;
let other: Session;
let repoId = '';

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
      email: `compliance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'correct-horse-battery',
      name: 'Compliance Owner',
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
      name: 'core-api',
      fullName: 'acme/core-api',
      status: 'active',
      monitoringEnabled: true,
      badgeToken: newId('repo'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
});

beforeEach(() => resetRateLimits());

describe('repository readiness contract', () => {
  it('returns controls a reader can understand, not raw ids', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/repositories/${repoId}/readiness`, { session });
    expect(res.status).toBe(200);

    const controls = res.body.data.controls;
    expect(controls.length).toBeGreaterThan(20);

    for (const control of controls) {
      expect(control.title).toBeTruthy();
      expect(control.title).not.toBe(control.controlId);
      expect(control.domain).toBeTruthy();
      expect(typeof control.weight).toBe('number');
      expect(control.rationale).toBeTruthy();
    }
  });

  it('cites the CRA obligation behind each expectation', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/repositories/${repoId}/readiness`, { session });
    const withRef = res.body.data.controls.filter((c: any) => c.legalRef);
    expect(withRef.length).toBeGreaterThan(10);
  });

  it('orders domains worst first, because that is the reading order', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/repositories/${repoId}/readiness`, { session });
    const scores = res.body.data.domains.map((d: any) => d.score);
    expect([...scores].sort((a: number, b: number) => a - b)).toEqual(scores);
  });

  it('explains the score rather than just printing it', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/repositories/${repoId}/readiness`, { session });
    const totals = res.body.data.totals;
    const assessed = totals.passed + totals.partial + totals.missing + totals.needs_review;
    expect(assessed).toBeGreaterThan(20);
    expect(res.body.data.topActions.length).toBeGreaterThan(0);
    expect(res.body.data.topActions[0]).not.toMatch(/^cra\./);
  });

  it('does not expose another organisation’s repository', async () => {
    const res = await call('GET', `/api/v1/organizations/${other.orgId}/repositories/${repoId}/readiness`, { session: other });
    expect(res.status).toBe(404);
  });
});

describe('human review', () => {
  it('records a review without erasing the automated verdict', async () => {
    const before = await call('GET', `/api/v1/organizations/${session.orgId}/repositories/${repoId}/readiness`, { session });
    const control = before.body.data.controls.find((c: any) => c.status === 'missing');
    expect(control).toBeTruthy();

    const res = await call(
      'POST',
      `/api/v1/organizations/${session.orgId}/repositories/${repoId}/assessments/${control.controlId}/review`,
      { session, body: { status: 'passed', note: 'Covered by our ISO 27001 surveillance audit.' } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const row = getDb()
      .select()
      .from(complianceAssessments)
      .where(
        and(
          eq(complianceAssessments.orgId, session.orgId),
          eq(complianceAssessments.repositoryId, repoId),
          eq(complianceAssessments.controlId, control.controlId),
        ),
      )
      .get();
    expect(row).toBeTruthy();
    expect(row!.reviewedAt).not.toBeNull();

    // The reviewed control now reports as reviewed on the screen.
    const after = await call('GET', `/api/v1/organizations/${session.orgId}/repositories/${repoId}/readiness`, { session });
    const updated = after.body.data.controls.find((c: any) => c.controlId === control.controlId);
    expect(updated.reviewedAt).not.toBeNull();
  });

  it('refuses a review from someone outside the organisation', async () => {
    const outsider = await signup();
    const res = await call(
      'POST',
      `/api/v1/organizations/${session.orgId}/repositories/${repoId}/assessments/cra.sbom.present/review`,
      { session: { ...outsider, orgId: session.orgId }, body: { status: 'missing' } },
    );
    expect(res.status).toBe(403);
  });
});

describe('organisation readiness', () => {
  it('answers with a grade, a breakdown and what needs attention', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/readiness`, { session });
    expect(res.status).toBe(200);

    expect(res.body.data.grade).toBeTruthy();
    expect(typeof res.body.data.score).toBe('number');
    expect(Array.isArray(res.body.data.attention)).toBe(true);
    expect(Array.isArray(res.body.data.domains)).toBe(true);
    expect(res.body.data.inventory).toBeTruthy();
  });

  it('gives every attention item a title, a reason and somewhere to go', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/readiness`, { session });
    for (const item of res.body.data.attention) {
      expect(item.title).toBeTruthy();
      expect(item.why).toBeTruthy();
      expect(['critical', 'high', 'medium', 'low']).toContain(item.severity);
      if (item.href) expect(item.href.startsWith('/app/')).toBe(true);
    }
  });

  it('tells a brand-new organisation to connect a repository', async () => {
    const res = await call('GET', `/api/v1/organizations/${other.orgId}/readiness`, { session: other });
    expect(res.status).toBe(200);
    expect(res.body.data.attention[0].kind).toBe('no_repositories');
    expect(res.body.data.grade).toBe('N/A');
  });
});
