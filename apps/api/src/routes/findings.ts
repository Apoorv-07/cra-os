import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../core/context.js';
import { getDb } from '../db/index.js';
import {
  componentVulnerabilities,
  components,
  complianceAssessments,
  evidence,
  repositories,
  vulnerabilities,
} from '../db/schema.js';
import { AppError } from '../core/errors.js';
import { ok, parseBody } from '../core/http.js';
import { requireAuth, requireOrg } from '../core/auth.js';
import { audit } from '../core/audit.js';

export const findingsRoutes = new Hono<AppEnv>();

/**
 * Unified findings.
 *
 * A "finding" is the product-level answer to "what is wrong, and what do I do
 * about it?". The underlying row is a component↔vulnerability link, but the API
 * deliberately returns a prioritised, human-readable item with the technical
 * scores nested underneath — the UI leads with the decision, not with CVSS.
 */

const SEVERITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

export type FindingPriority = 'act_now' | 'prioritise' | 'monitor' | 'review';

/**
 * Priority is the product's opinion, computed from the intelligence we hold:
 * a known-exploited issue outranks a severe one nobody is using, and a critical
 * issue with a high EPSS outranks a critical issue nobody is likely to see.
 */
export function priorityOf(input: {
  severity: string | null;
  kevFlag: boolean;
  epssScore: number | null;
  exploitability: string | null;
  exposure: string | null;
  state: string;
}): FindingPriority {
  if (input.state !== 'open') return 'review';

  const sev = input.severity ?? 'unknown';
  const epss = input.epssScore ?? 0;

  if (input.kevFlag) return 'act_now';
  if (input.exploitability === 'active' && (sev === 'critical' || sev === 'high')) return 'act_now';
  if (sev === 'critical' && (epss >= 0.2 || input.exposure === 'internet')) return 'act_now';
  if (sev === 'critical' || sev === 'high') return 'prioritise';
  if (sev === 'medium') return 'monitor';
  return 'review';
}

/**
 * Numeric risk used to order findings *within* a priority band.
 *
 * Confirmed exploitation outranks theoretical severity: a high-severity issue
 * in CISA's KEV catalogue is more urgent than a critical one nobody has been
 * seen exploiting. The bands above decide the headline; this decides the order
 * inside the band.
 */
export function riskScore(input: {
  severity: string | null;
  kevFlag: boolean;
  epssScore: number | null;
  exploitability: string | null;
  exposure: string | null;
}): number {
  let score = 0;
  if (input.kevFlag) score += 1000;
  if (input.exploitability === 'active') score += 400;
  else if (input.exploitability === 'poc') score += 100;
  score += (SEVERITY_WEIGHT[input.severity ?? 'unknown'] ?? 0) * 20;
  score += Math.round((input.epssScore ?? 0) * 100);
  if (input.exposure === 'internet') score += 20;
  return score;
}

/** One sentence a non-specialist can act on. Never invents facts. */
export function headlineFor(input: {
  componentName: string;
  version: string | null;
  severity: string | null;
  kevFlag: boolean;
  exploitability: string | null;
  repositoryName: string;
}): string {
  const what = `${input.componentName}${input.version ? ` ${input.version}` : ''}`;
  const where = ` in ${input.repositoryName}`;

  if (input.kevFlag) return `Known exploited vulnerability in ${what}${where}`;
  if (input.exploitability === 'active') return `Actively exploited vulnerability in ${what}${where}`;
  switch (input.severity) {
    case 'critical':
      return `Critical vulnerability in ${what}${where}`;
    case 'high':
      return `High-severity vulnerability in ${what}${where}`;
    case 'medium':
      return `Moderate vulnerability in ${what}${where}`;
    case 'low':
      return `Low-severity vulnerability in ${what}${where}`;
    default:
      return `Unrated vulnerability in ${what}${where}`;
  }
}

export function whyItMatters(input: {
  kevFlag: boolean;
  epssScore: number | null;
  exploitability: string | null;
  exposure: string | null;
  severity: string | null;
  state: string;
}): string {
  if (input.state === 'risk_accepted') return 'This risk was formally accepted and is tracked, not forgotten.';
  if (input.state === 'ignored') return 'Previously dismissed. Re-open it if the component is still in use.';
  if (input.state === 'fixed') return 'Resolved in a later scan.';
  if (input.kevFlag) return 'Listed in CISA’s Known Exploited Vulnerabilities catalogue — exploitation is confirmed in the wild, so this is both a security and an Article 14 reporting concern.';
  if (input.exploitability === 'active') return 'Exploitation has been observed in the wild.';
  if (input.exploitability === 'poc') return 'A public proof of concept exists, which lowers the effort needed to attack this component.';
  if (input.exposure === 'internet' && (input.severity === 'critical' || input.severity === 'high')) {
    return 'This component is reachable from the internet, which raises the likelihood of exploitation.';
  }
  if (input.epssScore !== null && input.epssScore >= 0.5) {
    return `Roughly ${Math.round(input.epssScore * 100)}% of similar systems are expected to see exploitation activity in the next 30 days.`;
  }
  if (input.severity === 'critical' || input.severity === 'high') {
    return 'High-impact issue: the Cyber Resilience Act expects known vulnerabilities in shipped components to be handled without undue delay.';
  }
  return 'Lower impact, but it still counts towards a demonstrable vulnerability-handling process.';
}

