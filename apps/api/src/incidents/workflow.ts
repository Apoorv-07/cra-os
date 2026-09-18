import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {componentVulnerabilities, components as componentsTable, evidence, incidentEvents, incidentReports, incidents, organizations, projects, repositories, vulnerabilities} from '../db/schema.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { log } from '../core/logger.js';
import { aiProvider } from '../ai/provider.js';
import { storage, objectKey, sha256Hex } from '../core/storage.js';

/**
 * Article 14 incident workflow.
 *
 * Under Regulation (EU) 2024/2847 Article 14, once a manufacturer becomes aware
 * of an actively exploited vulnerability or a severe incident in a product with
 * digital elements placed on the EU market, the clocks start:
 *
 *   24 hours  -> early warning to ENISA / the national CSIRT
 *   72 hours  -> full notification
 *   14 days   -> final report, once a corrective measure is available
 *
 * This module turns a vulnerability finding into a full incident record with
 * those deadlines computed, and drafts the three reports from the data the
 * platform already holds. Everything generated is labelled a draft for
 * engineering evidence — it is not legal advice and not a filed report.
 */

export const DRAFT_DISCLAIMER =
  '> **Draft — engineering evidence.** This document was generated from scan data held in CRA Compliance OS and has not been reviewed by a legal adviser. Verify every field against your own records before filing with ENISA or your national CSIRT.';

export type ReportStage = 'early_warning' | 'notification' | 'final';

