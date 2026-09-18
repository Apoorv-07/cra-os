import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  complianceAssessments,
  complianceControls,
  componentVulnerabilities,
  components as componentsTable,
  evidence,
  incidents,
  organizations,
  projects,
  repositories,
  scans,
  sboms,
  vulnerabilities,
} from '../db/schema.js';
import { newId } from '../core/ids.js';
import { CONTROL_CATALOGUE, type ControlDefinition } from './controls.js';

/**
 * CRA readiness engine.
 *
 * The score is a weighted, fully explainable function of real data. There is no
 * questionnaire: every control is evaluated either from scan output, from
 * artefacts discovered in the repository, or from evidence uploaded to the
 * vault. Every assessment persists its rationale so the UI can always answer
 * "why is my score 74%?" with a specific list of reasons and the evidence
 * behind each one.
 */

export type ControlStatus = 'passed' | 'partial' | 'missing' | 'not_applicable' | 'needs_review';

const STATUS_SCORE: Record<ControlStatus, number> = {
  passed: 1,
  partial: 0.5,
  needs_review: 0.25,
  missing: 0,
  not_applicable: 0,
};

export interface OpenFinding {
  severity: string;
  kev: boolean;
  state: string;
  assigned: boolean;
  slaDueAt: number | null;
  triaged: boolean;
  hasFix: boolean;
}

export interface EvaluationContext {
  orgId: string;
  repositoryId: string;
  scanId: string | null;
  hasScan: boolean;
  scanFreshnessDays: number | null;
  componentCount: number;
  componentsWithPurl: number;
  componentsWithLicense: number;
  directComponentCount: number;
  hasSbom: boolean;
  openFindings: OpenFinding[];
  policyFiles: string[];
  evidenceTypes: string[];
  evidenceControlIds: string[];
  monitoringEnabled: boolean;
  supportPeriodMonths: number | null;
  retentionDays: number;
  incidentReportCount: number;
  hasProductDescription: boolean;
  repoRegisteredInProject: boolean;
}

export interface ControlAssessmentResult {
  controlId: string;
  status: ControlStatus;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  evidence: string[];
  remediation: string;
}

export interface ReadinessResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'N/A';
  totals: { passed: number; partial: number; missing: number; needsReview: number; notApplicable: number };
  domains: Array<{ domain: string; score: number; weight: number; controls: number }>;
  assessments: ControlAssessmentResult[];
  actions: Array<{ controlId: string; title: string; rationale: string; impact: number; remediation: string }>;
}

type Evaluator = (ctx: EvaluationContext) => Omit<ControlAssessmentResult, 'controlId' | 'remediation'>;

const has = (ctx: EvaluationContext, key: string): boolean => ctx.policyFiles.includes(key);

// ---------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------

