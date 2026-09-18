import { describe, it, expect } from 'vitest';
import {
  buildCycloneDxJson,
  buildCycloneDxXml,
  componentsToSbomInput,
  vulnsToSbomInput,
  type SbomInput,
} from '../../src/sbom/cyclonedx.js';

/**
 * CycloneDX 1.6 export.
 *
 * The SBOM is a compliance artifact: it gets handed to customers and auditors.
 * These tests assert the parts that make it machine-verifiable — spec version,
 * serial number, purls, licence handling — so a downstream validator accepts it.
 */

const input: SbomInput = {
  productName: 'acme/demo-service',
  productVersion: 'main@abc1234',
  repositoryUrl: 'https://github.com/acme/demo-service',
  components: [
    {
      name: 'lodash',
      version: '4.17.21',
      ecosystem: 'npm',
      purl: 'pkg:npm/lodash@4.17.21',
      licenses: ['MIT'],
      scope: 'runtime',
      isDirect: true,
      manifestPath: 'package-lock.json',
    },
    {
      name: 'django',
      version: '3.2.0',
      ecosystem: 'pypi',
      purl: 'pkg:pypi/django@3.2.0',
      licenses: ['BSD-3-Clause'],
      scope: 'runtime',
      isDirect: true,
    },
    {
      name: 'eslint',
      version: '7.0.0',
      ecosystem: 'npm',
      purl: null,
      licenses: [],
      scope: 'development',
      isDirect: false,
    },
  ],
  vulnerabilities: [
    {
      id: 'CVE-2021-44228',
      summary: 'Remote code execution in Log4j',
      severity: 'critical',
      cvssScore: 9.8,
      cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      kevFlag: true,
      componentPurl: 'pkg:npm/lodash@4.17.21',
      fixedVersion: '4.17.22',
    },
  ],
  dependencies: [{ from: 'pkg:npm/lodash@4.17.21', to: 'pkg:pypi/django@3.2.0' }],
};

describe('buildCycloneDxJson', () => {
  const bom = buildCycloneDxJson(input) as Record<string, any>;

  it('declares CycloneDX 1.6 with a unique serial number', () => {
    expect(bom.bomFormat).toBe('CycloneDX');
    expect(bom.specVersion).toBe('1.6');
    expect(String(bom.serialNumber)).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(bom.version).toBe(1);
    expect(buildCycloneDxJson(input).serialNumber).not.toBe(bom.serialNumber);
  });

  it('names the product and records the CRA purpose in metadata', () => {
    expect(bom.metadata.component.type).toBe('application');
    expect(bom.metadata.component.name).toBe('acme/demo-service');
    expect(bom.metadata.component.version).toBe('main@abc1234');
    expect(bom.metadata.component.externalReferences[0]).toMatchObject({ type: 'vcs' });
    expect(bom.metadata.properties).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'cra:purpose' })]),
    );
    expect(bom.metadata.tools[0].name).toBe('CRA Compliance OS');
  });

  it('emits one component per dependency with a stable bom-ref', () => {
    expect(bom.components).toHaveLength(3);
    expect(bom.components[0]).toMatchObject({
      type: 'library',
      name: 'lodash',
      version: '4.17.21',
      purl: 'pkg:npm/lodash@4.17.21',
    });
    // Without a purl we still need a deterministic reference.
    expect(bom.components[2]['bom-ref']).toBe('npm:eslint@7.0.0');
  });

  it('uses SPDX ids for known licences and omits empty licence arrays', () => {
    expect(bom.components[0].licenses).toEqual([{ license: { id: 'MIT' } }]);
    expect(bom.components[2].licenses).toBeUndefined();
  });

  it('treats a free-text licence string as a name, not an SPDX id', () => {
    const custom = buildCycloneDxJson({
      ...input,
      components: [{ ...input.components[0]!, licenses: ['Apache License 2.0 custom fork'] }],
    }) as Record<string, any>;
    expect(custom.components[0].licenses).toEqual([
      { license: { name: 'Apache License 2.0 custom fork' } },
    ]);
  });

  it('tags each component with CRA-specific properties', () => {
    const props = bom.components[0].properties as Array<{ name: string; value: string }>;
    const byName = Object.fromEntries(props.map((p) => [p.name, p.value]));
    expect(byName['cra:ecosystem']).toBe('npm');
    expect(byName['cra:scope']).toBe('runtime');
    expect(byName['cra:isDirect']).toBe('true');
    expect(byName['cra:manifest']).toBe('package-lock.json');
  });

  it('embeds vulnerabilities with severity, KEV flag and the fix version', () => {
    const vuln = bom.vulnerabilities[0];
    expect(vuln.id).toBe('CVE-2021-44228');
    expect(vuln.ratings[0]).toMatchObject({ method: 'CVSSv31', score: 9.8, severity: 'CRITICAL' });
    expect(vuln.properties).toEqual([{ name: 'cra:knownExploited', value: 'true' }]);
    expect(vuln.recommendation).toMatch(/4\.17\.22/);
    expect(vuln.affects).toEqual([{ ref: 'pkg:npm/lodash@4.17.21' }]);
  });

  it('omits the vulnerabilities block entirely when there are none', () => {
    const clean = buildCycloneDxJson({ ...input, vulnerabilities: [] });
    expect(clean.vulnerabilities).toBeUndefined();
  });

  it('emits a dependency graph when one is known', () => {
    expect(bom.dependencies).toEqual([
      { ref: 'pkg:npm/lodash@4.17.21', dependsOn: ['pkg:pypi/django@3.2.0'] },
    ]);
  });

  it('handles an empty inventory without crashing', () => {
    const empty = buildCycloneDxJson({ productName: 'x', productVersion: '0', components: [] }) as Record<string, any>;
    expect(empty.components).toEqual([]);
    expect(empty.specVersion).toBe('1.6');
  });

  it('escapes characters that would break downstream XML or JSON consumers', () => {
    const tricky = buildCycloneDxJson({
      ...input,
      productName: 'a & b <script>"x"</script>',
      components: [{ ...input.components[0]!, name: 'weird & name' }],
    }) as Record<string, any>;
    // JSON keeps the raw value; the XML serializer is what must escape it.
    expect(tricky.metadata.component.name).toBe('a & b <script>"x"</script>');
    const xml = buildCycloneDxXml(tricky);
    expect(xml).not.toMatch(/<script>/);
    expect(xml).toContain('&amp;');
  });
});