export interface IncidentFacts {
  incidentId: string;
  title: string;
  severity: string;
  awarenessAt: number;
  earlyWarningDueAt: number;
  notificationDueAt: number;
  finalReportDueAt: number | null;
  activelyExploited: boolean;
  kevFlag: boolean;
  product: { name: string; version: string | null; supportPeriodMonths: number | null };
  organisation: { name: string; country: string | null };
  vulnerability: {
    id: string;
    aliases: string[];
    summary: string | null;
    details: string | null;
    severity: string;
    cvssScore: number | null;
    cvssVector: string | null;
    epssScore: number | null;
    kevFlag: boolean;
    kevDueDate: string | null;
    publishedAt: number | null;
    references: Array<{ url: string; type?: string }>;
  };
  affectedComponents: Array<{
    name: string;
    version: string | null;
    ecosystem: string;
    purl: string | null;
    fixedVersion: string | null;
    manifestPath: string | null;
  }>;
  affectedRepositories: Array<{ id: string; fullName: string | null; url: string | null; lastScanAt: number | null }>;
  correctiveMeasure: string | null;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

function fmt(ts: number | null | undefined): string {
  if (!ts) return 'not recorded';
  return `${new Date(ts).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

// ---------------------------------------------------------------------------
// Incident creation
// ---------------------------------------------------------------------------

export function createIncident(input: {
  orgId: string;
  componentVulnerabilityId: string;
  createdByUserId?: string;
  awarenessAt?: number;
  activelyExploited?: boolean;
}): string {
  const db = getDb();

  const link = db
    .select()
    .from(componentVulnerabilities)
    .where(
      and(
        eq(componentVulnerabilities.id, input.componentVulnerabilityId),
        eq(componentVulnerabilities.orgId, input.orgId),
      ),
    )
    .get();
  if (!link) throw AppError.notFound('Vulnerability finding');

  const component = db.select().from(componentsTable).where(eq(componentsTable.id, link.componentId)).get();
  const vuln = db.select().from(vulnerabilities).where(eq(vulnerabilities.id, link.vulnerabilityId)).get();
  if (!vuln) throw AppError.notFound('Vulnerability');

  const awarenessAt = input.awarenessAt ?? Date.now();
  const id = newId('inc');

  db.insert(incidents)
    .values({
      id,
      orgId: input.orgId,
      repositoryId: link.repositoryId,
      componentVulnerabilityId: link.id,
      vulnerabilityId: vuln.id,
      title: `${vuln.sourceId} in ${component?.name ?? 'component'}`,
      state: 'detected',
      severity: vuln.severity,
      detectedAt: Date.now(),
      awarenessAt,
      earlyWarningDueAt: awarenessAt + 24 * HOUR,
      notificationDueAt: awarenessAt + 72 * HOUR,
      finalReportDueAt: null, // set when a corrective measure becomes available
      kevFlag: Boolean(vuln.kevFlag),
      activelyExploited: input.activelyExploited ?? Boolean(vuln.kevFlag),
      severityRationale: buildSeverityRationale(vuln, link),
      affectedSummaryJson: JSON.stringify({
        components: [{ name: component?.name, version: component?.version, purl: component?.purl }],
      }),
      createdByUserId: input.createdByUserId ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  db.insert(incidentEvents)
    .values({
      id: newId('iev'),
      incidentId: id,
      orgId: input.orgId,
      type: 'created',
      stage: 'none',
      payloadJson: JSON.stringify({ vulnerability: vuln.sourceId, component: component?.name }),
      actorUserId: input.createdByUserId ?? null,
      note: 'Incident opened from a vulnerability finding.',
      createdAt: Date.now(),
    })
    .run();

  audit({
    orgId: input.orgId,
    action: 'incident.created',
    targetType: 'incident',
    targetId: id,
    meta: { vulnerability: vuln.sourceId, severity: vuln.severity, kev: vuln.kevFlag },
    actorUserId: input.createdByUserId ?? null,
  });

  return id;
}

function buildSeverityRationale(
  vuln: typeof vulnerabilities.$inferSelect,
  link: typeof componentVulnerabilities.$inferSelect,
): string {
  const parts: string[] = [];
  if (vuln.kevFlag) parts.push('Listed in the CISA Known Exploited Vulnerabilities catalogue (active exploitation confirmed).');
  if (vuln.cvssScore !== null) parts.push(`CVSS base score ${vuln.cvssScore} (${vuln.cvssVector ?? 'vector not recorded'}).`);
  if (vuln.epssScore !== null) parts.push(`EPSS ${(vuln.epssScore * 100).toFixed(2)}% probability of exploitation in the next 30 days.`);
  if (link.exposure && link.exposure !== 'unknown') parts.push(`Component exposure assessed as ${link.exposure}.`);
  if (link.fixedVersion) parts.push(`Fix available in ${link.fixedVersion}.`);
  else parts.push('No fixed version identified in the advisory data, so no corrective measure is available yet.');
  return parts.join(' ');
}

/** Marks a corrective measure as available, which starts the 14-day clock. */
export function markCorrectiveMeasureAvailable(incidentId: string, orgId: string, userId?: string): void {
  const db = getDb();
  const incident = db.select().from(incidents).where(and(eq(incidents.id, incidentId), eq(incidents.orgId, orgId))).get();
  if (!incident) throw AppError.notFound('Incident');

  const now = Date.now();
  db.update(incidents)
    .set({ finalReportDueAt: now + 14 * DAY, state: 'assessing', updatedAt: now })
    .where(eq(incidents.id, incidentId))
    .run();

  db.insert(incidentEvents)
    .values({
      id: newId('iev'),
      incidentId,
      orgId,
      type: 'state_changed',
      stage: 'final',
      payloadJson: JSON.stringify({ finalReportDueAt: now + 14 * DAY }),
      actorUserId: userId ?? null,
      note: 'Corrective measure marked available; the 14-day final report clock has started.',
      createdAt: now,
    })
    .run();
}

// ---------------------------------------------------------------------------
// Fact assembly
// ---------------------------------------------------------------------------

export function buildFacts(incidentId: string, orgId: string): IncidentFacts {
  const db = getDb();
  const incident = db.select().from(incidents).where(and(eq(incidents.id, incidentId), eq(incidents.orgId, orgId))).get();
  if (!incident) throw AppError.notFound('Incident');

  const vuln = incident.vulnerabilityId
    ? db.select().from(vulnerabilities).where(eq(vulnerabilities.id, incident.vulnerabilityId)).get()
    : null;
  if (!vuln) throw AppError.notFound('Vulnerability');

  const link = incident.componentVulnerabilityId
    ? db.select().from(componentVulnerabilities).where(eq(componentVulnerabilities.id, incident.componentVulnerabilityId)).get()
    : null;

  const component = link
    ? db.select().from(componentsTable).where(eq(componentsTable.id, link.componentId)).get()
    : null;

  const repo = incident.repositoryId
    ? db.select().from(repositories).where(eq(repositories.id, incident.repositoryId)).get()
    : null;

  const project = repo?.projectId ? db.select().from(projects).where(eq(projects.id, repo.projectId)).get() : null;
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();

  return {
    incidentId: incident.id,
    title: incident.title,
    severity: incident.severity,
    awarenessAt: incident.awarenessAt,
    earlyWarningDueAt: incident.earlyWarningDueAt,
    notificationDueAt: incident.notificationDueAt,
    finalReportDueAt: incident.finalReportDueAt,
    activelyExploited: Boolean(incident.activelyExploited),
    kevFlag: Boolean(incident.kevFlag),
    product: {
      name: project?.productName ?? repo?.fullName ?? repo?.name ?? 'Product not recorded',
      version: project?.productVersion ?? null,
      supportPeriodMonths: project?.supportPeriodMonths ?? null,
    },
    organisation: { name: org?.name ?? 'Organisation not recorded', country: org?.country ?? null },
    vulnerability: {
      id: vuln.sourceId,
      aliases: safeJson<string[]>(vuln.aliasesJson, []),
      summary: vuln.summary,
      details: vuln.details,
      severity: vuln.severity,
      cvssScore: vuln.cvssScore,
      cvssVector: vuln.cvssVector,
      epssScore: vuln.epssScore,
      kevFlag: Boolean(vuln.kevFlag),
      kevDueDate: vuln.kevDueDate,
      publishedAt: vuln.publishedAt,
      references: safeJson<Array<{ url: string; type?: string }>>(vuln.referencesJson, []),
    },
    affectedComponents: component
      ? [
          {
            name: component.name,
            version: component.version,
            ecosystem: component.ecosystem,
            purl: component.purl,
            fixedVersion: link?.fixedVersion ?? null,
            manifestPath: component.manifestPath,
          },
        ]
      : [],
    affectedRepositories: repo
      ? [{ id: repo.id, fullName: repo.fullName, url: repo.url, lastScanAt: repo.lastScanAt }]
      : [],
    correctiveMeasure: link?.remediation ?? null,
  };
}

// ---------------------------------------------------------------------------
// Report drafting
// ---------------------------------------------------------------------------

export function renderTemplate(facts: IncidentFacts, stage: ReportStage): string {
  const v = facts.vulnerability;
  const comp = facts.affectedComponents[0];
  const lines: string[] = [];

  if (stage === 'early_warning') {
    lines.push(`# Article 14 — Early Warning (24 hours)`);
    lines.push('');
    lines.push(DRAFT_DISCLAIMER);
    lines.push('');
    lines.push(`**Reporting manufacturer:** ${facts.organisation.name}${facts.organisation.country ? ` (${facts.organisation.country})` : ''}`);
    lines.push(`**Affected product:** ${facts.product.name}${facts.product.version ? ` — version ${facts.product.version}` : ''}`);
    lines.push(`**Date and time of awareness:** ${fmt(facts.awarenessAt)}`);
    lines.push(`**Early warning deadline:** ${fmt(facts.earlyWarningDueAt)}`);
    lines.push(`**Reference:** incident ${facts.incidentId}`);
    lines.push('');
    lines.push('## Nature of the issue');
    lines.push('');
    lines.push(`The vulnerability **${v.id}**${v.aliases.length ? ` (also tracked as ${v.aliases.join(', ')})` : ''} affects a component of the product listed above.`);
    if (v.summary) lines.push('');
    if (v.summary) lines.push(v.summary);
    lines.push('');
    lines.push(`- **Severity:** ${v.severity.toUpperCase()}${v.cvssScore !== null ? ` (CVSS ${v.cvssScore})` : ''}`);
    if (v.cvssVector) lines.push(`- **CVSS vector:** \`${v.cvssVector}\``);
    if (v.epssScore !== null) lines.push(`- **EPSS:** ${(v.epssScore * 100).toFixed(2)}%`);
    lines.push(`- **Actively exploited:** ${facts.activelyExploited ? 'Yes' : 'Not confirmed'}`);
    if (v.kevFlag) lines.push(`- **CISA KEV:** listed${v.kevDueDate ? `; remediation due ${v.kevDueDate}` : ''}`);
    lines.push('');
    lines.push('## Affected component');
    lines.push('');
    if (comp) {
      lines.push(`- **Component:** ${comp.name} ${comp.version ?? ''} (${comp.ecosystem})`);
      if (comp.purl) lines.push(`- **purl:** \`${comp.purl}\``);
      if (comp.manifestPath) lines.push(`- **Declared in:** \`${comp.manifestPath}\``);
      lines.push(`- **Fixed version:** ${comp.fixedVersion ?? 'none identified in advisory data'}`);
    } else {
      lines.push('Component details were not recorded for this incident.');
    }
    lines.push('');
    lines.push('## Status');
    lines.push('');
    lines.push('This is an early warning submitted within 24 hours of awareness. A full notification will follow within 72 hours.');
    lines.push('');
    lines.push('## Declarations');
    lines.push('');
    lines.push(`- [ ] The information above has been verified against internal records.`);
    lines.push(`- [ ] A corrective measure ${comp?.fixedVersion ? `is available (upgrade to ${comp.fixedVersion})` : 'is not yet available'}.`);
    lines.push(`- [ ] This draft has been reviewed and approved before filing.`);
    return lines.join('\n');
  }

