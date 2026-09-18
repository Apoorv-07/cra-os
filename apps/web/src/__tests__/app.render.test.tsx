import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { ToastProvider } from '../components/ui';
import { App } from '../App';

/**
 * Authenticated product surfaces.
 *
 * These render the real router, real auth context and real pages against
 * recorded-shape API responses. They exist to catch the failures that only
 * appear when a screen meets data: a field renamed in one place, a component
 * that throws on an empty array, a page that renders "undefined" where a number
 * should be.
 */

const ORG = 'org_test';

const me = {
  data: {
    user: {
      id: 'usr_test',
      email: 'owner@example.com',
      name: 'Ada Lovelace',
      avatarUrl: null,
      isSystemAdmin: false,
      timezone: 'UTC',
      locale: 'en',
    },
    organizations: [
      { orgId: ORG, role: 'owner', name: 'Acme Robotics', slug: 'acme-robotics', planKey: 'free', isAgency: false },
    ],
    defaultOrgId: ORG,
    capabilities: { githubApp: true, githubOauth: true, payments: true, ai: false },
  },
};

const repositories = {
  data: [
    {
      id: 'repo_1',
      orgId: ORG,
      provider: 'github',
      name: 'payments-service',
      fullName: 'acme/payments-service',
      owner: 'acme',
      url: 'https://github.com/acme/payments-service',
      defaultBranch: 'main',
      status: 'active',
      monitoringEnabled: true,
      readinessScore: 42,
      lastScanAt: Date.now() - 14 * 60_000,
      lastScanId: 'scan_1',
      badgeToken: 'tok',
      badgeEnabled: false,
      createdAt: Date.now(),
    },
  ],
};

const readiness = {
  data: {
    score: 42,
    grade: 'D',
    evaluatedAt: Date.now(),
    totals: { passed: 8, partial: 6, missing: 9, needsReview: 5, notApplicable: 0 },
    domains: [
      { domain: 'Vulnerability handling', name: 'Vulnerability handling', shortName: 'Vulnerabilities', score: 20, controls: 6 },
      { domain: 'Component transparency', name: 'Component transparency', shortName: 'Inventory', score: 75, controls: 4 },
      { domain: 'Incident reporting', name: 'Incident reporting', shortName: 'Incidents', score: 0, controls: 4 },
    ],
    assessments: [
      {
        controlId: 'cra.vuln.critical_open',
        title: 'Critical and high vulnerabilities remediated',
        domain: 'Vulnerability handling',
        domainName: 'Vulnerability handling',
        status: 'missing',
        score: 0,
        confidence: 'high',
        rationale: '4 critical findings are still open.',
        remediation: 'Triage every critical finding.',
        evidence: [],
        repositories: [{ id: 'repo_1', name: 'acme/payments-service', status: 'missing' }],
      },
    ],
    topActions: ['Triage every critical finding'],
    actions: [
      {
        controlId: 'cra.vuln.critical_open',
        title: 'Critical and high vulnerabilities remediated',
        rationale: '4 critical findings are still open.',
        impact: 5,
        remediation: 'Triage every critical finding.',
        repositoryName: 'acme/payments-service',
      },
    ],
    attention: [
      {
        id: 'kev:repo_1',
        kind: 'known_exploited',
        title: '1 known exploited vulnerability in acme/payments-service',
        why: 'Listed in CISA’s Known Exploited Vulnerabilities catalogue.',
        severity: 'critical',
        repositoryId: 'repo_1',
        repositoryName: 'acme/payments-service',
        href: '/app/findings?repositoryId=repo_1&priority=act_now',
        count: 1,
        dueAt: null,
      },
      {
        id: 'control-gaps',
        kind: 'control_gap',
        title: '14 CRA expectations need attention',
        why: 'Starting with “Critical and high vulnerabilities remediated”.',
        severity: 'high',
        repositoryId: null,
        repositoryName: null,
        href: '/app/compliance?filter=needs_attention',
        count: 14,
        dueAt: null,
      },
    ],
    inventory: { components: 128, ecosystems: ['npm', 'pypi'], repositories: 1 },
    repositories: [
      {
        id: 'repo_1',
        name: 'acme/payments-service',
        score: 42,
        grade: 'D',
        lastScanAt: Date.now() - 14 * 60_000,
        openCritical: 4,
        openHigh: 6,
        openKev: 1,
      },
    ],
  },
};

