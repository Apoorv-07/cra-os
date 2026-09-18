import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { componentVulnerabilities, components, evidence, repositories, vulnerabilities } from '../db/schema.js';
import { buildContext, evaluate, type ControlStatus, type ReadinessResult } from './engine.js';
import { CONTROL_CATALOGUE } from './controls.js';

/**
 * Estate-level compliance aggregation.
 *
 * The engine evaluates one repository, because that is the unit the CRA is
 * written against. Everything the product shows at organisation level — the
 * Overview, org-wide reports, the admin health view — is therefore derived
 * here, in one place, so a score means the same thing on every screen.
 *
 * The rule for merging is deliberately conservative: **an organisation is only
 * as compliant as its weakest repository.** A control that passes in nine
 * repositories and is missing in the tenth is reported as missing.
 */

export interface EstateAssessment {
  controlId: string;
  title: string;
  domain: string;
  domainName: string | null;
  status: ControlStatus;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  remediation: string;
  evidence: string[];
  /** Which repositories drove the verdict. */
  repositories: Array<{ id: string; name: string; status: ControlStatus }>;
}

export interface EstateEvaluation {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'N/A';
  totals: { passed: number; partial: number; missing: number; needsReview: number; notApplicable: number };
  domains: Array<{ domain: string; name: string; shortName: string; score: number; controls: number }>;
  assessments: EstateAssessment[];
  actions: Array<{ controlId: string; title: string; rationale: string; impact: number; remediation: string; repositoryId?: string; repositoryName?: string }>;
  repositories: Array<{
    id: string;
    name: string;
    score: number;
    grade: string;
    lastScanAt: number | null;
    openCritical: number;
    openHigh: number;
    openKev: number;
  }>;
  evaluatedAt: number;
}

const STATUS_RANK: Record<string, number> = {
  missing: 0,
  needs_review: 1,
  partial: 2,
  passed: 3,
  not_applicable: 4,
};

/**
 * Domains are already human-readable strings in the control catalogue
 * ('Vulnerability handling'), so the only mapping needed is the short label
 * used where space is tight (chips, chart axes).
 */
const DOMAIN_SHORT: Record<string, string> = {
  'Component transparency': 'Inventory',
  'Vulnerability handling': 'Vulnerabilities',
  'Incident reporting': 'Incidents',
  'Secure development': 'Development',
  'Update & support': 'Support',
  Documentation: 'Documentation',
  'Security properties': 'Security',
  Governance: 'Governance',
};

function domainLabel(domain: string): string {
  return DOMAIN_SHORT[domain] ?? domain;
}

export function gradeFor(score: number): 'A' | 'B' | 'C' | 'D' | 'E' | 'N/A' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'E';
}

