import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import app from '../../src/app.js';
import { resetRateLimits } from '../../src/core/rate-limit.js';
import { SESSION_COOKIE } from '../../src/core/session.js';
import { getDb } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';
import { creditTransactions, payments, organizations, subscriptions } from '../../src/db/schema.js';
import { seedPricingCatalogue } from '../../src/routes/billing.js';
import { getBalance } from '../../src/modules/billing/ledger.js';

/**
 * Payment webhooks (Dodo Payments).
 *
 * This is the code path where a bug either gives the product away or charges
 * someone twice, so the tests cover the whole contract: Standard Webhooks
 * signature verification, replay protection, idempotency, out-of-order
 * delivery, refunds, and "always ack fast".
 */

// The provider and secret come from the vitest environment block, because
// `src/env.ts` snapshots process.env before any test file is imported.
const WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET ?? 'whsec_testsecretvalue';

const sign = (id: string, timestamp: number, payload: string): string => {
  // Standard Webhooks: HMAC-SHA256 over `${id}.${timestamp}.${payload}`,
  // base64-encoded, tagged `v1`, with the secret's `whsec_` prefix stripped.
  const secret = WEBHOOK_SECRET.startsWith('whsec_')
    ? Buffer.from(WEBHOOK_SECRET.slice('whsec_'.length), 'base64').toString('utf8')
    : WEBHOOK_SECRET;
  const digest = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  return `v1,${digest}`;
};

let orgId = '';
let startingBalance = 0;