const findings = {
  data: {
    summary: {
      total: 11,
      open: 10,
      actNow: 1,
      prioritise: 5,
      monitor: 4,
      knownExploited: 1,
      bySeverity: { critical: 1, high: 5, medium: 4, low: 0, unknown: 0 },
      overdueSla: 0,
      repositoriesAffected: 1,
    },
    rows: [
      {
        id: 'cv_1',
        state: 'open',
        priority: 'act_now',
        headline: 'Known exploited vulnerability in lodash 4.17.15 in acme/payments-service',
        whyItMatters: 'Listed in CISA’s Known Exploited Vulnerabilities catalogue.',
        remediation: 'Upgrade lodash to 4.17.21.',
        slaDueAt: null,
        exploitability: 'active',
        exposure: 'internet',
        detectedAt: Date.now(),
        repository: { id: 'repo_1', name: 'acme/payments-service', monitoringEnabled: true },
        component: { id: 'cmp_1', name: 'lodash', version: '4.17.15', ecosystem: 'npm', purl: 'pkg:npm/lodash@4.17.15', isDirect: true, manifestPath: 'package-lock.json' },
        vulnerability: {
          id: 'ghsa:1',
          sourceId: 'CVE-2021-23337',
          summary: 'Command injection',
          severity: 'high',
          cvssScore: 7.2,
          cvssVector: 'CVSS:3.1/AV:N',
          epssScore: 0.97,
          kevFlag: true,
          publishedAt: Date.now(),
          fixedVersion: '4.17.21',
        },
        cra: [{ controlId: 'cra.vuln.known_exploited', title: 'Known exploited vulnerabilities' }],
      },
    ],
    total: 1,
    page: 1,
    perPage: 50,
  },
};

const reports = {
  data: [
    {
      id: 'rep_1',
      kind: 'readiness',
      title: 'CRA readiness report — acme/payments-service',
      status: 'ready',
      repositoryId: 'repo_1',
      creditsCharged: 100,
      createdAt: Date.now(),
      shared: true,
      shareToken: 'tok_abc',
      shareExpiresAt: null,
      shareViewCount: 3,
    },
  ],
};

const billing = {
  data: {
    balance: 150,
    lifetimePurchased: 0,
    lifetimeGranted: 250,
    lifetimeConsumed: 100,
    currency: 'USD',
    planKey: 'free',
    paymentsEnabled: true,
    autoTopup: { enabled: false, thresholdCredits: 100, packKey: null },
  },
};

const repoReadiness = {
  data: {
    score: 42,
    grade: 'D',
    evaluatedAt: Date.now(),
    totals: { passed: 8, partial: 6, missing: 9, needs_review: 5, not_applicable: 0 },
    domains: [
      { id: 'Vulnerability handling', name: 'Vulnerability handling', score: 20, controls: 6 },
      { id: 'Component transparency', name: 'Component transparency', score: 75, controls: 4 },
    ],
    controls: [
      {
        id: 'cra.vuln.critical_open',
        key: 'cra.vuln.critical_open',
        controlId: 'cra.vuln.critical_open',
        title: 'Critical and high vulnerabilities remediated',
        domain: 'Vulnerability handling',
        domainName: 'Vulnerability handling',
        weight: 5,
        legalRef: 'Annex I Part II(2)',
        obligation: 'Handle vulnerabilities without undue delay',
        description: null,
        status: 'missing',
        score: 0,
        confidence: 'high',
        rationale: '4 critical findings are still open.',
        remediation: 'Triage every critical finding.',
        evidence: [],
        reviewedAt: null,
      },
      {
        id: 'cra.sbom.present',
        key: 'cra.sbom.present',
        controlId: 'cra.sbom.present',
        title: 'Software bill of materials exists',
        domain: 'Component transparency',
        domainName: 'Component transparency',
        weight: 3,
        legalRef: 'Annex I Part II(1)',
        obligation: 'Document the software components',
        description: null,
        status: 'passed',
        score: 100,
        confidence: 'high',
        rationale: 'A CycloneDX SBOM exists for the latest scan.',
        remediation: '',
        evidence: ['sbom'],
        reviewedAt: null,
      },
    ],
    topActions: ['Triage every critical finding'],
    actions: [
      {
        controlId: 'cra.vuln.critical_open',
        title: 'Critical and high vulnerabilities remediated',
        rationale: '4 critical findings are still open.',
        impact: 5,
        remediation: 'Triage every critical finding.',
      },
    ],
  },
};

const incidents = { data: [] };
const evidence = { data: [] };
const scans = { data: [] };

