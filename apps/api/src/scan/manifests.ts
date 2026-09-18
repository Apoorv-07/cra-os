import type { EcosystemId } from './purl.js';
import {
  parseCargoLock,
  parseCargoToml,
  parseComposerJson,
  parseComposerLock,
  parseCsproj,
  parseDockerfile,
  parseGemfileLock,
  parseGoMod,
  parseGoSum,
  parseGradle,
  parseNpmLock,
  parsePackageJson,
  parsePackageJsonInventory,
  parseComposerJsonInventory,
  parsePyprojectInventory,
  parseCargoTomlInventory,
  parsePackagesLockJson,
  parsePnpmLock,
  parsePomXml,
  parsePoetryLock,
  parsePyproject,
  parseRequirements,
  parseYarnLock,
  type ParsedComponent,
} from './parsers.js';

/**
 * Manifest detection and repository artefact collection.
 *
 * A scan reads two classes of file:
 *  1. **Dependency manifests** — turned into the component inventory / SBOM.
 *  2. **Policy artefacts** — SECURITY.md, Dependabot/Renovate config, CI
 *     workflows, threat models. These are what let the CRA engine evaluate
 *     *attested* controls from real evidence instead of asking the user to
 *     tick boxes.
 */

export interface ManifestRule {
  id: string;
  ecosystem: EcosystemId;
  /** Higher priority = preferred source of truth when several match. */
  priority: number;
  /** Lockfiles pin exact versions; manifests only declare ranges. */
  isLockfile: boolean;
  matches: (path: string) => boolean;
  parse: (content: string, ctx: { path: string; directNames?: Set<string> }) => ParsedComponent[];
}

const depth = (p: string): number => p.split('/').length - 1;

/** Skips vendored, generated and dependency directories. */
function isRelevantPath(path: string): boolean {
  if (depth(path) > 6) return false;
  const blocked = [
    'node_modules/', 'vendor/', 'dist/', 'build/', 'target/', '.git/', 'site-packages/',
    '.venv/', 'venv/', '__pycache__/', 'bin/', 'obj/', '.terraform/', 'coverage/',
    '.next/', '.nuxt/', 'out/', 'Pods/', 'packages/*/node_modules/',
  ];
  return !blocked.some((b) => path.includes(b));
}

const filename = (p: string): string => p.split('/').pop() ?? '';

export const MANIFEST_RULES: ManifestRule[] = [
  {
    id: 'npm-package-lock',
    ecosystem: 'npm',
    priority: 100,
    isLockfile: true,
    matches: (p) => filename(p) === 'package-lock.json',
    parse: (content, ctx) => parseNpmLock(content, ctx),
  },
  {
    id: 'npm-yarn-lock',
    ecosystem: 'npm',
    priority: 90,
    isLockfile: true,
    matches: (p) => filename(p) === 'yarn.lock',
    parse: (content, ctx) => parseYarnLock(content, ctx),
  },
  {
    id: 'npm-pnpm-lock',
    ecosystem: 'npm',
    priority: 90,
    isLockfile: true,
    matches: (p) => filename(p) === 'pnpm-lock.yaml',
    parse: (content, ctx) => parsePnpmLock(content, ctx),
  },
  {
    id: 'python-poetry-lock',
    ecosystem: 'pypi',
    priority: 100,
    isLockfile: true,
    matches: (p) => filename(p) === 'poetry.lock',
    parse: (content, ctx) => parsePoetryLock(content, ctx),
  },
  {
    id: 'python-requirements',
    ecosystem: 'pypi',
    priority: 70,
    isLockfile: false,
    matches: (p) => /^requirements.*\.txt$/.test(filename(p)),
    parse: (content, ctx) => parseRequirements(content, ctx),
  },
  {
    id: 'go-mod',
    ecosystem: 'go',
    priority: 100,
    isLockfile: true,
    matches: (p) => filename(p) === 'go.mod',
    parse: (content, ctx) => parseGoMod(content, ctx),
  },
  {
    id: 'go-sum',
    ecosystem: 'go',
    priority: 40,
    isLockfile: true,
    matches: (p) => filename(p) === 'go.sum',
    parse: (content, ctx) => parseGoSum(content, ctx),
  },
  {
    id: 'rust-cargo-lock',
    ecosystem: 'crates',
    priority: 100,
    isLockfile: true,
    matches: (p) => filename(p) === 'Cargo.lock',
    parse: (content, ctx) => parseCargoLock(content, ctx),
  },
  {
    id: 'php-composer-lock',
    ecosystem: 'composer',
    priority: 100,
    isLockfile: true,
    matches: (p) => filename(p) === 'composer.lock',
    parse: (content, ctx) => parseComposerLock(content, ctx),
  },
  {
    id: 'java-pom',
    ecosystem: 'maven',
    priority: 80,
    isLockfile: false,
    matches: (p) => filename(p) === 'pom.xml',
    parse: (content, ctx) => parsePomXml(content, ctx),
  },
  {
    id: 'java-gradle',
    ecosystem: 'maven',
    priority: 60,
    isLockfile: false,
    matches: (p) => /^build\.gradle(\.kts)?$/.test(filename(p)),
    parse: (content, ctx) => parseGradle(content, ctx),
  },
  {
    id: 'dotnet-packages-lock',
    ecosystem: 'nuget',
    priority: 100,
    isLockfile: true,
    matches: (p) => filename(p) === 'packages.lock.json',
    parse: (content, ctx) => parsePackagesLockJson(content, ctx),
  },
  {
    id: 'dotnet-csproj',
    ecosystem: 'nuget',
    priority: 60,
    isLockfile: false,
    matches: (p) => p.endsWith('.csproj') || p.endsWith('.fsproj'),
    parse: (content, ctx) => parseCsproj(content, ctx),
  },
  {
    id: 'ruby-gemfile-lock',
    ecosystem: 'rubygems',
    priority: 100,
    isLockfile: true,
    matches: (p) => filename(p) === 'Gemfile.lock',
    parse: (content, ctx) => parseGemfileLock(content, ctx),
  },
  {
    id: 'container-dockerfile',
    ecosystem: 'docker',
    priority: 30,
    isLockfile: false,
    matches: (p) => /^Dockerfile/i.test(filename(p)) || p.endsWith('.dockerfile'),
    parse: (content, ctx) => parseDockerfile(content, ctx),
  },
];

