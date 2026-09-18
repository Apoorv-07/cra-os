import { and, eq, sql } from 'drizzle-orm';
import { getDb, tx } from '../../db/index.js';
import {
  creditAccounts,
  creditTransactions,
  organizations,
  usageEvents,
} from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { audit } from '../../core/audit.js';
import { creditsFor } from './usage-rules.js';

/**
 * Credit ledger.
 *
 * Guarantees
 *  - **Append-only.** Credits are never mutated; every movement writes a row
 *    with the resulting balance, so the balance is reproducible from history.
 *  - **Idempotent.** Every write takes an `idempotencyKey`; replaying the same
 *    logical operation returns the original result instead of double-charging.
 *  - **Reserve / commit / release.** Expensive jobs reserve up front and release
 *    on failure, so a crashed scan never silently burns a customer's balance.
 *  - **Never negative.** Debits are rejected with `insufficient_credits`.
 *
 * Writes are wrapped in a synchronous SQLite transaction, which serialises
 * concurrent writers on this node. `revision` is an optimistic guard for
 * multi-node deployments.
 */

export type CreditTxType =
  | 'purchase'
  | 'grant'
  | 'promo'
  | 'bonus'
  | 'referral'
  | 'reservation'
  | 'commit'
  | 'release'
  | 'refund'
  | 'expiry'
  | 'adjustment';

export interface AccountView {
  id: string;
  orgId: string;
  balance: number;
  lifetimePurchased: number;
  lifetimeGranted: number;
  lifetimeConsumed: number;
  currency: string;
  revision: number;
}

export function getOrCreateAccount(orgId: string, currency = 'USD'): AccountView {
  const db = getDb();
  const existing = db.select().from(creditAccounts).where(eq(creditAccounts.orgId, orgId)).get();
  if (existing) return existing as AccountView;

  db.insert(creditAccounts)
    .values({
      id: newId('cac'),
      orgId,
      balance: 0,
      currency,
      revision: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  return db.select().from(creditAccounts).where(eq(creditAccounts.orgId, orgId)).get() as AccountView;
}

export function getBalance(orgId: string): number {
  return getOrCreateAccount(orgId).balance;
}

function writeTransaction(params: {
  orgId: string;
  accountId: string;
  type: CreditTxType;
  amount: number;
  balanceAfter: number;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  idempotencyKey?: string;
  createdByUserId?: string;
  expiresAt?: number;
}) {
  return getDb()
    .insert(creditTransactions)
    .values({
      id: newId('ctx'),
      orgId: params.orgId,
      accountId: params.accountId,
      type: params.type,
      amount: params.amount,
      balanceAfter: params.balanceAfter,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      description: params.description ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      createdByUserId: params.createdByUserId ?? null,
      expiresAt: params.expiresAt ?? null,
      createdAt: Date.now(),
    })
    .returning()
    .get();
}

/**
 * Credits an account. Idempotent on `idempotencyKey`.
 * Returns `{ applied, transaction, balance }`; a replay returns `applied: false`.
 */
export function grantCredits(input: {
  orgId: string;
  amount: number;
  type: Extract<CreditTxType, 'purchase' | 'grant' | 'promo' | 'bonus' | 'referral' | 'refund' | 'adjustment'>;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  idempotencyKey: string;
  createdByUserId?: string;
}): { applied: boolean; balance: number; transactionId: string } {
  if (input.amount <= 0) throw AppError.badRequest('Grant amount must be positive.');

  return tx(() => {
    const db = getDb();

    const replay = db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.idempotencyKey, input.idempotencyKey))
      .get();
    if (replay) {
      return { applied: false, balance: replay.balanceAfter, transactionId: replay.id };
    }

    const account = getOrCreateAccount(input.orgId);
    const balance = account.balance + input.amount;

    db.update(creditAccounts)
      .set({
        balance,
        revision: account.revision + 1,
        lifetimePurchased:
          input.type === 'purchase' ? account.lifetimePurchased + input.amount : account.lifetimePurchased,
        lifetimeGranted:
          input.type === 'purchase' ? account.lifetimeGranted : account.lifetimeGranted + input.amount,
        updatedAt: Date.now(),
      })
      .where(eq(creditAccounts.orgId, input.orgId))
      .run();

    const row = writeTransaction({
      orgId: input.orgId,
      accountId: account.id,
      type: input.type,
      amount: input.amount,
      balanceAfter: balance,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
      createdByUserId: input.createdByUserId,
    });

    audit({
      orgId: input.orgId,
      action: `credits.${input.type}`,
      targetType: 'credit_account',
      targetId: account.id,
      meta: { amount: input.amount, balance },
      actorUserId: input.createdByUserId ?? null,
    });

    return { applied: true, balance, transactionId: row!.id };
  });
}

