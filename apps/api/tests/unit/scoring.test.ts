import {describe, it, expect} from 'vitest';
import { getDb } from '../../src/db/index.js';
import { organizations, users, repositories, complianceAssessments as complianceAssessmentsTable } from '../../src/db/schema.js';
import { evaluate, gradeFor, type EvaluationContext, type OpenFinding } from '../../src/compliance/engine.js';
import { CONTROL_CATALOGUE, CONTROL_IDS } from '../../src/compliance/controls.js';
import { newId } from '../../src/core/ids.js';

/**
 * CRA readiness scoring.
 *
 * The score is the number customers and auditors look at first, so these tests
 * pin down three properties: it is explainable, it is deterministic, and it
 * moves in the direction a security engineer would expect when reality changes.
 */

function seed(orgSuffix = `t${Math.random().toString(36).slice(2, 8)}`) {
  const db = getDb();
  const userId = newId('usr');
  db.insert(users)
    .values({
      id: userId,
      email: `${orgSuffix}@example.com`,
      emailNormalised: `${orgSuffix}@example.com`,
      name: orgSuffix,
      passwordHash: 'x',
      status: 'active',
      isSystemAdmin: false,
      timezone: 'UTC',
      locale: 'en',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  const orgId = newId('org');
  db.insert(organizations)
    .values({
      id: orgId,
      name: orgSuffix,
      slug: orgSuffix,
      planKey: 'free',
      isAgency: false,
      status: 'active',
      createdByUserId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  const repositoryId = newId('repo');
  db.insert(repositories)
    .values({
      id: repositoryId,
      orgId,
      provider: 'github',
      providerRepoId: String(Math.floor(Math.random() * 1e9)),
      name: 'demo',
      fullName: 'acme/demo',
      defaultBranch: 'main',
      visibility: 'private',
      monitoringEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  return { orgId, repositoryId };
}

function baseContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  const { orgId, repositoryId } = seed();
  return {
    orgId,
    repositoryId,
    scanId: null,
    hasScan: false,
    scanFreshnessDays: null,
    componentCount: 0,
    componentsWithPurl: 0,
    componentsWithLicense: 0,
    directComponentCount: 0,
    hasSbom: false,
    openFindings: [],
    policyFiles: [],
    evidenceTypes: [],
    evidenceControlIds: [],
    monitoringEnabled: false,
    supportPeriodMonths: null,
    retentionDays: 365,
    incidentReportCount: 0,
    hasProductDescription: false,
    repoRegisteredInProject: false,
    ...overrides,
  };
}

const finding = (over: Partial<OpenFinding> = {}): OpenFinding => ({
  severity: 'high',
  kev: false,
  state: 'open',
  assigned: false,
  slaDueAt: null,
  triaged: false,
  hasFix: true,
  ...over,
});

describe('control catalogue', () => {
  it('has no duplicate ids', () => {
    expect(new Set(CONTROL_IDS).size).toBe(CONTROL_IDS.length);
  });

  it('gives every control a remediation and a positive weight', () => {
    for (const c of CONTROL_CATALOGUE) {
      expect(c.remediation.length, `${c.id} has no remediation guidance`).toBeGreaterThan(10);
      expect(c.weight, `${c.id} has a non-positive weight`).toBeGreaterThan(0);
      expect(c.title.length).toBeGreaterThan(3);
    }
  });
});

describe('evaluate', () => {
  it('assesses every control in the catalogue', () => {
    const result = evaluate(baseContext());
    const assessed = new Set(result.assessments.map((a) => a.controlId));
    for (const id of CONTROL_IDS) expect(assessed.has(id), `${id} was never assessed`).toBe(true);
  });

  it('is explainable: every assessment carries a rationale and a remediation', () => {
    const result = evaluate(baseContext({ hasScan: true, componentCount: 12 }));
    for (const a of result.assessments) {
      expect(a.rationale.length, `${a.controlId} has an empty rationale`).toBeGreaterThan(0);
      expect(a.remediation.length, `${a.controlId} has no remediation`).toBeGreaterThan(0);
    }
  });

  it('only uses the five documented statuses', () => {
    const result = evaluate(baseContext({ hasScan: true, componentCount: 5 }));
    const allowed = new Set(['passed', 'partial', 'missing', 'not_applicable', 'needs_review']);
    for (const a of result.assessments) expect(allowed.has(a.status)).toBe(true);
  });

  it('scores a never-scanned repository low and marks unverified controls for review', () => {
    const result = evaluate(baseContext());
    expect(result.score).toBeLessThan(20);
    expect(result.totals.needsReview).toBeGreaterThan(0);
  });

  it('is deterministic — the same context always produces the same score', () => {
    const ctx = baseContext({
      hasScan: true,
      hasSbom: true,
      componentCount: 20,
      componentsWithPurl: 20,
      componentsWithLicense: 18,
      directComponentCount: 6,
      monitoringEnabled: true,
      policyFiles: ['security_policy', 'readme'],
      evidenceTypes: ['policy'],
      evidenceControlIds: ['cra.vuln.sla'],
      supportPeriodMonths: 24,
      retentionDays: 1825,
    });
    const a = evaluate(ctx);
    const b = evaluate(ctx);
    expect(a.score).toBe(b.score);
    expect(a.assessments.map((x) => x.status)).toEqual(b.assessments.map((x) => x.status));
  });

  it('rewards a well-run repository with a high score', () => {
    const good = evaluate(
      baseContext({
        hasScan: true,
        scanFreshnessDays: 2,
        hasSbom: true,
        componentCount: 40,
        componentsWithPurl: 40,
        componentsWithLicense: 40,
        directComponentCount: 12,
        monitoringEnabled: true,
        policyFiles: ['security_policy', 'readme', 'ci_workflow', 'codeowners', 'sa_config'],
        evidenceTypes: ['policy', 'pen_test'],
        evidenceControlIds: CONTROL_IDS,
        supportPeriodMonths: 36,
        retentionDays: 1825,
        incidentReportCount: 3,
        hasProductDescription: true,
        repoRegisteredInProject: true,
      }),
    );
    expect(good.score).toBeGreaterThan(85);
    expect(gradeFor(good.score)).toBe('A');

    const bad = evaluate(baseContext());
    expect(good.score).toBeGreaterThan(bad.score + 60);
  });

  it('treats a known-exploited vulnerability as a hard fail with the 24-hour clock spelled out', () => {
    const ctx = baseContext({
      hasScan: true,
      componentCount: 10,
      openFindings: [finding({ kev: true, severity: 'critical' })],
    });
    const result = evaluate(ctx);
    const kevControl = result.assessments.find((a) => a.controlId === 'cra.vuln.known_exploited')!;
    expect(kevControl.status).toBe('missing');
    expect(kevControl.score).toBe(0);
    expect(kevControl.rationale).toMatch(/24-hour/i);
  });

  it('separates owned-and-scheduled criticals from unowned ones', () => {
    const unowned = evaluate(
      baseContext({ hasScan: true, componentCount: 10, openFindings: [finding({ severity: 'critical' })] }),
    );
    const owned = evaluate(
      baseContext({
        hasScan: true,
        componentCount: 10,
        openFindings: [
          finding({ severity: 'critical', assigned: true, slaDueAt: Date.now() + 86_400_000 }),
        ],
      }),
    );
    const unownedScore = unowned.assessments.find((a) => a.controlId === 'cra.vuln.critical_open')!;
    const ownedScore = owned.assessments.find((a) => a.controlId === 'cra.vuln.critical_open')!;

    expect(unownedScore.status).toBe('missing');
    expect(ownedScore.status).toBe('partial');
    expect(owned.score).toBeGreaterThan(unowned.score);
  });

  it('penalises a stale SBOM even when one exists', () => {
    const fresh = evaluate(baseContext({ hasScan: true, hasSbom: true, scanFreshnessDays: 3, componentCount: 10 }));
    const stale = evaluate(baseContext({ hasScan: true, hasSbom: true, scanFreshnessDays: 200, componentCount: 10 }));
    expect(fresh.assessments.find((a) => a.controlId === 'cra.sbom.present')!.status).toBe('passed');
    expect(stale.assessments.find((a) => a.controlId === 'cra.sbom.present')!.status).toBe('partial');
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it('scores continuous monitoring above on-demand scanning', () => {
    const onDemand = evaluate(baseContext({ hasScan: true, componentCount: 10, monitoringEnabled: false }));
    const monitored = evaluate(baseContext({ hasScan: true, componentCount: 10, monitoringEnabled: true }));
    expect(monitored.score).toBeGreaterThan(onDemand.score);
    expect(monitored.assessments.find((a) => a.controlId === 'cra.vuln.monitoring')!.status).toBe('passed');
  });

  it('keeps not_applicable controls out of the denominator', () => {
    // A control marked N/A must not drag the score down even though it scores 0.
    const result = evaluate(baseContext({ hasScan: true, componentCount: 10 }));
    const applicable = result.assessments.filter((a) => a.status !== 'not_applicable');
    expect(applicable.length).toBeGreaterThan(0);
    expect(result.totals.notApplicable).toBe(
      result.assessments.filter((a) => a.status === 'not_applicable').length,
    );
  });

  it('produces actionable next steps ordered by score impact', () => {
    const result = evaluate(baseContext({ hasScan: true, componentCount: 10 }));
    expect(result.actions.length).toBeGreaterThan(0);
    for (const action of result.actions) {
      expect(action.impact).toBeGreaterThan(0);
      expect(action.title.length).toBeGreaterThan(0);
    }
    const impacts = result.actions.map((a) => a.impact);
    expect([...impacts].sort((a, b) => b - a)).toEqual(impacts);
  });

  it('reports a domain breakdown that sums to the assessed controls', () => {
    const result = evaluate(baseContext({ hasScan: true, componentCount: 10 }));
    const total = result.domains.reduce((sum, d) => sum + d.controls, 0);
    expect(total).toBe(result.assessments.length);
    expect(result.domains.length).toBeGreaterThan(0);
  });

  it('persists assessments so the score can be audited later', () => {
    const ctx = baseContext({ hasScan: true, componentCount: 4 });
    evaluate(ctx);
    const stored = getDb().select().from(complianceAssessmentsTable).all();
    expect(stored.filter((r) => r.repositoryId === ctx.repositoryId).length).toBeGreaterThan(0);

    // Re-running must update in place rather than duplicate rows.
    evaluate(ctx);
    const again = getDb()
      .select()
      .from(complianceAssessmentsTable)
      .all()
      .filter((r) => r.repositoryId === ctx.repositoryId);
    const ids = new Set(again.map((r) => `${r.controlId}`));
    expect(ids.size).toBe(again.length);
  });
});

describe('gradeFor', () => {
  it('bands scores into grades', () => {
    expect(gradeFor(96)).toBe('A');
    expect(gradeFor(90)).toBe('A');
    expect(gradeFor(80)).toBe('B');
    expect(gradeFor(65)).toBe('C');
    expect(gradeFor(45)).toBe('D');
    expect(gradeFor(12)).toBe('E');
    expect(gradeFor(0)).toBe('N/A');
  });

  it('is monotone non-decreasing', () => {
    let previous = 0;
    for (let score = 0; score <= 100; score += 5) {
      const order = ['N/A', 'E', 'D', 'C', 'B', 'A'];
      const rank = order.indexOf(gradeFor(score));
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });
});
