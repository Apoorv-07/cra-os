import { env } from '../env.js';
import { log } from '../core/logger.js';

/**
 * EPSS (Exploit Prediction Scoring System).
 *
 * EPSS answers "how likely is this to be exploited in the next 30 days?", which
 * is the missing half of a CVSS score (CVSS measures impact, not likelihood).
 * For CRA triage we use the pair: high CVSS = severe if exploited, high EPSS =
 * likely to be exploited. Sorting remediation by CVSS alone is how teams end up
 * patching unreachable code while leaving the exploited one open.
 */

export interface EpssScore {
  cve: string;
  epss: number;
  percentile: number;
  date: string;
}

const CHUNK = 60; // FIRST API allows a reasonably large `cve=` list per call.

export async function fetchEpss(cveIds: string[]): Promise<Map<string, EpssScore>> {
  const out = new Map<string, EpssScore>();
  if (cveIds.length === 0) return out;

  for (let i = 0; i < cveIds.length; i += CHUNK) {
    const chunk = cveIds.slice(i, i + CHUNK);
    const url = `${env.EPSS_URL}?cve=${chunk.map(encodeURIComponent).join(',')}`;

    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'cra-compliance-os' } });
      if (!res.ok) {
        log.warn('epss request failed', { status: res.status });
        continue;
      }
      const json = (await res.json()) as { data?: Array<{ cve: string; epss: string; percentile: string; date: string }> };
      for (const row of json.data ?? []) {
        out.set(row.cve, {
          cve: row.cve,
          epss: Number(row.epss) || 0,
          percentile: Number(row.percentile) || 0,
          date: row.date,
        });
      }
    } catch (err) {
      // EPSS is an enrichment signal: never fail a scan because it is down.
      log.warn('epss unavailable', { error: err instanceof Error ? err.message : String(err) });
      break;
    }
  }

  return out;
}

/** Human-readable exploitability band used in reports and the UI. */
export function epssBand(score: number | null | undefined): 'very_high' | 'high' | 'moderate' | 'low' | 'unknown' {
  if (score === null || score === undefined) return 'unknown';
  if (score >= 0.5) return 'very_high';
  if (score >= 0.1) return 'high';
  if (score >= 0.01) return 'moderate';
  return 'low';
}
