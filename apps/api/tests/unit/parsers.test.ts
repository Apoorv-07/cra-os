import { describe, it, expect } from 'vitest';
import {
  parseNpmLock,
  parseRequirements,
  parseGoMod,
  parseGoSum,
  parseComposerLock,
  parseCargoLock,
  parsePyproject,
  parsePackageJsonInventory,
  parseComposerJsonInventory,
  parseCargoTomlInventory,
  versionFromRange,
} from '../../src/scan/parsers.js';

const ctx = (path: string, directNames: Set<string> = new Set<string>()) => ({ path, directNames });

describe('npm lockfile v3', () => {
  const json = JSON.stringify({
    name: 'demo',
    lockfileVersion: 3,
    packages: {
      '': { name: 'demo' },
      'node_modules/lodash': { version: '4.17.21', dev: false },
      'node_modules/minimist': { version: '1.2.5', dev: false },
      'node_modules/eslint': { version: '7.0.0', dev: true },
      'node_modules/@babel/core': { version: '7.22.0' },
    },
  });

  it('extracts runtime and development packages', () => {
    const components = parseNpmLock(
      json,
      ctx('package-lock.json', new Set(['lodash'])),
    );
    const lodash = components.find((c) => c.name === 'lodash');
    expect(lodash?.version).toBe('4.17.21');
    expect(lodash?.scope).toBe('runtime');
    // Direct-ness comes from the package.json dependency list, not the lockfile.
    expect(lodash?.isDirect).toBe(true);
    expect(components.find((c) => c.name === 'minimist')?.isDirect).toBe(false);

    const eslint = components.find((c) => c.name === 'eslint');
    expect(eslint?.scope).toBe('development');
  });

  it('keeps scoped names intact', () => {
    const components = parseNpmLock(json, ctx('package-lock.json'));
    const babel = components.find((c) => c.name === '@babel/core');
    expect(babel?.purl).toBe('pkg:npm/%40babel/core@7.22.0');
  });

  it('skips the root package', () => {
    const components = parseNpmLock(json, ctx('package-lock.json'));
    expect(components.every((c) => c.name !== 'demo')).toBe(true);
  });
});

describe('requirements.txt', () => {
  it('parses pinned versions with markers and comments', () => {
    const text = ['# comment', 'django==3.2.0', 'requests==2.20.0  # indirect', 'flask>=1.0,<2.0', '', '-r other.txt'].join('\n');
    const components = parseRequirements(text, ctx('requirements.txt'));
    expect(components.map((c) => [c.name, c.version])).toEqual(
      expect.arrayContaining([
        ['django', '3.2.0'],
        ['requests', '2.20.0'],
        ['flask', '1.0'],
      ]),
    );
    expect(components.every((c) => c.ecosystem === 'pypi')).toBe(true);
  });
});

describe('go.mod', () => {
  it('parses single requires and blocks', () => {
    const text = [
      'module example.com/demo',
      '',
      'go 1.21',
      '',
      'require golang.org/x/crypto v0.1.0',
      '',
      'require (',
      '\tgithub.com/pkg/errors v0.9.1',
      '\tgithub.com/sirupsen/logrus v1.9.3 // indirect',
      ')',
    ].join('\n');

    const components = parseGoMod(text, ctx('go.mod'));
    const crypto = components.find((c) => c.name.includes('crypto'));
    expect(crypto?.version).toBe('v0.1.0');
    expect(crypto?.scope).toBe('runtime');
    // `// indirect` marks a transitive dependency; it is still shipped in the
    // binary, so it stays in the runtime scope for CRA purposes.
    expect(components.find((c) => c.name.includes('logrus'))?.isDirect).toBe(false);
    expect(components.find((c) => c.name.includes('logrus'))?.scope).toBe('runtime');
    expect(components.every((c) => c.ecosystem === 'go')).toBe(true);
  });
});