  if (stage === 'notification') {
    lines.push(`# Article 14 — Notification (72 hours)`);
    lines.push('');
    lines.push(DRAFT_DISCLAIMER);
    lines.push('');
    lines.push(`**Reporting manufacturer:** ${facts.organisation.name}`);
    lines.push(`**Affected product:** ${facts.product.name}${facts.product.version ? ` — version ${facts.product.version}` : ''}`);
    lines.push(`**Early warning submitted:** ${fmt(facts.awarenessAt)} (within 24 hours of awareness)`);
    lines.push(`**Notification deadline:** ${fmt(facts.notificationDueAt)}`);
    lines.push('');
    lines.push('## Description of the vulnerability');
    lines.push('');
    lines.push(v.details ?? v.summary ?? 'No advisory description was available at the time of drafting.');
    lines.push('');
    lines.push('## Severity assessment');
    lines.push('');
    lines.push(`- **Severity:** ${v.severity.toUpperCase()}${v.cvssScore !== null ? ` (CVSS ${v.cvssScore})` : ''}`);
    if (v.cvssVector) lines.push(`- **CVSS vector:** \`${v.cvssVector}\``);
    if (v.epssScore !== null) lines.push(`- **EPSS:** ${(v.epssScore * 100).toFixed(2)}%`);
    lines.push(`- **Actively exploited:** ${facts.activelyExploited ? 'Yes — exploitation confirmed' : 'Not confirmed'}`);
    if (v.kevFlag) lines.push(`- **CISA KEV:** listed${v.kevDueDate ? `; KEV remediation due date ${v.kevDueDate}` : ''}`);
    lines.push('');
    lines.push('## Affected versions and products');
    lines.push('');
    if (comp) {
      lines.push(`| Component | Version | Ecosystem | Fixed in |`);
      lines.push(`| --- | --- | --- | --- |`);
      lines.push(`| ${comp.name} | ${comp.version ?? 'unknown'} | ${comp.ecosystem} | ${comp.fixedVersion ?? 'none identified'} |`);
    } else {
      lines.push('No component record is attached to this incident.');
    }
    lines.push('');
    lines.push('## Mitigating or corrective measures');
    lines.push('');
    if (comp?.fixedVersion) {
      lines.push(`Upgrade \`${comp.name}\` to **${comp.fixedVersion}** or later and redeploy the affected product.`);
    } else {
      lines.push('No fixed version has been identified. Document the compensating controls applied and the date a fix is expected.');
    }
    if (facts.correctiveMeasure) {
      lines.push('');
      lines.push(`Recorded remediation note: ${facts.correctiveMeasure}`);
    }
    lines.push('');
    lines.push('## Users affected');
    lines.push('');
    lines.push('Not recorded — complete this section from your distribution and telemetry records before filing.');
    lines.push('');
    lines.push('## Declarations');
    lines.push('');
    lines.push('- [ ] Severity and exploitability verified.');
    lines.push('- [ ] Affected version range confirmed against the maintained SBOM.');
    lines.push('- [ ] Mitigation plan approved by the responsible owner.');
    return lines.join('\n');
  }

