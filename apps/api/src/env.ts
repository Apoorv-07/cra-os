import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal `.env` loader.
 *
 * Deliberately dependency-free: configuration must be readable before anything
 * else in the process runs, and a single small parser is easier to audit than a
 * package. Real environment variables always win over the file, so production
 * secrets come from the platform's secret store, never from a file on disk.
 */
function loadDotEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
    return;
  }
}

loadDotEnv();

/**
 * Environment configuration.
 *
 * Design rule: the service must boot with **zero** configuration for local
 * development and CI, while refusing to boot in production without the secrets
 * that actually matter. Anything secret is therefore validated lazily at the
 * point of use (see `requireSecret`) rather than at import time.
 */

const boolish = (def: boolean) =>
  z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
    .optional()
    .transform((v) => {
      if (v === undefined) return def;
      if (typeof v === 'boolean') return v;
      return v === 'true' || v === '1' || v === 'yes';
    });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),

  APP_URL: z.string().default('http://localhost:8787'),
  WEB_URL: z.string().default('http://localhost:5173'),

  DATABASE_PATH: z.string().default('data/cra.db'),

  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  STORAGE_DIR: z.string().default('data/storage'),

  SESSION_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),

  // -- Source control -------------------------------------------------------
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_API_BASE: z.string().default('https://api.github.com'),

  // -- Vulnerability intelligence -------------------------------------------
  OSV_URL: z.string().default('https://api.osv.dev'),
  KEV_URL: z
    .string()
    .default('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'),
  EPSS_URL: z.string().default('https://api.first.org/data/v1/epss'),

  // -- AI -------------------------------------------------------------------
  AI_PROVIDER: z.enum(['none', 'workers-ai', 'openai', 'anthropic']).default('none'),
  AI_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),

  // -- Payments -------------------------------------------------------------
  PAYMENT_PROVIDER: z.enum(['dodo', 'manual']).default('manual'),
  DODO_API_KEY: z.string().optional(),
  DODO_WEBHOOK_SECRET: z.string().optional(),
  DODO_ENV: z.enum(['test', 'live']).default('test'),
  DODO_BASE_URL: z.string().default('https://live.dodopayments.com'),

  // -- Mail -----------------------------------------------------------------
  MAIL_DRIVER: z.enum(['console', 'resend', 'none']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('CRA Compliance OS <no-reply@example.com>'),

  // -- Behaviour ------------------------------------------------------------
  BILLING_ENABLED: boolish(true),
  SELF_SERVE_SIGNUP: boolish(true),
  // Enough to connect a repository, scan it a few times and generate one
  // readiness report without buying anything: the free tier must be able to
  // complete the core flow, or the product cannot demonstrate its own value.
  PUBLIC_SIGNUP_CREDITS: z.coerce.number().int().nonnegative().default(250),
  PUBLIC_BADGES: boolish(true),
  RUN_WORKER_IN_PROCESS: boolish(true),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1500),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_S: z.coerce.number().int().positive().default(60),
  ADMIN_EMAILS: z.string().default(''),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  TRUST_PROXY: boolish(true),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail loudly with an actionable message rather than a stack trace.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\n[env] Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

/** Secrets that must be present in production deployments. */
const PRODUCTION_REQUIRED = ['SESSION_SECRET', 'ENCRYPTION_KEY'] as const;

if (raw.NODE_ENV === 'production') {
  const missing = PRODUCTION_REQUIRED.filter((k) => !raw[k]);
  if (missing.length > 0) {
    console.error(
      `\n[env] ${missing.join(', ')} must be set in production.\n` +
        `Generate with: openssl rand -hex 32\n`,
    );
    process.exit(1);
  }
}

const DEV_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

export const env: Env & {
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
  isProduction: boolean;
  isTest: boolean;
  adminEmails: string[];
} = {
  ...raw,
  // In dev/test we derive stable defaults so a clean clone boots immediately.
  SESSION_SECRET: raw.SESSION_SECRET ?? DEV_SECRET,
  ENCRYPTION_KEY: raw.ENCRYPTION_KEY ?? DEV_SECRET,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  adminEmails: raw.ADMIN_EMAILS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

/**
 * Returns a secret or throws a descriptive, user-facing error.
 * Used so that optional-by-default configuration (payments, AI, GitHub) fails
 * with a clear message instead of a mysterious 500.
 */
export function requireSecret(value: string | undefined, name: string, hint: string): string {
  if (!value) {
    throw new Error(`${name} is not configured. ${hint}`);
  }
  return value;
}

export const isSecretConfigured = (v: string | undefined): boolean => Boolean(v && v.length > 0);
