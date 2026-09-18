import { Hono } from 'hono';
import type { AppEnv } from '../core/context.js';
import {setCookie, deleteCookie} from 'hono/cookie';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  identities,
  magicLinks,
  organizations,
  organizationMembers,
  referrals,
  users,
} from '../db/schema.js';
import { env } from '../env.js';
import {newId, slugify} from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { hashPassword, verifyPassword, generateToken, hashToken, encryptSecret } from '../core/crypto.js';
import { issueSession, revokeSession, revokeAllUserSessions, SESSION_COOKIE, MAGIC_LINK_TTL_MS } from '../core/session.js';
import { audit } from '../core/audit.js';
import { ok, created, parseBody, errorResponse, clientIp } from '../core/http.js';
import { authRateLimit } from '../core/rate-limit.js';
import { requireAuth } from '../core/auth.js';
import { grantCredits } from '../modules/billing/ledger.js';
import { seedUsageRules } from '../modules/billing/usage-rules.js';
import { sendMail } from '../core/mail.js';
import { exchangeOAuthCode } from '../scan/source.js';
import type { AppContext } from '../core/context.js';

export const authRoutes = new Hono<AppEnv>();

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Bootstraps an organisation for a new user: org, owner membership, credit
 * account and the free credit grant. Wrapped in one transaction so a partial
 * signup can never leave an org without an owner.
 */
