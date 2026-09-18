import { Hono } from 'hono';
import type { AppEnv } from '../core/context.js';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  componentVulnerabilities,
  components,
  integrations,
  projects,
  repositories,
  scans,
  sboms,
  vulnerabilities,
} from '../db/schema.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { sha256 } from '../core/crypto.js';
import { audit } from '../core/audit.js';
import { ok, created, binaryBody, parseBody, errorResponse, PaginationSchema, paginate } from '../core/http.js';
import { requireAuth, requireOrg } from '../core/auth.js';
import { enqueue, getJobDetail } from '../jobs/queue.js';
import { reserveCredits } from '../modules/billing/ledger.js';
import {storage, objectKey} from '../core/storage.js';
import { env } from '../env.js';
import {listInstallationRepositories} from '../scan/source.js';
import { buildContext, evaluate } from '../compliance/engine.js';
import { generateSbomForScan } from '../scan/service.js';
import type { AppContext } from '../core/context.js';

export const repoRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Discovery & registration
// ---------------------------------------------------------------------------

/** Repositories available through the installed GitHub App. */
repoRoutes.get('/:orgId/sources/github', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const rows = getDb().select().from(integrations).where(eq(integrations.orgId, orgId)).all();
  const active = rows.filter((i) => i.status === 'active' && i.provider === 'github');

  if (active.length === 0) {
    return ok(c, { connected: false, repositories: [], reason: 'No GitHub installation connected.' });
  }

  try {
    const repos = await listInstallationRepositories(active[0]!.installationId);
    return ok(c, {
      connected: true,
      installationId: active[0]!.installationId,
      accountLogin: active[0]!.accountLogin,
      repositories: repos.map((r) => ({
        externalId: String(r.id),
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        url: r.html_url,
      })),
    });
  } catch (err) {
    return ok(c, {
      connected: true,
      repositories: [],
      reason: err instanceof Error ? err.message : 'Could not list repositories.',
    });
  }
});

const AddRepoSchema = z.object({
  externalId: z.string().optional(),
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().optional(),
  url: z.string().url().optional(),
  defaultBranch: z.string().optional(),
  visibility: z.string().optional(),
  projectId: z.string().optional(),
  provider: z.enum(['github', 'gitlab', 'upload', 'other']).default('github'),
  autoScan: z.boolean().default(true),
});

repoRoutes.post('/:orgId/repositories', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const body = await parseBody(c, AddRepoSchema);
  const db = getDb();

  const existing = db
    .select()
    .from(repositories)
    .where(and(eq(repositories.orgId, orgId), eq(repositories.name, body.name), eq(repositories.owner, body.owner)))
    .get();
  if (existing) return ok(c, { id: existing.id, alreadyAdded: true });

  const integration = db.select().from(integrations).where(eq(integrations.orgId, orgId)).get();
  const id = newId('repo');

  db.insert(repositories)
    .values({
      id,
      orgId,
      projectId: body.projectId ?? null,
      integrationId: integration?.id ?? null,
      provider: body.provider,
      externalId: body.externalId ?? null,
      owner: body.owner,
      name: body.name,
      fullName: body.fullName ?? `${body.owner}/${body.name}`,
      defaultBranch: body.defaultBranch ?? 'main',
      url: body.url ?? null,
      visibility: body.visibility ?? null,
      badgeToken: newId('repo'),
      monitoringEnabled: true,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  audit({ orgId, action: 'repository.added', targetType: 'repository', targetId: id, meta: { fullName: body.fullName }, actorUserId: c.get('auth')!.user.id });

  // Scan immediately so the user sees value in the first minute.
  if (body.autoScan) {
    const scanId = await startScan({ orgId, repositoryId: id, userId: c.get('auth')!.user.id, trigger: 'onboarding' });
    return created(c, { id, scanId });
  }

  return created(c, { id });
});

// ---------------------------------------------------------------------------
// Listing & detail
// ---------------------------------------------------------------------------

repoRoutes.get('/:orgId/repositories', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const rows = getDb()
    .select()
    .from(repositories)
    .where(and(eq(repositories.orgId, orgId), eq(repositories.status, 'active')))
    .orderBy(desc(repositories.updatedAt))
    .all();
  return ok(c, rows);
});

