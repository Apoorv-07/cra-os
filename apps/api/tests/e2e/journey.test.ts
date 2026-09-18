import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import app from '../../src/app.js';
import { resetRateLimits } from '../../src/core/rate-limit.js';
import { SESSION_COOKIE } from '../../src/core/session.js';
import { getDb } from '../../src/db/index.js';
import { componentVulnerabilities, components, repositories, scans, sboms } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { getBalance } from '../../src/modules/billing/ledger.js';
import { runJobNow } from '../../src/jobs/worker.js';
import { newId } from '../../src/core/ids.js';

/**
 * The launch gate.
 *
 * One file, one journey, no shortcuts: register → create organisation →
 * connect a repository → scan → inventory → findings → compliance →
 * evidence → report → share → consume. Then the same journey's failure
 * states, because a product that only works when everything goes right is
 * not finished.
 *
 * The scan runs through the real worker (`processOnce`), so this exercises
 * parsing, normalisation, advisory matching and scoring end to end.
 */

interface Session {
  cookie: string;
  orgId: string;
  email: string;
}

let session: Session;
let repositoryId = '';
let scanId = '';

const FIXTURE = resolve(process.cwd(), 'tests/fixtures/demo-repo.tar.gz');

async function call(method: string, path: string, options: { body?: unknown; session?: Session; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.session) {
    headers['Cookie'] = `${SESSION_COOKIE}=${options.session.cookie}`;
    headers['X-Organization-Id'] = options.session.orgId;
  }
  const res = await app.request(path, {
    method,
    headers,
    body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as any };
}

/** Runs the scan job the way the worker would, so parsing and matching are real. */
async function runScan(scanIdToRun: string): Promise<void> {
  const scan = getDb().select().from(scans).where(eq(scans.id, scanIdToRun)).get();
  if (!scan?.jobId) throw new Error('The scan has no job attached');
  await runJobNow(scan.jobId);
}

beforeAll(async () => {
  resetRateLimits();
});

beforeEach(() => resetRateLimits());

describe('the journey', () => {
  it('registers an account and starts with welcome credits', async () => {
    const email = `journey-${Date.now()}@example.com`;
    const res = await call('POST', '/api/v1/auth/signup', {
      body: { email, password: 'correct-horse-battery', name: 'Journey Tester', organizationName: 'Journey Ltd' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const cookie = /([^;]+)/.exec((res.headers.get('set-cookie') ?? '').replace(`${SESSION_COOKIE}=`, ''))?.[1];
    expect(cookie).toBeTruthy();
    // The session must survive: this is the tenant boundary for everything below.
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);

    session = { cookie: cookie!, orgId: res.body.data.organizationId, email };
    expect(getBalance(session.orgId)).toBeGreaterThan(0);
  });

  it('starts from an empty, honest posture', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/readiness`, { session });
    expect(res.status).toBe(200);
    expect(res.body.data.grade).toBe('N/A');
    expect(res.body.data.attention[0].kind).toBe('no_repositories');
  });

  it('rejects an archive that is not a gzipped tarball', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('this is not an archive')], { type: 'application/zip' }), 'repo.zip');
    form.append('name', 'bad-archive');
    const res = await call('POST', `/api/v1/organizations/${session.orgId}/repositories/upload`, { session, form });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/tar\.gz/);
  });

  it('connects a repository from a source archive', async () => {
    const form = new FormData();
    const buffer = readFileSync(FIXTURE);
    form.append('file', new Blob([buffer], { type: 'application/gzip' }), 'demo-repo.tar.gz');
    form.append('name', 'payments-service');

    const res = await call('POST', `/api/v1/organizations/${session.orgId}/repositories/upload`, { session, form });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    repositoryId = res.body.data.id;
    scanId = res.body.data.scanId;
    expect(repositoryId).toBeTruthy();
  });

  it('charges for the scan before it runs', async () => {
    const row = getDb().select().from(scans).where(eq(scans.id, scanId)).get();
    expect(row?.creditsCharged).toBeGreaterThan(0);
  });

  it('completes the scan through the real worker', async () => {
    await runScan(scanId);

    const scan = getDb().select().from(scans).where(eq(scans.id, scanId)).get();
    expect(scan?.status, scan?.errorMessage ?? '').toBe('succeeded');
    expect(scan!.componentCount).toBeGreaterThan(0);
  });

  it('builds a software inventory', async () => {
    const comps = getDb().select().from(components).where(eq(components.scanId, scanId)).all();
    expect(comps.length).toBeGreaterThan(0);

    const sbom = await call('POST', `/api/v1/organizations/${session.orgId}/scans/${scanId}/sbom`, { session });
    expect([200, 201]).toContain(sbom.status);

    const stored = getDb().select().from(sboms).all();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0]!.specVersion).toContain('1.');
  });

  it('matches real advisories and prioritises them', async () => {
    const links = getDb().select().from(componentVulnerabilities).where(eq(componentVulnerabilities.scanId, scanId)).all();
    expect(links.length).toBeGreaterThan(0);

    const res = await call('GET', `/api/v1/organizations/${session.orgId}/findings`, { session });
    expect(res.status).toBe(200);
    expect(res.body.data.rows.length).toBeGreaterThan(0);

    const first = res.body.data.rows[0];
    expect(first.headline).toMatch(/vulnerability/i);
    expect(first.whyItMatters.length).toBeGreaterThan(20);
    expect(['act_now', 'prioritise', 'monitor', 'review']).toContain(first.priority);
  });

  it('turns the scan into an explainable compliance posture', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/repositories/${repositoryId}/readiness`, {
      session,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.controls.length).toBeGreaterThan(20);
    expect(res.body.data.controls[0].title).toBeTruthy();
    expect(res.body.data.score).toBeGreaterThanOrEqual(0);

    const org = await call('GET', `/api/v1/organizations/${session.orgId}/readiness`, { session });
    expect(org.body.data.grade).toMatch(/^[A-E]$|N\/A/);
    expect(org.body.data.attention.length).toBeGreaterThan(0);
    for (const item of org.body.data.attention) {
      expect(item.why).toBeTruthy();
    }
  });

  it('stores evidence with a checksum and timestamp', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from('# Incident response runbook\n\n1. Detect\n2. Triage\n3. Report\n')], { type: 'text/markdown' }),
      'incident-runbook.md',
    );
    form.append('title', 'Incident response runbook');
    form.append('type', 'document');
    form.append('repositoryId', repositoryId);

    const res = await call('POST', `/api/v1/organizations/${session.orgId}/evidence`, { session, form });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates a report, shares it, and serves it publicly', async () => {
    const created = await call('POST', `/api/v1/organizations/${session.orgId}/reports`, {
      session,
      body: { kind: 'readiness', repositoryId },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const reportId = created.body.data.id;

    const shared = await call('POST', `/api/v1/organizations/${session.orgId}/reports/${reportId}/share`, {
      session,
      body: { expiresInDays: 30 },
    });
    expect(shared.status).toBe(201);

    const token = shared.body.data.token;
    const publicView = await call('GET', `/api/v1/share/${token}`);
    expect(publicView.status).toBe(200);
    expect(publicView.body.data.title).toBeTruthy();
    expect(publicView.body.data.content.sections.length).toBeGreaterThan(2);
    expect(JSON.stringify(publicView.body)).not.toContain('creditsCharged');
  });

  it('records every movement on the credit ledger', async () => {
    const ledger = await call('GET', `/api/v1/organizations/${session.orgId}/billing/ledger?limit=100`, { session });
    expect(ledger.status).toBe(200);

    const types = ledger.body.data.map((row: any) => row.type);
    expect(types).toContain('grant'); // welcome credits
    expect(types).toContain('reservation'); // the scan and the report

    // The balance is the sum of the ledger — no silent drift.
    const sum = ledger.body.data.reduce((acc: number, row: any) => acc + row.amount, 0);
    expect(getBalance(session.orgId)).toBe(sum);
  });
});