export function createOrganizationForUser(input: {
  userId: string;
  name: string;
  isAgency?: boolean;
  parentOrgId?: string | null;
}): string {
  const db = getDb();
  return db.transaction(() => {
    const orgId = newId('org');
    db.insert(organizations)
      .values({
        id: orgId,
        name: input.name,
        slug: slugify(input.name),
        planKey: 'free',
        isAgency: Boolean(input.isAgency),
        parentOrgId: input.parentOrgId ?? null,
        retentionDays: 365,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    db.insert(organizationMembers)
      .values({
        id: newId('mem'),
        orgId,
        userId: input.userId,
        role: 'owner',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    db.update(users).set({ defaultOrgId: orgId, updatedAt: Date.now() }).where(eq(users.id, input.userId)).run();

    grantCredits({
      orgId,
      amount: env.PUBLIC_SIGNUP_CREDITS,
      type: 'grant',
      description: 'Welcome credits',
      idempotencyKey: `signup:${orgId}`,
    });

    return orgId;
  });
}

// ---------------------------------------------------------------------------
// Password auth
// ---------------------------------------------------------------------------

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Use at least 10 characters.'),
  name: z.string().min(1).max(120).optional(),
  organizationName: z.string().min(1).max(120).optional(),
  referralCode: z.string().max(32).optional(),
});

authRoutes.post('/signup', authRateLimit(), async (c) => {
  if (!env.SELF_SERVE_SIGNUP) throw AppError.forbidden('Signups are closed on this deployment.');

  const body = await parseBody(c, SignupSchema);
  const db = getDb();
  const email = normaliseEmail(body.email);

  if (db.select().from(users).where(eq(users.emailNormalised, email)).get()) {
    throw AppError.conflict('An account with that email already exists.');
  }

  seedUsageRules();

  const userId = newId('usr');
  const isSystemAdmin = env.adminEmails.includes(email);

  db.insert(users)
    .values({
      id: userId,
      email: body.email.trim(),
      emailNormalised: email,
      name: body.name ?? null,
      passwordHash: await hashPassword(body.password),
      emailVerifiedAt: null,
      isSystemAdmin,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  const orgId = createOrganizationForUser({
    userId,
    name: body.organizationName ?? (body.name ? `${body.name}'s organisation` : 'My organisation'),
  });

  // Referral credits for both sides, capped to a single conversion.
  if (body.referralCode) {
    const referral = db.select().from(referrals).where(eq(referrals.code, body.referralCode)).get();
    if (referral && referral.status === 'pending') {
      db.update(referrals)
        .set({ status: 'converted', referredOrgId: orgId, convertedAt: Date.now() })
        .where(eq(referrals.id, referral.id))
        .run();
      grantCredits({
        orgId: referral.orgId,
        amount: referral.rewardCredits,
        type: 'referral',
        description: 'Referral bonus',
        idempotencyKey: `referral:${referral.id}`,
      });
      grantCredits({
        orgId,
        amount: Math.floor(referral.rewardCredits / 2),
        type: 'referral',
        description: 'Referral welcome bonus',
        idempotencyKey: `referral-welcome:${orgId}`,
      });
    }
  }

  const token = issueSession(c, userId);
  setCookie(c as never, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  audit({ orgId, actorUserId: userId, action: 'user.signup', targetType: 'user', targetId: userId, ip: clientIp(c as AppContext) });

  return created(c, {
    user: { id: userId, email: body.email.trim(), name: body.name ?? null },
    organizationId: orgId,
  });
});

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRoutes.post('/login', authRateLimit(), async (c) => {
  const body = await parseBody(c, LoginSchema);
  const db = getDb();
  const user = db.select().from(users).where(eq(users.emailNormalised, normaliseEmail(body.email))).get();

  // Constant-ish response: never reveal whether the account exists.
  if (!user || !user.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
    throw AppError.unauthenticated('Those credentials are not valid.');
  }
  if (user.status !== 'active') throw AppError.forbidden('That account is not active.');

  const token = issueSession(c, user.id);
  setCookie(c as never, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
  audit({ actorUserId: user.id, action: 'user.login', targetType: 'user', targetId: user.id, ip: clientIp(c as AppContext) });

  return ok(c, { user: { id: user.id, email: user.email, name: user.name, isSystemAdmin: Boolean(user.isSystemAdmin) } });
});

authRoutes.post('/logout', requireAuth, async (c) => {
  const auth = c.get('auth')!;
  if (auth.sessionId) revokeSession(auth.sessionId);
  deleteCookie(c as never, SESSION_COOKIE, { path: '/' });
  return ok(c, { ok: true });
});

// ---------------------------------------------------------------------------
// Magic links
// ---------------------------------------------------------------------------

const MagicLinkSchema = z.object({ email: z.string().email() });

authRoutes.post('/magic-link', authRateLimit(), async (c) => {
  const body = await parseBody(c, MagicLinkSchema);
  const db = getDb();
  const email = normaliseEmail(body.email);
  const { token, hash } = generateToken();

  db.insert(magicLinks)
    .values({ id: newId('mlk'), email, tokenHash: hash, expiresAt: Date.now() + MAGIC_LINK_TTL_MS, createdAt: Date.now() })
    .run();

  const link = `${env.WEB_URL}/auth/callback?token=${token}`;
  await sendMail({
    to: email,
    subject: 'Sign in to CRA Compliance OS',
    text: `Use this link to sign in (valid for 15 minutes):\n\n${link}\n\nIf you did not request it, you can ignore this email.`,
    html: `<p>Use this link to sign in (valid for 15 minutes):</p><p><a href="${link}">${link}</a></p>`,
  });

  // Always the same response, so the endpoint cannot enumerate accounts.
  return ok(c, { ok: true, message: 'If that email has an account, a sign-in link is on its way.' });
});

const ConsumeSchema = z.object({ token: z.string().min(10) });

authRoutes.post('/magic-link/consume', authRateLimit(), async (c) => {
  const body = await parseBody(c, ConsumeSchema);
  const db = getDb();
  const hash = hashToken(body.token);
  const link = db.select().from(magicLinks).where(eq(magicLinks.tokenHash, hash)).get();

  if (!link || link.consumedAt || link.expiresAt < Date.now()) {
    throw AppError.unauthenticated('That sign-in link is invalid or has expired.');
  }

  let user = db.select().from(users).where(eq(users.emailNormalised, normaliseEmail(link.email))).get();
  if (!user) {
    const userId = newId('usr');
    db.insert(users)
      .values({
        id: userId,
        email: link.email,
        emailNormalised: normaliseEmail(link.email),
        emailVerifiedAt: Date.now(),
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
    createOrganizationForUser({ userId, name: 'My organisation' });
    user = db.select().from(users).where(eq(users.id, userId)).get()!;
  }

  db.update(magicLinks).set({ consumedAt: Date.now() }).where(eq(magicLinks.id, link.id)).run();
  db.update(users).set({ emailVerifiedAt: Date.now() }).where(eq(users.id, user.id)).run();

  const token = issueSession(c, user.id);
  setCookie(c as never, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  return ok(c, { user: { id: user.id, email: user.email, name: user.name } });
});

// ---------------------------------------------------------------------------
// GitHub OAuth
// ---------------------------------------------------------------------------

authRoutes.get('/github', async (c) => {
  if (!env.GITHUB_CLIENT_ID) {
    return c.json(
      { error: { code: 'integration_error', message: 'GitHub OAuth is not configured.', hint: 'Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.' } },
      503,
    );
  }
  const redirectUri = `${env.APP_URL}/api/v1/auth/github/callback`;
  const url =
    `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(env.GITHUB_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('read:user user:email repo')}`;
  return c.redirect(url);
});

authRoutes.get('/github/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) throw AppError.badRequest('Missing OAuth code.');

  const profile = await exchangeOAuthCode(code);
  const db = getDb();

  const existingIdentity = db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, 'github'), eq(identities.providerAccountId, profile.accountId)))
    .get();

  let userId: string;

  if (existingIdentity) {
    userId = existingIdentity.userId;
    db.update(identities)
      .set({ accessTokenEnc: encryptSecret(profile.accessToken), updatedAt: Date.now() })
      .where(eq(identities.id, existingIdentity.id))
      .run();
  } else {
    const auth = c.get('auth');
    if (auth?.user) {
      userId = auth.user.id;
    } else {
      // Fall back to matching on verified email, then create.
      const email = profile.email ? normaliseEmail(profile.email) : null;
      const byEmail = email ? db.select().from(users).where(eq(users.emailNormalised, email)).get() : null;
      if (byEmail) {
        userId = byEmail.id;
      } else {
        userId = newId('usr');
        db.insert(users)
          .values({
            id: userId,
            email: profile.email ?? `${profile.login}@users.noreply.github.com`,
            emailNormalised: normaliseEmail(profile.email ?? `${profile.login}@users.noreply.github.com`),
            name: profile.name ?? profile.login,
            avatarUrl: profile.avatarUrl,
            emailVerifiedAt: profile.email ? Date.now() : null,
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          .run();
        createOrganizationForUser({ userId, name: profile.name ?? profile.login });
      }
    }

    db.insert(identities)
      .values({
        id: newId('idn'),
        userId,
        provider: 'github',
        providerAccountId: profile.accountId,
        providerLogin: profile.login,
        accessTokenEnc: encryptSecret(profile.accessToken),
        profileJson: JSON.stringify({ login: profile.login, avatarUrl: profile.avatarUrl }),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
  }

  const token = issueSession(c, userId);
  setCookie(c as never, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  audit({ actorUserId: userId, action: 'user.github_linked', targetType: 'user', targetId: userId });

  // The UI reads the nonce/state on return and closes the flow.
  return c.redirect(`${env.WEB_URL}/app/onboarding?connected=github`);
});

// ---------------------------------------------------------------------------
// Session introspection
// ---------------------------------------------------------------------------

authRoutes.get('/me', requireAuth, async (c) => {
  const auth = c.get('auth')!;
  const db = getDb();

  const memberships = db
    .select({
      orgId: organizationMembers.orgId,
      role: organizationMembers.role,
      name: organizations.name,
      slug: organizations.slug,
      planKey: organizations.planKey,
      isAgency: organizations.isAgency,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(eq(organizationMembers.userId, auth.user.id))
    .all();

  const user = db.select().from(users).where(eq(users.id, auth.user.id)).get();

  return ok(c, {
    user: {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
      avatarUrl: auth.user.avatarUrl,
      isSystemAdmin: auth.user.isSystemAdmin,
      timezone: user?.timezone ?? 'UTC',
      locale: user?.locale ?? 'en',
    },
    organizations: memberships,
    defaultOrgId: user?.defaultOrgId ?? memberships[0]?.orgId ?? null,
    capabilities: {
      githubApp: Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY),
      githubOauth: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      payments: env.PAYMENT_PROVIDER === 'dodo' && Boolean(env.DODO_API_KEY),
      ai: env.AI_PROVIDER !== 'none',
    },
  });
});

authRoutes.post('/logout-all', requireAuth, async (c) => {
  const auth = c.get('auth')!;
  revokeAllUserSessions(auth.user.id);
  deleteCookie(c as never, SESSION_COOKIE, { path: '/' });
  return ok(c, { ok: true });
});

authRoutes.onError((err, c) => errorResponse(c as AppContext, err));
