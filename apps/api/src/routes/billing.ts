import { Hono } from 'hono';
import type { AppEnv } from '../core/context.js';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {coupons, creditPacks, organizations, payments, plans, subscriptions} from '../db/schema.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { log } from '../core/logger.js';
import { audit } from '../core/audit.js';
import { ok, created, parseBody, errorResponse, PaginationSchema, paginate } from '../core/http.js';
import { requireAuth, requireOrg } from '../core/auth.js';
import { env } from '../env.js';
import {getOrCreateAccount, grantCredits, ledgerHistory, usageHistory, maybeAutoTopUp, recomputeBalance} from '../modules/billing/ledger.js';
import { paymentProvider, normaliseDodoPayment, listProviders } from '../modules/billing/providers/index.js';
import { listUsageRules, seedUsageRules } from '../modules/billing/usage-rules.js';
import type { AppContext } from '../core/context.js';

export const billingRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export function seedPricingCatalogue(): void {
  const db = getDb();
  seedUsageRules();

  const packs = [
    { key: 'starter', name: 'Starter', credits: 1000, priceCents: 2900, bonusCredits: 0, popular: false, sortOrder: 10 },
    { key: 'growth', name: 'Growth', credits: 5000, priceCents: 9900, bonusCredits: 500, popular: true, sortOrder: 20 },
    { key: 'business', name: 'Business', credits: 20000, priceCents: 29900, bonusCredits: 3000, popular: false, sortOrder: 30 },
    { key: 'scale', name: 'Scale', credits: 60000, priceCents: 79900, bonusCredits: 12000, popular: false, sortOrder: 40 },
  ];

  for (const currency of ['USD', 'EUR', 'GBP']) {
    for (const pack of packs) {
      const existing = db
        .select()
        .from(creditPacks)
        .where(and(eq(creditPacks.key, pack.key), eq(creditPacks.currency, currency)))
        .get();
      if (existing) continue;
      db.insert(creditPacks)
        .values({ id: newId('pk'), ...pack, currency, active: true })
        .run();
    }
  }

  const planCatalogue = [
    { key: 'free', name: 'Free', priceCents: 0, creditsIncluded: 250, repoLimit: 1, seatLimit: 3, sortOrder: 10, description: 'One repository, monitoring and a first readiness assessment.', features: ['1 repository', '250 credits on signup', 'CycloneDX SBOM', 'Manual scans'] },
    { key: 'developer', name: 'Developer', priceCents: 4900, creditsIncluded: 500, repoLimit: 3, seatLimit: 3, sortOrder: 20, description: 'For a solo builder shipping one product into the EU.', features: ['3 repositories', '500 credits / month', 'Scheduled monitoring', 'Article 14 drafts', 'Email support'] },
    { key: 'startup', name: 'Startup', priceCents: 19900, creditsIncluded: 2500, repoLimit: 10, seatLimit: 10, sortOrder: 30, description: 'Continuous monitoring across a product suite.', features: ['10 repositories', '2,500 credits / month', 'Continuous monitoring', 'Evidence vault', 'API access'] },
    { key: 'growth', name: 'Growth', priceCents: 79900, creditsIncluded: 12000, repoLimit: 40, seatLimit: 25, sortOrder: 40, description: 'Organisation-wide CRA readiness with approvals.', features: ['40 repositories', '12,000 credits / month', 'Approval workflows', 'Shareable reports', 'Priority support'] },
    { key: 'enterprise', name: 'Enterprise', priceCents: 199900, creditsIncluded: 40000, repoLimit: 1000, seatLimit: 200, sortOrder: 50, description: 'SSO, advanced RBAC, custom retention and procurement support.', features: ['Unlimited repositories', '40,000 credits / month', 'SSO & advanced RBAC', 'Custom retention', 'Dedicated support'] },
  ];

  for (const currency of ['USD', 'EUR', 'GBP']) {
    for (const plan of planCatalogue) {
      const existing = db.select().from(plans).where(and(eq(plans.key, plan.key), eq(plans.currency, currency))).get();
      if (existing) {
        // Catalogue *content* is owned by code; price is owned by the admin
        // console. Re-seeding refreshes the copy without ever touching a price
        // an operator has set.
        db.update(plans)
          .set({
            name: plan.name,
            description: plan.description,
            creditsIncluded: plan.creditsIncluded,
            repoLimit: plan.repoLimit,
            seatLimit: plan.seatLimit,
            featuresJson: JSON.stringify(plan.features),
            sortOrder: plan.sortOrder,
          })
          .where(eq(plans.id, existing.id))
          .run();
        continue;
      }
      db.insert(plans)
        .values({
          id: newId('pln'),
          key: plan.key,
          name: plan.name,
          description: plan.description,
          interval: 'month',
          priceCents: plan.priceCents,
          currency,
          creditsIncluded: plan.creditsIncluded,
          repoLimit: plan.repoLimit,
          seatLimit: plan.seatLimit,
          featuresJson: JSON.stringify(plan.features),
          active: true,
          sortOrder: plan.sortOrder,
        })
        .run();
    }
  }
}

