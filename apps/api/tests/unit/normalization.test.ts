import { describe, it, expect, afterEach } from 'vitest';
import {
  normaliseOsvVuln,
  vulnAppliesTo,
  fixedVersionFor,
  buildQueries,
  queryBatch,
} from '../../src/intel/osv.js';

/**
 * Vulnerability normalisation and matching.
 *
 * False positives are the fastest way to lose a security team's trust, so the
 * matching rules here are asserted against realistic OSV payloads: same package
 * but different ecosystem, a near-miss version, an explicit version list, and a
 * withdrawn advisory.
 */

const log4shell = {
  id: 'GHSA-jfh8-c2jp-5v3q',
  aliases: ['CVE-2021-44228'],
  summary: 'Remote code execution in Log4j',
  details: 'Apache Log4j2 JNDI features do not protect against attacker controlled LDAP.',
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H' }],
  published: '2021-12-10T10:15:00Z',
  modified: '2023-11-28T05:00:00Z',
  database_specific: { cwe_ids: ['CWE-20', 'CWE-400'], severity: 'CRITICAL' },
  references: [{ type: 'WEB', url: 'https://logging.apache.org/log4j/2.x/security.html' }, { type: 'ADVISORY', url: null }],
  affected: [
    {
      package: { name: 'org.apache.logging.log4j:log4j-core', ecosystem: 'Maven', purl: 'pkg:maven/org.apache.logging.log4j/log4j-core' },
      ranges: [
        { type: 'ECOSYSTEM', events: [{ introduced: '2.0-beta9' }, { fixed: '2.15.0' }] },
        { type: 'ECOSYSTEM', events: [{ introduced: '2.16.0' }, { fixed: '2.17.0' }] },
      ],
      database_specific: { severity: 'CRITICAL' },
    },
  ],
};

const npmNearMiss = {
  id: 'GHSA-example-0001',
  summary: 'Prototype pollution with no CVSS vector',
  severity: [],
  database_specific: { severity: 'MODERATE' },
  affected: [
    {
      package: { name: 'lodash', ecosystem: 'npm' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '4.17.0' }, { fixed: '4.17.21' }] }],
    },
  ],
};

const noRanges = {
  id: 'GHSA-example-0002',
  summary: 'Affects all versions',
  affected: [{ package: { name: 'left-pad', ecosystem: 'npm' } }],
};

const explicitVersions = {
  id: 'GHSA-example-0003',
  summary: 'Only some versions are listed',
  affected: [
    { package: { name: 'requests', ecosystem: 'PyPI' }, versions: ['2.19.0', '2.19.1', '2.20.0'] },
  ],
};

const withdrawn = {
  id: 'GHSA-example-0004',
  summary: 'Withdrawn advisory',
  withdrawn: '2024-01-05T00:00:00Z',
  affected: [{ package: { name: 'eslint', ecosystem: 'npm' } }],
};

describe('normaliseOsvVuln', () => {
  it('extracts CVSS v3, aliases, CWEs and timestamps', () => {
    const v = normaliseOsvVuln(log4shell);
    expect(v.id).toBe('osv:GHSA-jfh8-c2jp-5v3q');
    expect(v.sourceId).toBe('GHSA-jfh8-c2jp-5v3q');
    expect(v.aliases).toEqual(['CVE-2021-44228']);
    expect(v.cvssVersion).toBe('3.1');
    expect(v.cvssScore).toBe(10);
    expect(v.severity).toBe('critical');
    expect(v.weaknesses).toEqual(['CWE-20', 'CWE-400']);
    expect(v.publishedAt).toBe(Date.parse('2021-12-10T10:15:00Z'));
    expect(v.modifiedAt).toBe(Date.parse('2023-11-28T05:00:00Z'));
    expect(v.withdrawnAt).toBeNull();
  });

  it('falls back to the advisory label when no CVSS vector is present', () => {
    const v = normaliseOsvVuln(npmNearMiss);
    expect(v.cvssScore).toBeNull();
    expect(v.cvssVector).toBeNull();
    expect(v.severity).toBe('medium');
  });

  it('prefers CVSS over a mismatched advisory label', () => {
    const v = normaliseOsvVuln({
      ...npmNearMiss,
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N' }],
      database_specific: { severity: 'CRITICAL' },
    });
    expect(v.severity).toBe('medium');
    expect(v.cvssScore).toBe(5.3);
  });

  it('collects every fixed version across all affected ranges', () => {
    const v = normaliseOsvVuln(log4shell);
    expect(v.fixedVersions.sort()).toEqual(['2.15.0', '2.17.0']);
  });

  it('drops references without a URL', () => {
    const v = normaliseOsvVuln(log4shell);
    expect(v.references).toEqual([
      { type: 'WEB', url: 'https://logging.apache.org/log4j/2.x/security.html' },
    ]);
  });

  it('records withdrawal and never invents a score', () => {
    const v = normaliseOsvVuln(withdrawn);
    expect(v.withdrawnAt).toBe(Date.parse('2024-01-05T00:00:00Z'));
    expect(v.cvssScore).toBeNull();
    expect(v.severity).toBe('unknown');
  });

  it('survives a malformed payload', () => {
    const v = normaliseOsvVuln({});
    expect(v.severity).toBe('unknown');
    expect(v.fixedVersions).toEqual([]);
    expect(v.references).toEqual([]);
  });
});

