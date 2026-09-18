import { Hono } from 'hono';
import type { AppEnv } from '../core/context.js';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {complianceAssessments, complianceControls, evidence, repositories, scans} from '../db/schema.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { sha256Hex, storage, objectKey, assertSafeKey } from '../core/storage.js';
import {ok, created, parseBody, errorResponse} from '../core/http.js';
import { requireAuth, requireOrg } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { env } from '../env.js';
import { buildContext, evaluate, type ControlStatus } from '../compliance/engine.js';
import { CONTROL_CATALOGUE } from '../compliance/controls.js';
import { evaluateEstate, attentionFor, inventorySummary } from '../compliance/estate.js';
import { buildCycloneDxJson, componentsToSbomInput, vulnsToSbomInput } from '../sbom/cyclonedx.js';
import { components as componentsTable, componentVulnerabilities, vulnerabilities } from '../db/schema.js';
import { aiProvider } from '../ai/provider.js';
import { reserveCredits } from '../modules/billing/ledger.js';
import type { AppContext } from '../core/context.js';

export const complianceRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * Readiness for one repository.
 *
 * The engine returns verdicts keyed by control id; this endpoint joins them to
 * the catalogue so the screen receives the *product* shape: a human title, the
 * domain it belongs to, the CRA obligation it maps to, and the evidence behind
 * the verdict. Control ids are still present, because an engineer will need
 * them — they are just not the only thing on offer.
 */
complianceRoutes.get('/:orgId/repositories/:repositoryId/readiness', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');
  const repo = getDb().select().from(repositories).where(eq(repositories.id, repositoryId)).get();
  if (!repo || repo.orgId !== orgId) throw AppError.notFound('Repository');

  const result = evaluate(buildContext({ orgId, repositoryId }));

  const catalogue = new Map(CONTROL_CATALOGUE.map((control) => [control.id, control]));
  const reviewed = new Map(
    getDb()
      .select()
      .from(complianceAssessments)
      .where(and(eq(complianceAssessments.orgId, orgId), eq(complianceAssessments.repositoryId, repositoryId)))
      .all()
      .map((row) => [row.controlId, row]),
  );

  const controls = (result.assessments ?? []).map((assessment) => {
    const definition = catalogue.get(assessment.controlId);
    const review = reviewed.get(assessment.controlId);
    return {
      id: assessment.controlId,
      key: assessment.controlId,
      controlId: assessment.controlId,
      title: definition?.title ?? assessment.controlId,
      domain: definition?.domain ?? 'Governance',
      domainName: definition?.domain ?? 'Governance',
      weight: definition?.weight ?? 1,
      legalRef: definition?.legalRef ?? null,
      obligation: definition?.obligation ?? null,
      description: definition?.description ?? null,
      status: assessment.status,
      score: assessment.score,
      confidence: assessment.confidence,
      rationale: assessment.rationale,
      remediation: assessment.remediation,
      evidence: assessment.evidence ?? [],
      reviewedAt: review?.reviewedAt ?? null,
    };
  });

  // Domains, named and counted, worst first — the order a reader wants.
  const byDomain = new Map<string, { id: string; name: string; controls: number; total: number; scored: number }>();
  for (const control of controls) {
    const entry = byDomain.get(control.domain) ?? {
      id: control.domain,
      name: control.domain,
      controls: 0,
      total: 0,
      scored: 0,
    };
    entry.controls += 1;
    if (control.status !== 'not_applicable') {
      entry.total += control.score;
      entry.scored += 1;
    }
    byDomain.set(control.domain, entry);
  }
  const domains = [...byDomain.values()]
    .map((d) => ({
      id: d.id,
      name: d.name,
      controls: d.controls,
      score: d.scored ? Math.round(d.total / d.scored) : 100,
    }))
    .sort((a, b) => a.score - b.score);

  return ok(c, {
    score: result.score,
    grade: result.grade,
    evaluatedAt: Date.now(),
    totals: {
      passed: result.totals.passed,
      partial: result.totals.partial,
      missing: result.totals.missing,
      needs_review: result.totals.needsReview,
      not_applicable: result.totals.notApplicable,
    },
    domains,
    controls,
    assessments: controls,
    topActions: (result.actions ?? []).map((action) => action.title),
    actions: result.actions ?? [],
  });
});