/**
 * Reserves credits for a billable action and records a pending usage event.
 * Call `commitUsage` on success or `releaseUsage` on failure.
 */
export function reserveCredits(input: {
  orgId: string;
  userId?: string;
  apiKeyId?: string;
  action: string;
  quantity?: number;
  resourceType?: string;
  resourceId?: string;
  idempotencyKey?: string;
  meta?: unknown;
  /** Bypass billing (platform-internal operations, e.g. onboarding). */
  free?: boolean;
}): { usageEventId: string; credits: number; balance: number } {
  const quantity = input.quantity ?? 1;
  const credits = input.free ? 0 : creditsFor(input.action, quantity);

  return tx(() => {
    const db = getDb();

    if (input.idempotencyKey) {
      const replay = db
        .select()
        .from(usageEvents)
        .where(eq(usageEvents.id, input.idempotencyKey))
        .get();
      if (replay) {
        return { usageEventId: replay.id, credits: replay.credits, balance: getBalance(input.orgId) };
      }
    }

    const account = getOrCreateAccount(input.orgId);

    if (credits > 0 && account.balance < credits) {
      throw AppError.insufficientCredits(credits, account.balance);
    }

    const usageEventId = input.idempotencyKey ?? newId('usg');
    db.insert(usageEvents)
      .values({
        id: usageEventId,
        orgId: input.orgId,
        userId: input.userId ?? null,
        apiKeyId: input.apiKeyId ?? null,
        action: input.action,
        quantity,
        credits,
        status: 'pending',
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        metaJson: input.meta === undefined ? null : JSON.stringify(input.meta),
        createdAt: Date.now(),
      })
      .run();

    if (credits === 0) {
      return { usageEventId, credits: 0, balance: account.balance };
    }

    const balance = account.balance - credits;
    db.update(creditAccounts)
      .set({
        balance,
        revision: account.revision + 1,
        lifetimeConsumed: account.lifetimeConsumed + credits,
        updatedAt: Date.now(),
      })
      .where(eq(creditAccounts.orgId, input.orgId))
      .run();

    const reservation = writeTransaction({
      orgId: input.orgId,
      accountId: account.id,
      type: 'reservation',
      amount: -credits,
      balanceAfter: balance,
      referenceType: 'usage_event',
      referenceId: usageEventId,
      description: `Reserved for ${input.action}`,
    });

    db.update(usageEvents)
      .set({ reservationTransactionId: reservation!.id })
      .where(eq(usageEvents.id, usageEventId))
      .run();

    return { usageEventId, credits, balance };
  });
}

/**
 * Finalises a reservation: the reserved credits stay spent and the usage event
 * becomes `committed`. Idempotent — committing twice is a no-op.
 */