export function evaluateEstate(orgId: string): EstateEvaluation {
  const db = getDb();
  const repos = db
    .select()
    .from(repositories)
    .where(and(eq(repositories.orgId, orgId), eq(repositories.status, 'active')))
    .all();

  const perRepo = repos.map((repo) => ({
    repo,
    result: evaluate(buildContext({ orgId, repositoryId: repo.id })),
  }));

  const score = perRepo.length ? Math.round(perRepo.reduce((sum, p) => sum + p.result.score, 0) / perRepo.length) : 0;

  // ---- Controls: worst status across the estate wins -----------------------
  const byControl = new Map<string, EstateAssessment>();

  for (const { repo, result } of perRepo) {
    for (const a of result.assessments ?? []) {
      const definition = CONTROL_CATALOGUE.find((c) => c.id === a.controlId);
      const entry: EstateAssessment = byControl.get(a.controlId) ?? {
        controlId: a.controlId,
        title: definition?.title ?? a.controlId,
        domain: definition?.domain ?? 'Governance',
        domainName: definition?.domain ?? 'Governance',
        status: a.status,
        score: a.score,
        confidence: a.confidence,
        rationale: a.rationale,
        remediation: a.remediation,
        evidence: a.evidence ?? [],
        repositories: [],
      };

      entry.repositories.push({
        id: repo.id,
        name: repo.fullName ?? repo.name ?? 'Repository',
        status: a.status,
      });

      const current = byControl.get(a.controlId);
      if (!current || (STATUS_RANK[a.status] ?? 5) < (STATUS_RANK[current.status] ?? 5)) {
        const repoName = repo.fullName ?? repo.name ?? 'a repository';
        byControl.set(a.controlId, {
          ...entry,
          status: a.status,
          score: a.score,
          confidence: a.confidence,
          rationale:
            perRepo.length > 1
              ? `${a.rationale} (Weakest result across the estate: ${repoName}.)`
              : a.rationale,
          remediation: a.remediation,
          evidence: a.evidence ?? [],
        });
      } else {
        byControl.set(a.controlId, entry);
      }
    }
  }

  const assessments = [...byControl.values()].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 5) - (STATUS_RANK[b.status] ?? 5) || a.title.localeCompare(b.title),
  );

  const totals = {
    passed: assessments.filter((a) => a.status === 'passed').length,
    partial: assessments.filter((a) => a.status === 'partial').length,
    missing: assessments.filter((a) => a.status === 'missing').length,
    needsReview: assessments.filter((a) => a.status === 'needs_review').length,
    notApplicable: assessments.filter((a) => a.status === 'not_applicable').length,
  };

  // ---- Domains ------------------------------------------------------------
  const domainGroups = new Map<string, EstateAssessment[]>();
  for (const a of assessments) {
    const list = domainGroups.get(a.domain) ?? [];
    list.push(a);
    domainGroups.set(a.domain, list);
  }
  const domains = [...domainGroups.entries()].map(([domain, list]) => {
    const scored = list.filter((a) => a.status !== 'not_applicable');
    const domainScore = scored.length ? Math.round(scored.reduce((sum, a) => sum + a.score, 0) / scored.length) : 100;
    return { domain, name: domain, shortName: domainLabel(domain), score: domainScore, controls: list.length };
  });

  // ---- Actions: the highest-impact remediations across the estate ---------
  const actions = perRepo
    .flatMap(({ repo, result }) =>
      (result.actions ?? []).map((a) => ({
        ...a,
        repositoryId: repo.id,
        repositoryName: repo.fullName ?? repo.name ?? 'Repository',
      })),
    )
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 8);

  return {
    score,
    grade: perRepo.length === 0 ? 'N/A' : gradeFor(score),
    totals,
    domains,
    assessments,
    actions,
    repositories: perRepo.map(({ repo, result }) => ({
      id: repo.id,
      name: repo.fullName ?? repo.name ?? 'Repository',
      score: result.score,
      grade: result.grade,
      lastScanAt: repo.lastScanAt,
      openCritical: repo.openCritical ?? 0,
      openHigh: repo.openHigh ?? 0,
      openKev: repo.openKev ?? 0,
    })),
    evaluatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Attention — the Overview's reason to exist
// ---------------------------------------------------------------------------

export type AttentionKind = 'known_exploited' | 'critical_finding' | 'overdue_sla' | 'control_gap' | 'missing_evidence' | 'stale_scan' | 'no_repositories' | 'failed_scan';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  /** One line a director can read. */
  title: string;
  /** The consequence, in plain language. */
  why: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  repositoryId: string | null;
  repositoryName: string | null;
  /** Where "Resolve" should take the user. */
  href: string | null;
  count: number;
  dueAt: number | null;
}

/**
 * Turns the estate's state into the handful of things a human should act on
 * today. Everything here is derived from real rows — nothing is inferred or
 * invented — because the Overview is the screen customers screenshot.
 */