complianceRoutes.get('/:orgId/readiness', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const estate = evaluateEstate(orgId);
  const attention = attentionFor(orgId);
  const inventory = inventorySummary(orgId);

  return ok(c, {
    score: estate.score,
    grade: estate.grade,
    evaluatedAt: estate.evaluatedAt,
    totals: estate.totals,
    domains: estate.domains,
    assessments: estate.assessments,
    topActions: estate.actions.map((a) => a.title),
    actions: estate.actions,
    attention,
    inventory,
    repositories: estate.repositories,
    worst: [...estate.repositories].sort((a, b) => a.score - b.score).slice(0, 3),
  });
});

complianceRoutes.get('/:orgId/controls', requireAuth, requireOrg('viewer'), async (c) => {
  const rows = getDb()
    .select()
    .from(complianceControls)
    .where(eq(complianceControls.isActive, true))
    .orderBy(asc(complianceControls.sortOrder))
    .all();
  return ok(c, rows);
});

complianceRoutes.get('/:orgId/repositories/:repositoryId/assessments', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');

  const rows = getDb()
    .select({
      id: complianceAssessments.id,
      controlId: complianceAssessments.controlId,
      status: complianceAssessments.status,
      score: complianceAssessments.score,
      confidence: complianceAssessments.confidence,
      rationale: complianceAssessments.rationale,
      evidence: complianceAssessments.evidenceJson,
      remediation: complianceAssessments.remediation,
      reviewedAt: complianceAssessments.reviewedAt,
      updatedAt: complianceAssessments.updatedAt,
      title: complianceControls.title,
      domain: complianceControls.domain,
      legalRef: complianceControls.legalRef,
      weight: complianceControls.weight,
      description: complianceControls.description,
      obligation: complianceControls.obligation,
      references: complianceControls.referencesJson,
      sortOrder: complianceControls.sortOrder,
    })
    .from(complianceAssessments)
    .innerJoin(complianceControls, eq(complianceControls.id, complianceAssessments.controlId))
    .where(and(eq(complianceAssessments.orgId, orgId), eq(complianceAssessments.repositoryId, repositoryId)))
    .orderBy(asc(complianceControls.sortOrder))
    .all();

  return ok(c, rows);
});

const ReviewSchema = z.object({
  status: z.enum(['passed', 'partial', 'missing', 'not_applicable', 'needs_review']).optional(),
  note: z.string().max(2000).optional(),
  ownerUserId: z.string().nullable().optional(),
});

/** Lets a human override or acknowledge a control, with an audit trail. */
complianceRoutes.post('/:orgId/repositories/:repositoryId/assessments/:controlId/review', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');
  const controlId = c.req.param('controlId');
  const body = await parseBody(c, ReviewSchema);
  const auth = c.get('auth')!;

  const existing = getDb()
    .select()
    .from(complianceAssessments)
    .where(
      and(
        eq(complianceAssessments.orgId, orgId),
        eq(complianceAssessments.repositoryId, repositoryId),
        eq(complianceAssessments.controlId, controlId),
      ),
    )
    .get();

  if (!existing) throw AppError.notFound('Assessment');

  getDb()
    .update(complianceAssessments)
    .set({
      ...(body.status ? { status: body.status as ControlStatus, score: body.status === 'passed' ? 1 : body.status === 'partial' ? 0.5 : 0 } : {}),
      reviewedByUserId: auth.user.id,
      reviewedAt: Date.now(),
      ownerUserId: body.ownerUserId === undefined ? existing.ownerUserId : body.ownerUserId,
      rationale: body.note ? `${existing.rationale}\n\nReview note: ${body.note}` : existing.rationale,
      updatedAt: Date.now(),
    })
    .where(eq(complianceAssessments.id, existing.id))
    .run();

  audit({
    orgId,
    action: 'assessment.reviewed',
    targetType: 'compliance_assessment',
    targetId: existing.id,
    meta: { controlId, status: body.status ?? null, note: body.note ?? null },
    actorUserId: auth.user.id,
  });

  return ok(c, { id: existing.id, reviewed: true });
});