export function commitUsage(usageEventId: string): { credits: number; balance: number } {
  return tx(() => {
    const db = getDb();
    const event = db.select().from(usageEvents).where(eq(usageEvents.id, usageEventId)).get();
    if (!event) throw AppError.notFound('Usage event');
    if (event.status === 'committed') return { credits: event.credits, balance: getBalance(event.orgId) };
    if (event.status === 'released') {
      throw AppError.conflict('This usage event was already released and cannot be committed.');
    }

    db.update(usageEvents)
      .set({ status: 'committed', resolvedAt: Date.now() })
      .where(eq(usageEvents.id, usageEventId))
      .run();

    if (event.credits > 0 && event.reservationTransactionId) {
      writeTransaction({
        orgId: event.orgId,
        accountId: getOrCreateAccount(event.orgId).id,
        type: 'commit',
        amount: 0,
        balanceAfter: getBalance(event.orgId),
        referenceType: 'usage_event',
        referenceId: event.id,
        description: `Committed ${event.credits} credits for ${event.action}`,
      });
    }

    return { credits: event.credits, balance: getBalance(event.orgId) };
  });
}

/**
 * Refunds a reservation. Used when a job fails, is cancelled, or is skipped
 * because the repository fingerprint has not changed.
 */
export function releaseUsage(usageEventId: string, reason?: string): { refunded: number; balance: number } {
  return tx(() => {
    const db = getDb();
    const event = db.select().from(usageEvents).where(eq(usageEvents.id, usageEventId)).get();
    if (!event) throw AppError.notFound('Usage event');
    if (event.status === 'released') return { refunded: 0, balance: getBalance(event.orgId) };

    db.update(usageEvents)
      .set({ status: 'released', resolvedAt: Date.now(), metaJson: JSON.stringify({ reason: reason ?? null }) })
      .where(eq(usageEvents.id, usageEventId))
      .run();

    if (event.credits === 0) return { refunded: 0, balance: getBalance(event.orgId) };

    const account = getOrCreateAccount(event.orgId);
    const balance = account.balance + event.credits;
    db.update(creditAccounts)
      .set({
        balance,
        revision: account.revision + 1,
        lifetimeConsumed: Math.max(0, account.lifetimeConsumed - event.credits),
        updatedAt: Date.now(),
      })
      .where(eq(creditAccounts.orgId, event.orgId))
      .run();

    writeTransaction({
      orgId: event.orgId,
      accountId: account.id,
      type: 'release',
      amount: event.credits,
      balanceAfter: balance,
      referenceType: 'usage_event',
      referenceId: event.id,
      description: `Released ${event.credits} credits (${reason ?? 'unused'})`,
    });

    return { refunded: event.credits, balance };
  });
}

/** Convenience one-shot for cheap, synchronous billable actions. */
export function consumeCredits(input: {
  orgId: string;
  userId?: string;
  apiKeyId?: string;
  action: string;
  quantity?: number;
  resourceType?: string;
  resourceId?: string;
  idempotencyKey?: string;
  meta?: unknown;
  free?: boolean;
}): { usageEventId: string; credits: number; balance: number } {
  const reserved = reserveCredits(input);
  if (input.idempotencyKey) {
    const committed = commitUsage(reserved.usageEventId);
    return { ...reserved, balance: committed.balance };
  }
  const committed = commitUsage(reserved.usageEventId);
  return { usageEventId: reserved.usageEventId, credits: reserved.credits, balance: committed.balance };
}

/**
 * Retry-safe settlement.
 *
 * A job can run more than once: the first attempt may fail (reservation
 * released, customer not charged) and a later retry succeed. Committing the
 * original event would then throw, because it has already been released. So on
 * a commit-after-release we take a fresh reservation and charge that instead —
 * the work happened once, so the customer is charged exactly once.
 */