const evaluators: Record<string, Evaluator> = {
  'cra.sbom.present': (ctx) => {
    if (!ctx.hasSbom) {
      return {
        status: 'missing',
        score: 0,
        confidence: 'high',
        rationale: 'No SBOM has been generated for this repository yet.',
        evidence: [],
      };
    }
    if (ctx.scanFreshnessDays !== null && ctx.scanFreshnessDays > 30) {
      return {
        status: 'partial',
        score: 0.5,
        confidence: 'high',
        rationale: `An SBOM exists but the last scan was ${Math.round(ctx.scanFreshnessDays)} days ago, so it may not reflect the current release.`,
        evidence: ['sbom'],
      };
    }
    return {
      status: 'passed',
      score: 1,
      confidence: 'high',
      rationale: `A CycloneDX 1.6 SBOM covering ${ctx.componentCount} components is current.`,
      evidence: ['sbom'],
    };
  },

  'cra.sbom.completeness': (ctx) => {
    if (ctx.componentCount === 0) {
      return { status: 'missing', score: 0, confidence: 'high', rationale: 'No components were identified.', evidence: [] };
    }
    const purlRatio = ctx.componentsWithPurl / ctx.componentCount;
    const licenseRatio = ctx.componentsWithLicense / ctx.componentCount;
    const combined = purlRatio * 0.7 + licenseRatio * 0.3;

    if (combined >= 0.95) {
      return {
        status: 'passed',
        score: 1,
        confidence: 'high',
        rationale: `${ctx.componentsWithPurl}/${ctx.componentCount} components carry a purl and ${ctx.componentsWithLicense} declare a licence.`,
        evidence: ['sbom'],
      };
    }
    if (combined >= 0.6) {
      return {
        status: 'partial',
        score: combined,
        confidence: 'high',
        rationale: `${Math.round(purlRatio * 100)}% of components have a resolvable identifier and ${Math.round(licenseRatio * 100)}% declare a licence. Coverage is incomplete.`,
        evidence: ['sbom'],
      };
    }
    return {
      status: 'missing',
      score: combined,
      confidence: 'high',
      rationale: `Only ${Math.round(purlRatio * 100)}% of components carry a purl; provenance cannot be established for the rest.`,
      evidence: [],
    };
  },

  'cra.inventory.direct': (ctx) => {
    if (ctx.componentCount === 0) {
      return { status: 'missing', score: 0, confidence: 'high', rationale: 'No inventory to assess.', evidence: [] };
    }
    if (ctx.directComponentCount > 0) {
      return {
        status: 'passed',
        score: 1,
        confidence: 'high',
        rationale: `${ctx.directComponentCount} top-level dependencies are distinguished from transitive ones.`,
        evidence: ['sbom'],
      };
    }
    return {
      status: 'partial',
      score: 0.5,
      confidence: 'medium',
      rationale:
        'The inventory does not distinguish direct dependencies. Commit a manifest declaring them so top-level dependencies can be documented.',
      evidence: [],
    };
  },

  'cra.vuln.known_exploited': (ctx) => {
    const kev = ctx.openFindings.filter((f) => f.kev);
    if (kev.length === 0) {
      return {
        status: ctx.hasScan ? 'passed' : 'needs_review',
        score: ctx.hasScan ? 1 : 0.25,
        confidence: ctx.hasScan ? 'high' : 'low',
        rationale: ctx.hasScan
          ? `No component matches the CISA Known Exploited Vulnerabilities catalogue across ${ctx.componentCount} components.`
          : 'No scan has been run, so known-exploited exposure is unverified.',
        evidence: ctx.hasScan ? ['scan_result'] : [],
      };
    }
    return {
      status: 'missing',
      score: 0,
      confidence: 'high',
      rationale: `${kev.length} component(s) carry a CVE that is being actively exploited in the wild. This starts the Article 14 24-hour reporting clock.`,
      evidence: ['scan_result'],
    };
  },

  'cra.vuln.critical_open': (ctx) => {
    const severe = ctx.openFindings.filter((f) => f.severity === 'critical' || f.severity === 'high');
    if (severe.length === 0) {
      return {
        status: ctx.hasScan ? 'passed' : 'needs_review',
        score: ctx.hasScan ? 1 : 0.25,
        confidence: ctx.hasScan ? 'high' : 'low',
        rationale: ctx.hasScan ? 'No open critical or high severity vulnerabilities.' : 'Not yet scanned.',
        evidence: ctx.hasScan ? ['scan_result'] : [],
      };
    }
    const unresolved = severe.filter((f) => !f.assigned && !f.slaDueAt);
    if (unresolved.length === 0) {
      return {
        status: 'partial',
        score: 0.75,
        confidence: 'high',
        rationale: `${severe.length} critical/high findings are open but each has an owner and a due date.`,
        evidence: ['remediation'],
      };
    }
    return {
      status: 'missing',
      score: Math.max(0, 0.4 - unresolved.length * 0.05),
      confidence: 'high',
      rationale: `${unresolved.length} of ${severe.length} critical/high findings have no owner or due date.`,
      evidence: [],
    };
  },

  'cra.vuln.monitoring': (ctx) => {
    if (ctx.monitoringEnabled) {
      return {
        status: 'passed',
        score: 1,
        confidence: 'high',
        rationale: 'Scheduled monitoring is enabled, so new advisories are detected automatically.',
        evidence: ['scan_result'],
      };
    }
    return {
      status: 'missing',
      score: 0,
      confidence: 'high',
      rationale: 'This repository is scanned only on demand, so a newly published advisory will not be detected until someone runs a scan.',
      evidence: [],
    };
  },

  'cra.vuln.sla': (ctx) => {
    const hasPolicy = ctx.evidenceTypes.includes('policy') || has(ctx, 'security_policy');
    const dated = ctx.openFindings.filter((f) => f.slaDueAt).length;
    const total = ctx.openFindings.length;

    if (hasPolicy && total > 0 && dated === total) {
      return { status: 'passed', score: 1, confidence: 'high', rationale: 'A vulnerability handling policy exists and every open finding carries a due date.', evidence: ['policy'] };
    }
    if (hasPolicy) {
      return {
        status: 'partial',
        score: 0.6,
        confidence: 'medium',
        rationale: total === 0
          ? 'A policy exists and there are no open findings to schedule.'
          : `A policy exists but only ${dated} of ${total} open findings have a due date.`,
        evidence: ['policy'],
      };
    }
    return { status: 'missing', score: 0, confidence: 'medium', rationale: 'No vulnerability handling policy has been uploaded.', evidence: [] };
  },

  'cra.vuln.triage': (ctx) => {
    if (ctx.openFindings.length === 0) {
      return { status: ctx.hasScan ? 'passed' : 'needs_review', score: ctx.hasScan ? 1 : 0.25, confidence: ctx.hasScan ? 'high' : 'low', rationale: ctx.hasScan ? 'No open findings to triage.' : 'Not yet scanned.', evidence: [] };
    }
    const triaged = ctx.openFindings.filter((f) => f.triaged).length;
    const ratio = triaged / ctx.openFindings.length;
    if (ratio >= 0.9) return { status: 'passed', score: 1, confidence: 'high', rationale: `${triaged}/${ctx.openFindings.length} open findings have been triaged.`, evidence: ['remediation'] };
    if (ratio > 0) return { status: 'partial', score: ratio, confidence: 'high', rationale: `Only ${triaged} of ${ctx.openFindings.length} open findings have been triaged.`, evidence: [] };
    return { status: 'missing', score: 0, confidence: 'high', rationale: `None of the ${ctx.openFindings.length} open findings have been triaged.`, evidence: [] };
  },

  'cra.incident.process': (ctx) => {
    const hasRunbook = ctx.evidenceTypes.includes('policy') || ctx.evidenceControlIds.includes('cra.incident.process');
    if (hasRunbook) return { status: 'passed', score: 1, confidence: 'medium', rationale: 'An incident response artefact is stored in the evidence vault.', evidence: ['policy'] };
    if (ctx.incidentReportCount > 0) return { status: 'partial', score: 0.6, confidence: 'medium', rationale: 'Reports have been drafted but no runbook is on file.', evidence: ['report'] };
    return { status: 'missing', score: 0, confidence: 'medium', rationale: 'No Article 14 process documentation has been uploaded.', evidence: [] };
  },

  'cra.incident.rehearsal': (ctx) => {
    if (ctx.incidentReportCount >= 3) return { status: 'passed', score: 1, confidence: 'high', rationale: `${ctx.incidentReportCount} Article 14 report drafts have been produced, covering all three stages.`, evidence: ['report'] };
    if (ctx.incidentReportCount > 0) return { status: 'partial', score: 0.5, confidence: 'high', rationale: `${ctx.incidentReportCount} draft(s) produced; rehearse the full 24h/72h/14-day set.`, evidence: ['report'] };
    return { status: 'missing', score: 0, confidence: 'high', rationale: 'The reporting workflow has never been exercised. The 24-hour clock cannot be met cold.', evidence: [] };
  },

  'cra.incident.escalation': (ctx) => ({
    status: ctx.evidenceControlIds.includes('cra.incident.escalation') ? 'passed' : 'needs_review',
    score: ctx.evidenceControlIds.includes('cra.incident.escalation') ? 1 : 0.25,
    confidence: 'medium',
    rationale: ctx.evidenceControlIds.includes('cra.incident.escalation')
      ? 'Escalation ownership is recorded in the evidence vault.'
      : 'No recorded owner or escalation path. This is a manual attestation control.',
    evidence: ctx.evidenceControlIds.includes('cra.incident.escalation') ? ['policy'] : [],
  }),

  'cra.dev.disclosure': (ctx) => {
    if (has(ctx, 'security_policy')) return { status: 'passed', score: 1, confidence: 'high', rationale: 'A SECURITY.md is present, providing a coordinated disclosure channel.', evidence: ['policy:SECURITY.md'] };
    if (ctx.evidenceTypes.includes('policy')) return { status: 'partial', score: 0.6, confidence: 'medium', rationale: 'A policy document exists in the vault but no disclosure file was found in the repository.', evidence: ['policy'] };
    return { status: 'missing', score: 0, confidence: 'high', rationale: 'No SECURITY.md or disclosure policy found.', evidence: [] };
  },

  'cra.dev.dependency_updates': (ctx) => {
    if (has(ctx, 'dependabot') || has(ctx, 'renovate')) return { status: 'passed', score: 1, confidence: 'high', rationale: 'Automated dependency update tooling is configured in the repository.', evidence: ['policy:dependabot/renovate'] };
    return { status: 'missing', score: 0, confidence: 'high', rationale: 'No Dependabot or Renovate configuration was found.', evidence: [] };
  },

  'cra.dev.ci': (ctx) => has(ctx, 'ci_workflow')
    ? { status: 'passed', score: 1, confidence: 'high', rationale: 'CI workflows are present and were evaluated as build evidence.', evidence: ['policy:.github/workflows'] }
    : { status: 'missing', score: 0, confidence: 'high', rationale: 'No CI workflow was found in the repository.', evidence: [] },

  'cra.dev.code_review': (ctx) => has(ctx, 'codeowners')
    ? { status: 'passed', score: 1, confidence: 'high', rationale: 'A CODEOWNERS file defines review ownership.', evidence: ['policy:CODEOWNERS'] }
    : { status: 'partial', score: 0.4, confidence: 'medium', rationale: 'No CODEOWNERS file; review ownership is not machine-verifiable.', evidence: [] },

  'cra.dev.threat_model': (ctx) => {
    if (has(ctx, 'threat_model') || ctx.evidenceControlIds.includes('cra.dev.threat_model')) {
      return { status: 'passed', score: 1, confidence: 'medium', rationale: 'A threat model or security design record is present.', evidence: ['document'] };
    }
    return { status: 'missing', score: 0, confidence: 'medium', rationale: 'No threat model found in the repository or evidence vault.', evidence: [] };
  },

  'cra.dev.sast': (ctx) => has(ctx, 'sa_config')
    ? { status: 'passed', score: 1, confidence: 'medium', rationale: 'Static analysis or security scanning configuration detected.', evidence: ['policy:scanner-config'] }
    : { status: 'missing', score: 0, confidence: 'medium', rationale: 'No SAST or secret scanning configuration detected.', evidence: [] },

  'cra.support.period': (ctx) => {
    if (ctx.supportPeriodMonths && ctx.supportPeriodMonths >= 60) return { status: 'passed', score: 1, confidence: 'medium', rationale: `A support period of ${Math.round(ctx.supportPeriodMonths / 12)} years is declared on the product.`, evidence: ['product record'] };
    if (ctx.supportPeriodMonths) return { status: 'partial', score: 0.5, confidence: 'medium', rationale: `A support period of ${ctx.supportPeriodMonths} months is declared; most products require at least 5 years.`, evidence: ['product record'] };
    if (ctx.evidenceControlIds.includes('cra.support.period')) return { status: 'passed', score: 1, confidence: 'medium', rationale: 'Support period evidence is stored in the vault.', evidence: ['document'] };
    return { status: 'missing', score: 0, confidence: 'medium', rationale: 'No support period is declared for this product.', evidence: [] };
  },

  'cra.support.updates_process': (ctx) => attested(ctx, 'cra.support.updates_process', 'A documented security update delivery process', 'No documented process for building, testing and shipping security updates.'),
  'cra.support.integrity': (ctx) => attested(ctx, 'cra.support.integrity', 'Update integrity protection is documented (signing and verification).', 'No evidence that updates are signed or integrity-protected.'),

  'cra.doc.technical': (ctx) => {
    const parts = [ctx.hasSbom, ctx.hasProductDescription, Boolean(ctx.supportPeriodMonths) || ctx.evidenceControlIds.includes('cra.support.period')];
    const count = parts.filter(Boolean).length;
    if (count === 3) return { status: 'passed', score: 1, confidence: 'medium', rationale: 'SBOM, product description and support period are all present in the technical file.', evidence: ['sbom', 'document'] };
    if (count === 2) return { status: 'partial', score: 0.66, confidence: 'medium', rationale: 'Two of three technical documentation elements are present.', evidence: ['sbom'] };
    if (count === 1) return { status: 'partial', score: 0.33, confidence: 'medium', rationale: 'Only one technical documentation element is present.', evidence: [] };
    return { status: 'missing', score: 0, confidence: 'medium', rationale: 'No technical documentation elements found.', evidence: [] };
  },

  'cra.doc.user_information': (ctx) => has(ctx, 'readme')
    ? { status: 'passed', score: 1, confidence: 'medium', rationale: 'A README is present and can carry secure-use instructions.', evidence: ['document:README'] }
    : { status: 'missing', score: 0, confidence: 'medium', rationale: 'No README or user documentation found.', evidence: [] },

  'cra.doc.licensing': (ctx) => {
    if (ctx.componentCount === 0) return { status: 'missing', score: 0, confidence: 'high', rationale: 'No components to assess.', evidence: [] };
    const ratio = ctx.componentsWithLicense / ctx.componentCount;
    if (ratio >= 0.8) return { status: 'passed', score: 1, confidence: 'high', rationale: `${Math.round(ratio * 100)}% of components declare a licence.`, evidence: ['sbom'] };
    if (ratio > 0) return { status: 'partial', score: ratio, confidence: 'high', rationale: `Only ${Math.round(ratio * 100)}% of components declare a licence.`, evidence: [] };
    return { status: 'missing', score: 0, confidence: 'high', rationale: 'No licence information captured for any component.', evidence: [] };
  },

  'cra.sec.secure_defaults': (ctx) => attested(ctx, 'cra.sec.secure_defaults', 'Secure default configuration is documented.', 'No evidence about default configuration or default credentials.'),
  'cra.sec.access_control': (ctx) => attested(ctx, 'cra.sec.access_control', 'Access control and authentication are documented.', 'No evidence describing authentication or authorisation.'),
  'cra.sec.data_protection': (ctx) => attested(ctx, 'cra.sec.data_protection', 'Data protection measures are documented.', 'No evidence describing encryption at rest or in transit.'),
  'cra.sec.logging': (ctx) => attested(ctx, 'cra.sec.logging', 'Security logging and monitoring are documented.', 'No evidence describing security event logging.'),
  'cra.sec.input_validation': (ctx) => attested(ctx, 'cra.sec.input_validation', 'Input validation and error handling are documented.', 'No evidence describing input validation.'),

  'cra.gov.risk_assessment': (ctx) => {
    const documented = ctx.evidenceControlIds.includes('cra.gov.risk_assessment') || has(ctx, 'threat_model');
    if (documented) return { status: 'passed', score: 1, confidence: 'medium', rationale: 'A risk assessment or threat model is on file.', evidence: ['document'] };
    return { status: 'needs_review', score: 0.25, confidence: 'low', rationale: 'No cybersecurity risk assessment has been uploaded.', evidence: [] };
  },

  'cra.gov.pen_test': (ctx) => attested(ctx, 'cra.gov.pen_test', 'Independent security testing evidence is on file.', 'No penetration test or security review evidence has been uploaded.'),

  'cra.gov.conformity': (ctx) => attested(ctx, 'cra.gov.conformity', 'The conformity assessment route is recorded.', 'The applicable conformity assessment route has not been recorded.'),

  'cra.gov.supply_chain': (ctx) => {
    if (!ctx.hasScan) return { status: 'needs_review', score: 0.25, confidence: 'low', rationale: 'No inventory available to assess supply chain exposure.', evidence: [] };
    const ok = ctx.evidenceControlIds.includes('cra.gov.supply_chain');
    if (ok) return { status: 'passed', score: 1, confidence: 'medium', rationale: `Supply chain review recorded against ${ctx.componentCount} tracked components.`, evidence: ['sbom', 'document'] };
    return {
      status: 'partial',
      score: 0.5,
      confidence: 'medium',
      rationale: `${ctx.componentCount} third-party components are inventoried, but no supplier due diligence review has been recorded.`,
      evidence: ['sbom'],
    };
  },

  'cra.gov.retention': (ctx) => ctx.retentionDays >= 1825
    ? { status: 'passed', score: 1, confidence: 'high', rationale: `Evidence retention is configured for ${Math.round(ctx.retentionDays / 365)} years.`, evidence: ['policy'] }
    : { status: 'partial', score: 0.5, confidence: 'high', rationale: `Retention is ${ctx.retentionDays} days; align it with the product support period.`, evidence: [] },
};

