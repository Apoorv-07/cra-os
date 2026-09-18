import { XMLParser } from 'fast-xml-parser';
import { parse as parseToml } from 'smol-toml';
import { buildPurl, type EcosystemId } from './purl.js';

/**
 * Manifest parsers.
 *
 * Each parser takes the raw text of a dependency manifest found in a repository
 * and returns normalised components. They are deliberately defensive: a
 * malformed manifest must degrade to "we couldn't read this file" rather than
 * failing the whole scan, because real repositories are messy.
 *
 * Security: parsers operate on **file contents only**. Nothing here executes
 * repository code, installs packages, or follows network references.
 */

export interface ParsedComponent {
  name: string;
  version: string | null;
  ecosystem: EcosystemId;
  group: string | null;
  purl: string;
  licenses: string[];
  scope: 'runtime' | 'development' | 'unknown';
  isDirect: boolean;
  manifestPath: string;
}

interface ParseContext {
  path: string;
  directNames?: Set<string>;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

function safeJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeToml(text: string): Record<string, any> | null {
  try {
    return parseToml(text) as Record<string, any>;
  } catch {
    return null;
  }
}

function uniqBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// npm
// ---------------------------------------------------------------------------

interface NpmLockPackage {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  resolved?: string;
  license?: string | string[] | { type?: string };
  dependencies?: Record<string, string>;
}

export function parseNpmLock(text: string, ctx: ParseContext): ParsedComponent[] {
  const json = safeJson(text) as
    | { lockfileVersion?: number; packages?: Record<string, NpmLockPackage>; dependencies?: Record<string, any> }
    | null;
  if (!json) return [];

  const out: ParsedComponent[] = [];

  // lockfileVersion >= 2 stores a flattened `packages` map keyed by install path.
  if (json.packages) {
    for (const [installPath, pkg] of Object.entries(json.packages)) {
      if (!installPath || installPath === '') continue; // skip the root project entry
      const at = installPath.lastIndexOf('node_modules/');
      if (at === -1) continue;
      const name = installPath.slice(at + 'node_modules/'.length);
      if (!name) continue;
      out.push(
        make({
          name,
          version: pkg.version ?? null,
          ecosystem: 'npm',
          scope: pkg.dev ? 'development' : 'runtime',
          licenses: normaliseLicense(pkg.license),
          isDirect: ctx.directNames?.has(name) ?? false,
          path: ctx.path,
        }),
      );
    }
  }

  // lockfileVersion 1 nests dependencies recursively.
  if (json.dependencies && Object.keys(json.dependencies).length > 0) {
    const walk = (deps: Record<string, any>, dev: boolean): void => {
      for (const [name, meta] of Object.entries(deps)) {
        if (!meta || typeof meta !== 'object') continue;
        out.push(
          make({
            name,
            version: meta.version ?? null,
            ecosystem: 'npm',
            scope: dev || meta.dev ? 'development' : 'runtime',
            licenses: normaliseLicense(meta.license),
            isDirect: ctx.directNames?.has(name) ?? false,
            path: ctx.path,
          }),
        );
        if (meta.dependencies) walk(meta.dependencies, dev || Boolean(meta.dev));
      }
    };
    walk(json.dependencies, false);
  }

  return uniqBy(out, (c) => `${c.name}@${c.version}`);
}

export function parsePackageJson(text: string): { direct: Set<string>; licenses: Record<string, string[]> } {
  const json = safeJson(text) as
    | { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; license?: string }
    | null;
  const direct = new Set<string>();
  if (!json) return { direct, licenses: {} };
  for (const key of Object.keys(json.dependencies ?? {})) direct.add(key);
  for (const key of Object.keys(json.devDependencies ?? {})) direct.add(key);
  const licenses: Record<string, string[]> = {};
  if (typeof json.license === 'string') licenses.__root__ = [json.license];
  return { direct, licenses };
}

export function parseYarnLock(text: string, ctx: ParseContext): ParsedComponent[] {
  // Yarn v1: blocks of comma-separated descriptors followed by a `version` key.
  const out: ParsedComponent[] = [];
  const lines = text.split(/\r?\n/);
  let currentNames: string[] = [];
  let version: string | null = null;

  const flush = (): void => {
    if (version && currentNames.length) {
      for (const descriptor of currentNames) {
        const at = descriptor.lastIndexOf('@');
        const name = at > 0 ? descriptor.slice(0, at) : descriptor;
        out.push(
          make({
            name: name.replace(/^"|"$/g, ''),
            version,
            ecosystem: 'npm',
            scope: 'runtime',
            licenses: [],
            isDirect: ctx.directNames?.has(name) ?? false,
            path: ctx.path,
          }),
        );
      }
    }
    currentNames = [];
    version = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      flush();
      if (line.endsWith(':')) {
        currentNames = line
          .slice(0, -1)
          .split(',')
          .map((s) => s.trim().replace(/^"|"$/g, ''));
      }
    } else if (line.includes('version')) {
      const m = /version\s+"?([^"\s]+)"?/.exec(line.trim());
      if (m) version = m[1] ?? null;
    }
  }
  flush();
  return uniqBy(out, (c) => `${c.name}@${c.version}`);
}

