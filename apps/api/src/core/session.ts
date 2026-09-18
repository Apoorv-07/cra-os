import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { env } from '../env.js';
import { generateToken, hashToken } from './crypto.js';
import { newId } from './ids.js';
import type { SessionUser } from './context.js';
import type { CookieOptions } from 'hono/utils/cookie';

export const SESSION_COOKIE = 'cra_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

function cookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
    // Needed so the app works on both localhost and the proxied preview host.
    domain: undefined,
  };
}

export function issueSession(c: { req: { header: (n: string) => string | undefined } }, userId: string): string {
  const { token, hash } = generateToken();
  const now = Date.now();
  getDb()
    .insert(sessions)
    .values({
      id: newId('ses'),
      userId,
      tokenHash: hash,
      ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: c.req.header('user-agent') ?? null,
      expiresAt: now + SESSION_TTL_MS,
      lastUsedAt: now,
      createdAt: now,
    })
    .run();
  return token;
}

export function setSessionCookie(c: { req: { header: (n: string) => string | undefined } } & Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c as never, SESSION_COOKIE, token, cookieOptions(SESSION_TTL_MS / 1000));
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c as never, SESSION_COOKIE, { path: '/' });
}

export function readSessionToken(c: { req: { raw: Request } }): string | undefined {
  return getCookie(c as never, SESSION_COOKIE);
}

/** Resolves a session token to a user. Returns null when absent/expired/revoked. */
export function userFromSessionToken(token: string | undefined): { user: SessionUser; sessionId: string } | null {
  if (!token) return null;
  const hash = hashToken(token);
  const db = getDb();
  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      isSystemAdmin: users.isSystemAdmin,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, Date.now()),
      ),
    )
    .get();

  if (!row) return null;
  if (row.status !== 'active' || row.deletedAt) return null;

  // Sliding expiry: touch at most once an hour to avoid a write per request.
  if (Date.now() - (row.expiresAt - SESSION_TTL_MS) > 60 * 60 * 1000) {
    db.update(sessions)
      .set({ lastUsedAt: Date.now() })
      .where(eq(sessions.id, row.sessionId))
      .run();
  }

  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatarUrl,
      isSystemAdmin: Boolean(row.isSystemAdmin),
    },
  };
}

export function revokeSession(sessionId: string): void {
  getDb().update(sessions).set({ revokedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
}

export function revokeAllUserSessions(userId: string): void {
  getDb()
    .update(sessions)
    .set({ revokedAt: Date.now() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .run();
}