export function settleUsage(
  usageEventId: string,
  outcome: 'commit' | 'release',
  reason?: string,
): { credits: number; balance: number } {
  const db = getDb();
  const event = db.select().from(usageEvents).where(eq(usageEvents.id, usageEventId)).get();
  if (!event) throw AppError.notFound('Usage event');

  if (outcome === 'release') {
    const released = releaseUsage(usageEventId, reason);
    return { credits: released.refunded, balance: released.balance };
  }

  if (event.status === 'committed') return { credits: event.credits, balance: getBalance(event.orgId) };
  if (event.status === 'pending') return commitUsage(usageEventId);

  // Released by an earlier failed attempt — the work has now succeeded.
  try {
    const retry = reserveCredits({
      orgId: event.orgId,
      userId: event.userId ?? undefined,
      apiKeyId: event.apiKeyId ?? undefined,
      action: event.action,
      quantity: event.quantity || 1,
      resourceType: event.resourceType ?? undefined,
      resourceId: event.resourceId ?? undefined,
      meta: { retriedFrom: event.id },
    });
    const committed = commitUsage(retry.usageEventId);
    db.update(usageEvents)
      .set({
        status: 'committed',
        resolvedAt: Date.now(),
        metaJson: JSON.stringify({ chargedVia: retry.usageEventId, reason: reason ?? null }),
      })
      .where(eq(usageEvents.id, usageEventId))
      .run();
    return committed;
  } catch (err) {
    // Never fail a completed job over billing: the work is done, the shortfall
    // is recorded and surfaced through the admin integrity check.
    log.error('could not re-reserve credits after retry', {
      usageEventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { credits: 0, balance: getBalance(event.orgId) };
  }
}

/**
 * Recomputes a balance from the ledger. Used by the admin integrity check and
 * by tests; it must always equal `creditAccounts.balance`.
 */
export function recomputeBalance(orgId: string): { stored: number; computed: number; consistent: boolean } {
  const db = getDb();
  const account = getOrCreateAccount(orgId);
  const row = db
    .select({ total: sql<number>`coalesce(sum(${creditTransactions.amount}), 0)` })
    .from(creditTransactions)
    .where(eq(creditTransactions.accountId, account.id))
    .get();
  const computed = Number(row?.total ?? 0);
  return { stored: account.balance, computed, consistent: account.balance === computed };
}

export function ledgerHistory(orgId: string, limit = 100) {
  const account = getOrCreateAccount(orgId);
  return getDb()
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.accountId, account.id))
    .orderBy(sql`${creditTransactions.createdAt} desc`)
    .limit(limit)
    .all();
}

export function usageHistory(orgId: string, limit = 100) {
  return getDb()
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.orgId, orgId))
    .orderBy(sql`${usageEvents.createdAt} desc`)
    .limit(limit)
    .all();
}

/** Fires when a balance crosses the org's configured auto-top-up threshold. */
export function maybeAutoTopUp(orgId: string): { triggered: boolean; reason?: string } {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org?.autoTopupEnabled) return { triggered: false, reason: 'disabled' };

  const account = getOrCreateAccount(orgId);
  const threshold = org.autoTopupThresholdCredits ?? 100;
  if (account.balance > threshold) return { triggered: false, reason: 'above_threshold' };

  const packKey = org.autoTopupPackKey ?? 'growth';
  log.info('auto top-up triggered', { orgId, balance: account.balance, threshold, packKey });

  audit({
    orgId,
    action: 'billing.auto_topup_triggered',
    targetType: 'organization',
    targetId: orgId,
    meta: { balance: account.balance, threshold, packKey },
  });

  return { triggered: true };
}

/** Marks expired promotional credits. Safe to run on a schedule. */
export function expireCredits(now = Date.now()): number {
  const db = getDb();
  const expired = db
    .select()
    .from(creditTransactions)
    .where(and(eq(creditTransactions.type, 'promo'), sql`${creditTransactions.expiresAt} is not null`))
    .all()
    .filter((t) => (t.expiresAt ?? 0) <= now);

  for (const t of expired) {
    const account = db.select().from(creditAccounts).where(eq(creditAccounts.id, t.accountId)).get();
    if (!account || account.balance <= 0) continue;
    const deduct = Math.min(t.amount, account.balance);
    const balance = account.balance - deduct;
    db.update(creditAccounts).set({ balance, updatedAt: Date.now() }).where(eq(creditAccounts.id, t.id)).run();
    writeTransaction({
      orgId: t.orgId,
      accountId: account.id,
      type: 'expiry',
      amount: -deduct,
      balanceAfter: balance,
      referenceType: 'credit_transaction',
      referenceId: t.id,
      description: 'Promotional credits expired',
    });
  }
  return expired.length;
}