// ---------------------------------------------------------------------------
// Evidence vault
// ---------------------------------------------------------------------------

complianceRoutes.get('/:orgId/evidence', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.query('repositoryId');

  const rows = repositoryId
    ? getDb().select().from(evidence).where(and(eq(evidence.orgId, orgId), eq(evidence.repositoryId, repositoryId))).all()
    : getDb().select().from(evidence).where(eq(evidence.orgId, orgId)).all();

  return ok(c, rows.sort((a, b) => b.createdAt - a.createdAt));
});

complianceRoutes.post('/:orgId/evidence', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const auth = c.get('auth')!;
  const contentType = c.req.header('content-type') ?? '';

  if (!contentType.includes('multipart/form-data')) {
    throw AppError.badRequest('Upload the evidence file as multipart/form-data.');
  }

  const form = await c.req.parseBody();
  const file = form.file;
  if (!file || typeof file === 'string') throw AppError.badRequest('No file was uploaded.');

  const buffer = Buffer.from(await (file as File).arrayBuffer());
  if (buffer.byteLength === 0) throw AppError.badRequest('That file is empty.');
  if (buffer.byteLength > env.MAX_UPLOAD_BYTES) {
    throw AppError.badRequest(`Files must be under ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }

  const title = String(form.title ?? (file as File).name ?? 'Untitled evidence');
  const type = String(form.type ?? 'document');
  const repositoryId = form.repositoryId ? String(form.repositoryId) : null;
  const controlIds = form.controlIds ? String(form.controlIds).split(',').map((s) => s.trim()).filter(Boolean) : [];

  if (repositoryId) {
    const repo = getDb().select().from(repositories).where(eq(repositories.id, repositoryId)).get();
    if (!repo || repo.orgId !== orgId) throw AppError.notFound('Repository');
  }

  const digest = sha256Hex(buffer);
  const fileName = (file as File).name ?? 'evidence.bin';
  const key = objectKey(orgId, 'evidence', fileName, digest);
  const stored = await storage().put(key, buffer, (file as File).type || 'application/octet-stream');

  const seqRow = getDb()
    .select({ max: sql<number>`coalesce(max(${evidence.seq}), 0)` })
    .from(evidence)
    .where(eq(evidence.orgId, orgId))
    .get();

  const id = newId('evd');
  getDb()
    .insert(evidence)
    .values({
      id,
      orgId,
      repositoryId,
      scanId: form.scanId ? String(form.scanId) : null,
      type: type as 'document' | 'policy' | 'report' | 'other',
      title,
      description: form.description ? String(form.description) : null,
      storageKey: stored.key,
      fileName,
      mimeType: (file as File).type || 'application/octet-stream',
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      source: 'manual',
      controlIdsJson: JSON.stringify(controlIds),
      confidence: 'medium',
      version: 1,
      retentionUntil: Date.now() + 365 * 86_400_000,
      createdByUserId: auth.user.id,
      seq: (seqRow?.max ?? 0) + 1,
      createdAt: Date.now(),
    })
    .run();

  audit({ orgId, action: 'evidence.uploaded', targetType: 'evidence', targetId: id, meta: { title, type, controlIds, sha256: stored.sha256 }, actorUserId: auth.user.id });

  return created(c, { id, sha256: stored.sha256, title });
});

complianceRoutes.delete('/:orgId/evidence/:evidenceId', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const evidenceId = c.req.param('evidenceId');
  const row = getDb().select().from(evidence).where(eq(evidence.id, evidenceId)).get();
  if (!row || row.orgId !== orgId) throw AppError.notFound('Evidence');

  if (row.storageKey) {
    try {
      assertSafeKey(row.storageKey);
      await storage().delete(row.storageKey);
    } catch (err) {
      // Deletion must stay idempotent even if the object is already gone.
      void err;
    }
  }

  getDb().delete(evidence).where(eq(evidence.id, evidenceId)).run();
  audit({ orgId, action: 'evidence.deleted', targetType: 'evidence', targetId: evidenceId, actorUserId: c.get('auth')!.user.id });
  return ok(c, { deleted: true });
});

/**
 * Builds a downloadable, checksummed evidence pack: SBOM, scan summary, control
 * assessments, and any uploaded artefacts — the artifact an auditor asks for.
 */
complianceRoutes.post('/:orgId/repositories/:repositoryId/evidence-pack', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const repositoryId = c.req.param('repositoryId');
  const auth = c.get('auth')!;

  const repo = getDb().select().from(repositories).where(eq(repositories.id, repositoryId)).get();
  if (!repo || repo.orgId !== orgId) throw AppError.notFound('Repository');

  const reservation = reserveCredits({
    orgId,
    userId: auth.user.id,
    action: 'report.evidence_pack',
    resourceType: 'repository',
    resourceId: repositoryId,
    free: !env.BILLING_ENABLED,
  });

  const readiness = evaluate(buildContext({ orgId, repositoryId }));
  const scan = repo.lastScanId ? getDb().select().from(scans).where(eq(scans.id, repo.lastScanId)).get() : null;

  const comps = scan ? getDb().select().from(componentsTable).where(eq(componentsTable.scanId, scan.id)).all() : [];
  const links = getDb().select().from(componentVulnerabilities).where(eq(componentVulnerabilities.repositoryId, repositoryId)).all();
  const vulns = getDb().select().from(vulnerabilities).all();
  const vulnById = new Map(vulns.map((v) => [v.id, v]));
  const compById = new Map(comps.map((c2) => [c2.id, c2]));

  const sbom = buildCycloneDxJson({
    productName: repo.fullName ?? repo.name,
    productVersion: scan?.ref ?? '1.0.0',
    repositoryUrl: repo.url,
    components: componentsToSbomInput(comps),
    vulnerabilities: vulnsToSbomInput(
      links
        .map((link) => ({
          component: compById.get(link.componentId)!,
          vulnerability: vulnById.get(link.vulnerabilityId)!,
          link,
        }))
        .filter((p) => p.component && p.vulnerability),
    ),
  });

  const artefacts = getDb().select().from(evidence).where(and(eq(evidence.orgId, orgId), eq(evidence.repositoryId, repositoryId))).all();

  const pack = {
    generatedAt: new Date().toISOString(),
    organisation: orgId,
    repository: repo.fullName ?? repo.name,
    scan: scan
      ? { id: scan.id, ref: scan.ref, createdAt: scan.createdAt, components: scan.componentCount, vulnerabilities: scan.vulnerabilityCount }
      : null,
    readiness: {
      score: readiness.score,
      grade: readiness.grade,
      totals: readiness.totals,
      domains: readiness.domains,
    },
    assessments: readiness.assessments.map((a) => ({
      controlId: a.controlId,
      status: a.status,
      confidence: a.confidence,
      rationale: a.rationale,
      remediation: a.remediation,
    })),
    evidence: artefacts.map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      sha256: e.sha256,
      createdAt: e.createdAt,
      controlIds: safeJsonParse<string[]>(e.controlIdsJson, []),
    })),
    sbom,
    disclaimer:
      'This pack is engineering evidence generated by CRA Compliance OS. It is not legal advice and does not constitute a conformity assessment or CE marking.',
  };

  const body = Buffer.from(JSON.stringify(pack, null, 2), 'utf8');
  const fileName = `cra-evidence-pack-${repositoryId.slice(-6)}-${Date.now()}.json`;
  const key = objectKey(orgId, 'reports', fileName, sha256Hex(body));
  const stored = await storage().put(key, body, 'application/json');

  getDb()
    .insert(evidence)
    .values({
      id: newId('evd'),
      orgId,
      repositoryId,
      scanId: scan?.id ?? null,
      type: 'report',
      title: `Evidence pack — ${repo.fullName ?? repo.name}`,
      description: 'Generated evidence pack containing SBOM, readiness assessment and artefact checksums.',
      storageKey: stored.key,
      fileName,
      mimeType: 'application/json',
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      source: 'system',
      controlIdsJson: JSON.stringify(['cra.doc.technical']),
      confidence: 'high',
      createdByUserId: auth.user.id,
      createdAt: Date.now(),
    })
    .run();

  audit({ orgId, action: 'evidence_pack.generated', targetType: 'repository', targetId: repositoryId, meta: { key, sha256: stored.sha256, credits: reservation.credits }, actorUserId: auth.user.id });

  return created(c, { key, sha256: stored.sha256, fileName, sizeBytes: stored.sizeBytes, credits: reservation.credits });
});

/**
 * Suggests which controls an uploaded artefact might satisfy.
 * Uses the model only to rank the catalogued controls; the mapping is always
 * recorded with the controls it considered, so the suggestion is auditable.
 */
complianceRoutes.post('/:orgId/evidence/:evidenceId/classify', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const evidenceId = c.req.param('evidenceId');
  const row = getDb().select().from(evidence).where(eq(evidence.id, evidenceId)).get();
  if (!row || row.orgId !== orgId) throw AppError.notFound('Evidence');

  reserveCredits({ orgId, userId: c.get('auth')!.user.id, action: 'evidence.classify', resourceType: 'evidence', resourceId: evidenceId, free: !env.BILLING_ENABLED });

  const controls = getDb().select().from(complianceControls).where(eq(complianceControls.isActive, true)).all();
  const provider = aiProvider();

  let suggested: string[] = [];

  if (provider.available) {
    const result = await provider.complete({
      system:
        'You classify compliance artefacts. Reply with a JSON array of control ids only. Choose at most 5 ids from the provided list. Do not invent ids.',
      user: [
        `Artefact title: ${row.title}`,
        `Artefact type: ${row.type}`,
        `Description: ${row.description ?? 'none'}`,
        '',
        'Candidate controls:',
        ...controls.map((ctrl) => `- ${ctrl.id} :: ${ctrl.title} :: ${ctrl.description}`),
      ].join('\n'),
      maxTokens: 300,
    });

    try {
      if (result) {
        const cleaned = result.slice(result.indexOf('['), result.lastIndexOf(']') + 1);
        const parsed = JSON.parse(cleaned) as string[];
        const valid = new Set(controls.map((ctrl) => ctrl.id));
        suggested = parsed.filter((id) => valid.has(id)).slice(0, 5);
      }
    } catch {
      suggested = [];
    }
  }

  if (suggested.length === 0) {
    // Deterministic fallback: match on the control's declared evidence types.
    suggested = controls
      .filter((ctrl) => (JSON.parse(ctrl.evidenceTypesJson) as string[]).includes(row.type))
      .slice(0, 5)
      .map((ctrl) => ctrl.id);
  }

  const existing = safeJsonParse<string[]>(row.controlIdsJson, []);
  const merged = [...new Set([...existing, ...suggested])];

  // Evidence content is immutable; only the control mapping is updated.
  getDb().update(evidence).set({ controlIdsJson: JSON.stringify(merged) }).where(eq(evidence.id, evidenceId)).run();

  return ok(c, { evidenceId, controlIds: merged, suggested, aiUsed: provider.available && suggested.length > 0 });
});

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

complianceRoutes.onError((err, c) => errorResponse(c as AppContext, err));
