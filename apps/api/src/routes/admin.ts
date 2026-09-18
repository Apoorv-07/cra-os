import { Hono } from 'hono';
import type { AppEnv } from '../core/context.js';
import { desc, eq, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  analyticsEvents,
  complianceControls,
  creditAccounts,
  creditPacks,
  featureFlags,
  jobs,
  organizations,
  payments,
  plans,
  repositories,
  scans,
  systemEvents,
  usageRules,
  users,
  vulnerabilities,
} from '../db/schema.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { ok, parseBody, errorResponse } from '../core/http.js';
import { requireAuth, requireSystemAdmin } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { grantCredits, recomputeBalance } from '../modules/billing/ledger.js';
import { upsertUsageRule } from '../modules/billing/usage-rules.js';
import { queueStats, deadLetterJobs, requeueJob, getJobDetail } from '../jobs/queue.js';
import { syncKev, kevStatus, kevCount } from '../intel/kev.js';
import { dbHealthCheck } from '../db/index.js';
import { env } from '../env.js';
import type { AppContext } from '../core/context.js';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireAuth, requireSystemAdmin);

const countRows = (table: SQLiteTable): number => {
  const row = getDb().select({ c: sql<number>`count(*)` }).from(table).get() as { c: number } | undefined;
  return Number(row?.c ?? 0);
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

adminRoutes.get('/overview', async (c) => {
  const db = getDb();

  const succeeded = db
    .select({ total: sql<number>`coalesce(sum(${payments.amountCents}), 0)` })
    .from(payments)
    .where(eq(payments.status, 'succeeded'))
    .get();

  const pending = db
    .select({ total: sql<number>`coalesce(sum(${payments.amountCents}), 0)` })
    .from(payments)
    .where(eq(payments.status, 'pending'))
    .get();

  const outstanding = db.select({ total: sql<number>`coalesce(sum(${creditAccounts.balance}), 0)` }).from(creditAccounts).get();
  const consumed = db.select({ total: sql<number>`coalesce(sum(${creditAccounts.lifetimeConsumed}), 0)` }).from(creditAccounts).get();

  return ok(c, {
    counts: {
      users: countRows(users),
      organizations: countRows(organizations),
      repositories: countRows(repositories),
      scans: countRows(scans),
      payments: countRows(payments),
      vulnerabilities: countRows(vulnerabilities),
      controls: countRows(complianceControls),
    },
    revenue: {
      succeededCents: Number(succeeded?.total ?? 0),
      pendingCents: Number(pending?.total ?? 0),
    },
    credits: {
      outstanding: Number(outstanding?.total ?? 0),
      lifetimeConsumed: Number(consumed?.total ?? 0),
    },
    queue: queueStats(),
    infrastructure: {
      database: await dbHealthCheck(),
      payments: env.PAYMENT_PROVIDER,
      ai: env.AI_PROVIDER,
      storage: env.STORAGE_DRIVER,
      kev: { status: kevStatus(), entries: kevCount() },
    },
  });
});

adminRoutes.get('/organizations', async (c) => {
  const rows = getDb()
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      planKey: organizations.planKey,
      isAgency: organizations.isAgency,
      status: organizations.status,
      createdAt: organizations.createdAt,
      balance: creditAccounts.balance,
      lifetimePurchased: creditAccounts.lifetimePurchased,
    })
    .from(organizations)
    .leftJoin(creditAccounts, eq(creditAccounts.orgId, organizations.id))
    .orderBy(desc(organizations.createdAt))
    .limit(200)
    .all();
  return ok(c, rows);
});

adminRoutes.get('/users', async (c) => {
  const rows = getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isSystemAdmin: users.isSystemAdmin,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(200)
    .all();
  return ok(c, rows);
});

// ---------------------------------------------------------------------------
// Jobs & operations
// ---------------------------------------------------------------------------

adminRoutes.get('/jobs', async (c) => {
  const status = c.req.query('status');
  const db = getDb();
  const rows = status
    ? db.select().from(jobs).where(eq(jobs.status, status as never)).orderBy(desc(jobs.createdAt)).limit(100).all()
    : db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(100).all();
  return ok(c, rows);
});