function respond(path: string): unknown {
  if (path.includes('/auth/me')) return me;
  if (path.includes('/findings')) return findings;
  if (path.includes('/reports')) return reports;
  if (path.includes('/billing')) return billing;
  if (path.includes('/incidents')) return incidents;
  if (path.includes('/evidence')) return evidence;
  if (path.includes('/scans')) return scans;
  if (path.includes('/readiness')) return path.includes('/repositories/') ? repoReadiness : readiness;
  if (path.includes('/repositories')) return repositories;
  return { data: [] };
}

function mount(route: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(respond(path)),
        json: async () => respond(path),
      } as unknown as Response;
    }),
  );
});

describe('authenticated product surfaces', () => {
  it('renders the Overview as a command centre with an explainable score', async () => {
    mount('/app');

    // The answer, not a pile of metrics.
    await waitFor(() => expect(screen.getByText('42 out of 100')).toBeTruthy());
    expect(screen.getAllByText(/CRA readiness/i).length).toBeGreaterThan(0);

    // The score is explained in the same breath as the number.
    expect(screen.getByText(/8 expectations met, 6 partially met, and 14 still need attention/)).toBeTruthy();

    // What needs a human today, with the action on the item itself.
    await waitFor(() => expect(screen.getByText(/known exploited vulnerability in acme\/payments-service/i)).toBeTruthy());
    expect(screen.getByText('2 things need attention')).toBeTruthy();
    expect(screen.getAllByText('Resolve').length).toBeGreaterThan(0);

    // Evidence is one click away, and the estate is visible.
    expect(screen.getByText(/Open the evidence vault/i)).toBeTruthy();
    expect(screen.getAllByText('acme/payments-service').length).toBeGreaterThan(0);
  });

  it('keeps the promise about what this product is and is not', async () => {
    mount('/app');
    await waitFor(() => expect(screen.getByText('42 out of 100')).toBeTruthy());
    expect(screen.getByText(/does not certify conformity and is not legal advice/i)).toBeTruthy();
  });

  it('renders Findings with priority, plain language and an action', async () => {
    mount('/app/findings');

    await waitFor(() => expect(screen.getByText(/Known exploited vulnerability in lodash/i)).toBeTruthy());
    // The technical explanation lives behind a click, not in the queue.
    expect(screen.queryByText(/Why this matters/i)).toBeNull();
    expect(screen.getAllByText('Act now').length).toBeGreaterThan(0);
    expect(screen.getByText(/Upgrade lodash to 4.17.21/i)).toBeTruthy();
    expect(screen.getAllByText('acme/payments-service').length).toBeGreaterThan(0);
  });

  it('renders Reports as a list of shareable documents', async () => {
    mount('/app/reports');

    await waitFor(() => expect(screen.getByText('CRA readiness report — acme/payments-service')).toBeTruthy());
    expect(screen.getByText(/Live · 3 views/)).toBeTruthy();
    expect(screen.getAllByLabelText('Share report').length).toBe(1);
    expect(screen.getAllByLabelText('Revoke link').length).toBe(1);
  });

  it('renders Compliance as an explainable control register', async () => {
    mount('/app/compliance');

    await waitFor(() => expect(screen.getByText('Critical and high vulnerabilities remediated')).toBeTruthy());

    // Every control states its status and the reason for it — the two things an
    // auditor will ask for.
    expect(screen.getByText('4 critical findings are still open.')).toBeTruthy();
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThan(0);
    expect(screen.getByText('Software bill of materials exists')).toBeTruthy();

    // Domain scores and the "do these first" list come from the same payload.
    expect(screen.getAllByText('Vulnerability handling').length).toBeGreaterThan(0);
    expect(screen.getByText('Triage every critical finding')).toBeTruthy();

    // Identifiers still exist for the engineer who needs to grep for them, but
    // they are collapsed into technical detail rather than sitting in the
    // reading flow next to the obligation.
    const idNodes = screen.getAllByText('cra.vuln.critical_open');
    expect(idNodes.length).toBeGreaterThan(0);
    for (const node of idNodes) {
      expect(node.closest('details'), 'control id must live inside a disclosure').not.toBeNull();
    }
  });

  it('keeps the primary navigation to the eight questions a customer asks', async () => {
    mount('/app');
    await waitFor(() => expect(screen.getByText('42 out of 100')).toBeTruthy());

    const labels = ['Overview', 'Repositories', 'Compliance', 'Findings', 'Evidence', 'Incidents', 'Reports', 'Billing', 'Settings'];
    for (const label of labels) {
      expect(screen.getAllByText(label).length, `${label} should be in the navigation`).toBeGreaterThan(0);
    }
    // Admin is not shown to a normal user.
    expect(screen.queryByText('Admin console')).toBeNull();
  });
});
