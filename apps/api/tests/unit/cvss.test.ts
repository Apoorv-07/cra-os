import { describe, it, expect } from 'vitest';
import { cvssBaseScore, severityFromScore, severityFromLabel } from '../../src/intel/cvss.js';

/**
 * CVSS v3.1 base scores.
 *
 * The vectors below are the official reference examples and well-known CVEs, so
 * a regression here means our scoring silently changed — which would change
 * every remediation priority in the product.
 */
describe('cvssBaseScore', () => {
  it('scores Log4Shell at 9.8 (critical)', () => {
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
  });

  it('applies the scope-changed multiplier', () => {
    // Reference value from the CVSS v3.1 specification examples.
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:L')).toBe(8.3);
  });

  it('scores a local, high-complexity vector low', () => {
    expect(cvssBaseScore('CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N')).toBeCloseTo(1.8, 1);
  });

  it('scores a medium example at 5.4', () => {
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:L')).toBeCloseTo(5.4, 1);
  });

  it('returns null for an unusable vector', () => {
    expect(cvssBaseScore('not-a-vector')).toBeNull();
    expect(cvssBaseScore(null)).toBeNull();
  });

  it('is monotone: more impact never lowers the score', () => {
    const low = cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N') ?? 0;
    const high = cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H') ?? 0;
    expect(high).toBeGreaterThan(low);
  });
});

describe('severityFromScore', () => {
  it('bands scores as documented', () => {
    expect(severityFromScore(9.5)).toBe('critical');
    expect(severityFromScore(8.0)).toBe('high');
    expect(severityFromScore(5.0)).toBe('medium');
    expect(severityFromScore(2.0)).toBe('low');
  });

  it('does not invent a band for a zero or missing score', () => {
    // 0.0 means "no impact scored", which is different from "we do not know".
    // Both surface as `unknown` so the UI never overstates a finding.
    expect(severityFromScore(0)).toBe('unknown');
    expect(severityFromScore(null)).toBe('unknown');
  });

  it('returns unknown for null', () => {
    expect(severityFromScore(null)).toBe('unknown');
  });
});

describe('severityFromLabel', () => {
  it('normalises advisory labels', () => {
    expect(severityFromLabel('CRITICAL')).toBe('critical');
    expect(severityFromLabel('High')).toBe('high');
    expect(severityFromLabel('MODERATE')).toBe('medium');
    expect(severityFromLabel('low')).toBe('low');
  });

  it('falls back to null rather than guessing', () => {
    // Callers combine this with severityFromScore(), so an unrecognised label
    // must be distinguishable rather than silently becoming a severity.
    expect(severityFromLabel('severe-ish')).toBeNull();
    expect(severityFromLabel(null)).toBeNull();
    expect(severityFromLabel(undefined)).toBeNull();
  });
});
