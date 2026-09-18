import {and, eq, inArray} from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  components as componentsTable,
  componentVulnerabilities,
  dependencies as _dependenciesTable,
  integrations,
  notifications,
  repositories,
  sboms,
  scans,
  vulnerabilities,
  projects,
} from '../db/schema.js';
import { newId } from '../core/ids.js';
import { sha256 } from '../core/crypto.js';
import { log } from '../core/logger.js';
import { AppError } from '../core/errors.js';
import { storage, objectKey } from '../core/storage.js';
import { progress } from '../jobs/queue.js';
import { audit } from '../core/audit.js';
import {buildCycloneDxJson, buildCycloneDxXml, componentsToSbomInput} from '../sbom/cyclonedx.js';
import { buildQueries, fetchVulnDetail, normaliseOsvVuln, queryBatch, vulnAppliesTo, fixedVersionFor, type NormalisedVulnerability } from '../intel/osv.js';
import { isKev } from '../intel/kev.js';
import { fetchEpss } from '../intel/epss.js';
import { evaluate, buildContext } from '../compliance/engine.js';
import type { EcosystemId } from './purl.js';
import { buildInventory, detect, selectPaths, type CollectedFile } from './manifests.js';
import {
  downloadTarball,
  extractTarball,
  fetchFile,
  getRepository,
  listTree,
  tokenFor,
  type RepoRef,
  SCAN_LIMITS,
} from './source.js';

/**
 * Repository scan pipeline.
 *
 * Stage order is visible to the user as real progress events emitted by the
 * worker; there are no simulated steps. The pipeline is idempotent: if the
 * dependency fingerprint is unchanged we skip re-billing and re-processing.
 */

export interface ScanJobPayload {
  orgId: string;
  repositoryId: string;
  scanId: string;
  trigger: string;
  ref?: string;
  /** Reservation released on failure, committed on success. */
  usageEventId?: string | null;
  /** Set when scanning an archive uploaded by the customer. */
  uploadedArchiveKey?: string;
}

const STAGE = {
  connect: 5,
  fetch: 20,
  parse: 40,
  sbom: 55,
  advisories: 70,
  exploit: 82,
  compliance: 92,
  done: 100,
} as const;

function fingerprintFor(inventory: Array<{ ecosystem: string; name: string; version: string | null }>): string {
  const canonical = inventory
    .map((c) => `${c.ecosystem}:${c.name}@${c.version ?? ''}`)
    .sort()
    .join('\n');
  return sha256(canonical);
}