describe('vulnAppliesTo', () => {
  const log4j = normaliseOsvVuln(log4shell);

  it('matches a vulnerable version', () => {
    expect(vulnAppliesTo(log4j, 'org.apache.logging.log4j:log4j-core', '2.14.1', 'maven')).toBe(true);
  });

  it('rejects a patched version', () => {
    expect(vulnAppliesTo(log4j, 'org.apache.logging.log4j:log4j-core', '2.15.0', 'maven')).toBe(false);
  });

  it('re-matches the reintroduced window', () => {
    expect(vulnAppliesTo(log4j, 'org.apache.logging.log4j:log4j-core', '2.16.0', 'maven')).toBe(true);
    expect(vulnAppliesTo(log4j, 'org.apache.logging.log4j:log4j-core', '2.17.0', 'maven')).toBe(false);
  });

  it('rejects a different package in the same ecosystem', () => {
    expect(vulnAppliesTo(log4j, 'org.apache.logging.log4j:log4j-api', '2.14.1', 'maven')).toBe(false);
  });

  it('rejects the same name under a different ecosystem', () => {
    // The classic near-miss: an npm package that happens to share a name.
    expect(vulnAppliesTo(log4j, 'org.apache.logging.log4j:log4j-core', '2.14.1', 'npm')).toBe(false);
  });

  it('treats a missing range list as "all versions affected"', () => {
    const all = normaliseOsvVuln(noRanges);
    expect(vulnAppliesTo(all, 'left-pad', '1.3.0', 'npm')).toBe(true);
  });

  it('honours an explicit version list over ranges', () => {
    const listed = normaliseOsvVuln(explicitVersions);
    expect(vulnAppliesTo(listed, 'requests', '2.19.1', 'pypi')).toBe(true);
    expect(vulnAppliesTo(listed, 'requests', '2.19.2', 'pypi')).toBe(false);
  });

  it('does not report a version below the introduced bound', () => {
    const lodash = normaliseOsvVuln(npmNearMiss);
    expect(vulnAppliesTo(lodash, 'lodash', '4.17.20', 'npm')).toBe(true);
    expect(vulnAppliesTo(lodash, 'lodash', '4.17.21', 'npm')).toBe(false);
    expect(vulnAppliesTo(lodash, 'lodash', '4.16.0', 'npm')).toBe(false);
  });
});

describe('fixedVersionFor', () => {
  it('returns the earliest fix above the installed version', () => {
    expect(fixedVersionFor(normaliseOsvVuln(log4shell), 'org.apache.logging.log4j:log4j-core', '2.14.1', 'maven')).toBe('2.15.0');
  });

  it('returns the next fix for a version inside the reintroduced window', () => {
    expect(fixedVersionFor(normaliseOsvVuln(log4shell), 'org.apache.logging.log4j:log4j-core', '2.16.0', 'maven')).toBe('2.17.0');
  });

  it('returns null when no fix exists', () => {
    expect(fixedVersionFor(normaliseOsvVuln(noRanges), 'left-pad', '1.3.0', 'npm')).toBeNull();
  });
});