export function parsePnpmLock(text: string, ctx: ParseContext): ParsedComponent[] {
  // Lightweight YAML subset parser: we only need the `packages:` or `dependencies:` maps.
  const out: ParsedComponent[] = [];
  const lines = text.split(/\r?\n/);
  let section: 'none' | 'packages' | 'dependencies' | 'devDependencies' = 'none';

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^(packages|dependencies|devDependencies):\s*$/.test(line)) {
      section = line.startsWith('packages')
        ? 'packages'
        : line.startsWith('devDependencies')
          ? 'devDependencies'
          : 'dependencies';
      continue;
    }
    if (line && !line.startsWith(' ') && !line.startsWith('  ')) {
      if (!line.includes(':')) continue;
      if (!/^(packages|dependencies|devDependencies):/.test(line)) section = 'none';
    }
    if (section === 'none') continue;

    if (section === 'packages') {
      // e.g. "  /lodash/4.17.21:" or "  lodash@4.17.21:"
      const m = /^\s{2}\/?([^\s:]+)\s*:\s*$/.exec(line);
      if (!m) continue;
      const spec = m[1]!;
      const slashVersion = /^(.+)\/([^/]+)$/.exec(spec);
      const atVersion = /^(.+)@([^@]+)$/.exec(spec);
      let name = spec;
      let version: string | null = null;
      if (slashVersion) {
        name = slashVersion[1]!;
        version = slashVersion[2]!;
      } else if (atVersion) {
        name = atVersion[1]!;
        version = atVersion[2]!;
      }
      out.push(
        make({
          name,
          version,
          ecosystem: 'npm',
          scope: 'runtime',
          licenses: [],
          isDirect: ctx.directNames?.has(name) ?? false,
          path: ctx.path,
        }),
      );
    } else {
      const m = /^\s{2}([^\s:]+):\s*$/.exec(line);
      if (!m) continue;
      const name = m[1]!;
      out.push(
        make({
          name,
          version: null,
          ecosystem: 'npm',
          scope: section === 'devDependencies' ? 'development' : 'runtime',
          licenses: [],
          isDirect: true,
          path: ctx.path,
        }),
      );
    }
  }
  return uniqBy(out, (c) => `${c.name}@${c.version}`);
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