export async function runRepositoryScan(jobId: string, payload: ScanJobPayload): Promise<Record<string, unknown>> {
  const db = getDb();
  const { orgId, repositoryId, scanId } = payload;

  const repo = db.select().from(repositories).where(eq(repositories.id, repositoryId)).get();
  if (!repo) throw AppError.notFound('Repository');
  if (repo.orgId !== orgId) throw AppError.forbidden();

  const startedAt = Date.now();
  db.update(scans).set({ status: 'running', startedAt, progressMessage: 'Starting' }).where(eq(scans.id, scanId)).run();

  const step = (pct: number, message: string): void => {
    progress(jobId, pct, message);
    db.update(scans).set({ progressMessage: message }).where(eq(scans.id, scanId)).run();
  };

  try {
    // -----------------------------------------------------------------------
    // 1. Collect files
    // -----------------------------------------------------------------------
    step(STAGE.connect, 'Connecting to repository');

    let files: CollectedFile[] = [];
    let resolvedRef = payload.ref ?? repo.defaultBranch ?? 'HEAD';
    const commitSha: string | null = null;

    if (payload.uploadedArchiveKey) {
      step(STAGE.fetch, 'Extracting uploaded archive');
      const buffer = await storage().get(payload.uploadedArchiveKey);
      if (!buffer) throw AppError.notFound('Uploaded archive');
      const map = await extractTarball(buffer, (path, size) => {
        if (size > SCAN_LIMITS.maxFileBytes) return false;
        return /(\.json|\.lock|\.toml|\.xml|\.gradle|\.txt|\.md|\.yml|\.yaml|\.csproj|\.fsproj)$/i.test(path) ||
          /^(Dockerfile|requirements.*|Gemfile|go\.(mod|sum)|Cargo\.(toml|lock)|composer\.(json|lock)|package(-lock)?\.json|pom\.xml|packages\.lock\.json)/i.test(path);
      });
      files = [...map.entries()].map(([path, content]) => ({ path, content }));
    } else {
      const integration = repo.integrationId
        ? db.select().from(integrations).where(eq(integrations.id, repo.integrationId)).get()
        : null;

      const ref: RepoRef = {
        owner: repo.owner ?? '',
        repo: repo.name,
        ref: resolvedRef,
        installationId: integration?.installationId ?? undefined,
      };

      if (!ref.owner) throw AppError.integration('This repository has no owner recorded.');

      const token = await tokenFor(ref);
      step(STAGE.fetch, 'Listing repository files');

      let paths: string[] = [];
      try {
        const tree = await listTree(ref, token);
        paths = selectPaths(tree.filter((t) => t.type === 'blob').map((t) => t.path));
        const meta = await getRepository(token, ref.owner, ref.repo).catch(() => null);
        if (meta?.default_branch) resolvedRef = meta.default_branch;
      } catch {
        // Trees API unavailable (e.g. very large monorepos): fall back to the
        // archive endpoint, which has no pagination limit.
        step(STAGE.fetch, 'Downloading repository archive');
        const tarball = await downloadTarball(ref, token);
        const map = await extractTarball(tarball, (path, size) => {
          if (size > SCAN_LIMITS.maxFileBytes) return false;
          return (
            /(\.json|\.lock|\.toml|\.xml|\.gradle|\.txt|\.md|\.yml|\.yaml|\.csproj|\.fsproj)$/i.test(path) ||
            /^(Dockerfile|requirements.*|Gemfile|go\.(mod|sum)|Cargo\.(toml|lock)|composer\.(json|lock)|package(-lock)?\.json|pom\.xml|packages\.lock\.json)/i.test(path)
          );
        });
        files = [...map.entries()].map(([path, content]) => ({ path, content }));
      }

      if (files.length === 0 && paths.length > 0) {
        step(STAGE.fetch, `Reading ${paths.length} project files`);
        files = [];
        for (const path of paths) {
          const content = await fetchFile(ref, token, path);
          if (content !== null) files.push({ path, content });
          if (files.length >= SCAN_LIMITS.maxFiles) break;
        }
      }
    }

    if (files.length === 0) {
      throw AppError.integration(
        'No dependency manifests were found in this repository.',
        'Supported: package-lock.json, yarn.lock, pnpm-lock.yaml, requirements.txt, poetry.lock, pyproject.toml, go.mod, Cargo.lock, composer.lock, pom.xml, build.gradle, packages.lock.json, Gemfile.lock, Dockerfile.',
      );
    }

    // -----------------------------------------------------------------------
    // 2. Parse into a component inventory
    // -----------------------------------------------------------------------
    step(STAGE.parse, 'Inspecting project');
    const detected = detect(files);
    const { components: inventory, notes: scanNotes } = buildInventory(detected);

    if (inventory.length === 0) {
      throw AppError.integration(
        'Dependency files were found but no components could be resolved from them.',
        'The manifest may use a format we cannot parse yet. Upload an SBOM as evidence in the meantime.',
      );
    }

    const fingerprint = fingerprintFor(inventory);
    const ecosystems = [...new Set(inventory.map((c) => c.ecosystem))];

    db.update(scans)
      .set({
        ref: resolvedRef,
        commitSha,
        fingerprint,
        ecosystemsJson: JSON.stringify(ecosystems),
        manifestsJson: JSON.stringify({
          manifests: detected.manifests.map((m) => m.path),
          policyFiles: Object.keys(detected.policyFiles),
          notes: scanNotes,
        }),
      })
      .where(eq(scans.id, scanId))
      .run();

    // Skip reprocessing when nothing changed — and never double-charge.
    const previous = db
      .select()
      .from(scans)
      .where(and(eq(scans.repositoryId, repositoryId), eq(scans.status, 'succeeded')))
      .all()
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .find((s) => s.id !== scanId);

    if (previous && previous.fingerprint === fingerprint && !payload.uploadedArchiveKey) {
      step(STAGE.done, 'No changes since the last scan');
      db.update(scans)
        .set({
          status: 'skipped',
          skippedReason: 'Dependency fingerprint unchanged since the previous scan.',
          finishedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          componentCount: previous.componentCount,
          vulnerabilityCount: previous.vulnerabilityCount,
          criticalCount: previous.criticalCount,
          highCount: previous.highCount,
          kevCount: previous.kevCount,
          readinessScore: previous.readinessScore,
        })
        .where(eq(scans.id, scanId))
        .run();

      return { skipped: true, reason: 'unchanged', componentCount: previous.componentCount };
    }

    step(STAGE.parse, 'Storing component inventory');
    const componentIds: string[] = [];
    db.transaction(() => {
      for (const component of inventory) {
        const id = newId('cmp');
        componentIds.push(id);
        db.insert(componentsTable)
          .values({
            id,
            orgId,
            scanId,
            repositoryId,
            name: component.name,
            version: component.version,
            ecosystem: component.ecosystem,
            purl: component.purl,
            group: component.group,
            licensesJson: JSON.stringify(component.licenses),
            scope: component.scope,
            manifestPath: component.manifestPath,
            isDirect: component.isDirect,
            createdAt: Date.now(),
          })
          .run();
      }
    });

    const storedComponents = db.select().from(componentsTable).where(eq(componentsTable.scanId, scanId)).all();

    // -----------------------------------------------------------------------
    // 3. SBOM
    // -----------------------------------------------------------------------
    step(STAGE.sbom, 'Generating SBOM');
    const project = repo.projectId ? db.select().from(projects).where(eq(projects.id, repo.projectId)).get() : null;
    const productName = project?.productName ?? repo.fullName ?? repo.name;
    const productVersion = project?.productVersion ?? resolvedRef;

    const sbomJson = buildCycloneDxJson({
      productName,
      productVersion,
      repositoryUrl: repo.url,
      components: componentsToSbomInput(storedComponents),
    });

    const jsonBuffer = Buffer.from(JSON.stringify(sbomJson, null, 2), 'utf8');
    const jsonKey = objectKey(orgId, 'sbom', 'bom.json', sha256(jsonBuffer));
    const stored = await storage().put(jsonKey, jsonBuffer, 'application/json');

    const serialNumber = String(sbomJson.serialNumber);
    db.insert(sboms)
      .values({
        id: newId('sbom'),
        orgId,
        repositoryId,
        scanId,
        format: 'cyclonedx-json',
        specVersion: '1.6',
        serialNumber,
        version: 1,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        componentCount: storedComponents.length,
        createdAt: Date.now(),
      })
      .run();

    // -----------------------------------------------------------------------
    // 4. Advisory matching
    // -----------------------------------------------------------------------
    step(STAGE.advisories, 'Checking advisories');
    const queries = buildQueries(
      storedComponents.map((c) => ({
        key: c.id,
        name: c.name,
        version: c.version,
        ecosystem: c.ecosystem as EcosystemId,
        purl: c.purl ?? undefined,
      })),
    );

    const matches = queries.length ? await queryBatch(queries) : [];
    const allIds = [...new Set(matches.flatMap((m) => m.vulnIds))];

    // Only hydrate advisories we have not already cached.
    const cached = new Set(
      db
        .select({ id: vulnerabilities.id })
        .from(vulnerabilities)
        .where(inArray(vulnerabilities.id, allIds.map((id) => `osv:${id}`)))
        .all()
        .map((r) => r.id),
    );

    const details = new Map<string, NormalisedVulnerability>();
    let hydrated = 0;
    for (const osvId of allIds) {
      if (cached.has(`osv:${osvId}`)) {
        const row = db.select().from(vulnerabilities).where(eq(vulnerabilities.id, `osv:${osvId}`)).get();
        if (row) details.set(osvId, rowToNormalised(row));
        continue;
      }
      const detail = await fetchVulnDetail(osvId);
      if (detail) {
        details.set(osvId, detail);
        upsertVulnerability(detail);
        hydrated += 1;
      }
    }

    // -----------------------------------------------------------------------
    // 5. Exploit intelligence (KEV + EPSS)
    // -----------------------------------------------------------------------
    step(STAGE.exploit, 'Correlating exploit intelligence');

    const links: Array<{ componentId: string; vulnerabilityId: string; fixedVersion: string | null }> = [];
    for (const match of matches) {
      const component = storedComponents.find((c) => c.id === match.key);
      if (!component || !component.version) continue;

      for (const osvId of match.vulnIds) {
        const detail = details.get(osvId);
        if (!detail) continue;
        if (detail.withdrawnAt && detail.withdrawnAt < Date.now()) continue;

        const applies = vulnAppliesTo(detail, component.name, component.version, component.ecosystem as EcosystemId);
        if (!applies) continue;

        links.push({
          componentId: component.id,
          vulnerabilityId: detail.id,
          fixedVersion: fixedVersionFor(detail, component.name, component.version, component.ecosystem as EcosystemId),
        });
      }
    }

    // KEV: prefer the local catalogue (synced from CISA) over the API.
    for (const link of links) {
      const vuln = db.select().from(vulnerabilities).where(eq(vulnerabilities.id, link.vulnerabilityId)).get();
      if (!vuln) continue;
      if (vuln.kevFlag) continue;
      const aliases = safeParse<string[]>(vuln.aliasesJson, []);
      const kev = isKev([vuln.sourceId, ...aliases]);
      if (kev) {
        db.update(vulnerabilities).set({ kevFlag: true, updatedAt: Date.now() }).where(eq(vulnerabilities.id, vuln.id)).run();
      }
    }

    db.transaction(() => {
      for (const link of links) {
        db.insert(componentVulnerabilities)
          .values({
            id: newId('cv'),
            orgId,
            scanId,
            repositoryId,
            componentId: link.componentId,
            vulnerabilityId: link.vulnerabilityId,
            state: 'open',
            fixedVersion: link.fixedVersion,
            detectedAt: Date.now(),
            updatedAt: Date.now(),
          })
          .onConflictDoNothing()
          .run();
      }
    });

    // EPSS enrichment for the CVEs we actually matched.
    //
    // The CVE id is usually an *alias* of the advisory record (OSV keys advisories
    // by GHSA/PYSEC id), so we resolve CVE -> vulnerability row ids up front and
    // update by primary key. Matching on `sourceId` would silently update nothing.
    const cveToVulnIds = new Map<string, Set<string>>();
    for (const link of links) {
      const v = db.select().from(vulnerabilities).where(eq(vulnerabilities.id, link.vulnerabilityId)).get();
      if (!v) continue;
      const aliases = safeParse<string[]>(v.aliasesJson, []);
      const cve = [v.sourceId ?? '', ...aliases].find((a) => a.startsWith('CVE-'));
      if (!cve) continue;
      const ids = cveToVulnIds.get(cve) ?? new Set<string>();
      ids.add(v.id);
      cveToVulnIds.set(cve, ids);
    }

    const cveIds = [...cveToVulnIds.keys()];
    if (cveIds.length) {
      const epss = await fetchEpss(cveIds);
      let enriched = 0;
      for (const [cve, score] of epss) {
        const ids = cveToVulnIds.get(cve);
        if (!ids?.size) continue;
        db.update(vulnerabilities)
          .set({ epssScore: score.epss, epssPercentile: score.percentile, updatedAt: Date.now() })
          .where(inArray(vulnerabilities.id, [...ids]))
          .run();
        enriched += ids.size;
      }
      log.info('epss enriched', { requested: cveIds.length, returned: epss.size, rows: enriched });
    }

    // -----------------------------------------------------------------------
    // 6. Tally + compliance
    // -----------------------------------------------------------------------
    const matchedVulns = [...new Set(links.map((l) => l.vulnerabilityId))]
      .map((id) => db.select().from(vulnerabilities).where(eq(vulnerabilities.id, id)).get())
      .filter((v): v is NonNullable<typeof v> => Boolean(v));

    const counts = {
      critical: matchedVulns.filter((v) => v.severity === 'critical').length,
      high: matchedVulns.filter((v) => v.severity === 'high').length,
      medium: matchedVulns.filter((v) => v.severity === 'medium').length,
      low: matchedVulns.filter((v) => v.severity === 'low').length,
      kev: matchedVulns.filter((v) => v.kevFlag).length,
    };

    db.update(scans)
      .set({
        componentCount: storedComponents.length,
        vulnerabilityCount: matchedVulns.length,
        criticalCount: counts.critical,
        highCount: counts.high,
        mediumCount: counts.medium,
        lowCount: counts.low,
        kevCount: counts.kev,
      })
      .where(eq(scans.id, scanId))
      .run();

    db.update(repositories)
      .set({
        lastScanId: scanId,
        lastScanAt: Date.now(),
        fingerprint,
        status: 'active',
        lastError: null,
        openCritical: counts.critical,
        openHigh: counts.high,
        openKev: counts.kev,
        updatedAt: Date.now(),
      })
      .where(eq(repositories.id, repositoryId))
      .run();

    step(STAGE.compliance, 'Calculating CRA posture');
    const readiness = evaluate(buildContext({ orgId, repositoryId }));

    db.update(scans)
      .set({
        status: 'succeeded',
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        readinessScore: readiness.score,
      })
      .where(eq(scans.id, scanId))
      .run();

    // Alert on anything that starts the Article 14 clock.
    if (counts.kev > 0) {
      db.insert(notifications)
        .values({
          id: newId('ntf'),
          orgId,
          type: 'kev_detected',
          title: 'Known exploited vulnerability detected',
          body: `${counts.kev} component(s) in ${repo.fullName ?? repo.name} match the CISA KEV catalogue. The Article 14 24-hour reporting clock may already be running.`,
          linkUrl: `/app/repos/${repositoryId}/vulnerabilities`,
          severity: 'critical',
          createdAt: Date.now(),
        })
        .run();
    }

    audit({
      orgId,
      action: 'scan.completed',
      targetType: 'repository',
      targetId: repositoryId,
      meta: { scanId, components: storedComponents.length, vulnerabilities: matchedVulns.length, ...counts },
    });

    step(STAGE.done, 'Complete');

    return {
      scanId,
      components: storedComponents.length,
      vulnerabilities: matchedVulns.length,
      hydrated,
      sbomKey: jsonKey,
      readiness: readiness.score,
      counts,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(scans)
      .set({
        status: 'failed',
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        errorMessage: message,
        errorCode: err instanceof AppError ? err.code : 'internal_error',
      })
      .where(eq(scans.id, scanId))
      .run();
    db.update(repositories)
      .set({ status: 'error', lastError: message, updatedAt: Date.now() })
      .where(eq(repositories.id, repositoryId))
      .run();
    throw err;
  }
}

/** Persists a normalised advisory. Idempotent: re-ingesting refreshes it. */
export function upsertVulnerability(detail: NormalisedVulnerability): void {
  const db = getDb();
  const values = {
    id: detail.id,
    source: detail.source,
    sourceId: detail.sourceId,
    aliasesJson: JSON.stringify(detail.aliases),
    summary: detail.summary,
    details: detail.details,
    severity: detail.severity,
    cvssScore: detail.cvssScore,
    cvssVector: detail.cvssVector,
    cvssVersion: detail.cvssVersion,
    weaknessesJson: JSON.stringify(detail.weaknesses),
    referencesJson: JSON.stringify(detail.references),
    affectedRangesJson: JSON.stringify(detail.affectedRanges),
    fixedVersionsJson: JSON.stringify(detail.fixedVersions),
    publishedAt: detail.publishedAt,
    modifiedAt: detail.modifiedAt,
    withdrawnAt: detail.withdrawnAt,
    rawJson: JSON.stringify(detail.raw),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  db.insert(vulnerabilities)
    .values(values)
    .onConflictDoUpdate({
      target: vulnerabilities.id,
      set: {
        summary: values.summary,
        details: values.details,
        severity: values.severity,
        cvssScore: values.cvssScore,
        cvssVector: values.cvssVector,
        aliasesJson: values.aliasesJson,
        referencesJson: values.referencesJson,
        affectedRangesJson: values.affectedRangesJson,
        fixedVersionsJson: values.fixedVersionsJson,
        modifiedAt: values.modifiedAt,
        withdrawnAt: values.withdrawnAt,
        rawJson: values.rawJson,
        updatedAt: Date.now(),
      },
    })
    .run();
}

function rowToNormalised(row: typeof vulnerabilities.$inferSelect): NormalisedVulnerability {
  return {
    id: row.id,
    source: row.source as 'osv',
    sourceId: row.sourceId,
    aliases: safeParse<string[]>(row.aliasesJson, []),
    summary: row.summary,
    details: row.details,
    severity: row.severity,
    cvssScore: row.cvssScore,
    cvssVector: row.cvssVector,
    cvssVersion: row.cvssVersion,
    weaknesses: safeParse<string[]>(row.weaknessesJson, []),
    references: safeParse<Array<{ type?: string; url: string }>>(row.referencesJson, []),
    affectedRanges: safeParse<unknown>(row.affectedRangesJson, []),
    fixedVersions: safeParse<string[]>(row.fixedVersionsJson, []),
    publishedAt: row.publishedAt,
    modifiedAt: row.modifiedAt,
    withdrawnAt: row.withdrawnAt,
    raw: safeParse<unknown>(row.rawJson, {}),
  };
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Regenerates an SBOM (and its XML twin) for an existing scan. */
export async function generateSbomForScan(orgId: string, scanId: string): Promise<{ jsonKey: string; xmlKey: string; componentCount: number }> {
  const db = getDb();
  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();
  if (!scan || scan.orgId !== orgId) throw AppError.notFound('Scan');

  const repo = db.select().from(repositories).where(eq(repositories.id, scan.repositoryId)).get();
  const comps = db.select().from(componentsTable).where(eq(componentsTable.scanId, scanId)).all();

  const json = buildCycloneDxJson({
    productName: repo?.fullName ?? repo?.name ?? 'product',
    productVersion: scan.ref ?? '1.0.0',
    repositoryUrl: repo?.url,
    components: componentsToSbomInput(comps),
  });

  const jsonBuffer = Buffer.from(JSON.stringify(json, null, 2), 'utf8');
  const jsonKey = objectKey(orgId, 'sbom', 'bom.json', sha256(jsonBuffer));
  const storedJson = await storage().put(jsonKey, jsonBuffer, 'application/json');

  const xml = buildCycloneDxXml(json);
  const xmlBuffer = Buffer.from(xml, 'utf8');
  const xmlKey = objectKey(orgId, 'sbom', 'bom.xml', sha256(xmlBuffer));
  await storage().put(xmlKey, xmlBuffer, 'application/xml');

  db.insert(sboms)
    .values({
      id: newId('sbom'),
      orgId,
      repositoryId: scan.repositoryId,
      scanId,
      format: 'cyclonedx-xml',
      specVersion: '1.6',
      serialNumber: `${String(json.serialNumber)}-xml`,
      version: 1,
      storageKey: xmlKey,
      sizeBytes: xmlBuffer.byteLength,
      sha256: sha256(xmlBuffer),
      componentCount: comps.length,
      createdAt: Date.now(),
    })
    .run();

  return { jsonKey: storedJson.key, xmlKey, componentCount: comps.length };
}

export { normaliseOsvVuln };