billingRoutes.get('/pricing', async (c) => {
  const db = getDb();
  const currency = (c.req.query('currency') ?? 'USD').toUpperCase();

  const packs = db.select().from(creditPacks).where(and(eq(creditPacks.currency, currency), eq(creditPacks.active, true))).all();
  const planRows = db.select().from(plans).where(and(eq(plans.currency, currency), eq(plans.active, true))).all();
  const rules = listUsageRules();

  return ok(c, {
    currency,
    packs: packs.sort((a, b) => a.sortOrder - b.sortOrder),
    plans: planRows.sort((a, b) => a.sortOrder - b.sortOrder),
    usageRules: rules,
    providers: listProviders(),
    paymentsEnabled: env.PAYMENT_PROVIDER === 'dodo' && Boolean(env.DODO_API_KEY),
  });
});

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

billingRoutes.get('/:orgId/billing', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  const account = getOrCreateAccount(orgId, org?.currency ?? 'USD');

  return ok(c, {
    balance: account.balance,
    lifetimePurchased: account.lifetimePurchased,
    lifetimeGranted: account.lifetimeGranted,
    lifetimeConsumed: account.lifetimeConsumed,
    currency: account.currency,
    autoTopup: {
      enabled: Boolean(org?.autoTopupEnabled),
      thresholdCredits: org?.autoTopupThresholdCredits ?? 100,
      packKey: org?.autoTopupPackKey ?? null,
    },
    planKey: org?.planKey ?? 'free',
    paymentsEnabled: env.PAYMENT_PROVIDER === 'dodo' && Boolean(env.DODO_API_KEY),
  });
});

billingRoutes.get('/:orgId/billing/ledger', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const { page, perPage } = PaginationSchema.parse({ page: c.req.query('page') ?? 1, perPage: c.req.query('perPage') ?? 50 });
  const all = ledgerHistory(orgId, 1000);
  return ok(c, all.slice((page - 1) * perPage, page * perPage), paginate(all.length, page, perPage));
});

billingRoutes.get('/:orgId/billing/usage', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const rows = usageHistory(orgId, 200);

  const byAction = rows.reduce<Record<string, { count: number; credits: number }>>((acc, row) => {
    const entry = acc[row.action] ?? { count: 0, credits: 0 };
    entry.count += row.quantity;
    entry.credits += row.credits;
    acc[row.action] = entry;
    return acc;
  }, {});

  return ok(c, { events: rows, byAction });
});

billingRoutes.get('/:orgId/billing/payments', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const rows = getDb().select().from(payments).where(eq(payments.orgId, orgId)).orderBy(desc(payments.createdAt)).limit(100).all();
  return ok(c, rows);
});

const CheckoutSchema = z.object({
  packKey: z.string().optional(),
  planKey: z.string().optional(),
  currency: z.enum(['USD', 'EUR', 'GBP']).default('USD'),
  returnUrl: z.string().url().optional(),
  couponCode: z.string().max(40).optional(),
});

