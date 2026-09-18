import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { repositories, scans } from '../db/schema.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { created, ok, errorResponse, binaryBody } from '../core/http.js';
import { requireAuth, requireScope } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { enqueue, getJobDetail } from '../jobs/queue.js';
import { storage } from '../core/storage.js';
import { env } from '../env.js';
import { log } from '../core/logger.js';
import { sboms } from '../db/schema.js';
import { desc } from 'drizzle-orm';
import type { AppEnv, AppContext } from '../core/context.js';

/**
 * CI integration.
 *
 * Used by the GitHub Action. Authentication is by API key only (a CI runner has
 * no browser session), the archive arrives as multipart, and the request blocks
 * until the scan resolves so the workflow can fail the build on the result.
 *
 * This is deliberately a separate surface from the interactive upload route:
 * different auth, different response shape, different failure semantics.
 */

export const ciRoutes = new Hono<AppEnv>();

const SCAN_TIMEOUT_MS = 180_000;
const POLL_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function uploadAndScan(c: AppContext) {
  const auth = c.get('auth')!;
  const orgId = auth.orgId!;

  const form = await c.req.parseBody();
  const file = form.file;
  if (!file || typeof file === 'string') {
    throw AppError.badRequest('No archive was uploaded.', 'Send the repository as a .tar.gz in the `file` field.');
  }

  const buffer = Buffer.from(await (file as File).arrayBuffer());
  if (buffer.byteLength === 0) throw AppError.badRequest('The uploaded archive is empty.');
  if (buffer.byteLength > env.MAX_UPLOAD_BYTES) {
    throw AppError.badRequest(`Archives must be under ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }

  const repository = String(form.repository ?? '').trim();
  if (!repository) throw AppError.badRequest('`repository` is required (owner/name).');
  const ref = String(form.ref ?? 'main').trim() || 'main';
  const commitSha = form.commit ? String(form.commit) : null;
  const failOn = String(form.failOn ?? 'none').trim();

  const [owner, name] = repository.split('/');
  if (!owner || !name) throw AppError.badRequest('`repository` must be in owner/name form.');

  const db = getDb();

  // CI scans upsert the repository: the same service builds many times a day,
  // and requiring a human to register each one first would defeat the point.
  let repo = db
    .select()
    .from(repositories)
    .where(and(eq(repositories.orgId, orgId), eq(repositories.owner, owner), eq(repositories.name, name)))
    .get();

  if (!repo) {
    const id = newId('repo');
    db.insert(repositories)
      .values({
        id,
        orgId,
        provider: 'github',
        owner,
        name,
        fullName: repository,
        url: `https://github.com/${repository}`,
        defaultBranch: ref,
        status: 'active',
        monitoringEnabled: false,
        badgeToken: newId('repo'),
        badgeEnabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
    repo = db.select().from(repositories).where(eq(repositories.id, id)).get()!;
  } else {
    db.update(repositories).set({ defaultBranch: ref, updatedAt: Date.now() }).where(eq(repositories.id, repo.id)).run();
  }

  const scanId = newId('scan');
  db.insert(scans)
    .values({
      id: scanId,
      orgId,
      repositoryId: repo.id,
      trigger: 'action',
      ref,
      commitSha,
      status: 'queued',
      createdAt: Date.now(),
    })
    .run();

  const { reserveCredits, settleUsage } = await import('../modules/billing/ledger.js');
  const reservation = reserveCredits({
    orgId,
    userId: auth.user.id,
    action: 'scan.repository',
    resourceType: 'scan',
    resourceId: scanId,
    free: !env.BILLING_ENABLED,
    meta: { source: 'ci' },
  });

  const { sha256 } = await import('../core/crypto.js');
  const { objectKey } = await import('../core/storage.js');
  const key = objectKey(orgId, 'ci', `${repository.replace('/', '-')}-${ref}.tar.gz`, sha256(buffer));
  await storage().put(key, buffer, 'application/gzip');

  enqueue({
    type: 'scan.repository',
    orgId,
    payload: {
      orgId,
      repositoryId: repo.id,
      scanId,
      trigger: 'action',
      ref,
      uploadedArchiveKey: key,
      usageEventId: reservation.usageEventId,
    },
    dedupeKey: `scan:${repo.id}:${ref}:ci`,
  });

  audit({ orgId, action: 'ci.scan_started', targetType: 'scan', targetId: scanId, meta: { repository, ref } });

  // Block until the scan resolves so the workflow can act on the result.
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const current = db.select().from(scans).where(eq(scans.id, scanId)).get();
    if (!current) break;
    if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'skipped') break;
  }

  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();

  if (!scan || scan.status === 'failed') {
    if (reservation.usageEventId) settleUsage(reservation.usageEventId, 'release', 'ci scan failed');
    throw AppError.integration(
      'The scan did not complete.',
      scan?.errorMessage ?? 'The job may still be queued; retry, or run the worker process.',
    );
  }

  const sbom = db
    .select()
    .from(sboms)
    .where(and(eq(sboms.orgId, orgId), eq(sboms.repositoryId, repo.id)))
    .orderBy(desc(sboms.createdAt))
    .get();

  const result = {
    scanId,
    repositoryId: repo.id,
    repository,
    ref,
    commitSha,
    status: scan.status,
    readinessScore: scan.readinessScore,
    counts: {
      components: scan.componentCount,
      vulnerabilities: scan.vulnerabilityCount,
      critical: scan.criticalCount,
      high: scan.highCount,
      medium: scan.mediumCount,
      low: scan.lowCount,
      knownExploited: scan.kevCount,
    },
    creditsCharged: scan.creditsCharged,
    durationMs: scan.durationMs,
    failOn,
    sbomUrl: sbom ? `/api/v1/ci/sbom/${sbom.id}` : null,
    dashboardUrl: `/app/repositories/${repo.id}`,
  };

  return result;
}

