import { describe, it, expect } from 'vitest';
import {buildPurl, parsePurl, versionInRange, earliestFix} from '../../src/scan/purl.js';

describe('buildPurl', () => {
  it('builds a plain npm purl', () => {
    expect(buildPurl({ ecosystem: 'npm', name: 'lodash', version: '4.17.21' })).toBe('pkg:npm/lodash@4.17.21');
  });

  it('splits scoped npm packages into namespace and name', () => {
    expect(buildPurl({ ecosystem: 'npm', name: '@babel/core', version: '7.0.0' })).toBe('pkg:npm/%40babel/core@7.0.0');
  });

  it('does not percent-encode Go module paths (OSV indexes them unencoded)', () => {
    expect(buildPurl({ ecosystem: 'go', name: 'golang.org/x/crypto', version: 'v0.1.0' })).toBe(
      'pkg:golang/golang.org/x/crypto@v0.1.0',
    );
  });

  it('splits Composer vendor/package into namespace and name', () => {
    expect(buildPurl({ ecosystem: 'composer', name: 'monolog/monolog', version: '2.9.1' })).toBe(
      'pkg:composer/monolog/monolog@2.9.1',
    );
  });

  it('leaves Maven dotted group ids intact', () => {
    expect(buildPurl({ ecosystem: 'maven', name: 'org.apache.logging.log4j:log4j-core', version: '2.14.1' })).toBe(
      'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1',
    );
  });

  it('encodes the version segment', () => {
    expect(buildPurl({ ecosystem: 'pypi', name: 'django', version: '3.2.0' })).toBe('pkg:pypi/django@3.2.0');
  });

  it('omits the version when none is known', () => {
    expect(buildPurl({ ecosystem: 'npm', name: 'left-pad' })).toBe('pkg:npm/left-pad');
  });
});

describe('parsePurl', () => {
  it('round-trips a simple purl', () => {
    const parsed = parsePurl('pkg:npm/lodash@4.17.21');
    expect(parsed).toMatchObject({ type: 'npm', name: 'lodash', version: '4.17.21' });
  });

  it('round-trips a Go purl; parsePurl keeps the module path as namespace + name', () => {
    const purl = buildPurl({ ecosystem: 'go', name: 'golang.org/x/crypto', version: 'v0.1.0' });
    expect(purl).toBe('pkg:golang/golang.org/x/crypto@v0.1.0');
    const parsed = parsePurl(purl)!;
    expect(parsed.type).toBe('golang');
    expect(parsed.version).toBe('v0.1.0');
    // parsePurl is purl-spec compliant: everything before the last '/' is a namespace.
    expect(parsed.namespace ? `${parsed.namespace}/${parsed.name}` : parsed.name).toBe(
      'golang.org/x/crypto',
    );
  });
});

describe('versionInRange', () => {
  const ev = (events: Array<Record<string, string>>) => ({ type: 'SEMVER', events });

  it('is false outside the range', () => {
    expect(versionInRange('1.2.3', ev([{ introduced: '1.0.0', fixed: '2.0.0' }]))).toBe(true);
    expect(versionInRange('0.9.0', ev([{ introduced: '1.0.0', fixed: '2.0.0' }]))).toBe(false);
    expect(versionInRange('2.0.0', ev([{ introduced: '1.0.0', fixed: '2.0.0' }]))).toBe(false);
  });

  it('treats introduced "0" as unbounded below (OSV convention)', () => {
    expect(versionInRange('0.1.0', ev([{ introduced: '0', fixed: '1.0.0' }]))).toBe(true);
  });

  it('requires at least one event', () => {
    expect(versionInRange('1.0.0', { type: 'SEMVER', events: [] })).toBe(false);
    expect(versionInRange('1.0.0', { type: 'SEMVER' })).toBe(false);
  });

  it('handles last_affected as an inclusive bound', () => {
    expect(versionInRange('1.5.0', ev([{ introduced: '0', last_affected: '1.5.0' }]))).toBe(true);
    expect(versionInRange('1.5.1', ev([{ introduced: '0', last_affected: '1.5.0' }]))).toBe(false);
  });

  it('honours re-introduction: a fixed range can re-open later', () => {
    // Vulnerable 1.0–2.0, patched, then reintroduced in 3.0–3.5.
    const range = ev([
      { introduced: '1.0.0', fixed: '2.0.0' },
      { introduced: '3.0.0', fixed: '3.5.0' },
    ]);
    expect(versionInRange('1.5.0', range)).toBe(true);
    expect(versionInRange('2.5.0', range)).toBe(false);
    expect(versionInRange('3.1.0', range)).toBe(true);
    expect(versionInRange('4.0.0', range)).toBe(false);
  });

  it('handles Go pseudo-versions', () => {
    expect(
      versionInRange('v0.0.0-20200323165209-0ec3e9974c59', ev([{ introduced: '0', fixed: 'v0.0.0-20200401000000-000000000000' }])),
    ).toBe(true);
    expect(
      versionInRange('v0.0.0-20200615165409-0ec3e9974c59', ev([{ introduced: '0', fixed: 'v0.0.0-20200401000000-000000000000' }])),
    ).toBe(false);
  });
});

describe('earliestFix', () => {
  it('returns the lowest fix above the installed version', () => {
    const ranges = [
      { events: [{ introduced: '0', fixed: '2.0.0' }] },
      { events: [{ introduced: '0', fixed: '1.5.0' }] },
      { events: [{ introduced: '0', fixed: '1.4.1' }] },
    ];
    expect(earliestFix('1.0.0', ranges)).toBe('1.4.1');
  });

  it('ignores fixes that are not above the installed version', () => {
    expect(earliestFix('2.0.0', [{ events: [{ introduced: '0', fixed: '1.5.0' }] }])).toBeNull();
  });

  it('returns null when nothing is fixed', () => {
    expect(earliestFix('1.0.0', [{ events: [{ introduced: '0' }] }])).toBeNull();
    expect(earliestFix('1.0.0')).toBeNull();
  });

  it('compares semver, not strings', () => {
    // "10.0.0" sorts before "9.0.0" as a string but is correctly higher as semver.
    const ranges = [{ events: [{ fixed: '10.0.0' }] }, { events: [{ fixed: '9.0.0' }] }];
    expect(earliestFix('1.0.0', ranges)).toBe('9.0.0');
  });
});
