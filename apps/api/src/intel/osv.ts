import { env } from '../env.js';
import { log } from '../core/logger.js';
import { OSV_ECOSYSTEM, earliestFix, versionInRange, type EcosystemId } from '../scan/purl.js';
import { cvssBaseScore, severityFromLabel, severityFromScore, type Severity } from './cvss.js';

/**
 * OSV.dev client.
 *
 * OSV is the right primary source for dependency vulnerabilities: it aggregates
 * GHSA, PYSEC, RUSTSEC, GO and the NVD CVE records into one schema, needs no
 * API key, has no meaningful rate limit for our volumes, and is the same data
 * `npm audit`, `pip-audit` and `cargo audit` use.
 *
 * Two-step strategy keeps request counts low:
 *   1. `POST /v1/querybatch` — batched matching, returns vulnerability ids only.
 *   2. `GET /v1/vulns/{id}` — hydrate details, but only for ids we have not
 *      already cached in the `vulnerabilities` table.
 */

export interface OsvQuery {
  name: string;
  version: string | null;
  ecosystem: EcosystemId;
  purl?: string;
  /** Original index so results can be mapped back to components. */
  key: string;
}

export interface OsvMatch {
  key: string;
  vulnIds: string[];
}

interface OsvBatchResponse {
  results?: Array<{ vulns?: Array<{ id: string; modified?: string }> }>;
}

const CHUNK = 100;
const MAX_ATTEMPTS = 4;