/** Which CRA expectations this finding touches. Derived, never invented. */
function craRelevance(input: { kevFlag: boolean; severity: string | null; slaDueAt: number | null; state: string }) {
  const obligations: Array<{ controlId: string; title: string }> = [
    { controlId: 'cra.vuln.monitoring', title: 'Vulnerability monitoring' },
  ];

  if (input.kevFlag) {
    obligations.push({ controlId: 'cra.vuln.known_exploited', title: 'Known exploited vulnerabilities' });
    obligations.push({ controlId: 'cra.incident.process', title: 'Incident handling process' });
  }
  if (input.severity === 'critical' && input.state === 'open') {
    obligations.push({ controlId: 'cra.vuln.critical_open', title: 'Open critical vulnerabilities' });
  }
  if (input.slaDueAt) {
    obligations.push({ controlId: 'cra.vuln.sla', title: 'Remediation timelines' });
  }
  return obligations;
}

const querySchema = z.object({
  severity: z.string().optional(),
  priority: z.string().optional(),
  state: z.string().default('open'),
  repositoryId: z.string().optional(),
  kev: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  page: z.coerce.number().int().min(1).default(1),
});

findingsRoutes.get('/:orgId/findings', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const filters = querySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));

  const db = getDb();
  const repos = db.select().from(repositories).where(eq(repositories.orgId, orgId)).all();
  const repoById = new Map(repos.map((r) => [r.id, r]));

  // Findings come from the most recent scan of each repository. Older scans
  // stay in the database for history, but they must not resurface as "open".
  const scanIds = repos.map((r) => r.lastScanId).filter((id): id is string => Boolean(id));
  if (scanIds.length === 0) {
    return ok(c, { summary: emptySummary(), rows: [], total: 0, page: filters.page, perPage: filters.perPage });
  }

  const links = db
    .select()
    .from(componentVulnerabilities)
    .where(and(eq(componentVulnerabilities.orgId, orgId), inArray(componentVulnerabilities.scanId, scanIds)))
    .all();

  const comps = db.select().from(components).where(inArray(components.scanId, scanIds)).all();
  const vulns = db.select().from(vulnerabilities).all();
  const compById = new Map(comps.map((x) => [x.id, x]));
  const vulnById = new Map(vulns.map((v) => [v.id, v]));

  const rows = links
    .map((link) => {
      const component = compById.get(link.componentId);
      const vulnerability = vulnById.get(link.vulnerabilityId);
      if (!component || !vulnerability) return null;
      const repo = repoById.get(link.repositoryId);

      const priority = priorityOf({
        severity: vulnerability.severity,
        kevFlag: vulnerability.kevFlag,
        epssScore: vulnerability.epssScore,
        exploitability: link.exploitability,
        exposure: link.exposure,
        state: link.state,
      });

      return {
        id: link.id,
        state: link.state,
        priority,
        headline: headlineFor({
          componentName: component.name,
          version: component.version,
          severity: vulnerability.severity,
          kevFlag: vulnerability.kevFlag,
          exploitability: link.exploitability,
          repositoryName: repo?.fullName ?? repo?.name ?? 'Unknown repository',
        }),
        whyItMatters: whyItMatters({
          kevFlag: vulnerability.kevFlag,
          epssScore: vulnerability.epssScore,
          exploitability: link.exploitability,
          exposure: link.exposure,
          severity: vulnerability.severity,
          state: link.state,
        }),
        remediation: link.remediation ?? (link.fixedVersion ? `Upgrade ${component.name} to ${link.fixedVersion}.` : null),
        slaDueAt: link.slaDueAt,
        exploitability: link.exploitability,
        exposure: link.exposure,
        detectedAt: link.detectedAt,
        repository: {
          id: link.repositoryId,
          name: repo?.fullName ?? repo?.name ?? 'Unknown repository',
          monitoringEnabled: repo?.monitoringEnabled ?? false,
        },
        component: {
          id: component.id,
          name: component.name,
          version: component.version,
          ecosystem: component.ecosystem,
          purl: component.purl,
          isDirect: component.isDirect,
          manifestPath: component.manifestPath,
        },
        vulnerability: {
          id: vulnerability.id,
          sourceId: vulnerability.sourceId,
          summary: vulnerability.summary,
          severity: vulnerability.severity,
          cvssScore: vulnerability.cvssScore,
          cvssVector: vulnerability.cvssVector,
          epssScore: vulnerability.epssScore,
          kevFlag: vulnerability.kevFlag,
          publishedAt: vulnerability.publishedAt,
          fixedVersion: link.fixedVersion ?? null,
        },
        cra: craRelevance({
          kevFlag: vulnerability.kevFlag,
          severity: vulnerability.severity,
          slaDueAt: link.slaDueAt,
          state: link.state,
        }),
        severityWeight: SEVERITY_WEIGHT[vulnerability.severity ?? 'unknown'] ?? 0,
        riskScore: riskScore({
          severity: vulnerability.severity,
          kevFlag: vulnerability.kevFlag,
          epssScore: vulnerability.epssScore,
          exploitability: link.exploitability,
          exposure: link.exposure,
        }),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const filtered = rows.filter((row) => {
    if (filters.state !== 'all' && row.state !== filters.state) return false;
    if (filters.severity && row.vulnerability.severity !== filters.severity) return false;
    if (filters.priority && row.priority !== filters.priority) return false;
    if (filters.repositoryId && row.repository.id !== filters.repositoryId) return false;
    if (filters.kev === 'true' && !row.vulnerability.kevFlag) return false;
    if (filters.kev === 'false' && row.vulnerability.kevFlag) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      const haystack = `${row.component.name} ${row.vulnerability.sourceId} ${row.repository.name} ${row.component.purl ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Act now, then prioritise, then by severity: the order a human would work in.
  const order: Record<FindingPriority, number> = { act_now: 0, prioritise: 1, monitor: 2, review: 3 };
  filtered.sort(
    (a, b) =>
      order[a.priority] - order[b.priority] ||
      b.riskScore - a.riskScore ||
      b.severityWeight - a.severityWeight ||
      (b.vulnerability.epssScore ?? 0) - (a.vulnerability.epssScore ?? 0),
  );

  const total = filtered.length;
  const start = (filters.page - 1) * filters.perPage;
  const page = filtered.slice(start, start + filters.perPage);

  return ok(c, {
    summary: buildSummary(rows),
    rows: page,
    total,
    page: filters.page,
    perPage: filters.perPage,
  });
});

function emptySummary() {
  return {
    total: 0,
    open: 0,
    actNow: 0,
    prioritise: 0,
    monitor: 0,
    knownExploited: 0,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    overdueSla: 0,
    repositoriesAffected: 0,
  };
}

function buildSummary(rows: Array<{ state: string; priority: FindingPriority; vulnerability: { severity: string | null; kevFlag: boolean }; repository: { id: string }; slaDueAt: number | null }>) {
  const summary = emptySummary();
  const repos = new Set<string>();
  for (const row of rows) {
    summary.total += 1;
    if (row.state === 'open') summary.open += 1;
    if (row.priority === 'act_now') summary.actNow += 1;
    if (row.priority === 'prioritise') summary.prioritise += 1;
    if (row.priority === 'monitor') summary.monitor += 1;
    if (row.vulnerability.kevFlag) summary.knownExploited += 1;
    if (row.slaDueAt && row.slaDueAt < Date.now() && row.state === 'open') summary.overdueSla += 1;
    const sev = row.vulnerability.severity ?? 'unknown';
    if (sev in summary.bySeverity) summary.bySeverity[sev as keyof typeof summary.bySeverity] += 1;
    repos.add(row.repository.id);
  }
  summary.repositoriesAffected = repos.size;
  return summary;
}

// ---------------------------------------------------------------------------
// Triage: the one write action the findings screen performs.
// ---------------------------------------------------------------------------

const triageSchema = z.object({
  state: z.enum(['open', 'fixed', 'ignored', 'risk_accepted']),
  note: z.string().max(2000).optional(),
});

findingsRoutes.post('/:orgId/findings/:findingId/triage', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const findingId = c.req.param('findingId');
  const auth = c.get('auth')!;
  const body = await parseBody(c, triageSchema);

  const db = getDb();
  const link = db.select().from(componentVulnerabilities).where(eq(componentVulnerabilities.id, findingId)).get();
  if (!link || link.orgId !== orgId) throw AppError.notFound('Finding');

  db.update(componentVulnerabilities)
    .set({
      state: body.state,
      rationale: body.note ?? link.rationale,
      resolvedAt: body.state === 'fixed' ? Date.now() : null,
      assignedUserId: auth.user.id,
      updatedAt: Date.now(),
    })
    .where(eq(componentVulnerabilities.id, findingId))
    .run();

  audit({
    orgId,
    action: 'finding.triaged',
    targetType: 'finding',
    targetId: findingId,
    meta: { state: body.state, repositoryId: link.repositoryId },
    actorUserId: auth.user.id,
  });

  return ok(c, { id: findingId, state: body.state });
});

/**
 * The evidence behind one finding: what we know, where it came from, and which
 * controls it supports. This is the "why does CRAOS think this?" answer.
 */
findingsRoutes.get('/:orgId/findings/:findingId', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const findingId = c.req.param('findingId');
  const db = getDb();

  const link = db.select().from(componentVulnerabilities).where(eq(componentVulnerabilities.id, findingId)).get();
  if (!link || link.orgId !== orgId) throw AppError.notFound('Finding');

  const component = db.select().from(components).where(eq(components.id, link.componentId)).get();
  const vulnerability = db.select().from(vulnerabilities).where(eq(vulnerabilities.id, link.vulnerabilityId)).get();
  const repo = db.select().from(repositories).where(eq(repositories.id, link.repositoryId)).get();

  const assessments = db
    .select()
    .from(complianceAssessments)
    .where(eq(complianceAssessments.repositoryId, link.repositoryId))
    .all();

  const artefacts = db
    .select()
    .from(evidence)
    .where(and(eq(evidence.orgId, orgId), eq(evidence.repositoryId, link.repositoryId)))
    .orderBy(desc(evidence.createdAt))
    .all();

  return ok(c, {
    finding: {
      id: link.id,
      state: link.state,
      priority: priorityOf({
        severity: vulnerability?.severity ?? null,
        kevFlag: vulnerability?.kevFlag ?? false,
        epssScore: vulnerability?.epssScore ?? null,
        exploitability: link.exploitability,
        exposure: link.exposure,
        state: link.state,
      }),
      headline: headlineFor({
        componentName: component?.name ?? 'Component',
        version: component?.version ?? null,
        severity: vulnerability?.severity ?? null,
        kevFlag: vulnerability?.kevFlag ?? false,
        exploitability: link.exploitability,
        repositoryName: repo?.fullName ?? repo?.name ?? 'Unknown repository',
      }),
      whyItMatters: whyItMatters({
        kevFlag: vulnerability?.kevFlag ?? false,
        epssScore: vulnerability?.epssScore ?? null,
        exploitability: link.exploitability,
        exposure: link.exposure,
        severity: vulnerability?.severity ?? null,
        state: link.state,
      }),
      remediation: link.remediation,
      slaDueAt: link.slaDueAt,
      exploitability: link.exploitability,
      exposure: link.exposure,
      detectedAt: link.detectedAt,
      updatedAt: link.updatedAt,
      rationale: link.rationale,
    },
    repository: repo ? { id: repo.id, name: repo.fullName ?? repo.name, url: repo.url, defaultBranch: repo.defaultBranch } : null,
    component: component
      ? {
          id: component.id,
          name: component.name,
          version: component.version,
          ecosystem: component.ecosystem,
          purl: component.purl,
          isDirect: component.isDirect,
          manifestPath: component.manifestPath,
          licensesJson: component.licensesJson,
        }
      : null,
    vulnerability: vulnerability
      ? {
          id: vulnerability.id,
          sourceId: vulnerability.sourceId,
          summary: vulnerability.summary,
          severity: vulnerability.severity,
          cvssScore: vulnerability.cvssScore,
          cvssVector: vulnerability.cvssVector,
          epssScore: vulnerability.epssScore,
          kevFlag: vulnerability.kevFlag,
          publishedAt: vulnerability.publishedAt,
          fixedVersion: link.fixedVersion ?? null,
        }
      : null,
    supportingEvidence: artefacts.map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      sha256: e.sha256,
      createdAt: e.createdAt,
      source: e.source,
    })),
    relatedControls: (assessments ?? [])
      .filter((a) => ['cra.vuln.known_exploited', 'cra.vuln.critical_open', 'cra.vuln.monitoring', 'cra.vuln.sla', 'cra.vuln.triage'].includes(a.controlId))
      .map((a) => ({ controlId: a.controlId, status: a.status, rationale: a.rationale })),
  });
});

export { emptySummary };