repoRoutes.get('/:orgId/repositories/:repositoryId', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');
  const repo = getDb().select().from(repositories).where(eq(repositories.id, repositoryId)).get();
  if (!repo || repo.orgId !== orgId) throw AppError.notFound('Repository');

  const lastScan = repo.lastScanId ? getDb().select().from(scans).where(eq(scans.id, repo.lastScanId)).get() : null;
  const project = repo.projectId ? getDb().select().from(projects).where(eq(projects.id, repo.projectId)).get() : null;

  return ok(c, { repository: repo, lastScan: lastScan ?? null, project: project ?? null });
});

repoRoutes.patch('/:orgId/repositories/:repositoryId', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');
  const repo = getDb().select().from(repositories).where(eq(repositories.id, repositoryId)).get();
  if (!repo || repo.orgId !== orgId) throw AppError.notFound('Repository');

  const body = await parseBody(
    c,
    z.object({
      monitoringEnabled: z.boolean().optional(),
      schedule: z.enum(['hourly', 'daily', 'weekly']).optional(),
      projectId: z.string().nullable().optional(),
      badgeEnabled: z.boolean().optional(),
      status: z.enum(['active', 'paused']).optional(),
    }),
  );

  getDb()
    .update(repositories)
    .set({
      ...(body.monitoringEnabled !== undefined ? { monitoringEnabled: body.monitoringEnabled } : {}),
      ...(body.schedule ? { schedule: body.schedule } : {}),
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      ...(body.badgeEnabled !== undefined ? { badgeEnabled: body.badgeEnabled } : {}),
      ...(body.status ? { status: body.status } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(repositories.id, repositoryId))
    .run();

  return ok(c, { id: repositoryId, updated: true });
});

repoRoutes.delete('/:orgId/repositories/:repositoryId', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');
  const repo = getDb().select().from(repositories).where(eq(repositories.id, repositoryId)).get();
  if (!repo || repo.orgId !== orgId) throw AppError.notFound('Repository');

  // Deletion propagates: scans, components, findings and SBOM metadata go too.
  getDb().transaction(() => {
    getDb().update(repositories)
      .set({ status: 'deleted', deletedAt: Date.now(), monitoringEnabled: false, updatedAt: Date.now() })
      .where(eq(repositories.id, repositoryId))
      .run();
    getDb().delete(componentVulnerabilities).where(eq(componentVulnerabilities.repositoryId, repositoryId)).run();
    getDb().delete(sboms).where(eq(sboms.repositoryId, repositoryId)).run();
  });

  audit({ orgId, action: 'repository.deleted', targetType: 'repository', targetId: repositoryId, actorUserId: c.get('auth')!.user.id });
  return ok(c, { deleted: true });
});

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export async function startScan(input: {
  orgId: string;
  repositoryId: string;
  userId?: string;
  apiKeyId?: string;
  trigger: string;
  ref?: string;
  uploadedArchiveKey?: string;
  free?: boolean;
}): Promise<string> {
  const db = getDb();
  const repo = db.select().from(repositories).where(eq(repositories.id, input.repositoryId)).get();
  if (!repo || repo.orgId !== input.orgId) throw AppError.notFound('Repository');

  // Reserve credits first: no balance, no job.
  const reservation = reserveCredits({
    orgId: input.orgId,
    userId: input.userId,
    apiKeyId: input.apiKeyId,
    action: 'scan.repository',
    resourceType: 'repository',
    resourceId: input.repositoryId,
    meta: { trigger: input.trigger },
    free: !env.BILLING_ENABLED || input.free,
  });

  const scanId = newId('scan');
  db.insert(scans)
    .values({
      id: scanId,
      orgId: input.orgId,
      repositoryId: input.repositoryId,
      trigger: input.trigger as 'manual' | 'push' | 'schedule' | 'api' | 'action' | 'onboarding',
      ref: input.ref ?? repo.defaultBranch ?? null,
      status: 'queued',
      creditsCharged: reservation.credits,
      createdAt: Date.now(),
    })
    .run();

  const job = enqueue({
    type: 'scan.repository',
    orgId: input.orgId,
    dedupeKey: `scan:${input.repositoryId}`,
    payload: {
      orgId: input.orgId,
      repositoryId: input.repositoryId,
      scanId,
      trigger: input.trigger,
      ref: input.ref,
      uploadedArchiveKey: input.uploadedArchiveKey,
      usageEventId: reservation.usageEventId,
    },
  });

  db.update(scans).set({ jobId: job.id }).where(eq(scans.id, scanId)).run();
  return scanId;
}

