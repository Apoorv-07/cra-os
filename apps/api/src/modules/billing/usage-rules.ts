import { getDb } from '../../db/index.js';
import { usageRules } from '../../db/schema.js';
/**
 * Billable action catalogue.
 *
 * Costs are **data, not code**: seeded once at migration time and editable at
 * runtime from the admin console, so pricing changes never require a deploy
 * (product requirement §41).
 */

export type BillableAction =
  | 'scan.repository'
  | 'scan.deep'
  | 'sbom.generate'
  | 'vuln.refresh'
  | 'report.readiness'
  | 'report.findings'
  | 'report.evidence_pack'
  | 'incident.draft'
  | 'incident.report'
  | 'ai.explanation'
  | 'evidence.classify';

export const DEFAULT_USAGE_RULES: Array<{
  action: BillableAction;
  label: string;
  credits: number;
  description: string;
}> = [
  {
    action: 'scan.repository',
    label: 'Repository scan',
    credits: 10,
    description: 'Full dependency inventory + SBOM + advisory matching for one repository.',
  },
  {
    action: 'scan.deep',
    label: 'Deep vulnerability scan',
    credits: 25,
    description: 'Adds transitive graph analysis, EPSS enrichment and KEV correlation.',
  },
  {
    action: 'sbom.generate',
    label: 'SBOM generation',
    credits: 5,
    description: 'CycloneDX 1.6 export (JSON and XML) for an existing inventory.',
  },
  {
    action: 'vuln.refresh',
    label: 'Advisory refresh',
    credits: 2,
    description: 'Re-matches components against the latest advisory feeds.',
  },
  {
    action: 'report.readiness',
    label: 'CRA readiness report',
    credits: 100,
    description: 'Explainable readiness assessment with evidence pack export.',
  },
  {
    action: 'report.findings',
    label: 'Findings report',
    credits: 25,
    description: 'A prioritised vulnerability and compliance findings report for one repository or a whole organisation.',
  },
  {
    action: 'report.evidence_pack',
    label: 'Evidence pack',
    credits: 50,
    description: 'Downloadable, checksummed archive of all evidence for a repository.',
  },
  {
    action: 'incident.draft',
    label: 'Article 14 draft set',
    credits: 200,
    description: 'Generates the 24h, 72h and 14-day report drafts for one incident.',
  },
  {
    action: 'incident.report',
    label: 'Single Article 14 report',
    credits: 80,
    description: 'Generates one stage of the Article 14 reporting workflow.',
  },
  {
    action: 'ai.explanation',
    label: 'AI explanation',
    credits: 3,
    description: 'AI-written remediation or risk explanation grounded in scan data.',
  },
  {
    action: 'evidence.classify',
    label: 'Evidence classification',
    credits: 2,
    description: 'AI suggestion of which controls an uploaded artifact satisfies.',
  },
];

export function seedUsageRules(): void {
  const db = getDb();
  const existing = new Set(db.select().from(usageRules).all().map((r) => r.action));
  for (const rule of DEFAULT_USAGE_RULES) {
    if (existing.has(rule.action)) continue;
    db.insert(usageRules)
      .values({
        action: rule.action,
        label: rule.label,
        credits: rule.credits,
        description: rule.description,
        active: true,
        updatedAt: Date.now(),
      })
      .run();
  }
}

const FALLBACK: Record<string, number> = Object.fromEntries(
  DEFAULT_USAGE_RULES.map((r) => [r.action, r.credits]),
);

/** Runtime cost lookup with a hard fallback so billing never silently zeroes. */
export function creditsFor(action: string, quantity = 1): number {
  const row = getDb().select().from(usageRules).where(eqAction(action)).get();
  const unit = row?.credits ?? FALLBACK[action] ?? 1;
  return unit * Math.max(1, quantity);
}

// Small helper keeps the import surface tight.
import { eq } from 'drizzle-orm';
function eqAction(action: string) {
  return eq(usageRules.action, action);
}

export function listUsageRules() {
  return getDb().select().from(usageRules).all();
}

export function upsertUsageRule(input: {
  action: string;
  label: string;
  credits: number;
  description?: string | null;
  active?: boolean;
}) {
  const db = getDb();
  const existing = db.select().from(usageRules).where(eqAction(input.action)).get();
  if (existing) {
    db.update(usageRules)
      .set({
        label: input.label,
        credits: input.credits,
        description: input.description ?? null,
        active: input.active ?? true,
        updatedAt: Date.now(),
      })
      .where(eqAction(input.action))
      .run();
    return { id: input.action, updated: true };
  }
  db.insert(usageRules)
    .values({
      action: input.action,
      label: input.label,
      credits: input.credits,
      description: input.description ?? null,
      active: input.active ?? true,
      updatedAt: Date.now(),
    })
    .run();
  return { id: input.action, updated: false };
}
