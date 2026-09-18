/**
 * Package URL (purl) construction, ecosystem mapping and version comparison.
 *
 * purl is the canonical component identity used throughout the platform: it is
 * what we send to OSV, what we emit in the CycloneDX SBOM, and what we dedupe
 * on. Getting it right is the difference between real vulnerability matching
 * and noise.
 *
 * Spec: https://github.com/package-url/purl-spec
 */

export type EcosystemId =
  | 'npm'
  | 'pypi'
  | 'go'
  | 'crates'
  | 'maven'
  | 'composer'
  | 'nuget'
  | 'rubygems'
  | 'hex'
  | 'docker'
  | 'unknown';

/** Our ecosystem id -> OSV.dev ecosystem name. */
export const OSV_ECOSYSTEM: Record<EcosystemId, string> = {
  npm: 'npm',
  pypi: 'PyPI',
  go: 'Go',
  crates: 'crates.io',
  maven: 'Maven',
  // OSV indexes PHP packages under the Packagist ecosystem name.
  composer: 'Packagist',
  nuget: 'NuGet',
  rubygems: 'RubyGems',
  hex: 'Hex',
  docker: 'Debian', // container base images are matched via Debian/Alpine feeds
  unknown: 'unknown',
};

/** purl type for each ecosystem. */
export const PURL_TYPE: Record<EcosystemId, string> = {
  npm: 'npm',
  pypi: 'pypi',
  go: 'golang',
  crates: 'cargo',
  maven: 'maven',
  composer: 'composer',
  nuget: 'nuget',
  rubygems: 'gem',
  hex: 'hex',
  docker: 'docker',
  unknown: 'generic',
};

const PURL_ENCODE_SEGMENTS: Record<EcosystemId, boolean> = {
  npm: false,
  pypi: false,
  // Go module paths contain `/` (golang.org/x/crypto) and must NOT be
  // percent-encoded: OSV indexes Go modules by their unencoded path.
  go: true,
  crates: false,
  maven: false,
  composer: false,
  nuget: false,
  rubygems: false,
  hex: false,
  docker: false,
  unknown: false,
};

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/%3A/g, ':');
}

export interface PurlInput {
  ecosystem: EcosystemId;
  name: string;
  version?: string | null;
  group?: string | null;
}

/**
 * Builds a purl. Segment encoding is applied per-ecosystem because Go module
 * paths contain `/` and `@` (e.g. `golang.org/x/crypto`), while Maven group ids
 * are dot-separated and must survive as-is.
 */
export function buildPurl(input: PurlInput): string {
  const type = PURL_TYPE[input.ecosystem] ?? 'generic';
  const shouldEncode = !PURL_ENCODE_SEGMENTS[input.ecosystem];

  let namespace = input.group ? String(input.group).trim() : '';
  let name = String(input.name).trim();

  if (input.ecosystem === 'npm' && name.startsWith('@') && name.includes('/')) {
    const slash = name.indexOf('/');
    namespace = name.slice(0, slash);
    name = name.slice(slash + 1);
  }
  if (input.ecosystem === 'maven' && !namespace && name.includes(':')) {
    const colon = name.indexOf(':');
    namespace = name.slice(0, colon);
    name = name.slice(colon + 1);
  }
  if (input.ecosystem === 'composer' && !namespace && name.includes('/')) {
    // Composer packages are `vendor/package`: the vendor is the purl namespace,
    // and the separator must not be percent-encoded (`monolog/monolog`).
    const slash = name.indexOf('/');
    namespace = name.slice(0, slash);
    name = name.slice(slash + 1);
  }
  // Go module paths carry their own namespace (golang.org/x/crypto): the full
  // path is the purl name, never split or encoded.

  const ns = namespace ? `${shouldEncode ? encodeSegment(namespace) : namespace}/` : '';
  const nm = shouldEncode ? encodeSegment(name) : name;
  const version = input.version ? `@${encodeURIComponent(input.version)}` : '';

  return `pkg:${type}/${ns}${nm}${version}`;
}