repoRoutes.post('/:orgId/repositories/:repositoryId/scan', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');
  // The body is optional and tolerant: a scan with no body at all is valid
  // (the repository's default branch is used), so parsing must never 400 here.
  const body = (await c.req.json().catch(() => ({}))) as { ref?: unknown };
  const ref = typeof body?.ref === 'string' && body.ref.trim() ? body.ref.trim() : undefined;

  const scanId = await startScan({ orgId, repositoryId, userId: c.get('auth')!.user.id, trigger: 'manual', ref });
  return created(c, { scanId });
});

/** Scans a source archive without connecting any git provider. */
repoRoutes.post('/:orgId/repositories/upload', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const contentType = c.req.header('content-type') ?? '';

  if (!contentType.includes('multipart/form-data')) {
    throw AppError.badRequest('Upload a .tar.gz or .tgz archive as multipart/form-data.');
  }

  const form = await c.req.parseBody();
  const file = form.file;
  if (!file || typeof file === 'string') throw AppError.badRequest('No archive was uploaded.');

  const buffer = Buffer.from(await (file as File).arrayBuffer());
  if (buffer.byteLength === 0) throw AppError.badRequest('That archive is empty.');
  if (buffer.byteLength > env.MAX_UPLOAD_BYTES) {
    throw AppError.badRequest(`Archives must be under ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }

  // Fail here, not twenty seconds later inside the worker: a .zip is the most
  // common thing people upload, and "not a valid gzip archive" after a scan has
  // already been charged is the kind of dead end that loses a customer.
  const originalName = String((file as File).name ?? '');
  const looksGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (!looksGzip) {
    throw AppError.badRequest(
      `Uploads must be a gzipped tar archive (.tar.gz or .tgz)${originalName ? ` — "${originalName}" is not` : ''}. Create one with: tar -czf repo.tar.gz .`,
    );
  }

  const name = String((form.name as string) ?? (file as File).name ?? 'uploaded-repository').replace(/\.(tar\.gz|tgz)$/i, '');
  const key = objectKey(orgId, 'uploads', `${name}.tar.gz`, sha256(buffer));
  await storage().put(key, buffer, 'application/gzip');

  const id = newId('repo');
  getDb()
    .insert(repositories)
    .values({
      id,
      orgId,
      provider: 'upload',
      name,
      fullName: name,
      owner: null,
      defaultBranch: 'upload',
      status: 'active',
      monitoringEnabled: false,
      badgeToken: newId('repo'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  const scanId = await startScan({
    orgId,
    repositoryId: id,
    userId: c.get('auth')!.user.id,
    trigger: 'manual',
    uploadedArchiveKey: key,
  });

  audit({ orgId, action: 'repository.uploaded', targetType: 'repository', targetId: id, meta: { key, bytes: buffer.byteLength } });
  return created(c, { id, scanId });
});

// ---------------------------------------------------------------------------
// Scan results
// ---------------------------------------------------------------------------

repoRoutes.get('/:orgId/scans', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const { page, perPage } = PaginationSchema.parse({
    page: c.req.query('page') ?? 1,
    perPage: c.req.query('perPage') ?? 25,
  });

  const rows = getDb()
    .select()
    .from(scans)
    .where(eq(scans.orgId, orgId))
    .orderBy(desc(scans.createdAt))
    .all();

  const slice = rows.slice((page - 1) * perPage, page * perPage);
  return ok(c, slice, paginate(rows.length, page, perPage));
});

repoRoutes.get('/:orgId/scans/:scanId', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const scanId = c.req.param('scanId');
  const scan = getDb().select().from(scans).where(eq(scans.id, scanId)).get();
  if (!scan || scan.orgId !== orgId) throw AppError.notFound('Scan');

  const job = scan.jobId ? getJobDetail(scan.jobId) : null;
  return ok(c, { scan, job });
});

repoRoutes.get('/:orgId/scans/:scanId/status', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const scanId = c.req.param('scanId');
  const scan = getDb().select().from(scans).where(eq(scans.id, scanId)).get();
  if (!scan || scan.orgId !== orgId) throw AppError.notFound('Scan');

  const job = scan.jobId ? getJobDetail(scan.jobId) : null;
  return ok(c, {
    status: scan.status,
    progressPct: job?.progressPct ?? (scan.status === 'succeeded' ? 100 : 0),
    message: job?.progressMessage ?? scan.progressMessage ?? scan.errorMessage ?? null,
    events: job?.events ?? [],
    error: scan.errorMessage,
    ready: scan.status === 'succeeded' || scan.status === 'skipped' || scan.status === 'failed',
  });
});

repoRoutes.get('/:orgId/scans/:scanId/components', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const scanId = c.req.param('scanId');
  const scan = getDb().select().from(scans).where(eq(scans.id, scanId)).get();
  if (!scan || scan.orgId !== orgId) throw AppError.notFound('Scan');

  const q = c.req.query('q')?.toLowerCase();
  const ecosystem = c.req.query('ecosystem');
  let rows = getDb().select().from(components).where(eq(components.scanId, scanId)).all();

  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.purl ?? '').toLowerCase().includes(q));
  if (ecosystem) rows = rows.filter((r) => r.ecosystem === ecosystem);

  return ok(c, rows);
});

repoRoutes.get('/:orgId/scans/:scanId/vulnerabilities', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const scanId = c.req.param('scanId');
  const scan = getDb().select().from(scans).where(eq(scans.id, scanId)).get();
  if (!scan || scan.orgId !== orgId) throw AppError.notFound('Scan');

  const links = getDb().select().from(componentVulnerabilities).where(eq(componentVulnerabilities.scanId, scanId)).all();
  const comps = getDb().select().from(components).where(eq(components.scanId, scanId)).all();
  const vulns = getDb().select().from(vulnerabilities).all();

  const compById = new Map(comps.map((c2) => [c2.id, c2]));
  const vulnById = new Map(vulns.map((v) => [v.id, v]));

  const rows = links
    .map((link) => ({
      id: link.id,
      state: link.state,
      fixedVersion: link.fixedVersion,
      exploitability: link.exploitability,
      exposure: link.exposure,
      remediation: link.remediation,
      slaDueAt: link.slaDueAt,
      detectedAt: link.detectedAt,
      component: compById.get(link.componentId) ?? null,
      vulnerability: vulnById.get(link.vulnerabilityId) ?? null,
    }))
    .filter((r) => r.vulnerability !== null)
    .sort((a, b) => severityWeight(b.vulnerability!.severity) - severityWeight(a.vulnerability!.severity));

  return ok(c, rows);
});

function severityWeight(severity: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 }[severity] ?? 0;
}

repoRoutes.post('/:orgId/scans/:scanId/sbom', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const scanId = c.req.param('scanId');
  const result = await generateSbomForScan(orgId, scanId);
  return ok(c, result);
});

repoRoutes.get('/:orgId/repositories/:repositoryId/sbom/latest', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');
  const row = getDb()
    .select()
    .from(sboms)
    .where(and(eq(sboms.orgId, orgId), eq(sboms.repositoryId, repositoryId)))
    .orderBy(desc(sboms.createdAt))
    .get();

  if (!row) throw AppError.notFound('SBOM');
  const content = await storage().get(row.storageKey);
  if (!content) throw AppError.notFound('SBOM file');

  const isXml = row.format === 'cyclonedx-xml';
  return binaryBody(
    c,
    content,
    isXml ? 'application/xml' : 'application/json',
    `sbom-${row.specVersion}.${isXml ? 'xml' : 'json'}`,
  );
});

/** Re-evaluates readiness on demand (for example after uploading evidence). */
repoRoutes.post('/:orgId/repositories/:repositoryId/assess', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');
  const repo = getDb().select().from(repositories).where(eq(repositories.id, repositoryId)).get();
  if (!repo || repo.orgId !== orgId) throw AppError.notFound('Repository');

  const result = evaluate(buildContext({ orgId, repositoryId }));
  return ok(c, result);
});

repoRoutes.onError((err, c) => errorResponse(c as AppContext, err));
