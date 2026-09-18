/**
 * CVSS v3.x base score calculation.
 *
 * Advisory feeds frequently publish a vector string but no numeric score. We
 * compute the base score ourselves so severity is a real, reproducible number
 * rather than a label the vendor happened to attach.
 *
 * Implements the CVSS v3.1 specification:
 * https://www.first.org/cvss/specification-document
 */

export interface CvssVector {
  version: '3.0' | '3.1';
  attackVector: string;
  attackComplexity: string;
  privilegesRequired: string;
  userInteraction: string;
  scope: string;
  confidentiality: string;
  integrity: string;
  availability: string;
}

const W_AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const W_AC: Record<string, number> = { L: 0.77, H: 0.44 };
const W_PR_U: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const W_PR_C: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
const W_UI: Record<string, number> = { N: 0.85, R: 0.62 };
const W_CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

export function parseCvssVector(vector: string): CvssVector | null {
  if (!vector || !vector.startsWith('CVSS:')) return null;
  const parts = vector.split('/');
  const version = parts[0]!.replace('CVSS:', '');
  if (version !== '3.0' && version !== '3.1') return null;

  const map: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const [key, value] = part.split(':');
    if (key && value) map[key.toUpperCase()] = value.toUpperCase();
  }

  if (!map.AV || !map.AC || !map.PR || !map.UI || !map.S || !map.C || !map.I || !map.A) return null;

  return {
    version: version as '3.0' | '3.1',
    attackVector: map.AV,
    attackComplexity: map.AC,
    privilegesRequired: map.PR,
    userInteraction: map.UI,
    scope: map.S,
    confidentiality: map.C,
    integrity: map.I,
    availability: map.A,
  };
}

/** CVSS 3.1 "round up" definition: round to 1 decimal, always away from zero. */
function roundUp(input: number): number {
  const intInput = Math.round(input * 100000);
  if (intInput % 10000 === 0) return intInput / 100000;
  return (Math.floor(intInput / 10000) + 1) / 10;
}

export function cvssBaseScore(vector: string): number | null {
  const v = parseCvssVector(vector);
  if (!v) return null;

  const scopeChanged = v.scope === 'C';
  const iss =
    1 -
    (1 - (W_CIA[v.confidentiality] ?? 0)) *
      (1 - (W_CIA[v.integrity] ?? 0)) *
      (1 - (W_CIA[v.availability] ?? 0));

  let impact: number;
  if (scopeChanged) {
    impact = 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  } else {
    impact = 6.42 * iss;
  }

  const exploitability =
    8.22 *
    (W_AV[v.attackVector] ?? 0) *
    (W_AC[v.attackComplexity] ?? 0) *
    ((scopeChanged ? W_PR_C : W_PR_U)[v.privilegesRequired] ?? 0) *
    (W_UI[v.userInteraction] ?? 0);

  if (impact <= 0) return 0;

  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);

  return roundUp(raw);
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export function severityFromScore(score: number | null | undefined): Severity {
  if (score === null || score === undefined || Number.isNaN(score)) return 'unknown';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'unknown';
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER[s] ?? 0;
}

const LABELS: Record<string, Severity> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'medium',
  MEDIUM: 'medium',
  LOW: 'low',
};

export function severityFromLabel(label: string | null | undefined): Severity | null {
  if (!label) return null;
  return LABELS[label.toUpperCase()] ?? null;
}
