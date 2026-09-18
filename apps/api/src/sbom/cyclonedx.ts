import { randomUUID } from 'node:crypto';
import type { Component, Vulnerability, ComponentVulnerability } from '../db/schema.js';
import type { EcosystemId } from '../scan/purl.js';

/**
 * CycloneDX 1.6 generation.
 *
 * CycloneDX is the CRA-relevant SBOM format: it is the one referenced by the
 * EU technical work and the one that carries vulnerability data natively, so a
 * single artifact satisfies both the SBOM obligation and the evidence trail.
 */

export interface SbomComponentInput {
  name: string;
  version: string | null;
  ecosystem: EcosystemId;
  purl: string | null;
  licenses: string[];
  scope: 'runtime' | 'development' | 'unknown';
  isDirect: boolean;
  manifestPath?: string | null;
}

export interface SbomVulnerabilityInput {
  id: string;
  summary: string | null;
  severity: string;
  cvssScore: number | null;
  cvssVector: string | null;
  kevFlag: boolean;
  componentPurl: string | null;
  fixedVersion: string | null;
}

export interface SbomInput {
  productName: string;
  productVersion: string;
  repositoryUrl?: string | null;
  components: SbomComponentInput[];
  vulnerabilities?: SbomVulnerabilityInput[];
  dependencies?: Array<{ from: string; to: string }>;
}

const TOOL = { vendor: 'CRA Compliance OS', name: 'CRA Compliance OS', version: '1.0.0' };

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildCycloneDxJson(input: SbomInput): Record<string, unknown> {
  const serial = `urn:uuid:${randomUUID()}`;

  const components = input.components.map((c) => ({
    'bom-ref': c.purl ?? `${c.ecosystem}:${c.name}@${c.version ?? ''}`,
    type: 'library',
    name: c.name,
    ...(c.version ? { version: c.version } : {}),
    ...(c.purl ? { purl: c.purl } : {}),
    ...(c.licenses.length
      ? {
          licenses: c.licenses.map((license) => ({
            license: isSpdxLike(license) ? { id: license } : { name: license },
          })),
        }
      : {}),
    ...(c.manifestPath ? { evidence: { identity: { field: 'purl', confidence: 1 } } } : {}),
    properties: [
      { name: 'cra:ecosystem', value: c.ecosystem },
      { name: 'cra:scope', value: c.scope },
      { name: 'cra:isDirect', value: String(c.isDirect) },
      ...(c.manifestPath ? [{ name: 'cra:manifest', value: c.manifestPath }] : []),
    ],
  }));

  const vulnerabilities = (input.vulnerabilities ?? []).map((v, index) => ({
    'bom-ref': `vuln-${index}-${v.id}`,
    id: v.id,
    source: { name: 'OSV', url: 'https://osv.dev' },
    ...(v.summary ? { description: v.summary } : {}),
    ratings: [
      {
        ...(v.cvssScore !== null ? { score: v.cvssScore } : {}),
        severity: v.severity.toUpperCase(),
        method: v.cvssVector ? 'CVSSv31' : 'other',
        ...(v.cvssVector ? { vector: v.cvssVector } : {}),
      },
    ],
    ...(v.kevFlag
      ? { properties: [{ name: 'cra:knownExploited', value: 'true' }] }
      : {}),
    ...(v.fixedVersion ? { recommendation: `Upgrade to ${v.fixedVersion} or later.` } : {}),
    affects: v.componentPurl ? [{ ref: v.componentPurl }] : [],
  }));

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: serial,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [TOOL],
      component: {
        'bom-ref': `product-${input.productName}`,
        type: 'application',
        name: input.productName,
        version: input.productVersion,
        ...(input.repositoryUrl ? { externalReferences: [{ type: 'vcs', url: input.repositoryUrl }] } : {}),
      },
      properties: [
        { name: 'cra:generatedBy', value: 'CRA Compliance OS' },
        { name: 'cra:purpose', value: 'EU Cyber Resilience Act technical documentation (Annex I Part II)' },
      ],
    },
    components,
    ...(input.dependencies?.length
      ? {
          dependencies: input.dependencies.map((d) => ({ ref: d.from, dependsOn: [d.to] })),
        }
      : {}),
    ...(vulnerabilities.length ? { vulnerabilities } : {}),
  };
}

export function buildCycloneDxXml(json: Record<string, unknown>): string {
  const metadata = json.metadata as Record<string, any>;
  const components = (json.components as Array<Record<string, any>>) ?? [];

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<bom xmlns="http://cyclonedx.org/schema/bom/1.6" serialNumber="${escapeXml(String(json.serialNumber))}" version="1">`,
  );
  lines.push('  <metadata>');
  lines.push(`    <timestamp>${escapeXml(String(metadata.timestamp))}</timestamp>`);
  lines.push('    <tools>');
  lines.push(`      <vendor>${escapeXml(TOOL.vendor)}</vendor><name>${escapeXml(TOOL.name)}</name><version>${escapeXml(TOOL.version)}</version>`);
  lines.push('    </tools>');
  lines.push('    <component type="application">');
  lines.push(`      <name>${escapeXml(String(metadata.component.name))}</name>`);
  lines.push(`      <version>${escapeXml(String(metadata.component.version))}</version>`);
  lines.push('    </component>');
  lines.push('  </metadata>');
  lines.push('  <components>');

  for (const c of components) {
    lines.push(`    <component type="library" bom-ref="${escapeXml(String(c['bom-ref']))}">`);
    lines.push(`      <name>${escapeXml(String(c.name))}</name>`);
    if (c.version) lines.push(`      <version>${escapeXml(String(c.version))}</version>`);
    if (c.purl) lines.push(`      <purl>${escapeXml(String(c.purl))}</purl>`);
    for (const license of (c.licenses ?? []) as Array<{ license: Record<string, string> }>) {
      const id = license.license.id;
      const name = license.license.name;
      if (id) lines.push(`      <licenses><license><id>${escapeXml(id)}</id></license></licenses>`);
      else if (name) lines.push(`      <licenses><license><name>${escapeXml(name)}</name></license></licenses>`);
    }
    lines.push('    </component>');
  }

  lines.push('  </components>');
  lines.push('</bom>');
  return lines.join('\n');
}

function isSpdxLike(license: string): boolean {
  // SPDX ids are short, alphanumeric with dots/dashes and no spaces.
  return /^[A-Za-z0-9.+-]{2,40}$/.test(license) && !license.includes(' ');
}

/** Converts persisted rows into the SBOM component shape. */
export function componentsToSbomInput(components: Component[]): SbomComponentInput[] {
  return components.map((c) => ({
    name: c.name,
    version: c.version,
    ecosystem: c.ecosystem as EcosystemId,
    purl: c.purl,
    licenses: safeParseArray(c.licensesJson),
    scope: c.scope,
    isDirect: Boolean(c.isDirect),
    manifestPath: c.manifestPath,
  }));
}

export function vulnsToSbomInput(
  pairs: Array<{ component: Component; vulnerability: Vulnerability; link: ComponentVulnerability }>,
): SbomVulnerabilityInput[] {
  return pairs.map(({ component, vulnerability, link }) => ({
    id: vulnerability.sourceId,
    summary: vulnerability.summary,
    severity: vulnerability.severity,
    cvssScore: vulnerability.cvssScore,
    cvssVector: vulnerability.cvssVector,
    kevFlag: Boolean(vulnerability.kevFlag),
    componentPurl: component.purl,
    fixedVersion: link.fixedVersion,
  }));
}

function safeParseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
