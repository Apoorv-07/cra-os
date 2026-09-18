import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  sign as cryptoSign,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../env.js';
import { newToken } from './ids.js';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;

/** Key derived from ENCRYPTION_KEY. Cached because derivation is expensive. */
let cachedKey: Buffer | null = null;
function appKey(): Buffer {
  if (!cachedKey) {
    cachedKey = createHash('sha256').update(env.ENCRYPTION_KEY).digest();
  }
  return cachedKey;
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Bytes(input: Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}

/** Opaque secret + its hash. Only the hash is ever persisted. */
export function generateToken(): { token: string; hash: string } {
  const token = newToken();
  return { token, hash: sha256(token) };
}

export function hashToken(token: string): string {
  return sha256(token);
}

/**
 * URL-safe capability token for share links.
 *
 * Unlike `generateToken`, the value is stored verbatim: a share link *is* the
 * credential, and hashing it would make the link impossible to re-show to the
 * user who created it. 24 bytes ≈ 180 bits of entropy, which is far beyond
 * guessable, and the row can be revoked at any time.
 */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Symmetric encryption (AES-256-GCM) for OAuth tokens and webhook secrets
// ---------------------------------------------------------------------------

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', appKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', appKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

// ---------------------------------------------------------------------------
// HMAC signatures
// ---------------------------------------------------------------------------

export function hmacSha256(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

/**
 * Verifies a Standard Webhooks style signature header.
 * Used for Dodo Payments: `webhook-id`, `webhook-timestamp`, `webhook-signature`.
 * Returns true only if a signature matches AND the timestamp is within tolerance.
 */
export function verifyStandardWebhook(opts: {
  secret: string;
  id: string;
  timestamp: string;
  signaturesHeader: string;
  payload: string;
  toleranceSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signaturesHeader, payload, toleranceSeconds = 300 } = opts;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

  // Secret may be prefixed with `whsec_`; the raw key is the base64 body.
  const rawSecret = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64').toString('utf8')
    : secret;

  const signedContent = `${id}.${timestamp}.${payload}`;

  // The Standard Webhooks spec signs with the *decoded* secret bytes and emits
  // base64; some implementations hex-encode instead, so we accept both.
  const expectedB64 = createHmac('sha256', Buffer.from(rawSecret, 'base64'))
    .update(signedContent)
    .digest('base64');
  const expectedHex = hmacSha256(rawSecret, signedContent);

  const candidates = signaturesHeader
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes(',') ? s.split(',')[1] : s))
    .filter((s): s is string => Boolean(s))
    .map((s) => (s.startsWith('v1=') ? s.slice(3) : s));

  return candidates.some((c) => safeEqual(c, expectedB64) || safeEqual(c, expectedHex));
}

// ---------------------------------------------------------------------------
// GitHub App JWT (RS256)
// ---------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Creates a short-lived GitHub App JWT used to mint installation tokens. */
export function createGitHubAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const body = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  // Accept a PEM with literal "\n" escapes, which is how it lands in .env files.
  const key = privateKeyPem.includes('\\n') ? privateKeyPem.replace(/\\n/g, '\n') : privateKeyPem;
  const sig = cryptoSign('RSA-SHA256', Buffer.from(body), key);
  return `${body}.${base64url(sig)}`;
}