adminRoutes.get('/jobs/dead-letter', async (c) => ok(c, deadLetterJobs()));

adminRoutes.get('/jobs/:id', async (c) => {
  const detail = getJobDetail(c.req.param('id'));
  if (!detail) throw AppError.notFound('Job');
  return ok(c, detail);
});

adminRoutes.post('/jobs/:id/retry', async (c) => {
  const id = c.req.param('id');
  requeueJob(id);
  audit({ action: 'admin.job_retried', targetType: 'job', targetId: id, actorUserId: c.get('auth')!.user.id });
  return ok(c, { requeued: true });
});

adminRoutes.post('/jobs/:id/run', async (c) => {
  const id = c.req.param('id');
  const { runJobNow } = await import('../jobs/worker.js');
  try {
    const result = await runJobNow(id);
    return ok(c, { ran: true, result });
  } catch (err) {
    return ok(c, { ran: false, error: err instanceof Error ? err.message : String(err) });
  }
});

adminRoutes.get('/system-events', async (c) => {
  const rows = getDb().select().from(systemEvents).orderBy(desc(systemEvents.createdAt)).limit(200).all();
  return ok(c, rows);
});

adminRoutes.get('/health', async (c) => {
  const q = queueStats();
  const dbHealth = await dbHealthCheck();
  const degraded = (q.dead ?? 0) > 0 || !dbHealth.ok;

  return ok(c, {
    status: degraded ? 'degraded' : 'healthy',
    database: dbHealth,
    queue: q,
    providers: {
      payments: env.PAYMENT_PROVIDER,
      paymentsConfigured: env.PAYMENT_PROVIDER === 'dodo' ? Boolean(env.DODO_API_KEY) : true,
      ai: env.AI_PROVIDER,
      github: Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY),
      mail: env.MAIL_DRIVER,
    },
    kev: kevStatus(),
  });
});

// ---------------------------------------------------------------------------
// Support tools
// ---------------------------------------------------------------------------

const GrantSchema = z.object({
  orgId: z.string(),
  amount: z.number().int().positive().max(1_000_000),
  description: z.string().max(300).optional(),
  reason: z.string().max(300).optional(),
});

adminRoutes.post('/credits/grant', async (c) => {
  const body = await parseBody(c, GrantSchema);
  const auth = c.get('auth')!;

  const result = grantCredits({
    orgId: body.orgId,
    amount: body.amount,
    type: 'grant',
    description: body.description ?? 'Administrative grant',
    idempotencyKey: `admin-grant:${newId('ctx')}`,
    createdByUserId: auth.user.id,
  });

  audit({
    orgId: body.orgId,
    action: 'admin.credits_granted',
    targetType: 'organization',
    targetId: body.orgId,
    meta: { amount: body.amount, reason: body.reason ?? null, applied: result.applied },
    actorUserId: auth.user.id,
  });

  return ok(c, result);
});

adminRoutes.get('/organizations/:orgId/integrity', async (c) => ok(c, recomputeBalance(c.req.param('orgId'))));

// ---------------------------------------------------------------------------
// Pricing administration (§41 — change prices without a redeploy)
// ---------------------------------------------------------------------------

adminRoutes.get('/pricing/usage-rules', async (c) => ok(c, getDb().select().from(usageRules).all()));

adminRoutes.post('/pricing/usage-rules', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      action: z.string().min(1),
      label: z.string().min(1),
      credits: z.number().int().min(0).max(1_000_000),
      description: z.string().optional(),
      active: z.boolean().optional(),
    }),
  );
  const result = upsertUsageRule(body);
  audit({ action: 'admin.usage_rule_updated', targetType: 'usage_rule', targetId: body.action, meta: body, actorUserId: c.get('auth')!.user.id });
  return ok(c, result);
});

adminRoutes.get('/pricing/packs', async (c) => ok(c, getDb().select().from(creditPacks).all()));

