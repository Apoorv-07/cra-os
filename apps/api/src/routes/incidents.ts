import { Hono } from 'hono';
import type { AppEnv } from '../core/context.js';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {componentVulnerabilities, incidentReports, incidents} from '../db/schema.js';
import { AppError } from '../core/errors.js';
import { ok, created, parseBody, errorResponse } from '../core/http.js';
import { requireAuth, requireOrg } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { env } from '../env.js';
import {
  approveReport,
  buildFacts,
  createIncident,
  exportReport,
  generateAllDrafts,
  generateDraft,
  incidentTimeline,
  listIncidents,
  listReports,
  markCorrectiveMeasureAvailable,
  type ReportStage,
} from '../incidents/workflow.js';
import { reserveCredits, commitUsage, releaseUsage } from '../modules/billing/ledger.js';
import type { AppContext } from '../core/context.js';

export const incidentRoutes = new Hono<AppEnv>();

incidentRoutes.get('/:orgId/incidents', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const rows = listIncidents(orgId, 100);

  const now = Date.now();
  return ok(
    c,
    rows.map((incident) => ({
      ...incident,
      earlyWarningOverdue: incident.state !== 'closed' && now > incident.earlyWarningDueAt,
      notificationOverdue:
        incident.state !== 'closed' && now > incident.notificationDueAt,
      hoursRemaining: Math.max(0, Math.round((incident.earlyWarningDueAt - now) / 3_600_000)),
    })),
  );
});

const CreateSchema = z.object({
  componentVulnerabilityId: z.string(),
  activelyExploited: z.boolean().optional(),
  awarenessAt: z.number().int().optional(),
});

incidentRoutes.post('/:orgId/incidents', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const body = await parseBody(c, CreateSchema);

  // Tenant isolation: the finding must belong to this organisation.
  const link = getDb()
    .select()
    .from(componentVulnerabilities)
    .where(and(eq(componentVulnerabilities.id, body.componentVulnerabilityId), eq(componentVulnerabilities.orgId, orgId)))
    .get();
  if (!link) throw AppError.notFound('Vulnerability finding');

  const id = createIncident({
    orgId,
    componentVulnerabilityId: body.componentVulnerabilityId,
    createdByUserId: c.get('auth')!.user.id,
    awarenessAt: body.awarenessAt,
    activelyExploited: body.activelyExploited,
  });

  return created(c, { id });
});

incidentRoutes.get('/:orgId/incidents/:incidentId', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const incidentId = c.req.param('incidentId');

  const incident = getDb().select().from(incidents).where(and(eq(incidents.id, incidentId), eq(incidents.orgId, orgId))).get();
  if (!incident) throw AppError.notFound('Incident');

  const facts = buildFacts(incidentId, orgId);
  const reports = listReports(incidentId, orgId);
  const timeline = incidentTimeline(incidentId, orgId);

  const now = Date.now();
  return ok(c, {
    incident,
    facts,
    reports,
    timeline,
    clock: {
      earlyWarningDueAt: incident.earlyWarningDueAt,
      notificationDueAt: incident.notificationDueAt,
      finalReportDueAt: incident.finalReportDueAt,
      earlyWarningOverdue: now > incident.earlyWarningDueAt,
      notificationOverdue: now > incident.notificationDueAt,
      finalReportOverdue: incident.finalReportDueAt ? now > incident.finalReportDueAt : false,
    },
  });
});

const DraftSchema = z.object({
  stage: z.enum(['early_warning', 'notification', 'final', 'all']).default('all'),
  useAi: z.boolean().default(true),
});

incidentRoutes.post('/:orgId/incidents/:incidentId/drafts', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const incidentId = c.req.param('incidentId');
  const body = await parseBody(c, DraftSchema);
  const auth = c.get('auth')!;

  const incident = getDb().select().from(incidents).where(and(eq(incidents.id, incidentId), eq(incidents.orgId, orgId))).get();
  if (!incident) throw AppError.notFound('Incident');

  const action = body.stage === 'all' ? 'incident.draft' : 'incident.report';
  const reservation = reserveCredits({
    orgId,
    userId: auth.user.id,
    action,
    resourceType: 'incident',
    resourceId: incidentId,
    quantity: body.stage === 'all' ? 1 : 1,
    free: !env.BILLING_ENABLED,
  });

  try {
    if (body.stage === 'all') {
      const drafts = await generateAllDrafts(incidentId, orgId, auth.user.id, !body.useAi);
      commitUsage(reservation.usageEventId);
      return created(c, { drafts, credits: reservation.credits });
    }

    const draft = await generateDraft({
      incidentId,
      orgId,
      stage: body.stage as ReportStage,
      userId: auth.user.id,
      forceTemplate: !body.useAi,
    });
    commitUsage(reservation.usageEventId);
    return created(c, { draft, credits: reservation.credits });
  } catch (err) {
    releaseUsage(reservation.usageEventId, 'draft generation failed');
    throw err;
  }
});

const EditSchema = z.object({ bodyMarkdown: z.string().min(1).max(100_000) });

incidentRoutes.patch('/:orgId/incidents/:incidentId/reports/:reportId', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const incidentId = c.req.param('incidentId');
  const reportId = c.req.param('reportId');
  const body = await parseBody(c, EditSchema);

  const report = getDb().select().from(incidentReports).where(and(eq(incidentReports.id, reportId), eq(incidentReports.orgId, orgId))).get();
  if (!report || report.incidentId !== incidentId) throw AppError.notFound('Report');

  getDb()
    .update(incidentReports)
    .set({ bodyMarkdown: body.bodyMarkdown, status: 'draft', updatedAt: Date.now() })
    .where(eq(incidentReports.id, reportId))
    .run();

  audit({
    orgId,
    action: 'incident.report_edited',
    targetType: 'incident_report',
    targetId: reportId,
    actorUserId: c.get('auth')!.user.id,
  });

  return ok(c, { id: reportId, updated: true });
});

incidentRoutes.post('/:orgId/incidents/:incidentId/reports/:reportId/approve', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  approveReport(c.req.param('reportId'), orgId, c.get('auth')!.user.id);
  return ok(c, { approved: true });
});

incidentRoutes.post('/:orgId/incidents/:incidentId/reports/:reportId/export', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const result = await exportReport(c.req.param('reportId'), orgId, c.get('auth')!.user.id);
  return created(c, result);
});

incidentRoutes.post('/:orgId/incidents/:incidentId/corrective-measure', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const incidentId = c.req.param('incidentId');
  const body = await parseBody(c, z.object({ note: z.string().max(2000).optional() }));
  markCorrectiveMeasureAvailable(incidentId, orgId, c.get('auth')!.user.id);
  return ok(c, { finalReportDueAt: Date.now() + 14 * 86_400_000, note: body.note ?? null });
});

incidentRoutes.post('/:orgId/incidents/:incidentId/close', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const incidentId = c.req.param('incidentId');
  const incident = getDb().select().from(incidents).where(and(eq(incidents.id, incidentId), eq(incidents.orgId, orgId))).get();
  if (!incident) throw AppError.notFound('Incident');

  getDb()
    .update(incidents)
    .set({ state: 'closed', closedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(incidents.id, incidentId))
    .run();

  audit({ orgId, action: 'incident.closed', targetType: 'incident', targetId: incidentId, actorUserId: c.get('auth')!.user.id });
  return ok(c, { closed: true });
});

incidentRoutes.onError((err, c) => errorResponse(c as AppContext, err));