export function parseRequirements(text: string, ctx: ParseContext): ParsedComponent[] {
  const out: ParsedComponent[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    line = line.split(/\s+#/)[0]!.trim();
    // Strip environment markers.
    line = line.split(';')[0]!.trim();
    const m = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(==|===|~=|>=|<=|>|<|!=)?\s*([A-Za-z0-9.*+!_-]+)?/.exec(line);
    if (!m) continue;
    const name = m[1]!;
    const version = m[3] && !/[*]/.test(m[3]) ? m[3] : null;
    out.push(
      make({
        name,
        version,
        ecosystem: 'pypi',
        scope: 'runtime',
        licenses: [],
        isDirect: true,
        path: ctx.path,
      }),
    );
  }
  return uniqBy(out, (c) => c.name);
}

export function parsePoetryLock(text: string, ctx: ParseContext): ParsedComponent[] {
  const toml = safeToml(text);
  const out: ParsedComponent[] = [];
  if (!toml) return out;
  const packages = (toml.package as Array<Record<string, any>>) ?? [];
  for (const pkg of packages) {
    if (!pkg.name) continue;
    out.push(
      make({
        name: String(pkg.name),
        version: pkg.version ? String(pkg.version) : null,
        ecosystem: 'pypi',
        scope: pkg.category === 'dev' ? 'development' : 'runtime',
        licenses: normaliseLicense(pkg.license),
        isDirect: ctx.directNames?.has(String(pkg.name)) ?? false,
        path: ctx.path,
      }),
    );
  }
  return uniqBy(out, (c) => c.name);
}

export function parsePyproject(text: string): { direct: Set<string>; licenses: Record<string, string[]> } {
  const toml = safeToml(text);
  const direct = new Set<string>();
  const licenses: Record<string, string[]> = {};
  if (!toml) return { direct, licenses };

  const project = toml.project as Record<string, any> | undefined;

  // PEP 621 declares dependencies as an array of PEP 508 strings. Older and
  // Poetry-style files use a table instead, so both shapes are supported — the
  // array form is the one that silently produced index numbers if mishandled.
  const projectDeps = project?.dependencies;
  if (Array.isArray(projectDeps)) {
    for (const spec of projectDeps) {
      const name = /^([A-Za-z0-9._-]+)/.exec(String(spec).trim())?.[1];
      if (name) direct.add(name);
    }
  } else if (projectDeps && typeof projectDeps === 'object') {
    for (const key of Object.keys(projectDeps)) direct.add(key);
  }

  const poetry = (toml.tool as Record<string, any> | undefined)?.poetry as Record<string, any> | undefined;
  for (const key of Object.keys((poetry?.dependencies as Record<string, any>) ?? {})) direct.add(key);
  for (const key of Object.keys((poetry?.['dev-dependencies'] as Record<string, any>) ?? {})) direct.add(key);
  for (const key of Object.keys(((poetry?.group as Record<string, any>) ?? {}) as Record<string, any>)) {
    const group = (poetry!.group as Record<string, any>)[key] as Record<string, any>;
    for (const dep of Object.keys((group?.dependencies as Record<string, any>) ?? {})) direct.add(dep);
  }
  if (typeof project?.license === 'string') licenses.__root__ = [project.license];
  return { direct, licenses };
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

export function parseGoMod(text: string, ctx: ParseContext): ParsedComponent[] {
  const out: ParsedComponent[] = [];
  const lines = text.split(/\r?\n/);

  // `// indirect` is the only signal go.mod gives us about direct-ness, and it
  // matters for remediation: a direct dependency is easier to bump than one
  // dragged in transitively.
  const isIndirect = (line: string) => /\/\/.*\bindirect\b/.test(line);

  const push = (line: string, name: string, version: string) => {
    out.push(
      make({
        name,
        version,
        ecosystem: 'go',
        scope: 'runtime',
        licenses: [],
        isDirect: !isIndirect(line),
        path: ctx.path,
      }),
    );
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line.startsWith('require (')) {
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith(')')) {
        const raw = lines[i]!.trim();
        const m = /^([^\s]+)\s+(v[^\s]+)/.exec(raw);
        if (m) push(raw, m[1]!, m[2]!);
        i += 1;
      }
      continue;
    }
    const m = /^require\s+([^\s]+)\s+(v[^\s]+)/.exec(line);
    if (m) push(line, m[1]!, m[2]!);
  }
  return uniqBy(out, (c) => c.name);
}