billingRoutes.post('/:orgId/billing/checkout', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const body = await parseBody(c, CheckoutSchema);
  const db = getDb();
  const auth = c.get('auth')!;

  if (!body.packKey && !body.planKey) throw AppError.badRequest('Choose a credit pack or a plan.');

  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  const pack = body.packKey
    ? db.select().from(creditPacks).where(and(eq(creditPacks.key, body.packKey), eq(creditPacks.currency, body.currency))).get()
    : null;
  const plan = body.planKey
    ? db.select().from(plans).where(and(eq(plans.key, body.planKey), eq(plans.currency, body.currency))).get()
    : null;

  if (body.packKey && !pack) throw AppError.notFound('Credit pack');
  if (body.planKey && !plan) throw AppError.notFound('Plan');

  let discountPct = 0;
  let bonusCredits = 0;
  if (body.couponCode) {
    const coupon = db.select().from(coupons).where(eq(coupons.code, body.couponCode.toUpperCase())).get();
    if (coupon && coupon.active && (!coupon.expiresAt || coupon.expiresAt > Date.now())) {
      discountPct = coupon.percentOff;
      bonusCredits = coupon.bonusCredits;
    }
  }

  const provider = paymentProvider();
  const returnUrl = body.returnUrl ?? `${env.WEB_URL}/app/billing?checkout=success`;

  const session = await provider.createCheckout({
    orgId,
    orgName: org?.name ?? 'Organisation',
    customerEmail: org?.billingEmail ?? auth.user.email,
    customerName: org?.companyLegalName ?? org?.name ?? null,
    pack: pack ?? undefined,
    plan: plan ?? undefined,
    currency: body.currency,
    returnUrl,
    metadata: {
      user_id: auth.user.id,
      ...(body.couponCode ? { coupon: body.couponCode } : {}),
    },
  });

  db.insert(payments)
    .values({
      id: newId('pay'),
      orgId,
      provider: provider.name,
      providerCheckoutId: session.checkoutId,
      providerPaymentId: session.paymentId ?? null,
      status: 'pending',
      amountCents: pack?.priceCents ?? plan?.priceCents ?? 0,
      currency: body.currency,
      packKey: body.packKey ?? null,
      creditsGranted: 0,
      checkoutUrl: session.checkoutUrl,
      rawJson: JSON.stringify({ discountPct, bonusCredits, session: session.raw ?? null }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  audit({ orgId, action: 'billing.checkout_created', targetType: 'payment', meta: { packKey: body.packKey, planKey: body.planKey, currency: body.currency }, actorUserId: auth.user.id });

  return created(c, { checkoutUrl: session.checkoutUrl, checkoutId: session.checkoutId, provider: provider.name });
});

const AutoTopupSchema = z.object({
  enabled: z.boolean(),
  thresholdCredits: z.number().int().min(0).max(1_000_000).optional(),
  packKey: z.string().max(40).optional(),
});

billingRoutes.post('/:orgId/billing/auto-topup', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const body = await parseBody(c, AutoTopupSchema);

  getDb()
    .update(organizations)
    .set({
      autoTopupEnabled: body.enabled,
      ...(body.thresholdCredits !== undefined ? { autoTopupThresholdCredits: body.thresholdCredits } : {}),
      ...(body.packKey ? { autoTopupPackKey: body.packKey } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(organizations.id, orgId))
    .run();

  audit({ orgId, action: 'billing.auto_topup_updated', targetType: 'organization', targetId: orgId, meta: body, actorUserId: c.get('auth')!.user.id });
  return ok(c, { updated: true });
});

billingRoutes.get('/:orgId/billing/integrity', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  return ok(c, recomputeBalance(orgId));
});

// ---------------------------------------------------------------------------
// Provider webhook (Dodo, Standard Webhooks)
// ---------------------------------------------------------------------------

billingRoutes.post('/webhooks/dodo', async (c) => {
  const rawBody = await c.req.text();

  const provider = paymentProvider();

  let verification: ReturnType<typeof provider.verifyWebhook>;
  try {
    verification = provider.verifyWebhook({
      rawBody,
      headers: {
        'webhook-id': c.req.header('webhook-id'),
        'webhook-timestamp': c.req.header('webhook-timestamp'),
        'webhook-signature': c.req.header('webhook-signature'),
      },
    });
  } catch (err) {
    // The provider is not configured on this deployment. Acknowledge so the
    // provider stops retrying for the next 30 hours; the operator sees it in
    // the logs and in the audit trail instead of in a pager at 3am.
    log.error('payment webhook could not be verified', { error: String(err) });
    audit({ action: 'billing.webhook_unverifiable', meta: { error: String(err) }, actorType: 'provider' });
    return c.json({ received: true, ignored: 'provider not configured' }, 202);
  }

  if (!verification.valid) {
    log.warn('dodo webhook signature invalid');
    return c.json({ error: { code: 'unauthenticated', message: 'Invalid signature.' } }, 401);
  }

  try {
    const payment = normaliseDodoPayment({ type: verification.type, payload: verification.payload });

    if (!payment.orgId) {
      log.warn('dodo webhook missing org metadata', { type: verification.type });
      return c.json({ received: true, ignored: 'no org metadata' });
    }

    const db = getDb();
    const org = db.select().from(organizations).where(eq(organizations.id, payment.orgId)).get();
    if (!org) {
      return c.json({ received: true, ignored: 'unknown organisation' });
    }

    // Idempotency: the provider's event id is the ledger key, so retries are safe.
    const idempotencyKey = `dodo:${verification.eventId}`;

    const existing = db.select().from(payments).where(eq(payments.providerPaymentId, payment.providerPaymentId)).get();

    if (!existing) {
      db.insert(payments)
        .values({
          id: newId('pay'),
          orgId: payment.orgId,
          provider: 'dodo',
          providerPaymentId: payment.providerPaymentId,
          providerCheckoutId: payment.checkoutId ?? null,
          status: 'pending',
          amountCents: payment.amountCents,
          currency: payment.currency,
          packKey: payment.packKey ?? null,
          creditsGranted: 0,
          rawJson: JSON.stringify(payment.raw),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
    }

    if (payment.status === 'succeeded') {
      const pack = payment.packKey
        ? db.select().from(creditPacks).where(and(eq(creditPacks.key, payment.packKey), eq(creditPacks.currency, payment.currency))).get()
        : null;
      const plan = payment.planKey
        ? db.select().from(plans).where(and(eq(plans.key, payment.planKey), eq(plans.currency, payment.currency))).get()
        : null;

      const credits = pack ? pack.credits + pack.bonusCredits : plan ? plan.creditsIncluded : 0;

      if (credits > 0) {
        const result = grantCredits({
          orgId: payment.orgId,
          amount: credits,
          type: 'purchase',
          referenceType: 'payment',
          referenceId: payment.providerPaymentId,
          description: `${pack?.name ?? plan?.name ?? 'Purchase'} — ${credits} credits`,
          idempotencyKey,
        });

        db.update(payments)
          .set({ status: 'succeeded', creditsGranted: credits, updatedAt: Date.now() })
          .where(eq(payments.providerPaymentId, payment.providerPaymentId))
          .run();

        if (plan) {
          db.update(organizations).set({ planKey: plan.key, updatedAt: Date.now() }).where(eq(organizations.id, payment.orgId)).run();
          db.insert(subscriptions)
            .values({
              id: newId('sub'),
              orgId: payment.orgId,
              provider: 'dodo',
              planKey: plan.key,
              status: 'active',
              seats: plan.seatLimit,
              currentPeriodEnd: Date.now() + 30 * 86_400_000,
              metaJson: JSON.stringify({ paymentId: payment.providerPaymentId }),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })
            .run();
        }

        audit({
          orgId: payment.orgId,
          action: 'billing.payment_succeeded',
          targetType: 'payment',
          meta: { credits, amountCents: payment.amountCents, currency: payment.currency, applied: result.applied },
          actorType: 'provider',
        });
      }
    } else if (payment.status === 'failed' || payment.status === 'cancelled' || payment.status === 'refunded') {
      db.update(payments)
        .set({ status: payment.status, updatedAt: Date.now() })
        .where(eq(payments.providerPaymentId, payment.providerPaymentId))
        .run();
    }

  } catch (err) {
    // An unparseable or unexpected payload would fail identically on every
    // retry, so acknowledging is the only correct response. The failure is
    // recorded in the audit log, where the admin console surfaces it.
    log.error('payment webhook processing failed', {
      eventId: verification.eventId,
      type: verification.type,
      error: String(err),
    });
    audit({
      action: 'billing.webhook_failed',
      meta: { eventId: verification.eventId, type: verification.type, error: String(err) },
      actorType: 'provider',
    });
    return c.json({ received: true, ignored: 'processing error' }, 202);
  }

  // Always acknowledge quickly; Dodo retries for up to ~30 hours otherwise.
  return c.json({ received: true });
});


/** Called after a debit to decide whether to top up automatically. */
billingRoutes.post('/:orgId/billing/check-threshold', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  return ok(c, maybeAutoTopUp(orgId));
});

billingRoutes.onError((err, c) => errorResponse(c as AppContext, err));