describe('the same journey, when things go wrong', () => {
  it('refuses to start work the account cannot pay for', async () => {
    // Drain the balance by reserving more than we hold.
    const poor = await call('POST', '/api/v1/auth/signup', {
      body: { email: `poor-${Date.now()}@example.com`, password: 'correct-horse-battery' },
    });
    const poorCookieHeader = poor.headers.get('set-cookie') ?? '';
    const cookie = /([^;]+)/.exec(poorCookieHeader.replace(`${SESSION_COOKIE}=`, ''))?.[1] ?? '';
    const poorSession: Session = { cookie, orgId: poor.body.data.organizationId, email: '' };

    const repoId = newId('repo');
    getDb()
      .insert(repositories)
      .values({
        id: repoId,
        orgId: poorSession.orgId,
        provider: 'upload',
        name: 'cannot-afford',
        status: 'active',
        monitoringEnabled: false,
        badgeToken: newId('repo'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    // Spend everything by generating reports until the account refuses.
    let refused = false;
    for (let i = 0; i < 12 && !refused; i += 1) {
      const res = await call('POST', `/api/v1/organizations/${poorSession.orgId}/reports`, {
        session: poorSession,
        body: { kind: 'readiness' },
      });
      if (res.status === 402) {
        refused = true;
        expect(res.body.error.code).toBe('insufficient_credits');
      }
    }
    expect(refused, 'the account must eventually refuse').toBe(true);
    expect(getBalance(poorSession.orgId)).toBeGreaterThanOrEqual(0);
  });

  it('never lets one organisation touch another’s repository', async () => {
    const stranger = await call('POST', '/api/v1/auth/signup', {
      body: { email: `stranger-${Date.now()}@example.com`, password: 'correct-horse-battery' },
    });
    const strangerCookieHeader = stranger.headers.get('set-cookie') ?? '';
    const cookie = /([^;]+)/.exec(strangerCookieHeader.replace(`${SESSION_COOKIE}=`, ''))?.[1] ?? '';
    const strangerSession: Session = { cookie, orgId: stranger.body.data.organizationId, email: '' };

    for (const path of [
      `/api/v1/organizations/${strangerSession.orgId}/repositories/${repositoryId}`,
      `/api/v1/organizations/${strangerSession.orgId}/repositories/${repositoryId}/readiness`,
      `/api/v1/organizations/${strangerSession.orgId}/scans/${scanId}/components`,
    ]) {
      const res = await call('GET', path, { session: strangerSession });
      expect(res.status, `${path} must not be readable by a stranger`).toBe(404);
    }

    // And the stranger sees nothing in the shared surfaces.
    const findings = await call('GET', `/api/v1/organizations/${strangerSession.orgId}/findings`, {
      session: strangerSession,
    });
    expect(findings.body.data.rows).toHaveLength(0);
  });

  it('returns a shaped error for an unknown route', async () => {
    const res = await call('GET', '/api/v1/does-not-exist', { session });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBeTruthy();
  });

  it('refuses a request whose header and URL disagree about the organisation', async () => {
    const res = await call('GET', '/api/v1/organizations/org_someone_else/repositories', { session });
    expect([401, 403, 404]).toContain(res.status);
  });

  it('protects admin routes from ordinary users', async () => {
    const res = await call('GET', '/api/v1/admin/overview', { session });
    expect([401, 403]).toContain(res.status);
  });
});
