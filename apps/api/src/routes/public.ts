import { Hono } from 'hono';
import type { AppEnv } from '../core/context.js';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { analyticsEvents, evidence, organizations, reports, repositories, scans, shareLinks } from '../db/schema.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { ok, created, binaryBody, parseBody, errorResponse } from '../core/http.js';
import { rateLimit } from '../core/rate-limit.js';
import { storage, assertSafeKey } from '../core/storage.js';
import { dbHealthCheck } from '../db/index.js';
import { env } from '../env.js';
import { log } from '../core/logger.js';
import { openApiDocument } from '../openapi.js';
import type { AppContext } from '../core/context.js';

export const publicRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

publicRoutes.get('/health', async (c) => {
  const dbHealth = await dbHealthCheck();
  return c.json(
    {
      status: dbHealth.ok ? 'ok' : 'degraded',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: dbHealth,
    },
    dbHealth.ok ? 200 : 503,
  );
});

publicRoutes.get('/health/detailed', async (c) => {
  const dbHealth = await dbHealthCheck();
  const { queueStats } = await import('../jobs/queue.js');
  return c.json({
    status: dbHealth.ok ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    database: dbHealth,
    queue: queueStats(),
    configuration: {
      payments: env.PAYMENT_PROVIDER,
      paymentsConfigured: env.PAYMENT_PROVIDER === 'dodo' ? Boolean(env.DODO_API_KEY) : true,
      ai: env.AI_PROVIDER,
      githubApp: Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY),
      githubOauth: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      storage: env.STORAGE_DRIVER,
      billingEnabled: env.BILLING_ENABLED,
    },
  });
});

// ---------------------------------------------------------------------------
// Readiness badges (distribution loop, §38)
// ---------------------------------------------------------------------------

const BADGE_COLOURS: Record<string, string> = {
  A: '#0f9d58',
  B: '#3aa76d',
  C: '#f4b400',
  D: '#db4437',
  E: '#a50e0e',
  'N/A': '#9aa0a6',
};

function badgeSvg(label: string, value: string, colour: string): string {
  const labelWidth = label.length * 6.6 + 18;
  const valueWidth = value.length * 6.6 + 18;
  const width = Math.round(labelWidth + valueWidth);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <rect width="${width}" height="20" rx="3" fill="#0b1020"/>
  <rect x="${labelWidth}" width="${valueWidth}" height="20" rx="3" fill="${colour}"/>
  <rect x="${labelWidth}" width="6" height="20" fill="${colour}"/>
  <g fill="#ffffff" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial" font-size="11" font-weight="600">
    <text x="9" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth + 9}" y="14">${escapeXml(value)}</text>
  </g>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!);
}

/**
 * Public badge endpoint. Deliberately exposes only an aggregate readiness grade
 * and a component count — never vulnerability detail, which would hand an
 * attacker a target list.
 */
publicRoutes.get('/badge/:token', async (c) => {
  const token = c.req.param('token').replace(/\.svg$/, '');
  const repo = getDb().select().from(repositories).where(eq(repositories.badgeToken, token)).get();

  if (repo) {
    if (!repo.badgeEnabled) {
      c.header('Content-Type', 'image/svg+xml');
      c.header('Cache-Control', 'public, max-age=300');
      return c.body(badgeSvg('CRA', 'not published', '#9aa0a6'));
    }

    const scan = repo.lastScanId ? getDb().select().from(scans).where(eq(scans.id, repo.lastScanId)).get() : null;
    const score = scan?.readinessScore ?? repo.readinessScore ?? 0;
    const grade =
      score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : score > 0 ? 'E' : 'N/A';

    c.header('Content-Type', 'image/svg+xml');
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(badgeSvg('CRA readiness', `${grade} · ${Math.round(score)}%`, BADGE_COLOURS[grade] ?? '#9aa0a6'));
  }

  // Share links can also publish a badge for a specific report.
  const share = getDb().select().from(shareLinks).where(eq(shareLinks.token, token)).get();
  if (share && !share.revokedAt && (!share.expiresAt || share.expiresAt > Date.now())) {
    c.header('Content-Type', 'image/svg+xml');
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(badgeSvg('CRA', 'monitored', '#3aa76d'));
  }

  c.header('Content-Type', 'image/svg+xml');
  return c.body(badgeSvg('CRA', 'unknown', '#9aa0a6'));
});

// ---------------------------------------------------------------------------
// Share links (read-only, expiring)
// ---------------------------------------------------------------------------