export function parsePurl(purl: string): { type: string; namespace?: string; name: string; version?: string } | null {
  const match = /^pkg:([^/]+)\/(.+)$/.exec(purl);
  if (!match) return null;
  const [, type, rest] = match;
  const at = rest!.lastIndexOf('@');
  const version = at > -1 ? decodeURIComponent(rest!.slice(at + 1)) : undefined;
  const path = at > -1 ? rest!.slice(0, at) : rest!;
  const slash = path.lastIndexOf('/');
  const namespace = slash > -1 ? decodeURIComponent(path.slice(0, slash)) : undefined;
  const name = decodeURIComponent(slash > -1 ? path.slice(slash + 1) : path);
  return { type: type!, namespace, name, version };
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

export interface VersionParts {
  release: number[];
  pre: string[];
}

/** Parses semver, PEP 440-lite and Debian-ish versions into comparable parts. */
export function parseVersion(version: string): VersionParts {
  const cleaned = String(version ?? '')
    .trim()
    .replace(/^[vV^~>=<]+/, '')
    .replace(/^[=]+/, '');

  const [core = '', pre = ''] = cleaned.split(/[+-]/, 2);
  const release = core
    .split('.')
    .map((part) => parseInt(part.replace(/\D.*$/, ''), 10))
    .map((n) => (Number.isFinite(n) ? n : 0));

  // PEP 440 epochs and Debian revisions are handled by taking the numeric core.
  while (release.length < 3) release.push(0);

  return { release: release.slice(0, 4), pre: pre ? pre.split('.') : [] };
}

/** Returns -1, 0 or 1. Unknown/invalid versions sort lowest. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.release.length, pb.release.length);

  for (let i = 0; i < len; i += 1) {
    const na = pa.release[i] ?? 0;
    const nb = pb.release[i] ?? 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }

  // A pre-release sorts below the corresponding release.
  if (pa.pre.length && !pb.pre.length) return -1;
  if (!pa.pre.length && pb.pre.length) return 1;

  const preLen = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < preLen; i += 1) {
    const sa = pa.pre[i] ?? '';
    const sb = pb.pre[i] ?? '';
    if (sa === sb) continue;
    const na = parseInt(sa, 10);
    const nb = parseInt(sb, 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na < nb ? -1 : 1;
    return sa < sb ? -1 : 1;
  }
  return 0;
}

export type RangeType = 'SEMVER' | 'ECOSYSTEM' | 'GIT';

/**
 * Evaluates an OSV `affected[].ranges[]` entry against a concrete version.
 * Ranges are inclusive of `introduced`, exclusive of `fixed`.
 */
export function versionInRange(
  version: string,
  range: { type?: string; events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }> },
): boolean {
  if (!range.events?.length) return false;

  // Walk events in order, tracking whether we are currently inside the range.
  //
  // Two subtleties that matter for correctness:
  //   1. OSV uses `introduced: "0"` to mean "since the beginning of time", so it
  //      must open the range rather than be skipped.
  //   2. A range can re-open (vulnerable, patched, then reintroduced). Clearing
  //      the flag when a later `introduced` does not match would silently drop
  //      the earlier, still-affecting part of the range.
  let inRange = false;
  for (const event of range.events) {
    if (event.introduced !== undefined) {
      if (event.introduced === '0' || compareVersions(version, event.introduced) >= 0) {
        inRange = true;
      }
    }
    if (event.fixed !== undefined && compareVersions(version, event.fixed) >= 0) {
      inRange = false;
    }
    if (event.last_affected !== undefined && compareVersions(version, event.last_affected) > 0) {
      inRange = false;
    }
  }
  return inRange;
}

/** Chooses the lowest fixed version above the installed one, if any. */
export function earliestFix(
  version: string,
  ranges: Array<{ type?: string; events?: Array<{ introduced?: string; fixed?: string }> }> = [],
): string | null {
  const candidates: string[] = [];
  for (const range of ranges) {
    for (const event of range.events ?? []) {
      if (event.fixed && compareVersions(event.fixed, version) > 0) {
        candidates.push(event.fixed);
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates.sort(compareVersions)[0] ?? null;
}

export function ecosystemFromPurl(purl: string | null | undefined): EcosystemId {
  if (!purl) return 'unknown';
  const parsed = parsePurl(purl);
  if (!parsed) return 'unknown';
  const entry = Object.entries(PURL_TYPE).find(([, t]) => t === parsed.type);
  return (entry?.[0] as EcosystemId) ?? 'unknown';
}