async function postJson<T>(url: string, body: unknown, attempt = 1): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'cra-compliance-os' },
    body: JSON.stringify(body),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt < MAX_ATTEMPTS) {
      const backoff = 500 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
      return postJson<T>(url, body, attempt + 1);
    }
    throw new Error(`OSV request failed after ${MAX_ATTEMPTS} attempts (${res.status})`);
  }

  if (!res.ok) {
    throw new Error(`OSV request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  return (await res.json()) as T;
}

async function getJson<T>(url: string, attempt = 1): Promise<T | null> {
  const res = await fetch(url, { headers: { 'User-Agent': 'cra-compliance-os' } });
  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      return getJson<T>(url, attempt + 1);
    }
    throw new Error(`OSV fetch failed after ${MAX_ATTEMPTS} attempts (${res.status})`);
  }
  if (!res.ok) throw new Error(`OSV fetch failed (${res.status})`);
  return (await res.json()) as T;
}

/** Components with no resolvable version cannot be matched — filter them out. */
export function buildQueries(components: OsvQuery[]): OsvQuery[] {
  return components.filter((c) => c.version && c.ecosystem !== 'docker' && c.ecosystem !== 'unknown');
}

const toOsvQuery = (q: OsvQuery) => ({
  package: { name: q.name, ecosystem: OSV_ECOSYSTEM[q.ecosystem] ?? q.ecosystem },
  version: q.version,
  ...(q.purl ? { purl: q.purl } : {}),
});

/** Identity of a dependency, independent of which component row asked for it. */
const coordinateKey = (q: OsvQuery): string => `${q.ecosystem}|${q.name}|${q.version}`;

export async function queryBatch(queries: OsvQuery[]): Promise<OsvMatch[]> {
  // A monorepo usually resolves to the same package version in several modules.
  // Grouping identical coordinates means one HTTP query per unique
  // (ecosystem, name, version) instead of one per component — cheaper, kinder to
  // OSV's rate limits, and much faster on large repositories. Results are fanned
  // back out afterwards so every component still gets its own entry.
  const groups = new Map<string, OsvQuery[]>();
  for (const query of queries) {
    const key = coordinateKey(query);
    const group = groups.get(key);
    if (group) group.push(query);
    else groups.set(key, [query]);
  }
  const unique = [...groups.values()].map((group) => group[0]!);

  const postOne = async (query: OsvQuery): Promise<string[]> => {
    const response = await postJson<OsvBatchResponse>(`${env.OSV_URL}/v1/querybatch`, {
      queries: [toOsvQuery(query)],
    });
    return ((response.results ?? [])[0]?.vulns ?? []).map((v) => v.id).filter(Boolean);
  };

  const postChunk = async (chunk: OsvQuery[]): Promise<OsvMatch[]> => {
    try {
      const response = await postJson<OsvBatchResponse>(`${env.OSV_URL}/v1/querybatch`, {
        queries: chunk.map(toOsvQuery),
      });
      const results = response.results ?? [];
      return chunk.map((query, index) => ({
        key: query.key,
        vulnIds: ((results[index]?.vulns ?? []) as Array<{ id?: string }>)
          .map((v) => v.id)
          .filter((id): id is string => Boolean(id)),
      }));
    } catch (err) {
      // A single unparseable query (a purl OSV rejects, an ecosystem it does not
      // index) returns 400 for the *whole* batch. Retrying one-by-one isolates
      // the offender so one bad component cannot fail an entire repository scan.
      log.warn('osv batch rejected, falling back to per-item queries', { error: String(err) });
      const perItem: OsvMatch[] = [];
      for (const query of chunk) {
        try {
          perItem.push({ key: query.key, vulnIds: await postOne(query) });
        } catch (singleErr) {
          log.warn('osv query skipped (unmatched component)', {
            name: query.name,
            ecosystem: query.ecosystem,
            error: String(singleErr),
          });
          perItem.push({ key: query.key, vulnIds: [] });
        }
      }
      return perItem;
    }
  };

  const uniqueMatches: OsvMatch[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    uniqueMatches.push(...(await postChunk(unique.slice(i, i + CHUNK))));
  }

  const matches: OsvMatch[] = [];
  uniqueMatches.forEach((match, index) => {
    const group = groups.get(coordinateKey(unique[index]!)) ?? [];
    for (const query of group) matches.push({ key: query.key, vulnIds: match.vulnIds });
  });
  return matches;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export interface NormalisedVulnerability {
  id: string;
  source: 'osv';
  sourceId: string;
  aliases: string[];
  summary: string | null;
  details: string | null;
  severity: Severity;
  cvssScore: number | null;
  cvssVector: string | null;
  cvssVersion: string | null;
  weaknesses: string[];
  references: Array<{ type?: string; url: string }>;
  affectedRanges: unknown;
  fixedVersions: string[];
  publishedAt: number | null;
  modifiedAt: number | null;
  withdrawnAt: number | null;
  raw: unknown;
}

interface OsvVulnDetail {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  withdrawn?: string;
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    package?: { name?: string; ecosystem?: string; purl?: string };
    ranges?: Array<{ type?: string; events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }> }>;
    versions?: string[];
    database_specific?: Record<string, unknown>;
  }>;
  database_specific?: Record<string, unknown>;
  references?: Array<{ type?: string; url?: string }>;
}

export function normaliseOsvVuln(raw: unknown): NormalisedVulnerability {
  const v = raw as OsvVulnDetail;

  let cvssVector: string | null = null;
  let cvssVersion: string | null = null;
  for (const entry of v.severity ?? []) {
    if (entry.type?.startsWith('CVSS_V3') && entry.score?.startsWith('CVSS:3')) {
      cvssVector = entry.score;
      cvssVersion = entry.type === 'CVSS_V3' ? '3.1' : '3.0';
      break;
    }
  }
  if (!cvssVector) {
    const v4 = (v.severity ?? []).find((s) => s.score?.startsWith('CVSS:4'));
    if (v4) cvssVector = v4.score;
  }

  const cvssScore = cvssVector ? cvssBaseScore(cvssVector) : null;

  const dbSeverity = (v.database_specific as { severity?: string } | undefined)?.severity;
  const affectedSeverity = (v.affected ?? [])
    .map((a) => (a.database_specific as { severity?: string } | undefined)?.severity)
    .find(Boolean);

  const severity: Severity =
    cvssScore !== null
      ? severityFromScore(cvssScore)
      : severityFromLabel(dbSeverity ?? affectedSeverity) ?? 'unknown';

  const fixedVersions = new Set<string>();
  for (const affected of v.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) fixedVersions.add(event.fixed);
      }
    }
  }

  const toMs = (value?: string): number | null => {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  };

  return {
    id: `osv:${v.id}`,
    source: 'osv',
    sourceId: v.id,
    aliases: v.aliases ?? [],
    summary: v.summary ?? null,
    details: v.details ?? null,
    severity,
    cvssScore,
    cvssVector,
    cvssVersion,
    weaknesses: ((v.database_specific as { cwe_ids?: string[] } | undefined)?.cwe_ids ?? []),
    references: (v.references ?? [])
      .filter((r) => Boolean(r.url))
      .map((r) => ({ type: r.type, url: r.url as string })),
    affectedRanges: v.affected ?? [],
    fixedVersions: [...fixedVersions],
    publishedAt: toMs(v.published),
    modifiedAt: toMs(v.modified),
    withdrawnAt: toMs(v.withdrawn),
    raw,
  };
}

export async function fetchVulnDetail(id: string): Promise<NormalisedVulnerability | null> {
  const raw = await getJson<unknown>(`${env.OSV_URL}/v1/vulns/${encodeURIComponent(id)}`);
  if (!raw) return null;
  return normaliseOsvVuln(raw);
}

/**
 * Confirms a vulnerability actually applies to the installed version.
 * OSV's batch endpoint can return near-miss records, so we validate the range
 * locally before reporting — this is what keeps false positives out.
 */
export function vulnAppliesTo(
  detail: NormalisedVulnerability,
  name: string,
  version: string,
  ecosystem: EcosystemId,
): boolean {
  const affected = (detail.affectedRanges as OsvVulnDetail['affected']) ?? [];
  const target = OSV_ECOSYSTEM[ecosystem] ?? ecosystem;

  for (const entry of affected) {
    const pkgEcosystem = entry.package?.ecosystem ?? '';
    const pkgName = entry.package?.name ?? '';
    if (pkgEcosystem && pkgEcosystem !== target) continue;
    if (pkgName && pkgName !== name) continue;

    // Explicit version list wins over ranges.
    if (entry.versions?.length) {
      if (entry.versions.includes(version)) return true;
      continue;
    }

    const ranges = entry.ranges ?? [];
    if (ranges.length === 0) return true; // advisory says "all versions"
    if (ranges.some((range) => versionInRange(version, range))) return true;
  }
  return false;
}

export function fixedVersionFor(
  detail: NormalisedVulnerability,
  name: string,
  version: string,
  ecosystem: EcosystemId,
): string | null {
  const affected = (detail.affectedRanges as OsvVulnDetail['affected']) ?? [];
  const target = OSV_ECOSYSTEM[ecosystem] ?? ecosystem;
  for (const entry of affected) {
    if (entry.package?.ecosystem && entry.package.ecosystem !== target) continue;
    if (entry.package?.name && entry.package.name !== name) continue;
    const fix = earliestFix(version, entry.ranges ?? []);
    if (fix) return fix;
  }
  return detail.fixedVersions.sort()[0] ?? null;
}