  lines.push(`# Article 14 — Final Report (14 days)`);
  lines.push('');
  lines.push(DRAFT_DISCLAIMER);
  lines.push('');
  lines.push(`**Reporting manufacturer:** ${facts.organisation.name}`);
  lines.push(`**Affected product:** ${facts.product.name}${facts.product.version ? ` — version ${facts.product.version}` : ''}`);
  lines.push(`**Vulnerability:** ${v.id}${v.aliases.length ? ` (${v.aliases.join(', ')})` : ''}`);
  lines.push(`**Awareness:** ${fmt(facts.awarenessAt)} · **Early warning:** ${fmt(facts.awarenessAt)} · **Final report due:** ${fmt(facts.finalReportDueAt)}`);
  lines.push('');
  lines.push('## Root cause');
  lines.push('');
  lines.push('To be completed: describe how the vulnerable component entered the product and why it was not detected earlier.');
  lines.push('');
  lines.push('## Corrective measure taken');
  lines.push('');
  if (comp?.fixedVersion) {
    lines.push(`- Upgraded \`${comp.name}\` from ${comp.version ?? 'unknown'} to **${comp.fixedVersion}**.`);
    lines.push('- Rebuilt and redeployed the affected product version.');
    lines.push('- Regenerated the SBOM and confirmed the vulnerable version is no longer present.');
  } else {
    lines.push('No fixed version identified in advisory data. Document the compensating control and the plan to remove the component.');
  }
  lines.push('');
  lines.push('## Patch deployment status');
  lines.push('');
  lines.push('- [ ] Fix released to all supported versions.');
  lines.push('- [ ] Customer notification issued.');
  lines.push('- [ ] SBOM regenerated and archived as evidence.');
  lines.push('');
  lines.push('## Lessons learned');
  lines.push('');
  lines.push('To be completed: what detection, process or dependency change prevents recurrence.');
  lines.push('');
  lines.push('## Evidence attached');
  lines.push('');
  lines.push('See the evidence pack exported from CRA Compliance OS for this incident, which contains the SBOM, the scan record and this report with checksums and timestamps.');
  return lines.join('\n');
}