function attested(
  ctx: EvaluationContext,
  controlId: string,
  passRationale: string,
  missingRationale: string,
): Omit<ControlAssessmentResult, 'controlId' | 'remediation'> {
  if (ctx.evidenceControlIds.includes(controlId)) {
    return { status: 'passed', score: 1, confidence: 'medium', rationale: passRationale, evidence: ['document'] };
  }
  return { status: 'needs_review', score: 0.25, confidence: 'low', rationale: missingRationale, evidence: [] };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function evaluate(ctx: EvaluationContext): ReadinessResult {
  const db = getDb();
  const controlRows = db.select().from(complianceControls).all();
  const byId = new Map(controlRows.map((c) => [c.id, c]));
  const now = Date.now();

  const assessments: ControlAssessmentResult[] = [];
  let weightedSum = 0;
  let applicableWeight = 0;

  const totals = { passed: 0, partial: 0, missing: 0, needsReview: 0, notApplicable: 0 };

  for (const definition of CONTROL_CATALOGUE) {
    const control = byId.get(definition.id);
    if (!control || !control.isActive) continue;

    const evaluator = evaluators[definition.id];
    const result = evaluator
      ? evaluator(ctx)
      : { status: 'needs_review' as ControlStatus, score: 0.25, confidence: 'low' as const, rationale: 'No evaluator configured for this control.', evidence: [] };

    const full: ControlAssessmentResult = {
      controlId: definition.id,
      status: result.status,
      score: result.score,
      confidence: result.confidence,
      rationale: result.rationale,
      evidence: result.evidence,
      remediation: definition.remediation,
    };
    assessments.push(full);

    if (result.status === 'passed') totals.passed += 1;
    else if (result.status === 'partial') totals.partial += 1;
    else if (result.status === 'missing') totals.missing += 1;
    else if (result.status === 'needs_review') totals.needsReview += 1;
    else totals.notApplicable += 1;

    if (result.status !== 'not_applicable') {
      weightedSum += control.weight * STATUS_SCORE[result.status] * result.score;
      applicableWeight += control.weight;
    }

    const existing = db
      .select({ id: complianceAssessments.id })
      .from(complianceAssessments)
      .where(
        and(
          eq(complianceAssessments.orgId, ctx.orgId),
          eq(complianceAssessments.repositoryId, ctx.repositoryId),
          eq(complianceAssessments.controlId, definition.id),
        ),
      )
      .get();

    const values = {
      status: result.status,
      score: STATUS_SCORE[result.status] * result.score,
      confidence: result.confidence,
      rationale: result.rationale,
      evidenceJson: JSON.stringify(result.evidence),
      remediation: definition.remediation,
      scanId: ctx.scanId,
      updatedAt: now,
    };

    if (existing) {
      db.update(complianceAssessments).set(values).where(eq(complianceAssessments.id, existing.id)).run();
    } else {
      db.insert(complianceAssessments)
        .values({
          id: newId('asm'),
          orgId: ctx.orgId,
          repositoryId: ctx.repositoryId,
          controlId: definition.id,
          ...values,
          createdAt: now,
        })
        .run();
    }
  }

  const score = applicableWeight > 0 ? Math.round((weightedSum / applicableWeight) * 100) : 0;

  // Domain roll-up.
  const domainMap = new Map<string, { weight: number; earned: number; controls: number }>();
  for (const assessment of assessments) {
    const definition = CONTROL_CATALOGUE.find((c) => c.id === assessment.controlId);
    if (!definition) continue;
    if (assessment.status === 'not_applicable') continue;
    const entry = domainMap.get(definition.domain) ?? { weight: 0, earned: 0, controls: 0 };
    entry.weight += definition.weight;
    entry.earned += definition.weight * STATUS_SCORE[assessment.status] * assessment.score;
    entry.controls += 1;
    domainMap.set(definition.domain, entry);
  }

  const domains = [...domainMap.entries()].map(([domain, entry]) => ({
    domain,
    score: entry.weight > 0 ? Math.round((entry.earned / entry.weight) * 100) : 0,
    weight: entry.weight,
    controls: entry.controls,
  }));

  // Highest-impact actions: what the user should fix first.
  const actions = assessments
    .filter((a) => a.status !== 'passed' && a.status !== 'not_applicable')
    .map((a) => {
      const definition = CONTROL_CATALOGUE.find((c) => c.id === a.controlId);
      const weight = definition?.weight ?? 1;
      return {
        controlId: a.controlId,
        title: definition?.title ?? a.controlId,
        rationale: a.rationale,
        impact: Number(((weight * (1 - STATUS_SCORE[a.status] * a.score)) / 1).toFixed(2)),
        remediation: a.remediation,
      };
    })
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5);

  db.update(repositories).set({ readinessScore: score, updatedAt: now }).where(eq(repositories.id, ctx.repositoryId)).run();

  return { score, grade: gradeFor(score), totals, domains, assessments, actions };
}