/**
 * Parses `go.sum`, the Go module checksum database.
 *
 * Lines are `module version[/go.mod] h1:base64=`. Only the plain `version` lines
 * represent modules that actually get compiled into the binary; the `/go.mod`
 * lines exist to verify the module graph and would otherwise double-count every
 * dependency.
 */
export function parseGoSum(text: string, ctx: ParseContext): ParsedComponent[] {
  const out: ParsedComponent[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const name = parts[0]!;
    const version = parts[1]!;
    if (version.endsWith('/go.mod')) continue;

    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(
      make({
        name,
        version,
        ecosystem: 'go',
        scope: 'runtime',
        licenses: [],
        isDirect: false,
        path: ctx.path,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

export function parseCargoLock(text: string, ctx: ParseContext): ParsedComponent[] {
  const toml = safeToml(text);
  if (!toml) return [];
  const packages = (toml.package as Array<Record<string, any>>) ?? [];
  return uniqBy(
    packages
      .filter((p) => p.name)
      .map((p) =>
        make({
          name: String(p.name),
          version: p.version ? String(p.version) : null,
          ecosystem: 'crates',
          scope: 'runtime',
          licenses: normaliseLicense(p.license),
          isDirect: ctx.directNames?.has(String(p.name)) ?? false,
          path: ctx.path,
        }),
      ),
    (c) => c.name,
  );
}

export function parseCargoToml(text: string): { direct: Set<string>; licenses: Record<string, string[]> } {
  const toml = safeToml(text);
  const direct = new Set<string>();
  const licenses: Record<string, string[]> = {};
  if (!toml) return { direct, licenses };
  const sections = ['dependencies', 'dev-dependencies', 'build-dependencies'];
  for (const section of sections) {
    const deps = (toml[section] as Record<string, any>) ?? {};
    for (const key of Object.keys(deps)) direct.add(key);
  }
  const ws = (toml['workspace'] as Record<string, any> | undefined)?.dependencies as Record<string, any> | undefined;
  for (const key of Object.keys(ws ?? {})) direct.add(key);
  if (typeof (toml.package as Record<string, any>)?.license === 'string') {
    licenses.__root__ = [(toml.package as Record<string, any>).license as string];
  }
  return { direct, licenses };
}

// ---------------------------------------------------------------------------
// Java / JVM
// ---------------------------------------------------------------------------

export function parsePomXml(text: string, ctx: ParseContext): ParsedComponent[] {
  let parsed: Record<string, any>;
  try {
    parsed = xml.parse(text) as Record<string, any>;
  } catch {
    return [];
  }
  const project = parsed?.project ?? parsed;
  const dependencies = toArray(project?.dependencies?.dependency);
  const out: ParsedComponent[] = [];

  const properties = (project?.properties ?? {}) as Record<string, any>;
  const resolve = (value: unknown): string | null => {
    if (typeof value !== 'string') return value == null ? null : String(value);
    const m = /^\$\{([^}]+)\}$/.exec(value.trim());
    if (m && typeof properties[m[1]!] === 'string') return String(properties[m[1]!]);
    return value;
  };

  for (const dep of dependencies) {
    const groupId = resolve(dep?.groupId);
    const artifactId = resolve(dep?.artifactId);
    const version = resolve(dep?.version);
    if (!groupId || !artifactId) continue;
    out.push(
      make({
        name: artifactId,
        group: groupId,
        version,
        ecosystem: 'maven',
        scope: dep?.scope === 'test' || dep?.scope === 'provided' ? 'development' : 'runtime',
        licenses: [],
        isDirect: true,
        path: ctx.path,
      }),
    );
  }
  return uniqBy(out, (c) => `${c.group}:${c.name}`);
}

export function parseGradle(text: string, ctx: ParseContext): ParsedComponent[] {
  // Gradle scripts are not parseable without a full build; we match the common
  // `group:name:version` coordinate form, which covers the vast majority.
  const out: ParsedComponent[] = [];
  const re = /['"]([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+-]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(
      make({
        name: m[2]!,
        group: m[1]!,
        version: m[3]!,
        ecosystem: 'maven',
        scope: 'runtime',
        licenses: [],
        isDirect: true,
        path: ctx.path,
      }),
    );
  }
  return uniqBy(out, (c) => `${c.group}:${c.name}`);
}

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

export function parseComposerLock(text: string, ctx: ParseContext): ParsedComponent[] {
  const json = safeJson(text) as
    | { packages?: Array<Record<string, any>>; 'packages-dev'?: Array<Record<string, any>> }
    | null;
  if (!json) return [];
  const out: ParsedComponent[] = [];
  for (const [list, scope] of [
    [json.packages ?? [], 'runtime'],
    [json['packages-dev'] ?? [], 'development'],
  ] as const) {
    for (const pkg of list) {
      if (!pkg.name) continue;
      out.push(
        make({
          name: String(pkg.name),
          version: pkg.version ? String(pkg.version).replace(/^v/, '') : null,
          ecosystem: 'composer',
          scope,
          licenses: normaliseLicense(pkg.license),
          isDirect: ctx.directNames?.has(String(pkg.name)) ?? false,
          path: ctx.path,
        }),
      );
    }
  }
  return uniqBy(out, (c) => c.name);
}

export function parseComposerJson(text: string): { direct: Set<string>; licenses: Record<string, string[]> } {
  const json = safeJson(text) as Record<string, any> | null;
  const direct = new Set<string>();
  const licenses: Record<string, string[]> = {};
  if (!json) return { direct, licenses };
  for (const key of Object.keys((json.require as Record<string, any>) ?? {})) direct.add(key);
  for (const key of Object.keys((json['require-dev'] as Record<string, any>) ?? {})) direct.add(key);
  if (typeof json.license === 'string') licenses.__root__ = [json.license];
  return { direct, licenses };
}

// ---------------------------------------------------------------------------
// .NET
// ---------------------------------------------------------------------------

export function parsePackagesLockJson(text: string, ctx: ParseContext): ParsedComponent[] {
  const json = safeJson(text) as { dependencies?: Record<string, any> } | null;
  if (!json?.dependencies) return [];
  const out: ParsedComponent[] = [];
  for (const [framework, deps] of Object.entries(json.dependencies)) {
    void framework;
    for (const [name, meta] of Object.entries(deps as Record<string, any>)) {
      out.push(
        make({
          name,
          version: typeof meta?.resolved === 'string' ? meta.resolved : null,
          ecosystem: 'nuget',
          scope: meta?.type === 'Build' || meta?.type === 'Test' ? 'development' : 'runtime',
          licenses: [],
          isDirect: true,
          path: ctx.path,
        }),
      );
    }
  }
  return uniqBy(out, (c) => `${c.name}@${c.version}`);
}

export function parseCsproj(text: string, ctx: ParseContext): ParsedComponent[] {
  let parsed: Record<string, any>;
  try {
    parsed = xml.parse(text) as Record<string, any>;
  } catch {
    return [];
  }
  const project = parsed?.Project;
  if (!project) return [];
  const refs = toArray(project?.ItemGroup?.PackageReference).flat();
  const out: ParsedComponent[] = [];
  for (const ref of refs) {
    const name = ref?.['@_Include'] ?? ref?.['@_Update'];
    const version = ref?.['@_Version'];
    if (!name) continue;
    out.push(
      make({
        name: String(name),
        version: version ? String(version) : null,
        ecosystem: 'nuget',
        scope: 'runtime',
        licenses: [],
        isDirect: true,
        path: ctx.path,
      }),
    );
  }
  return uniqBy(out, (c) => c.name);
}

// ---------------------------------------------------------------------------
// Ruby
// ---------------------------------------------------------------------------

export function parseGemfileLock(text: string, ctx: ParseContext): ParsedComponent[] {
  const out: ParsedComponent[] = [];
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^[A-Z_]+$/.test(line.trim())) {
      section = line.trim();
      continue;
    }
    const m = /^\s{4}([A-Za-z0-9_.-]+)\s+\(([A-Za-z0-9_.-]+)\)/.exec(line);
    if (!m) continue;
    out.push(
      make({
        name: m[1]!,
        version: m[2]!,
        ecosystem: 'rubygems',
        scope: section === 'GEM' || section === 'DEPENDENCIES' ? 'runtime' : 'development',
        licenses: [],
        isDirect: section === 'DEPENDENCIES',
        path: ctx.path,
      }),
    );
  }
  return uniqBy(out, (c) => c.name);
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export function parseDockerfile(text: string, ctx: ParseContext): ParsedComponent[] {
  const out: ParsedComponent[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^FROM\s+(--platform=\S+\s+)?([^\s]+)(\s+AS\s+\S+)?$/i.exec(line);
    if (!m) continue;
    const image = m[2]!;
    if (image === 'scratch') continue;
    const [repo, tag] = image.includes(':') ? [image.split(':')[0], image.split(':')[1]] : [image, 'latest'];
    out.push(
      make({
        name: repo!,
        version: tag ?? 'latest',
        ecosystem: 'docker',
        scope: 'runtime',
        licenses: [],
        isDirect: true,
        path: ctx.path,
      }),
    );
  }
  return uniqBy(out, (c) => `${c.name}@${c.version}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normaliseLicense(license: unknown): string[] {
  if (!license) return [];
  if (typeof license === 'string') return [license];
  if (Array.isArray(license)) return license.map((l) => (typeof l === 'string' ? l : String(l)));
  if (typeof license === 'object' && 'type' in (license as Record<string, unknown>)) {
    const t = (license as { type?: unknown }).type;
    return t ? [String(t)] : [];
  }
  return [];
}

function make(input: {
  name: string;
  version: string | null;
  ecosystem: EcosystemId;
  group?: string | null;
  scope: 'runtime' | 'development' | 'unknown';
  licenses: string[];
  isDirect: boolean;
  path: string;
}): ParsedComponent {
  return {
    name: input.name,
    version: input.version,
    ecosystem: input.ecosystem,
    group: input.group ?? null,
    purl: buildPurl({
      ecosystem: input.ecosystem,
      name: input.name,
      version: input.version,
      group: input.group ?? null,
    }),
    licenses: input.licenses,
    scope: input.scope,
    isDirect: input.isDirect,
    manifestPath: input.path,
  };
}

// ---------------------------------------------------------------------------
// Manifest-only fallback
// ---------------------------------------------------------------------------

/**
 * Reduces a dependency range to a concrete version for matching.
 *
 * Used only when a repository ships a manifest without a lockfile. In that case
 * the exact installed version is unknowable from the repository alone, so we
 * take the range's lower bound — the version a fresh install would resolve to
 * at the time of the scan — and label the scan accordingly. Reporting nothing
 * at all would be a worse failure mode: the user would see an empty SBOM and a
 * false "no vulnerabilities" result.
 */
export function versionFromRange(range: string): string | null {
  if (typeof range !== 'string') return null;
  let value = range.trim();
  if (!value) return null;
  // Non-registry specs: workspace, file, link, git, github shorthand.
  if (/^(file:|link:|git\+|git:|github:|https?:|npm:|workspace:|portal:|patch:)/.test(value)) return null;
  // Take the first alternative of an OR range ("^1.0.0 || ^2.0.0").
  value = value.split('||')[0]!.trim();
  // Take the first part of a space-separated range (">=1.2.0 <2.0.0").
  value = value.split(/\s+/)[0]!;
  value = value.replace(/^[v=^~><]+/, '');
  // Wildcards carry no resolvable version ("1.2.x", "*", "latest").
  if (!value || /[*xX]/.test(value) || value === 'latest' || value === 'next') return null;
  if (!/^\d/.test(value)) return null;
  return value;
}

/** Inventory from `package.json` when no npm lockfile is present. */
export function parsePackageJsonInventory(text: string, ctx: ParseContext): ParsedComponent[] {
  const json = safeJson(text) as Record<string, any> | null;
  if (!json) return [];
  const out: ParsedComponent[] = [];
  const groups: Array<[Record<string, any> | undefined, 'runtime' | 'development']> = [
    [json.dependencies, 'runtime'],
    [json.devDependencies, 'development'],
    [json.optionalDependencies, 'runtime'],
  ];
  for (const [deps, scope] of groups) {
    for (const [name, range] of Object.entries(deps ?? {})) {
      out.push(
        make({
          name,
          version: versionFromRange(String(range ?? '')),
          ecosystem: 'npm',
          scope,
          licenses: [],
          isDirect: true,
          path: ctx.path,
        }),
      );
    }
  }
  return out;
}

/** Inventory from `composer.json` when no `composer.lock` is present. */
export function parseComposerJsonInventory(text: string, ctx: ParseContext): ParsedComponent[] {
  const json = safeJson(text) as Record<string, any> | null;
  if (!json) return [];
  const out: ParsedComponent[] = [];
  const groups: Array<[Record<string, any> | undefined, 'runtime' | 'development']> = [
    [json.require, 'runtime'],
    [json['require-dev'], 'development'],
  ];
  for (const [deps, scope] of groups) {
    for (const [name, range] of Object.entries(deps ?? {})) {
      out.push(
        make({
          name,
          version: versionFromRange(String(range ?? '')),
          ecosystem: 'composer',
          scope,
          licenses: [],
          isDirect: true,
          path: ctx.path,
        }),
      );
    }
  }
  return out;
}

/** Inventory from `pyproject.toml` (PEP 621 / Poetry) when no lockfile is present. */
export function parsePyprojectInventory(text: string, ctx: ParseContext): ParsedComponent[] {
  const raw = parseToml(text) as Record<string, any>;
  const deps: string[] = Array.isArray(raw?.project?.dependencies) ? (raw.project.dependencies as string[]) : [];
  const poetry: Record<string, any> = (raw?.tool?.poetry?.dependencies as Record<string, any>) ?? {};
  const out: ParsedComponent[] = [];

  for (const spec of deps) {
    const m = /^([A-Za-z0-9._-]+)\s*(.*)$/.exec(spec.trim());
    if (!m) continue;
    out.push(
      make({
        name: m[1]!,
        version: versionFromRange(m[2]!.replace(/[()[\],]/g, ' ').trim()),
        ecosystem: 'pypi',
        scope: 'runtime',
        licenses: [],
        isDirect: true,
        path: ctx.path,
      }),
    );
  }
  for (const [name, spec] of Object.entries(poetry)) {
    if (name === 'python') continue;
    const value = typeof spec === 'string' ? spec : String((spec as any)?.version ?? '');
    out.push(
      make({
        name,
        version: versionFromRange(value),
        ecosystem: 'pypi',
        scope: 'runtime',
        licenses: [],
        isDirect: true,
        path: ctx.path,
      }),
    );
  }
  return out;
}

/** Inventory from `Cargo.toml` when no `Cargo.lock` is present. */
export function parseCargoTomlInventory(text: string, ctx: ParseContext): ParsedComponent[] {
  const raw = parseToml(text) as Record<string, any>;
  const sections: Array<[Record<string, any> | undefined, 'runtime' | 'development']> = [
    [raw?.dependencies, 'runtime'],
    [raw?.['dev-dependencies'], 'development'],
    [raw?.['build-dependencies'], 'development'],
  ];
  const out: ParsedComponent[] = [];
  for (const [deps, scope] of sections) {
    for (const [name, spec] of Object.entries(deps ?? {})) {
      const value = typeof spec === 'string' ? spec : String((spec as any)?.version ?? '');
      out.push(
        make({
          name,
          version: versionFromRange(value),
          ecosystem: 'crates',
          scope,
          licenses: [],
          isDirect: true,
          path: ctx.path,
        }),
      );
    }
  }
  return out;
}