/**
 * Manifests that only declare direct dependencies. They are read to compute
 * `isDirect` on the inventory, not to build the inventory itself.
 */
const DECLARATION_FILES: Array<{ matches: (p: string) => boolean; parse: (c: string) => { direct: Set<string>; licenses: Record<string, string[]> } }> = [
  { matches: (p) => filename(p) === 'package.json' && depth(p) <= 2, parse: parsePackageJson },
  { matches: (p) => filename(p) === 'pyproject.toml' && depth(p) <= 2, parse: parsePyproject },
  { matches: (p) => filename(p) === 'Cargo.toml' && depth(p) <= 2, parse: parseCargoToml },
  { matches: (p) => filename(p) === 'composer.json' && depth(p) <= 2, parse: parseComposerJson },
];

/**
 * Used only when an ecosystem produced no lockfile at all.
 *
 * A repository that ships `package.json` without a lockfile would otherwise
 * yield an empty inventory — and therefore a false "no vulnerabilities" result.
 * We fall back to the declared ranges and surface a note on the scan, so the
 * approximation is visible rather than silent.
 */
const FALLBACK_RULES: Array<{
  ecosystem: EcosystemId;
  matches: (p: string) => boolean;
  parse: (c: string, ctx: { path: string; directNames?: Set<string> }) => ParsedComponent[];
  label: string;
}> = [
  { ecosystem: 'npm', label: 'npm', matches: (p) => filename(p) === 'package.json' && depth(p) <= 2, parse: parsePackageJsonInventory },
  { ecosystem: 'composer', label: 'Composer', matches: (p) => filename(p) === 'composer.json' && depth(p) <= 2, parse: parseComposerJsonInventory },
  { ecosystem: 'pypi', label: 'Python', matches: (p) => filename(p) === 'pyproject.toml' && depth(p) <= 2, parse: parsePyprojectInventory },
  { ecosystem: 'crates', label: 'Cargo', matches: (p) => filename(p) === 'Cargo.toml' && depth(p) <= 2, parse: parseCargoTomlInventory },
];

/** Files that constitute compliance-relevant evidence already in the repo. */
export const POLICY_FILE_PATTERNS: Array<{ key: string; matches: (p: string) => boolean }> = [
  { key: 'security_policy', matches: (p) => /^(.github\/)?(docs\/)?SECURITY\.md$/i.test(p) },
  { key: 'codeowners', matches: (p) => /^(.github\/)?CODEOWNERS$/i.test(p) },
  { key: 'dependabot', matches: (p) => /^\.github\/dependabot\.ya?ml$/i.test(p) },
  { key: 'renovate', matches: (p) => /^renovate\.json5?$/i.test(p) },
  { key: 'ci_workflow', matches: (p) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p) },
  { key: 'license', matches: (p) => /^(LICENSE|LICENCE|COPYING)(\.md|\.txt)?$/i.test(p) },
  { key: 'readme', matches: (p) => /^README(\.md|\.rst|\.txt)?$/i.test(p) },
  { key: 'changelog', matches: (p) => /^(CHANGELOG|CHANGES|HISTORY)(\.md)?$/i.test(p) },
  { key: 'threat_model', matches: (p) => /threat[-_]?model/i.test(p) },
  { key: 'existing_sbom', matches: (p) => /(^|\/)(bom|sbom)[-_.]?.*\.(json|xml)$/i.test(p) },
  { key: 'containerfile', matches: (p) => /^Dockerfile/i.test(filenameOf(p)) },
  { key: 'sa_config', matches: (p) => /^\.semgrep|^\.snyk|^\.trivy/i.test(p) },
];