/**
 * Generates a draft. Falls back to the deterministic template when no model is
 * configured, so the workflow always works.
 */
export async function generateDraft(input: {
  incidentId: string;
  orgId: string;
  stage: ReportStage;
  userId?: string;
  forceTemplate?: boolean;
}): Promise<{ id: string; generatedBy: 'template' | 'ai'; bodyMarkdown: string; model: string | null; confidence: string }> {
  const db = getDb();
  const facts = buildFacts(input.incidentId, input.orgId);
  const template = renderTemplate(facts, input.stage);

  let body = template;
  let generatedBy: 'template' | 'ai' = 'template';
  let model: string | null = null;
  let confidence = 'high';

  const provider = aiProvider();

  if (!input.forceTemplate && provider.available) {
    const system = [
      'You draft EU Cyber Resilience Act Article 14 reports for software manufacturers.',
      'Use ONLY the structured facts provided. Do not invent CVEs, dates, versions, customers, or legal citations.',
      'If a required fact is absent, write exactly "not recorded".',
      'Write precise, formal regulatory prose in Markdown. No preamble, no marketing language.',
      'Keep the existing section headings and the draft disclaimer block verbatim.',
    ].join(' ');

    const user = [
      `Report stage: ${input.stage}`,
      '',
      'Structured facts (JSON):',
      JSON.stringify(facts, null, 2),
      '',
      'Baseline draft to improve (keep structure and headings):',
      template,
    ].join('\n');

    try {
      const result = await provider.complete({ system, user, maxTokens: 1600 });
      if (result && result.trim().length > 200) {
        // Guard: reject a model response that dropped the disclaimer, which is
        // our guarantee that the output stays labelled as engineering evidence.
        body = result.includes('engineering evidence') ? result : `${DRAFT_DISCLAIMER}\n\n${result}`;
        generatedBy = 'ai';
        model = provider.name;
        confidence = 'medium';
      }
    } catch (err) {
      log.warn('ai draft failed, using template', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const existing = db
    .select()
    .from(incidentReports)
    .where(and(eq(incidentReports.incidentId, input.incidentId), eq(incidentReports.stage, input.stage)))
    .get();

  const values = {
    incidentId: input.incidentId,
    orgId: input.orgId,
    stage: input.stage,
    title: `${STAGE_TITLE[input.stage]} — ${facts.vulnerability.id}`,
    bodyMarkdown: body,
    status: 'draft' as const,
    generatedBy,
    sourcesJson: JSON.stringify(facts),
    aiConfidence: generatedBy === 'ai' ? confidence : null,
    aiModel: model,
    createdByUserId: input.userId ?? null,
    updatedAt: Date.now(),
  };

  let id: string;
  if (existing) {
    db.update(incidentReports).set(values).where(eq(incidentReports.id, existing.id)).run();
    id = existing.id;
  } else {
    id = newId('irp');
    db.insert(incidentReports).values({ id, ...values, createdAt: Date.now() }).run();
  }

  db.insert(incidentEvents)
    .values({
      id: newId('iev'),
      incidentId: input.incidentId,
      orgId: input.orgId,
      type: 'draft_generated',
      stage: input.stage,
      payloadJson: JSON.stringify({ generatedBy, model }),
      actorUserId: input.userId ?? null,
      note: `${STAGE_TITLE[input.stage]} draft generated (${generatedBy}).`,
      createdAt: Date.now(),
    })
    .run();

  return { id, generatedBy, bodyMarkdown: body, model, confidence };
}

export const STAGE_TITLE: Record<ReportStage, string> = {
  early_warning: 'Article 14 early warning (24h)',
  notification: 'Article 14 notification (72h)',
  final: 'Article 14 final report (14 days)',
};

export function generateAllDrafts(incidentId: string, orgId: string, userId?: string, forceTemplate?: boolean) {
  return Promise.all([
    generateDraft({ incidentId, orgId, stage: 'early_warning', userId, forceTemplate }),
    generateDraft({ incidentId, orgId, stage: 'notification', userId, forceTemplate }),
    generateDraft({ incidentId, orgId, stage: 'final', userId, forceTemplate }),
  ]);
}

// ---------------------------------------------------------------------------
// Approval, export, lifecycle
// ---------------------------------------------------------------------------

export function approveReport(reportId: string, orgId: string, userId: string): void {
  const db = getDb();
  const report = db.select().from(incidentReports).where(and(eq(incidentReports.id, reportId), eq(incidentReports.orgId, orgId))).get();
  if (!report) throw AppError.notFound('Report');

  db.update(incidentReports)
    .set({ status: 'approved', approvedByUserId: userId, approvedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(incidentReports.id, reportId))
    .run();

  db.insert(incidentEvents)
    .values({
      id: newId('iev'),
      incidentId: report.incidentId,
      orgId,
      type: 'approved',
      stage: report.stage as ReportStage,
      actorUserId: userId,
      note: `${STAGE_TITLE[report.stage as ReportStage]} approved.`,
      createdAt: Date.now(),
    })
    .run();

  audit({ orgId, action: 'incident.report_approved', targetType: 'incident_report', targetId: reportId, actorUserId: userId });
}

export async function exportReport(
  reportId: string,
  orgId: string,
  userId: string,
): Promise<{ key: string; sha256: string; fileName: string; sizeBytes: number }> {
  const db = getDb();
  const report = db.select().from(incidentReports).where(and(eq(incidentReports.id, reportId), eq(incidentReports.orgId, orgId))).get();
  if (!report) throw AppError.notFound('Report');

  const fileName = `cra-article14-${report.stage}-${report.id.slice(-8)}.md`;
  const buffer = Buffer.from(report.bodyMarkdown, 'utf8');
  const key = objectKey(orgId, 'reports', fileName, sha256Hex(buffer));
  const stored = await storage().put(key, buffer, 'text/markdown');

  db.update(incidentReports)
    .set({ status: 'exported', exportedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(incidentReports.id, reportId))
    .run();

  // Exported reports become immutable evidence in their own right.
  db.insert(evidence)
    .values({
      id: newId('evd'),
      orgId,
      repositoryId: null,
      scanId: null,
      type: 'report',
      title: `Exported ${STAGE_TITLE[report.stage as ReportStage]}`,
      description: 'Article 14 report exported as engineering evidence.',
      storageKey: key,
      fileName,
      mimeType: 'text/markdown',
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      source: 'system',
      controlIdsJson: JSON.stringify(['cra.incident.process', 'cra.incident.rehearsal']),
      confidence: 'high',
      createdByUserId: userId,
      createdAt: Date.now(),
    })
    .run();

  db.insert(incidentEvents)
    .values({
      id: newId('iev'),
      incidentId: report.incidentId,
      orgId,
      type: 'exported',
      stage: report.stage as ReportStage,
      payloadJson: JSON.stringify({ key, sha256: stored.sha256 }),
      actorUserId: userId,
      note: 'Report exported and archived in the evidence vault.',
      createdAt: Date.now(),
    })
    .run();

  return { key, sha256: stored.sha256, fileName, sizeBytes: stored.sizeBytes };
}

export function incidentTimeline(incidentId: string, orgId: string) {
  const db = getDb();
  return db
    .select()
    .from(incidentEvents)
    .where(and(eq(incidentEvents.incidentId, incidentId), eq(incidentEvents.orgId, orgId)))
    .orderBy(desc(incidentEvents.createdAt))
    .all();
}

export function listIncidents(orgId: string, limit = 50) {
  return getDb()
    .select()
    .from(incidents)
    .where(eq(incidents.orgId, orgId))
    .orderBy(desc(incidents.createdAt))
    .limit(limit)
    .all();
}

export function listReports(incidentId: string, orgId: string) {
  return getDb()
    .select()
    .from(incidentReports)
    .where(and(eq(incidentReports.incidentId, incidentId), eq(incidentReports.orgId, orgId)))
    .all();
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export { fmt as formatTimestamp };
