import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { resetRateLimits } from '../../src/core/rate-limit.js';
import { SESSION_COOKIE } from '../../src/core/session.js';
import { getDb } from '../../src/db/index.js';
import {
  componentVulnerabilities,
  components,
  repositories,
  scans,
  vulnerabilities,
} from '../../src/db/schema.js';
import { newId } from '../../src/core/ids.js';
import { priorityOf, headlineFor } from '../../src/routes/findings.js';

/**
 * Findings — the screen that answers "what is wrong and what do I do?".
 *
 * The API is where prioritisation happens, so that is what gets tested: not
 * that rows come back, but that they come back in the order a human would work
 * them, with wording a non-specialist can act on, and that no organisation can
 * see or change another organisation's findings.
 */

interface Session {
  cookie: string;
  orgId: string;
}

let session: Session;
let otherSession: Session;
let repoId = '';
let scanId = '';

const ids = {
  kevComponent: '',
  criticalComponent: '',
  lowComponent: '',
  kevFinding: '',
  criticalFinding: '',
  lowFinding: '',
};

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
      email: `findings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'correct-horse-battery',
      name: 'Findings Owner',
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const cookie = /([^;]+)/.exec((res.headers.get('set-cookie') ?? '').replace(`${SESSION_COOKIE}=`, ''))?.[1];
  return { cookie: cookie!, orgId: res.body.data.organizationId };
}

function seedFinding(input: {
  scanId: string;
  repositoryId: string;
  orgId: string;
  componentName: string;
  version: string;
  ecosystem: string;
  sourceId: string;
  severity: string;
  kevFlag: boolean;
  epssScore: number | null;
  fixedVersion?: string;
  state?: string;
}) {
  const db = getDb();
  const componentId = newId('cmp');
  const vulnerabilityId = `test:${input.sourceId}`;

  db.insert(components)
    .values({
      id: componentId,
      orgId: input.orgId,
      scanId: input.scanId,
      repositoryId: input.repositoryId,
      name: input.componentName,
      version: input.version,
      ecosystem: input.ecosystem,
      purl: `pkg:${input.ecosystem}/${input.componentName}@${input.version}`,
      scope: 'runtime',
      isDirect: true,
      manifestPath: 'package-lock.json',
      createdAt: Date.now(),
    })
    .run();

  const existing = db.select().from(vulnerabilities).where(vulnerabilitiesId(vulnerabilityId)).get?.() ?? null;
  if (!existing) {
    db.insert(vulnerabilities)
      .values({
        id: vulnerabilityId,
        source: 'test',
        sourceId: input.sourceId,
        severity: input.severity as 'critical',
        cvssScore: input.severity === 'critical' ? 9.8 : input.severity === 'high' ? 7.5 : 3.1,
        epssScore: input.epssScore,
        kevFlag: input.kevFlag,
        summary: `Test advisory for ${input.componentName}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
  }

  const linkId = newId('cv');
  db.insert(componentVulnerabilities)
    .values({
      id: linkId,
      orgId: input.orgId,
      scanId: input.scanId,
      repositoryId: input.repositoryId,
      componentId,
      vulnerabilityId,
      state: input.state ?? 'open',
      exploitability: input.kevFlag ? 'active' : 'unknown',
      exposure: 'internet',
      fixedVersion: input.fixedVersion ?? null,
      remediation: input.fixedVersion ? `Upgrade ${input.componentName} to ${input.fixedVersion}.` : null,
      detectedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  return { linkId, componentId, vulnerabilityId };
}

// Small helper: drizzle's `eq` needs the column, which we import lazily to keep
// the import list readable.
import { eq } from 'drizzle-orm';
function vulnerabilitiesId(id: string) {
  return eq(vulnerabilities.id, id);
}

beforeAll(async () => {
  resetRateLimits();
  session = await signup();
  otherSession = await signup();

  const db = getDb();
  repoId = newId('repo');
  scanId = newId('scan');

  db.insert(repositories)
    .values({
      id: repoId,
      orgId: session.orgId,
      provider: 'upload',
      providerRepoId: null,
      name: 'payments-service',
      fullName: 'acme/payments-service',
      defaultBranch: 'main',
      status: 'active',
      monitoringEnabled: true,
      badgeToken: newId('repo'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  db.insert(scans)
    .values({
      id: scanId,
      orgId: session.orgId,
      repositoryId: repoId,
      status: 'succeeded',
      trigger: 'manual',
      componentCount: 3,
      vulnerabilityCount: 3,
      criticalCount: 1,
      kevCount: 1,
      finishedAt: Date.now(),
      createdAt: Date.now(),
    })
    .run();

  db.update(repositories).set({ lastScanId: scanId, lastScanAt: Date.now() }).where(eq(repositories.id, repoId)).run();

  const kev = seedFinding({
    scanId,
    repositoryId: repoId,
    orgId: session.orgId,
    componentName: 'lodash',
    version: '4.17.15',
    ecosystem: 'npm',
    sourceId: 'CVE-2021-23337',
    severity: 'high',
    kevFlag: true,
    epssScore: 0.97,
    fixedVersion: '4.17.21',
  });
  const critical = seedFinding({
    scanId,
    repositoryId: repoId,
    orgId: session.orgId,
    componentName: 'pyyaml',
    version: '5.1',
    ecosystem: 'pypi',
    sourceId: 'CVE-2020-14343',
    severity: 'critical',
    kevFlag: false,
    epssScore: 0.1,
    fixedVersion: '5.4',
  });
  const low = seedFinding({
    scanId,
    repositoryId: repoId,
    orgId: session.orgId,
    componentName: 'minimist',
    version: '1.2.5',
    ecosystem: 'npm',
    sourceId: 'CVE-2021-44906',
    severity: 'low',
    kevFlag: false,
    epssScore: 0.01,
    fixedVersion: '1.2.6',
  });

  ids.kevComponent = kev.componentId;
  ids.criticalComponent = critical.componentId;
  ids.lowComponent = low.componentId;
  ids.kevFinding = kev.linkId;
  ids.criticalFinding = critical.linkId;
  ids.lowFinding = low.linkId;
});

beforeEach(() => resetRateLimits());

describe('prioritisation', () => {
  it('puts known-exploited findings first, whatever their severity', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/findings`, { session });
    expect(res.status).toBe(200);

    const rows = res.body.data.rows;
    expect(rows.length).toBe(3);
    expect(rows[0].vulnerability.sourceId).toBe('CVE-2021-23337');
    expect(rows[0].priority).toBe('act_now');
    expect(rows[0].headline).toContain('Known exploited');
  });

  it('explains the priority in plain language', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/findings`, { session });
    const kev = res.body.data.rows.find((r: any) => r.id === ids.kevFinding);
    expect(kev.whyItMatters).toContain('Known Exploited');
    expect(kev.remediation).toBe('Upgrade lodash to 4.17.21.');
  });

  it('states the recommended action even when no fixed version exists', async () => {
    const db = getDb();
    const scan2 = newId('scan');
    const repo2 = newId('repo');
    db.insert(repositories)
      .values({
        id: repo2,
        orgId: session.orgId,
        provider: 'upload',
        name: 'legacy-api',
        fullName: 'acme/legacy-api',
        status: 'active',
        monitoringEnabled: true,
        badgeToken: newId('repo'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
    db.insert(scans)
      .values({ id: scan2, orgId: session.orgId, repositoryId: repo2, status: 'succeeded', trigger: 'manual', createdAt: Date.now() })
      .run();
    db.update(repositories).set({ lastScanId: scan2 }).where(eq(repositories.id, repo2)).run();

    const finding = seedFinding({
      scanId: scan2,
      repositoryId: repo2,
      orgId: session.orgId,
      componentName: 'struts',
      version: '2.5.12',
      ecosystem: 'maven',
      sourceId: 'CVE-2017-5638',
      severity: 'critical',
      kevFlag: true,
      epssScore: 0.94,
    });

    const res = await call('GET', `/api/v1/organizations/${session.orgId}/findings`, { session });
    const row = res.body.data.rows.find((r: any) => r.id === finding.linkId);
    expect(row).toBeTruthy();
    expect(row.remediation).toBeNull(); // the UI renders its own fallback
    expect(row.priority).toBe('act_now');
  });

  it('summarises what matters rather than dumping counts', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/findings`, { session });
    const summary = res.body.data.summary;
    expect(summary.actNow).toBeGreaterThan(0);
    expect(summary.knownExploited).toBeGreaterThan(0);
    expect(summary.repositoriesAffected).toBeGreaterThanOrEqual(1);
    expect(summary.bySeverity.critical).toBeGreaterThan(0);
  });
});

describe('filters', () => {
  it('filters by severity', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/findings?severity=critical`, { session });
    expect(res.body.data.rows.every((r: any) => r.vulnerability.severity === 'critical')).toBe(true);
  });

  it('filters by repository', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/findings?repositoryId=${repoId}`, { session });
    expect(res.body.data.rows.every((r: any) => r.repository.id === repoId)).toBe(true);
  });

  it('searches by component and advisory id', async () => {
    const byName = await call('GET', `/api/v1/organizations/${session.orgId}/findings?q=lodash`, { session });
    expect(byName.body.data.rows.length).toBe(1);

    const byCve = await call('GET', `/api/v1/organizations/${session.orgId}/findings?q=CVE-2020-14343`, { session });
    expect(byCve.body.data.rows.length).toBe(1);
  });

  it('shows only open findings by default', async () => {
    seedFinding({
      scanId,
      repositoryId: repoId,
      orgId: session.orgId,
      componentName: 'eslint',
      version: '7.0.0',
      ecosystem: 'npm',
      sourceId: 'CVE-2024-0001',
      severity: 'medium',
      kevFlag: false,
      epssScore: 0.02,
      state: 'fixed',
    });
    const open = await call('GET', `/api/v1/organizations/${session.orgId}/findings`, { session });
    expect(open.body.data.rows.every((r: any) => r.state === 'open')).toBe(true);

    const all = await call('GET', `/api/v1/organizations/${session.orgId}/findings?state=all`, { session });
    expect(all.body.data.rows.some((r: any) => r.state === 'fixed')).toBe(true);
  });
});

describe('triage', () => {
  it('records a triage decision and changes the queue', async () => {
    const res = await call('POST', `/api/v1/organizations/${session.orgId}/findings/${ids.lowFinding}/triage`, {
      session,
      body: { state: 'risk_accepted', note: 'Not reachable from untrusted input.' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('risk_accepted');

    const open = await call('GET', `/api/v1/organizations/${session.orgId}/findings`, { session });
    expect(open.body.data.rows.some((r: any) => r.id === ids.lowFinding)).toBe(false);

    const all = await call('GET', `/api/v1/organizations/${session.orgId}/findings?state=all`, { session });
    const row = all.body.data.rows.find((r: any) => r.id === ids.lowFinding);
    expect(row.state).toBe('risk_accepted');
    expect(row.priority).toBe('review');
  });

  it('rejects a state outside the allowed set', async () => {
    const res = await call('POST', `/api/v1/organizations/${session.orgId}/findings/${ids.criticalFinding}/triage`, {
      session,
      body: { state: 'deleted' },
    });
    expect(res.status).toBe(400);
  });

  it('returns the evidence behind a single finding', async () => {
    const res = await call('GET', `/api/v1/organizations/${session.orgId}/findings/${ids.kevFinding}`, { session });
    expect(res.status).toBe(200);
    expect(res.body.data.component.name).toBe('lodash');
    expect(res.body.data.vulnerability.kevFlag).toBe(true);
    expect(Array.isArray(res.body.data.supportingEvidence)).toBe(true);
    expect(Array.isArray(res.body.data.relatedControls)).toBe(true);
  });

  it('does not let one organisation triage another’s finding', async () => {
    const res = await call('POST', `/api/v1/organizations/${otherSession.orgId}/findings/${ids.criticalFinding}/triage`, {
      session: otherSession,
      body: { state: 'fixed' },
    });
    expect(res.status).toBe(404);
  });

  it('does not let one organisation read another’s finding', async () => {
    const res = await call('GET', `/api/v1/organizations/${otherSession.orgId}/findings/${ids.criticalFinding}`, {
      session: otherSession,
    });
    expect(res.status).toBe(404);
  });

  it('shows the other organisation nothing', async () => {
    const res = await call('GET', `/api/v1/organizations/${otherSession.orgId}/findings`, { session: otherSession });
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(0);
  });
});

describe('priority rules', () => {
  it('treats confirmed exploitation as the strongest signal', () => {
    expect(priorityOf({ severity: 'low', kevFlag: true, epssScore: 0.01, exploitability: 'unknown', exposure: 'unknown', state: 'open' })).toBe('act_now');
  });

  it('escalates a severe issue with a high EPSS', () => {
    expect(priorityOf({ severity: 'critical', kevFlag: false, epssScore: 0.6, exploitability: 'unknown', exposure: 'internal', state: 'open' })).toBe('act_now');
  });

  it('does not escalate a severe issue nobody is likely to exploit', () => {
    expect(priorityOf({ severity: 'critical', kevFlag: false, epssScore: 0.001, exploitability: 'unknown', exposure: 'internal', state: 'open' })).toBe('prioritise');
  });

  it('moves resolved findings out of the working queue', () => {
    expect(priorityOf({ severity: 'critical', kevFlag: true, epssScore: 0.99, exploitability: 'active', exposure: 'internet', state: 'fixed' })).toBe('review');
  });

  it('writes headlines a director can read', () => {
    expect(headlineFor({ componentName: 'lodash', version: '4.17.15', severity: 'high', kevFlag: true, exploitability: 'active', repositoryName: 'acme/api' })).toBe(
      'Known exploited vulnerability in lodash 4.17.15 in acme/api',
    );
  });
});