adminRoutes.post('/pricing/packs', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      id: z.string().optional(),
      key: z.string().min(1),
      name: z.string().min(1),
      credits: z.number().int().min(1),
      priceCents: z.number().int().min(0),
      currency: z.enum(['USD', 'EUR', 'GBP']),
      bonusCredits: z.number().int().min(0).default(0),
      popular: z.boolean().default(false),
      active: z.boolean().default(true),
      providerProductId: z.string().optional(),
      sortOrder: z.number().int().default(100),
    }),
  );

  const db = getDb();
  const { id, ...rest } = body;

  if (id) {
    db.update(creditPacks).set(rest).where(eq(creditPacks.id, id)).run();
    return ok(c, { id, updated: true });
  }

  const newPackId = newId('pk');
  db.insert(creditPacks).values({ id: newPackId, ...rest }).run();
  return ok(c, { id: newPackId, created: true });
});

adminRoutes.get('/pricing/plans', async (c) => ok(c, getDb().select().from(plans).all()));

adminRoutes.post('/pricing/plans', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      id: z.string().optional(),
      key: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      priceCents: z.number().int().min(0),
      currency: z.enum(['USD', 'EUR', 'GBP']),
      creditsIncluded: z.number().int().min(0),
      repoLimit: z.number().int().min(1),
      seatLimit: z.number().int().min(1),
      features: z.array(z.string()).optional(),
      providerProductId: z.string().optional(),
      active: z.boolean().default(true),
      sortOrder: z.number().int().default(100),
    }),
  );

  const db = getDb();
  const { id, features, ...rest } = body;
  const payload = { ...rest, featuresJson: JSON.stringify(features ?? []), interval: 'month' as const };

  if (id) {
    db.update(plans).set(payload).where(eq(plans.id, id)).run();
    return ok(c, { id, updated: true });
  }

  const newPlanId = newId('pln');
  db.insert(plans).values({ id: newPlanId, ...payload }).run();
  return ok(c, { id: newPlanId, created: true });
});

// ---------------------------------------------------------------------------
// Feature flags & intelligence ingestion
// ---------------------------------------------------------------------------

adminRoutes.get('/feature-flags', async (c) => ok(c, getDb().select().from(featureFlags).all()));

adminRoutes.post('/feature-flags', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      key: z.string().min(1),
      enabled: z.boolean(),
      description: z.string().optional(),
      rolloutPct: z.number().int().min(0).max(100).optional(),
    }),
  );

  getDb()
    .insert(featureFlags)
    .values({
      key: body.key,
      enabled: body.enabled,
      description: body.description ?? null,
      rolloutPct: body.rolloutPct ?? 100,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: { enabled: body.enabled, description: body.description ?? null, rolloutPct: body.rolloutPct ?? 100, updatedAt: Date.now() },
    })
    .run();

  return ok(c, { key: body.key, enabled: body.enabled });
});

adminRoutes.post('/intel/kev-sync', async (c) => {
  const { enqueue } = await import('../jobs/queue.js');
  enqueue({ type: 'intel.kev.sync', payload: {}, dedupeKey: 'intel.kev.sync' });
  return ok(c, { queued: true });
});

adminRoutes.post('/intel/kev-sync/now', async (c) => ok(c, await syncKev()));

// ---------------------------------------------------------------------------
// Funnel analytics (§49)
// ---------------------------------------------------------------------------

adminRoutes.get('/funnel', async (c) => {
  const rows = getDb()
    .select({ name: analyticsEvents.name, count: sql<number>`count(*)` })
    .from(analyticsEvents)
    .groupBy(analyticsEvents.name)
    .all();

  const byName: Record<string, number> = Object.fromEntries(rows.map((r) => [r.name, Number(r.count)]));

  const steps = [
    'page_view',
    'signup_started',
    'signup_completed',
    'github_connected',
    'repository_added',
    'scan_started',
    'scan_completed',
    'finding_viewed',
    'pricing_viewed',
    'checkout_started',
    'credits_purchased',
  ];

  return ok(c, {
    counts: byName,
    funnel: steps.map((step, index) => {
      const previous = index === 0 ? byName[step] ?? 0 : byName[steps[index - 1]!] ?? 0;
      return {
        step,
        count: byName[step] ?? 0,
        conversionFromPrevious: previous > 0 ? Number(((byName[step] ?? 0) / previous).toFixed(4)) : 0,
      };
    }),
  });
});

adminRoutes.onError((err, c) => errorResponse(c as AppContext, err));