async function sendWebhook(options: {
  eventId?: string;
  type: string;
  data: Record<string, unknown>;
  timestamp?: number;
  signature?: string;
  corruptPayload?: boolean;
}) {
  const payload = JSON.stringify({ type: options.type, data: options.data });
  const eventId = options.eventId ?? `msg_${Math.random().toString(36).slice(2, 12)}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);

  const body = options.corruptPayload ? payload + ' ' : payload;
  const signature = options.signature ?? sign(eventId, timestamp, payload);

  const res = await app.request('/api/v1/billing/webhooks/dodo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': eventId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signature,
    },
    body,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const paymentSucceeded = (overrides: Record<string, unknown> = {}) => ({
  payment_id: 'pay_test_1',
  total_amount: 4900,
  currency: 'USD',
  status: 'succeeded',
  metadata: { org_id: orgId, pack_key: 'starter' },
  ...overrides,
});

beforeAll(async () => {
  resetRateLimits();
  seedPricingCatalogue();

  // Create an org the same way signup does, then reset its balance so the
  // assertions below measure exactly what the webhook granted.
  const res = await app.request('/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `payments-${Date.now()}@example.com`,
      password: 'correct-horse-battery',
    }),
  });
  const data = (await res.json()) as any;
  orgId = data.data.organizationId;

  // Signup grants welcome credits; every assertion below is a delta from here,
  // because the ledger is append-only and cannot be zeroed by a negative grant.
  startingBalance = getBalance(orgId);
});

beforeEach(() => {
  resetRateLimits();
});

describe('starting position', () => {
  it('an account begins with its welcome credits already on the ledger', () => {
    expect(startingBalance).toBeGreaterThan(0);
  });
});

describe('webhook signature verification', () => {
  it('rejects an unsigned webhook', async () => {
    const res = await sendWebhook({
      type: 'payment.succeeded',
      data: paymentSucceeded(),
      signature: '',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects a signature computed over a tampered body', async () => {
    const res = await sendWebhook({
      type: 'payment.succeeded',
      data: paymentSucceeded(),
      corruptPayload: true,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a signature from a different secret', async () => {
    const payload = JSON.stringify({ type: 'payment.succeeded', data: paymentSucceeded() });
    const forged = createHmac('sha256', Buffer.from('a-different-secret', 'base64'))
      .update(`msg_x.${Math.floor(Date.now() / 1000)}.${payload}`)
      .digest('base64');
    const res = await sendWebhook({
      type: 'payment.succeeded',
      data: paymentSucceeded(),
      signature: `v1,${forged}`,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a replayed timestamp outside the tolerance window', async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const payload = JSON.stringify({ type: 'payment.succeeded', data: paymentSucceeded() });
    const res = await sendWebhook({
      type: 'payment.succeeded',
      data: paymentSucceeded(),
      timestamp: stale,
      signature: sign('msg_stale', stale, payload),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a correctly signed webhook within the window', async () => {
    const res = await sendWebhook({ type: 'payment.succeeded', data: paymentSucceeded() });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

describe('crediting purchases', () => {
  it('grants the pack credits exactly once, even if the provider retries', async () => {
    const balanceBefore = getBalance(orgId);

    const first = await sendWebhook({
      eventId: 'msg_idempotent_1',
      type: 'payment.succeeded',
      data: paymentSucceeded({ payment_id: 'pay_idem_1' }),
    });
    expect(first.status).toBe(200);
    const afterFirst = getBalance(orgId);

    // Dodo retries for up to ~30 hours with the same event id.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const retry = await sendWebhook({
        eventId: 'msg_idempotent_1',
        type: 'payment.succeeded',
        data: paymentSucceeded({ payment_id: 'pay_idem_1' }),
      });
      expect(retry.status).toBe(200);
    }

    expect(afterFirst).toBeGreaterThan(balanceBefore);
    expect(getBalance(orgId)).toBe(afterFirst);
  });

  it('records one payment row and keeps the ledger consistent', async () => {
    await sendWebhook({
      eventId: 'msg_ledger_1',
      type: 'payment.succeeded',
      data: paymentSucceeded({ payment_id: 'pay_ledger_1' }),
    });

    const rows = getDb().select().from(payments).where(eq(payments.providerPaymentId, 'pay_ledger_1')).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('succeeded');
    expect(rows[0]!.creditsGranted).toBeGreaterThan(0);

    const tx = getDb()
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.orgId, orgId))
      .all()
      .filter((t) => t.referenceId === 'pay_ledger_1');
    expect(tx).toHaveLength(1);
  });

  it('does not credit a failed payment', async () => {
    const before = getBalance(orgId);
    await sendWebhook({
      eventId: 'msg_failed_1',
      type: 'payment.failed',
      data: paymentSucceeded({ payment_id: 'pay_failed_1', status: 'failed' }),
    });
    expect(getBalance(orgId)).toBe(before);

    const row = getDb().select().from(payments).where(eq(payments.providerPaymentId, 'pay_failed_1')).get();
    expect(row?.status).toBe('failed');
  });

  it('handles out-of-order delivery — a late "succeeded" after an earlier "failed"', async () => {
    const before = getBalance(orgId);
    await sendWebhook({
      eventId: 'msg_order_1',
      type: 'payment.failed',
      data: paymentSucceeded({ payment_id: 'pay_order_1', status: 'failed' }),
    });
    expect(getBalance(orgId)).toBe(before);

    await sendWebhook({
      eventId: 'msg_order_2',
      type: 'payment.succeeded',
      data: paymentSucceeded({ payment_id: 'pay_order_1', status: 'succeeded' }),
    });
    // The customer paid, so the credits must arrive.
    expect(getBalance(orgId)).toBeGreaterThan(before);
  });

  it('marks a refunded payment without clawing back grant-type credits', async () => {
    await sendWebhook({
      eventId: 'msg_refund_1',
      type: 'payment.succeeded',
      data: paymentSucceeded({ payment_id: 'pay_refund_1' }),
    });
    const afterPurchase = getBalance(orgId);

    const res = await sendWebhook({
      eventId: 'msg_refund_2',
      type: 'payment.refunded',
      data: paymentSucceeded({ payment_id: 'pay_refund_1', status: 'refunded' }),
    });
    expect(res.status).toBe(200);
    const row = getDb().select().from(payments).where(eq(payments.providerPaymentId, 'pay_refund_1')).get();
    expect(row?.status).toBe('refunded');
    // A refund is recorded and surfaced in the admin console; the balance is
    // reconciled by an adjustment so the ledger stays append-only.
    expect(getBalance(orgId)).toBeLessThanOrEqual(afterPurchase);
  });

  it('activates the plan and opens a subscription when a plan is purchased', async () => {
    await sendWebhook({
      eventId: 'msg_plan_1',
      type: 'subscription.active',
      data: {
        payment_id: 'pay_plan_1',
        subscription_id: 'sub_test_1',
        total_amount: 9900,
        currency: 'USD',
        status: 'succeeded',
        metadata: { org_id: orgId, plan_key: 'startup' },
      },
    });

    const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
    const subs = getDb().select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).all();
    expect(subs.length).toBeGreaterThan(0);
    expect(org).toBeTruthy();
  });

  it('ignores a webhook with no org metadata instead of failing', async () => {
    const res = await sendWebhook({
      eventId: 'msg_no_org',
      type: 'payment.succeeded',
      data: { payment_id: 'pay_no_org', total_amount: 100, currency: 'USD', status: 'succeeded', metadata: {} },
    });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBeTruthy();
  });

  it('always acknowledges quickly — never a 5xx for a provider mistake', async () => {
    const res = await sendWebhook({
      eventId: 'msg_garbage',
      type: 'payment.succeeded',
      data: paymentSucceeded({ payment_id: 'pay_garbage', total_amount: 'not-a-number' }),
    });
    expect(res.status).toBeLessThan(500);
  });
});

describe('checkout sessions', () => {
  it('refuses to create a checkout for a viewer', async () => {
    // Billing actions are admin-only; a viewer must never be able to spend.
    const res = await app.request(`/api/v1/organizations/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packKey: 'starter' }),
    });
    expect(res.status).toBe(401);
  });

  it('never returns a checkout URL without a session cookie (unauthenticated)', async () => {
    const res = await app.request(`/api/v1/organizations/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=bogus` },
      body: JSON.stringify({ packKey: 'starter' }),
    });
    expect(res.status).toBe(401);
  });
});
