import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { compress } from 'hono/compress';
import { env } from './env.js';
import type { AppEnv } from './core/context.js';
import { log } from './core/logger.js';
import { errorResponse, ok } from './core/http.js';
import { resolveAuth, csrfGuard } from './core/auth.js';
import { rateLimit } from './core/rate-limit.js';
import { audit } from './core/audit.js';

import { authRoutes } from './routes/auth.js';
import { orgRoutes } from './routes/orgs.js';
import { repoRoutes } from './routes/repositories.js';
import { complianceRoutes } from './routes/compliance.js';
import { incidentRoutes } from './routes/incidents.js';
import { billingRoutes } from './routes/billing.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';
import { ciRoutes } from './routes/ci.js';
import { findingsRoutes } from './routes/findings.js';
import { reportsRoutes } from './routes/reports.js';

/**
 * Application assembly.
 *
 * The Hono instance is runtime-agnostic: `src/index.ts` serves it on Node with
 * @hono/node-server, and `src/worker.ts` exports the same app for Cloudflare
 * Workers with a different storage/queue driver. Nothing here binds to Node.
 */

const app = new Hono<AppEnv>();

// --- Global middleware -----------------------------------------------------

app.use('*', compress());

app.use(
  '*',
  cors({
    origin: (origin) => {
      // Allow the configured app origins plus local dev servers.
      const allowed = new Set([
        env.WEB_URL,
        env.APP_URL,
        'http://localhost:5173',
        'http://localhost:4173',
        'http://localhost:8787',
      ]);
      if (process.env.ALLOWED_ORIGINS) {
        for (const o of process.env.ALLOWED_ORIGINS.split(',')) allowed.add(o.trim());
      }
      if (!origin) return env.WEB_URL;
      return allowed.has(origin) ? origin : null;
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Organization-Id', 'X-Requested-With'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  }),
);

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"], // the SPA and docs pages use inline bootstrap data
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  },
  referrerPolicy: 'strict-origin-when-cross-origin',
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  strictTransportSecurity: env.isProduction ? 'max-age=63072000; includeSubDomains; preload' : undefined,
}));

app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  // Set as a header rather than via secureHeaders() to keep the policy string
  // in one readable place.
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  c.header('X-Request-Id', c.get('requestId')!);
  c.header('Server-Timing', `total;dur=${duration}`);
  if (duration > 1000) log.warn('slow request', { path: c.req.path, durationMs: duration });
});

app.use('*', rateLimit({ scope: 'global' }));
app.use('*', resolveAuth);
app.use('*', csrfGuard);

// --- Routes ----------------------------------------------------------------

app.get('/health', (c) => ok(c, { status: 'ok' }));

app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/organizations', orgRoutes);
app.route('/api/v1/organizations', repoRoutes);
app.route('/api/v1/organizations', complianceRoutes);
app.route('/api/v1/organizations', findingsRoutes);
app.route('/api/v1/organizations', reportsRoutes);
app.route('/api/v1/organizations', incidentRoutes);
app.route('/api/v1/organizations', billingRoutes);
app.route('/api/v1/billing', billingRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1', publicRoutes);
app.route('/api/v1/ci', ciRoutes);

// --- Not found & errors ----------------------------------------------------

app.notFound((c) => c.json({ error: { code: 'not_found', message: `No route for ${c.req.method} ${c.req.path}.` } }, 404));

app.onError((err, c) => {
  audit({
    action: 'request.error',
    meta: { path: c.req.path, method: c.req.method, message: err instanceof Error ? err.message : String(err) },
  });
  return errorResponse(c as never, err);
});

export default app;
export { app };