function filenameOf(p: string): string {
  return p.split('/').pop() ?? '';
}

export interface CollectedFile {
  path: string;
  content: string;
}

export interface DetectedManifests {
  manifests: Array<ManifestRule & { path: string; content: string }>;
  declarations: Array<{ path: string; content: string; direct: Set<string>; licenses: Record<string, string[]> }>;
  policyFiles: Record<string, CollectedFile>;
}

/** Decides which paths a scan needs to read. Everything else is never fetched. */
export function selectPaths(allPaths: string[]): string[] {
  const relevant = allPaths.filter(isRelevantPath);
  const selected = new Set<string>();

  const manifestPaths = relevant.filter((p) => MANIFEST_RULES.some((r) => r.matches(p)));
  const declarationPaths = relevant.filter((p) => DECLARATION_FILES.some((d) => d.matches(p)));

  for (const p of manifestPaths.slice(0, 40)) selected.add(p);
  for (const p of declarationPaths.slice(0, 10)) selected.add(p);

  for (const pattern of POLICY_FILE_PATTERNS) {
    const hit = relevant.find((p) => pattern.matches(p));
    if (hit) selected.add(hit);
  }

  // Some CI evidence (up to 3 workflows) supports the "secure development" controls.
  for (const p of relevant.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p)).slice(0, 3)) {
    selected.add(p);
  }

  return [...selected];
}

export function detect(files: CollectedFile[]): DetectedManifests {
  const manifests: DetectedManifests['manifests'] = [];
  const declarations: DetectedManifests['declarations'] = [];
  const policyFiles: Record<string, CollectedFile> = {};

  for (const file of files) {
    for (const pattern of POLICY_FILE_PATTERNS) {
      if (pattern.matches(file.path) && !policyFiles[pattern.key]) {
        policyFiles[pattern.key] = file;
      }
    }

    const declRule = DECLARATION_FILES.find((d) => d.matches(file.path));
    if (declRule) {
      declarations.push({ path: file.path, content: file.content, ...declRule.parse(file.content) });
    }

    const rule = MANIFEST_RULES.find((r) => r.matches(file.path));
    if (rule) manifests.push({ ...rule, path: file.path, content: file.content });
  }

  return { manifests, declarations, policyFiles };
}

/**
 * Builds the component inventory.
 *
 * When both a lockfile and a loose manifest exist for the same ecosystem we use
 * the lockfile, because it pins the version that actually ships — which is the
 * only version that matters for a vulnerability match and for an SBOM.
 */
export function buildInventory(detected: DetectedManifests): { components: ParsedComponent[]; notes: string[] } {
  const directNames = new Set<string>();
  for (const decl of detected.declarations) {
    for (const name of decl.direct) directNames.add(name);
  }

  const byEcosystem = new Map<EcosystemId, Array<{ rule: ManifestRule; path: string; content: string }>>();
  for (const m of detected.manifests) {
    const list = byEcosystem.get(m.ecosystem) ?? [];
    list.push({ rule: m, path: m.path, content: m.content });
    byEcosystem.set(m.ecosystem, list);
  }

  const out: ParsedComponent[] = [];
  const seen = new Set<string>();
  const notes: string[] = [];

  const add = (component: ParsedComponent): void => {
    const key = `${component.ecosystem}:${component.name}:${component.version ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(component);
  };

  for (const [, candidates] of byEcosystem) {
    candidates.sort((a, b) => b.rule.priority - a.rule.priority);
    const best = candidates[0]!;
    for (const component of best.rule.parse(best.content, { path: best.path, directNames })) add(component);

    // Container base images are additive, not exclusive: a repo can have both.
    if (best.rule.ecosystem === 'docker') {
      for (const extra of candidates.slice(1)) {
        for (const component of extra.rule.parse(extra.content, { path: extra.path, directNames })) add(component);
      }
    }
  }

  // Fallback: ecosystems with a declaration file but no lockfile at all.
  const covered = new Set<EcosystemId>(out.map((c) => c.ecosystem));
  for (const rule of FALLBACK_RULES) {
    if (covered.has(rule.ecosystem)) continue;
    const decl = detected.declarations.find((d) => rule.matches(d.path));
    if (!decl) continue;
    const parsed = rule.parse(decl.content, { path: decl.path, directNames });
    if (parsed.length === 0) continue;
    for (const component of parsed) add(component);
    notes.push(
      `No ${rule.label} lockfile was found. Components were read from ${decl.path} and their versions are the ranges declared there, not pinned installs. Commit a lockfile for exact results.`,
    );
  }

  return { components: out, notes };
}

export type { ParsedComponent };