describe('go.sum', () => {
  const text = [
    'github.com/pkg/errors v0.9.1 h1:FEBLx1pKExVjN4Zb7Z4k4n1mVCvEGUuJqYQ1Q==',
    'github.com/pkg/errors v0.9.1/go.mod h1:bwawxfHBFNV+L2hUp1rHADufV3IMtnDRdf1r5NINEI0=',
    'golang.org/x/crypto v0.1.0 h1:M7eJptF7d/9sRbF2tBvR6HGUEqAqQCWTDM7Z6HfAqEo=',
    'golang.org/x/crypto v0.1.0/go.mod h1:L0i1abWzNxDFRDVfRsMzHfEjE1kKM1bbEz8wKui2KzY=',
    '',
  ].join('\n');

  it('emits one component per module, ignoring /go.mod graph lines', () => {
    const components = parseGoSum(text, ctx('go.sum'));
    expect(components.map((c) => c.name).sort()).toEqual(['github.com/pkg/errors', 'golang.org/x/crypto']);
    expect(components.every((c) => c.ecosystem === 'go')).toBe(true);
    expect(components.every((c) => c.isDirect === false)).toBe(true);
  });
});

describe('composer.lock', () => {
  it('parses packages and dev packages', () => {
    const json = JSON.stringify({
      packages: [{ name: 'monolog/monolog', version: '2.9.1' }],
      'packages-dev': [{ name: 'phpunit/phpunit', version: '9.6.0' }],
    });
    const components = parseComposerLock(json, ctx('composer.lock'));
    expect(components.find((c) => c.name === 'monolog/monolog')?.scope).toBe('runtime');
    expect(components.find((c) => c.name === 'phpunit/phpunit')?.scope).toBe('development');
  });
});

describe('Cargo.lock', () => {
  it('parses v3 lockfiles', () => {
    const text = ['version = 3', '', '[[package]]', 'name = "serde"', 'version = "1.0.188"'].join('\n');
    const components = parseCargoLock(text, ctx('Cargo.lock'));
    expect(components.find((c) => c.name === 'serde')?.version).toBe('1.0.188');
  });
});

describe('pyproject.toml', () => {
  it('reads PEP 621 dependencies', () => {
    const text = ['[project]', 'name = "demo"', 'dependencies = ["django>=3.2", "requests==2.31.0"]'].join('\n');
    const result = parsePyproject(text);
    expect([...result.direct].sort()).toEqual(['django', 'requests']);
  });
});

describe('manifest-only fallback parsers', () => {
  it('reads package.json dependencies with ranges reduced to a version', () => {
    const json = JSON.stringify({
      dependencies: { lodash: '^4.17.15', axios: '0.21.1', 'internal-lib': 'file:../internal' },
      devDependencies: { eslint: '^7.0.0' },
    });
    const components = parsePackageJsonInventory(json, ctx('package.json'));
    expect(components.find((c) => c.name === 'lodash')?.version).toBe('4.17.15');
    expect(components.find((c) => c.name === 'axios')?.version).toBe('0.21.1');
    expect(components.find((c) => c.name === 'eslint')?.scope).toBe('development');
    // Non-registry specs yield no resolvable version rather than a wrong one.
    expect(components.find((c) => c.name === 'internal-lib')?.version).toBeNull();
  });

  it('reads composer.json requirements', () => {
    const json = JSON.stringify({ require: { 'monolog/monolog': '^2.0' }, 'require-dev': { phpunit: '^9' } });
    const components = parseComposerJsonInventory(json, ctx('composer.json'));
    expect(components.find((c) => c.name === 'monolog/monolog')?.version).toBe('2.0');
    expect(components.find((c) => c.name === 'phpunit')?.scope).toBe('development');
  });

  it('reads Cargo.toml dependencies', () => {
    const text = ['[dependencies]', 'serde = "1.0.188"', '', '[dev-dependencies]', 'tempfile = "3.0"'].join('\n');
    const components = parseCargoTomlInventory(text, ctx('Cargo.toml'));
    expect(components.find((c) => c.name === 'serde')?.version).toBe('1.0.188');
    expect(components.find((c) => c.name === 'tempfile')?.scope).toBe('development');
  });
});

describe('versionFromRange', () => {
  it.each([
    ['^4.17.15', '4.17.15'],
    ['~1.2.3', '1.2.3'],
    ['>=1.2.3', '1.2.3'],
    ['1.2.3', '1.2.3'],
    ['v2.0.0', '2.0.0'],
    ['^1.0.0 || ^2.0.0', '1.0.0'],
    ['>=1.2.0 <2.0.0', '1.2.0'],
  ])('reduces %s to %s', (range, expected) => {
    expect(versionFromRange(range)).toBe(expected);
  });

  it.each(['*', 'latest', '1.2.x', 'workspace:*', 'file:../x', 'git+https://github.com/a/b.git', ''])(
    'returns null for unresolvable spec %s',
    (range) => {
      expect(versionFromRange(range)).toBeNull();
    },
  );
});