publicRoutes.get('/share/:token', async (c) => {
  const token = c.req.param('token');
  const share = getDb().select().from(shareLinks).where(eq(shareLinks.token, token)).get();

  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt < Date.now())) {
    throw AppError.notFound('This shared link has expired or been revoked.');
  }

  getDb()
    .update(shareLinks)
    .set({ viewCount: share.viewCount + 1, lastViewedAt: Date.now() })
    .where(eq(shareLinks.id, share.id))
    .run();

  if (share.resourceType === 'evidence') {
    const item = getDb().select().from(evidence).where(eq(evidence.id, share.resourceId)).get();
    if (!item) throw AppError.notFound('Evidence');
    return ok(c, {
      title: item.title,
      description: item.description,
      type: item.type,
      sha256: item.sha256,
      createdAt: item.createdAt,
      mimeType: item.mimeType,
    });
  }

  if (share.resourceType === 'report') {
    const report = getDb().select().from(reports).where(eq(reports.id, share.resourceId)).get();
    if (!report) throw AppError.notFound('Report');
    const org = getDb().select().from(organizations).where(eq(organizations.id, report.orgId)).get();
    const content = report.contentJson ? JSON.parse(report.contentJson) : null;
    return ok(c, {
      kind: 'report',
      title: report.title,
      reportKind: report.kind,
      organisation: org?.name ?? 'Organisation',
      generatedAt: report.createdAt,
      content,
      disclaimer:
        'Shared compliance report. Contents are accurate as of the generation date shown. This is engineering evidence, not legal advice.',
    });
  }

  if (share.resourceType === 'repository') {
    const repo = getDb().select().from(repositories).where(eq(repositories.id, share.resourceId)).get();
    if (!repo) throw AppError.notFound('Repository');
    const scan = repo.lastScanId ? getDb().select().from(scans).where(eq(scans.id, repo.lastScanId)).get() : null;
    return ok(c, {
      repository: {
        name: repo.fullName ?? repo.name,
        readinessScore: repo.readinessScore,
        lastScanAt: repo.lastScanAt,
        componentCount: scan?.componentCount ?? 0,
        criticalCount: scan?.criticalCount ?? 0,
        highCount: scan?.highCount ?? 0,
        kevCount: scan?.kevCount ?? 0,
      },
      note: 'Shared summary only. Vulnerability detail is not exposed publicly.',
    });
  }

  throw AppError.notFound('Shared resource');
});

// ---------------------------------------------------------------------------
// Product analytics
// ---------------------------------------------------------------------------

const AnalyticsSchema = z.object({
  name: z.string().min(1).max(80),
  props: z.record(z.string(), z.unknown()).optional(),
  sessionId: z.string().max(64).optional(),
  path: z.string().max(300).optional(),
  anonymousId: z.string().max(64).optional(),
});

publicRoutes.post('/analytics', rateLimit({ scope: 'analytics', limit: 120, windowSeconds: 60 }), async (c) => {
  const body = await parseBody(c, AnalyticsSchema);
  const auth = c.get('auth');

  getDb()
    .insert(analyticsEvents)
    .values({
      id: newId('anl'),
      orgId: auth?.orgId ?? null,
      userId: auth?.user.id ?? null,
      anonymousId: body.anonymousId ?? null,
      sessionId: body.sessionId ?? null,
      name: body.name,
      propsJson: body.props ? JSON.stringify(body.props) : null,
      path: body.path ?? null,
      referrer: c.req.header('referer') ?? null,
      userAgent: c.req.header('user-agent') ?? null,
      createdAt: Date.now(),
    })
    .run();

  return created(c, { recorded: true });
});

// ---------------------------------------------------------------------------
// Object storage (authenticated, tenant-scoped)
// ---------------------------------------------------------------------------

publicRoutes.get('/storage/*', async (c) => {
  const auth = c.get('auth');
  if (!auth) throw AppError.unauthenticated();

  const key = c.req.path.replace('/api/v1/storage/', '');
  assertSafeKey(key);

  // Tenant isolation: the first path segment is the organisation id.
  const orgId = key.split('/')[0];
  if (auth.orgId && auth.orgId !== orgId && !auth.user.isSystemAdmin) {
    throw AppError.forbidden();
  }

  const content = await storage().get(key);
  if (!content) throw AppError.notFound('File');

  c.header('Cache-Control', 'private, max-age=60');
  return binaryBody(c, content, 'application/octet-stream');
});

// ---------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------

publicRoutes.get('/openapi.json', async (c) => c.json(openApiDocument()));
publicRoutes.get('/docs', async (c) => c.redirect('/openapi.json'));

// ---------------------------------------------------------------------------
// GitHub App webhook (installation lifecycle)
// ---------------------------------------------------------------------------

publicRoutes.post('/integrations/github/webhook', async (c) => {
  const event = c.req.header('x-github-event');
  const raw = await c.req.text();

  // HMAC verification is mandatory whenever a secret is configured.
  if (env.GITHUB_APP_WEBHOOK_SECRET) {
    const { createHmac, timingSafeEqual } = await import('node:crypto');
    const signature = c.req.header('x-hub-signature-256') ?? '';
    const expected = `sha256=${createHmac('sha256', env.GITHUB_APP_WEBHOOK_SECRET).update(raw).digest('hex')}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      log.warn('github webhook signature mismatch');
      return c.json({ error: { code: 'unauthenticated', message: 'Invalid signature.' } }, 401);
    }
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: { code: 'validation_failed', message: 'Invalid JSON.' } }, 400);
  }

  log.info('github webhook received', { event });

  if (event === 'installation' && payload.action === 'deleted') {
    const { integrations } = await import('../db/schema.js');
    getDb()
      .update(integrations)
      .set({ status: 'revoked', revokedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(integrations.installationId, String(payload.installation?.id ?? '')))
      .run();
  }

  if (event === 'push' && payload.repository) {
    // Trigger a scan for any repository we monitor on the pushed ref.
    const fullName = payload.repository.full_name as string;
    const [owner, name] = fullName.split('/');
    const repo = getDb()
      .select()
      .from(repositories)
      .where(and(eq(repositories.owner, owner ?? ''), eq(repositories.name, name ?? '')))
      .get();

    if (repo && repo.monitoringEnabled && repo.status === 'active') {
      const { startScan } = await import('./repositories.js');
      try {
        await startScan({
          orgId: repo.orgId,
          repositoryId: repo.id,
          trigger: 'push',
          ref: String(payload.ref ?? '').replace('refs/heads/', ''),
        });
      } catch (err) {
        log.error('push-triggered scan failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return c.json({ received: true });
});

publicRoutes.onError((err, c) => errorResponse(c as AppContext, err));
