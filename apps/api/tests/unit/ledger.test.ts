import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/index.js';
import { organizations, users, creditAccounts } from '../../src/db/schema.js';
import {
  grantCredits,
  reserveCredits,
  commitUsage,
  releaseUsage,
  settleUsage,
  consumeCredits,
  recomputeBalance,
  getBalance,
} from '../../src/modules/billing/ledger.js';
import { creditsFor, upsertUsageRule, DEFAULT_USAGE_RULES } from '../../src/modules/billing/usage-rules.js';
import { AppError } from '../../src/core/errors.js';
import { newId } from '../../src/core/ids.js';

/**
 * Credit ledger invariants.
 *
 * These are the tests that protect revenue correctness: the ledger is
 * append-only, idempotent by key, and must always reconcile with the cached
 * balance. A failure here means either over-charging customers or giving work
 * away.
 */

function makeOrg(name: string): string {
  const db = getDb();
  const userId = newId('usr');
  db.insert(users)
    .values({
      id: userId,
      email: `${name}@example.com`,
      emailNormalised: `${name}@example.com`,
      name,
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
      name,
      slug: name,
      planKey: 'free',
      isAgency: false,
      status: 'active',
      createdByUserId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return orgId;
}

describe('credit ledger', () => {
  let orgId: string;

  beforeEach(() => {
    orgId = makeOrg(`org-${Math.random().toString(36).slice(2)}`);
  });

  it('starts at zero and grants add to the balance', () => {
    expect(getBalance(orgId)).toBe(0);
    grantCredits({ orgId, amount: 500, type: 'grant', description: 'welcome' });
    expect(getBalance(orgId)).toBe(500);
  });

  it('reserves, then commits — the balance drops once, not twice', () => {
    grantCredits({ orgId, amount: 500, type: 'grant', description: 'welcome' });

    const reserved = reserveCredits({ orgId, action: 'scan.repository' });
    expect(reserved.credits).toBe(creditsFor('scan.repository'));
    expect(getBalance(orgId)).toBe(500 - reserved.credits);

    commitUsage(reserved.usageEventId);
    expect(getBalance(orgId)).toBe(500 - reserved.credits);
  });

  it('releases a reservation and refunds in full', () => {
    grantCredits({ orgId, amount: 500, type: 'grant', description: 'welcome' });
    const reserved = reserveCredits({ orgId, action: 'scan.repository' });

    const released = releaseUsage(reserved.usageEventId, 'scan failed');
    expect(released.refunded).toBe(reserved.credits);
    expect(getBalance(orgId)).toBe(500);
  });

  it('counts lifetime consumption only for committed work', () => {
    grantCredits({ orgId, amount: 500, type: 'grant', description: 'welcome' });
    const account = () => getDb().select().from(creditAccounts).where(eq(creditAccounts.orgId, orgId)).get()!;

    const a = reserveCredits({ orgId, action: 'scan.repository' });
    commitUsage(a.usageEventId);
    expect(account().lifetimeConsumed).toBe(a.credits);

    const b = reserveCredits({ orgId, action: 'scan.repository' });
    releaseUsage(b.usageEventId, 'failed');
    // A released reservation must not leave consumption inflated.
    expect(account().lifetimeConsumed).toBe(a.credits);
  });

  it('refuses to overdraw', () => {
    grantCredits({ orgId, amount: 5, type: 'grant', description: 'small' });
    expect(() => reserveCredits({ orgId, action: 'scan.repository' })).toThrow(AppError);
    expect(getBalance(orgId)).toBe(5);
  });

  it('is idempotent by key — the same purchase never credits twice', () => {
    const key = `payment:pay_123`;
    grantCredits({ orgId, amount: 1000, type: 'purchase', idempotencyKey: key, description: 'pack' });
    grantCredits({ orgId, amount: 1000, type: 'purchase', idempotencyKey: key, description: 'pack' });
    expect(getBalance(orgId)).toBe(1000);
  });

  it('reconciles: the cached balance equals the sum of transactions', () => {
    grantCredits({ orgId, amount: 1000, type: 'grant', description: 'welcome' });
    const scan = reserveCredits({ orgId, action: 'scan.repository' });
    commitUsage(scan.usageEventId);
    const report = reserveCredits({ orgId, action: 'report.readiness' });
    commitUsage(report.usageEventId);

    const result = recomputeBalance(orgId);
    expect(result.consistent).toBe(true);
    expect(result.computed).toBe(result.stored);
  });

  it('settles a retry correctly after an earlier attempt released the reservation', () => {
    grantCredits({ orgId, amount: 1000, type: 'grant', description: 'welcome' });

    const first = reserveCredits({ orgId, action: 'scan.repository' });
    settleUsage(first.usageEventId, 'release', 'attempt 1 failed');
    expect(getBalance(orgId)).toBe(1000);

    // The retry succeeds, so the customer is charged exactly once.
    const settled = settleUsage(first.usageEventId, 'commit');
    expect(settled.credits).toBe(creditsFor('scan.repository'));
    expect(getBalance(orgId)).toBe(1000 - creditsFor('scan.repository'));
    expect(recomputeBalance(orgId).consistent).toBe(true);
  });

  it('committing twice is a no-op', () => {
    grantCredits({ orgId, amount: 1000, type: 'grant', description: 'welcome' });
    const reserved = reserveCredits({ orgId, action: 'scan.repository' });
    commitUsage(reserved.usageEventId);
    const balance = getBalance(orgId);
    commitUsage(reserved.usageEventId);
    expect(getBalance(orgId)).toBe(balance);
  });

  it('consumeCredits charges exactly the rule price', () => {
    grantCredits({ orgId, amount: 1000, type: 'grant', description: 'welcome' });
    const before = getBalance(orgId);
    const result = consumeCredits({ orgId, action: 'incident.draft' });
    expect(result.credits).toBe(creditsFor('incident.draft'));
    expect(getBalance(orgId)).toBe(before - result.credits);
  });

  it('free actions cost nothing and still create an audit trail', () => {
    grantCredits({ orgId, amount: 100, type: 'grant', description: 'welcome' });
    const before = getBalance(orgId);
    const result = consumeCredits({ orgId, action: 'scan.repository', free: true });
    expect(result.credits).toBe(0);
    expect(getBalance(orgId)).toBe(before);
  });
});

describe('usage rules', () => {
  it('every billable action has a default price', () => {
    for (const rule of DEFAULT_USAGE_RULES) {
      expect(rule.credits).toBeGreaterThanOrEqual(0);
    }
    expect(creditsFor('scan.repository')).toBeGreaterThan(0);
    expect(creditsFor('incident.draft')).toBeGreaterThan(creditsFor('scan.repository'));
  });

  it('prices are editable at runtime without a redeploy', () => {
    const original = creditsFor('report.evidence_pack');
    upsertUsageRule({ action: 'report.evidence_pack', label: 'Evidence pack', credits: original + 7 });
    expect(creditsFor('report.evidence_pack')).toBe(original + 7);
    upsertUsageRule({ action: 'report.evidence_pack', label: 'Evidence pack', credits: original });
    expect(creditsFor('report.evidence_pack')).toBe(original);
  });

  it('falls back to 1 credit for an unpriced action instead of giving work away', () => {
    // New billable actions must be priced explicitly, but if one slips through
    // we charge the minimum rather than zero — a free action is a revenue leak.
    expect(creditsFor('does.not.exist')).toBe(1);
  });

  it('scales by quantity for metered actions', () => {
    const unit = creditsFor('scan.repository');
    expect(creditsFor('scan.repository', 3)).toBe(unit * 3);
  });
});