export function attentionFor(orgId: string): AttentionItem[] {
  const db = getDb();
  const items: AttentionItem[] = [];

  const repos = db.select().from(repositories).where(eq(repositories.orgId, orgId)).all();
  const active = repos.filter((r) => r.status === 'active');

  if (active.length === 0) {
    items.push({
      id: 'no-repositories',
      kind: 'no_repositories',
      title: 'No repositories connected yet',
      why: 'CRA readiness is assessed per repository. Connect one and the first scan produces an inventory, findings and a score.',
      severity: 'medium',
      repositoryId: null,
      repositoryName: null,
      href: '/app/onboarding',
      count: 0,
      dueAt: null,
    });
    return items;
  }

  const repoById = new Map(repos.map((r) => [r.id, r]));
  const nameOf = (id: string) => {
    const r = repoById.get(id);
    return r?.fullName ?? r?.name ?? 'Repository';
  };

  // Known-exploited and overdue findings come straight from the latest scan
  // of each repository.
  const scanIds = repos.map((r) => r.lastScanId).filter((id): id is string => Boolean(id));
  const links = scanIds.length
    ? db.select().from(componentVulnerabilities).where(and(eq(componentVulnerabilities.orgId, orgId))).all().filter((l) => scanIds.includes(l.scanId))
    : [];
  const openLinks = links.filter((l) => l.state === 'open');

  const kevByRepo = new Map<string, number>();
  const criticalByRepo = new Map<string, number>();
  const overdueByRepo = new Map<string, { count: number; dueAt: number }>();

  const vulnRows = db.select().from(vulnerabilities).all();

  for (const link of openLinks) {
    const vuln = vulnRows.find((v) => v.id === link.vulnerabilityId);
    if (vuln?.kevFlag) kevByRepo.set(link.repositoryId, (kevByRepo.get(link.repositoryId) ?? 0) + 1);
    if (vuln?.severity === 'critical') criticalByRepo.set(link.repositoryId, (criticalByRepo.get(link.repositoryId) ?? 0) + 1);
    if (link.slaDueAt && link.slaDueAt < Date.now()) {
      const existing = overdueByRepo.get(link.repositoryId);
      overdueByRepo.set(link.repositoryId, {
        count: (existing?.count ?? 0) + 1,
        dueAt: existing ? Math.min(existing.dueAt, link.slaDueAt) : link.slaDueAt,
      });
    }
  }

  for (const [repositoryId, count] of kevByRepo) {
    items.push({
      id: `kev:${repositoryId}`,
      kind: 'known_exploited',
      title: `${count} known exploited vulnerabilit${count === 1 ? 'y' : 'ies'} in ${nameOf(repositoryId)}`,
      why: 'Listed in CISA’s Known Exploited Vulnerabilities catalogue. Under the CRA this is both a remediation duty and a 24-hour reporting trigger.',
      severity: 'critical',
      repositoryId,
      repositoryName: nameOf(repositoryId),
      href: `/app/findings?repositoryId=${repositoryId}&priority=act_now`,
      count,
      dueAt: null,
    });
  }

  for (const [repositoryId, count] of criticalByRepo) {
    if (kevByRepo.has(repositoryId)) continue; // already covered, louder
    items.push({
      id: `critical:${repositoryId}`,
      kind: 'critical_finding',
      title: `${count} critical vulnerabilit${count === 1 ? 'y' : 'ies'} in ${nameOf(repositoryId)}`,
      why: 'Critical issues in shipped components are expected to be handled without undue delay.',
      severity: 'high',
      repositoryId,
      repositoryName: nameOf(repositoryId),
      href: `/app/findings?repositoryId=${repositoryId}&severity=critical`,
      count,
      dueAt: null,
    });
  }

  for (const [repositoryId, info] of overdueByRepo) {
    items.push({
      id: `sla:${repositoryId}`,
      kind: 'overdue_sla',
      title: `${info.count} finding${info.count === 1 ? '' : 's'} past their remediation due date in ${nameOf(repositoryId)}`,
      why: 'A due date you set and missed is harder to defend than having no date at all.',
      severity: 'high',
      repositoryId,
      repositoryName: nameOf(repositoryId),
      href: `/app/findings?repositoryId=${repositoryId}&state=open`,
      count: info.count,
      dueAt: info.dueAt,
    });
  }

  // Control gaps and evidence coverage.
  const estate = evaluateEstate(orgId);
  const gaps = estate.assessments.filter((a) => a.status === 'missing' || a.status === 'needs_review');
  if (gaps.length > 0) {
    const worst = gaps.slice(0, 3);
    items.push({
      id: 'control-gaps',
      kind: 'control_gap',
      title: `${gaps.length} CRA expectation${gaps.length === 1 ? '' : 's'} need${gaps.length === 1 ? 's' : ''} attention`,
      why: `Starting with “${worst[0]!.title}”. Each carries the reason CRAOS reached that conclusion and what would change it.`,
      severity: gaps.length >= 8 ? 'high' : 'medium',
      repositoryId: null,
      repositoryName: null,
      href: '/app/compliance?filter=needs_attention',
      count: gaps.length,
      dueAt: null,
    });
  }

  const evidenceCount = db.select().from(evidence).where(eq(evidence.orgId, orgId)).all().length;
  if (evidenceCount === 0 && active.length > 0) {
    items.push({
      id: 'missing-evidence',
      kind: 'missing_evidence',
      title: 'No evidence collected yet',
      why: 'Scan output proves what your code contains. Policies, runbooks and test reports prove how you work — both are needed for a defensible posture.',
      severity: 'medium',
      repositoryId: null,
      repositoryName: null,
      href: '/app/evidence',
      count: 0,
      dueAt: null,
    });
  }

  // Stale or failed scans.
  const stale = active.filter((r) => (r.lastScanAt ?? 0) < Date.now() - 14 * 86_400_000);
  for (const repo of stale.slice(0, 3)) {
    items.push({
      id: `stale:${repo.id}`,
      kind: 'stale_scan',
      title: `${repo.fullName ?? repo.name} has not been scanned in over two weeks`,
      why: 'Readiness drifts. Continuous monitoring exists so the score reflects today, not the day you connected the repository.',
      severity: 'medium',
      repositoryId: repo.id,
      repositoryName: repo.fullName ?? repo.name ?? null,
      href: `/app/repositories/${repo.id}`,
      count: 0,
      dueAt: null,
    });
  }

  const failed = active.filter((r) => r.status === 'error');
  for (const repo of failed.slice(0, 3)) {
    items.push({
      id: `failed:${repo.id}`,
      kind: 'failed_scan',
      title: `The last scan of ${repo.fullName ?? repo.name} failed`,
      why: 'Nothing was charged for a failed scan, but the posture shown for this repository is out of date until it succeeds.',
      severity: 'high',
      repositoryId: repo.id,
      repositoryName: repo.fullName ?? repo.name ?? null,
      href: `/app/repositories/${repo.id}`,
      count: 0,
      dueAt: null,
    });
  }

  const rank: Record<AttentionItem['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
}

/** Components per repository, used by the Overview's inventory summary. */
export function inventorySummary(orgId: string): { components: number; ecosystems: string[]; repositories: number } {
  const db = getDb();
  const repos = db.select().from(repositories).where(eq(repositories.orgId, orgId)).all();
  const scanIds = repos.map((r) => r.lastScanId).filter((id): id is string => Boolean(id));
  if (scanIds.length === 0) return { components: 0, ecosystems: [], repositories: 0 };

  const rows = db
    .select()
    .from(components)
    .all()
    .filter((c) => scanIds.includes(c.scanId));

  return {
    components: rows.length,
    ecosystems: [...new Set(rows.map((r) => r.ecosystem))].sort(),
    repositories: repos.length,
  };
}

/** Most recent evidence, for the "recently collected" strip on the Overview. */
export function recentEvidence(orgId: string, limit = 5) {
  return getDb()
    .select()
    .from(evidence)
    .where(eq(evidence.orgId, orgId))
    .orderBy(desc(evidence.createdAt))
    .limit(limit)
    .all();
}

export type { ReadinessResult };