ciRoutes.post('/scan', requireAuth, requireScope('scan'), async (c) => {
  const result = await uploadAndScan(c as AppContext);
  return created(c, result);
});

ciRoutes.get('/scan/:scanId', requireAuth, async (c) => {
  const orgId = c.get('auth')!.orgId!;
  const scan = getDb().select().from(scans).where(eq(scans.id, c.req.param('scanId'))).get();
  if (!scan || scan.orgId !== orgId) throw AppError.notFound('Scan');

  const job = scan.jobId ? getJobDetail(scan.jobId) : null;

  return ok(c, {
    scanId: scan.id,
    status: scan.status,
    progressPct: job?.progressPct ?? (scan.status === 'succeeded' ? 100 : 0),
    message: job?.progressMessage ?? scan.progressMessage ?? scan.errorMessage ?? null,
    counts: {
      components: scan.componentCount,
      vulnerabilities: scan.vulnerabilityCount,
      critical: scan.criticalCount,
      high: scan.highCount,
      medium: scan.mediumCount,
      low: scan.lowCount,
      knownExploited: scan.kevCount,
    },
    readinessScore: scan.readinessScore,
    error: scan.errorMessage,
  });
});

/** SBOM fetch for CI artefacts (authenticated by API key). */
ciRoutes.get('/sbom/:sbomId', requireAuth, async (c) => {
  const orgId = c.get('auth')!.orgId!;
  const row = getDb().select().from(sboms).where(eq(sboms.id, c.req.param('sbomId'))).get();
  if (!row || row.orgId !== orgId) throw AppError.notFound('SBOM');

  const content = await storage().get(row.storageKey);
  if (!content) throw AppError.notFound('SBOM file');

  return binaryBody(
    c,
    content,
    row.format === 'cyclonedx-xml' ? 'application/xml' : 'application/json',
    `sbom-${row.specVersion}.${row.format === 'cyclonedx-xml' ? 'xml' : 'json'}`,
  );
});

ciRoutes.onError((err, c) => errorResponse(c as AppContext, err));

void log;