describe('buildQueries', () => {
  it('drops components that cannot be matched upstream', () => {
    const queries = buildQueries([
      { key: '1', name: 'lodash', version: '', ecosystem: 'npm' },
      { key: '2', name: 'lodash', version: null, ecosystem: 'npm' },
      { key: '3', name: 'alpine', version: '3.19', ecosystem: 'docker' },
      { key: '4', name: 'mystery', version: '1.0.0', ecosystem: 'unknown' },
      { key: '5', name: 'django', version: '3.2.0', ecosystem: 'pypi' },
    ] as never[]);
    expect(queries.map((q) => q.key)).toEqual(['5']);
  });

  it('keeps one query per component so findings can be attributed precisely', () => {
    const queries = buildQueries([
      { key: 'a', name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
      { key: 'b', name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
    ] as never[]);
    expect(queries).toHaveLength(2);
  });
});

describe('queryBatch (stubbed network)', () => {
  const originalFetch = globalThis.fetch;

  const stubFetch = (handler: (body: any, call: number) => { status: number; body: any }) => {
    let calls = 0;
    const seen: any[] = [];
    globalThis.fetch = (async (_url: unknown, init: any) => {
      calls += 1;
      const body = JSON.parse(init.body);
      seen.push(body);
      const result = handler(body, calls);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    return { count: () => calls, bodies: seen };
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends one query per unique dependency and fans results back to every component', async () => {
    const stub = stubFetch((body) => ({
      status: 200,
      body: { results: body.queries.map(() => ({ vulns: [{ id: 'GHSA-1' }] })) },
    }));

    const matches = await queryBatch([
      { key: 'component-1', name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
      { key: 'component-2', name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
      { key: 'component-3', name: 'django', version: '3.2.0', ecosystem: 'pypi' },
    ] as never[]);

    expect(stub.count()).toBe(1);
    expect(stub.bodies[0].queries).toHaveLength(2);
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.key).sort()).toEqual(['component-1', 'component-2', 'component-3']);
    expect(matches.every((m) => m.vulnIds.includes('GHSA-1'))).toBe(true);
  });

  it('maps our ecosystem ids onto the OSV ecosystem names', async () => {
    const stub = stubFetch(() => ({ status: 200, body: { results: [{ vulns: [] }] } }));

    await queryBatch([
      { key: 'a', name: 'monolog/monolog', version: '2.9.1', ecosystem: 'composer' },
      { key: 'b', name: 'django', version: '3.2.0', ecosystem: 'pypi' },
      { key: 'c', name: 'serde', version: '1.0.0', ecosystem: 'crates' },
      { key: 'd', name: 'log4j-core', version: '2.14.1', ecosystem: 'maven' },
      { key: 'e', name: 'Newtonsoft.Json', version: '13.0.1', ecosystem: 'nuget' },
      { key: 'f', name: 'rack', version: '2.2.0', ecosystem: 'rubygems' },
    ] as never[]);

    expect(stub.bodies[0].queries.map((q: any) => q.package.ecosystem)).toEqual([
      'Packagist',
      'PyPI',
      'crates.io',
      'Maven',
      'NuGet',
      'RubyGems',
    ]);
  });

  it('retries a rate-limited batch with backoff instead of failing the scan', async () => {
    const stub = stubFetch((_body, call) =>
      call === 1
        ? { status: 429, body: {} }
        : { status: 200, body: { results: [{ vulns: [{ id: 'GHSA-2' }] }] } },
    );

    const matches = await queryBatch([
      { key: 'k', name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
    ] as never[]);

    expect(stub.count()).toBe(2);
    expect(matches[0]!.vulnIds).toEqual(['GHSA-2']);
  });

  it('isolates a poisoned query so one bad component cannot fail a whole repository', async () => {
    // OSV returns 400 for the entire batch if any single query is unacceptable.
    const stub = stubFetch((body) => {
      const bad = body.queries.some((q: any) => q.package.name === 'weird/pkg');
      return bad ? { status: 400, body: { code: 3, message: 'Invalid query' } } : { status: 200, body: { results: body.queries.map(() => ({ vulns: [{ id: 'GHSA-3' }] })) } };
    });

    const matches = await queryBatch([
      { key: 'good', name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
      { key: 'bad', name: 'weird/pkg', version: '1.0.0', ecosystem: 'npm', purl: 'pkg:npm/weird/pkg@1.0.0' },
    ] as never[]);

    const byKey = Object.fromEntries(matches.map((m) => [m.key, m.vulnIds]));
    expect(byKey['good']).toEqual(['GHSA-3']);
    expect(byKey['bad']).toEqual([]);
    expect(stub.count()).toBeGreaterThan(1);
  });

  it('returns an empty result set for no queries without calling the network', async () => {
    const stub = stubFetch(() => ({ status: 200, body: { results: [] } }));
    expect(await queryBatch([])).toEqual([]);
    expect(stub.count()).toBe(0);
  });
});