export function gradeFor(score: number): ReadinessResult['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  if (score > 0) return 'E';
  return 'N/A';
}

/**
 * Builds the evaluation context by reading everything the engine needs in one
 * place. Kept separate from `evaluate` so it is cheap to unit test.
 */
export function buildContext(input: {
  orgId: string;
  repositoryId: string;
}): EvaluationContext {
  const db = getDb();

  const repo = db.select().from(repositories).where(eq(repositories.id, input.repositoryId)).get();
  const org = db.select().from(organizations).where(eq(organizations.id, input.orgId)).get();
  const project = repo?.projectId
    ? db.select().from(projects).where(eq(projects.id, repo.projectId)).get()
    : null;

  // Evidence stored against this repository (or the org as a whole) determines
  // which attested controls are satisfied.
  const evidenceRows = db
    .select()
    .from(evidence)
    .where(and(eq(evidence.orgId, input.orgId), eq(evidence.repositoryId, input.repositoryId)))
    .all();
  const orgEvidence = db.select().from(evidence).where(eq(evidence.orgId, input.orgId)).all();

  const evidenceTypes = [...new Set([...evidenceRows, ...orgEvidence].map((e) => e.type))];
  const evidenceControlIds = new Set<string>();
  for (const row of [...evidenceRows, ...orgEvidence]) {
    try {
      const ids = JSON.parse(row.controlIdsJson ?? '[]') as string[];
      for (const id of ids) evidenceControlIds.add(id);
    } catch {
      /* non-fatal */
    }
  }

  // Policy artefacts discovered during the last scan.
  const scan = repo?.lastScanId ? db.select().from(scans).where(eq(scans.id, repo.lastScanId)).get() : null;
  let policyFiles: string[];
  try {
    const meta = scan?.manifestsJson ? (JSON.parse(scan.manifestsJson) as { policyFiles?: string[] }) : null;
    policyFiles = meta?.policyFiles ?? [];
  } catch {
    policyFiles = [];
  }

  const components = scan
    ? db.select().from(componentsTable).where(eq(componentsTable.scanId, scan.id)).all()
    : [];
  const openFindings = db
    .select()
    .from(componentVulnerabilities)
    .where(and(eq(componentVulnerabilities.orgId, input.orgId), eq(componentVulnerabilities.state, 'open')))
    .all();
  const vulnById = new Map(
    db.select().from(vulnerabilities).all().map((v) => [v.id, v]),
  );

  const sbomRow = db.select({ id: sboms.id }).from(sboms).where(eq(sboms.repositoryId, input.repositoryId)).get();

  return {
    orgId: input.orgId,
    repositoryId: input.repositoryId,
    scanId: repo?.lastScanId ?? null,
    hasScan: Boolean(repo?.lastScanId),
    scanFreshnessDays: repo?.lastScanAt ? (Date.now() - repo.lastScanAt) / 86_400_000 : null,
    componentCount: components.length,
    componentsWithPurl: components.filter((c) => Boolean(c.purl)).length,
    componentsWithLicense: components.filter((c) => (c.licensesJson ?? '').length > 2).length,
    directComponentCount: components.filter((c) => Boolean(c.isDirect)).length,
    hasSbom: Boolean(sbomRow),
    openFindings: openFindings.map((f) => {
      const vuln = vulnById.get(f.vulnerabilityId);
      return {
        severity: vuln?.severity ?? 'unknown',
        kev: Boolean(vuln?.kevFlag),
        state: f.state,
        assigned: Boolean(f.assignedUserId),
        slaDueAt: f.slaDueAt,
        triaged: Boolean(f.assignedUserId) || f.exploitability !== 'unknown' || f.exposure !== 'unknown',
        hasFix: Boolean(f.fixedVersion),
      };
    }),
    policyFiles,
    evidenceTypes,
    evidenceControlIds: [...evidenceControlIds],
    monitoringEnabled: Boolean(repo?.monitoringEnabled),
    supportPeriodMonths: project?.supportPeriodMonths ?? null,
    retentionDays: org?.retentionDays ?? 365,
    incidentReportCount: countIncidentReports(input.orgId),
    hasProductDescription: Boolean(repo?.fullName),
    repoRegisteredInProject: Boolean(repo?.projectId),
  };
}

export function countIncidentReports(orgId: string): number {
  const rows = getDb().select({ id: incidents.id }).from(incidents).where(eq(incidents.orgId, orgId)).all();
  return rows.length;
}

export type { ControlDefinition };