describe('buildCycloneDxXml', () => {
  const xml = buildCycloneDxXml(buildCycloneDxJson(input));

  it('is well-formed and declares the 1.6 namespace', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://cyclonedx.org/schema/bom/1.6"');
    expect(xml.trimEnd().endsWith('</bom>')).toBe(true);
  });

  it('carries the serial number, timestamp and product component', () => {
    expect(xml).toContain('serialNumber="urn:uuid:');
    expect(xml).toMatch(/<timestamp>\d{4}-\d{2}-\d{2}T/);
    expect(xml).toContain('<name>acme/demo-service</name>');
  });

  it('emits purls and SPDX licence ids for every component', () => {
    expect(xml).toContain('<purl>pkg:npm/lodash@4.17.21</purl>');
    expect(xml).toContain('<id>MIT</id>');
    expect((xml.match(/<component type="library"/g) ?? []).length).toBe(3);
  });
});

describe('row converters', () => {
  it('maps persisted components into the SBOM shape', () => {
    const rows = [
      {
        name: 'left-pad',
        version: '1.3.0',
        ecosystem: 'npm',
        purl: 'pkg:npm/left-pad@1.3.0',
        licensesJson: '["MIT"]',
        scope: 'runtime' as const,
        isDirect: 1,
        manifestPath: 'package-lock.json',
      },
    ] as never[];
    const mapped = componentsToSbomInput(rows);
    expect(mapped[0]).toEqual({
      name: 'left-pad',
      version: '1.3.0',
      ecosystem: 'npm',
      purl: 'pkg:npm/left-pad@1.3.0',
      licenses: ['MIT'],
      scope: 'runtime',
      isDirect: true,
      manifestPath: 'package-lock.json',
    });
  });

  it('survives malformed licence JSON rather than failing the export', () => {
    const rows = [
      {
        name: 'broken',
        version: null,
        ecosystem: 'npm',
        purl: null,
        licensesJson: '{not json',
        scope: 'unknown' as const,
        isDirect: 0,
        manifestPath: null,
      },
    ] as never[];
    expect(componentsToSbomInput(rows)[0].licenses).toEqual([]);
  });

  it('links vulnerabilities to the component they affect', () => {
    const pairs = [
      {
        component: { purl: 'pkg:npm/lodash@4.17.21' },
        vulnerability: {
          sourceId: 'GHSA-x',
          summary: 'Prototype pollution',
          severity: 'high',
          cvssScore: 7.5,
          cvssVector: null,
          kevFlag: 0,
        },
        link: { fixedVersion: '4.17.22' },
      },
    ] as never[];
    const mapped = vulnsToSbomInput(pairs);
    expect(mapped[0]).toMatchObject({
      id: 'GHSA-x',
      severity: 'high',
      kevFlag: false,
      fixedVersion: '4.17.22',
      componentPurl: 'pkg:npm/lodash@4.17.21',
    });
  });
});
