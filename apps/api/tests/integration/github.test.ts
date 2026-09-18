import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import app from '../../src/app.js';
import { resetRateLimits } from '../../src/core/rate-limit.js';
import { getDb } from '../../src/db/index.js';
import {
  users,
  organizations,
  repositories,
  integrations,
  jobs,
  scans,
  creditTransactions,
} from '../../src/db/schema.js';
import { grantCredits } from '../../src/modules/billing/ledger.js';
import { newId } from '../../src/core/ids.js';

/**
 * GitHub App webhooks.
 *
 * The webhook is the only unauthenticated write path into the platform, so the
 * signature check is the security boundary. The tests also prove the product
 * behaviour it exists to deliver: a push to a monitored repository starts a
 * real, billed scan, and uninstalling the App revokes access.
 */

const SECRET = 'github-webhook-test-secret';

let orgId = '';
let monitoredRepoId = '';
let quietRepoId = '';

const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

async function send(event: string, payload: unknown, options: { signature?: string | null; body?: string } = {}) {
  const body = options.body ?? JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-GitHub-Event': event,
  };
  if (options.signature !== null) {
    headers['X-Hub-Signature-256'] = options.signature ?? sign(body);
  }
  const res = await app.request('/api/v1/integrations/github/webhook', { method: 'POST', headers, body });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const pushPayload = (fullName: string, ref = 'refs/heads/main') => ({
  ref,
  repository: { full_name: fullName, default_branch: 'main' },
  head_commit: { id: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
});

function makeRepo(owner: string, name: string, monitoring: boolean) {
  const id = newId('repo');
  getDb()
    .insert(repositories)
    .values({
      id,
      orgId,
      provider: 'github',
      providerRepoId: String(Math.floor(Math.random() * 1e9)),
      owner,
      name,
      fullName: `${owner}/${name}`,
      defaultBranch: 'main',
      visibility: 'private',
      monitoringEnabled: monitoring,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}

beforeAll(async () => {
  resetRateLimits();

  const userId = newId('usr');
  getDb()
    .insert(users)
    .values({
      id: userId,
      email: `gh-${Date.now()}@example.com`,
      emailNormalised: `gh-${Date.now()}@example.com`,
      name: 'GH',
      passwordHash: 'x',
      status: 'active',
      isSystemAdmin: false,
      timezone: 'UTC',
      locale: 'en',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  orgId = newId('org');
  getDb()
    .insert(organizations)
    .values({
      id: orgId,
      name: 'gh-org',
      slug: `gh-org-${Date.now()}`,
      planKey: 'free',
      isAgency: false,
      status: 'active',
      createdByUserId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  monitoredRepoId = makeRepo('acme', 'monitored-api', true);
  quietRepoId = makeRepo('acme', 'quiet-web', false);
});

beforeEach(() => {
  resetRateLimits();
  getDb().delete(jobs).run();
  getDb().delete(scans).run();
  // Every push-triggered scan must be paid for.
  grantCredits({ orgId, amount: 500, type: 'grant', description: 'test top-up' });
});

describe('webhook signature verification', () => {
  it('rejects a push with no signature', async () => {
    const res = await send('push', pushPayload('acme/monitored-api'), { signature: null });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const payload = JSON.stringify(pushPayload('acme/monitored-api'));
    const res = await send('push', pushPayload('acme/monitored-api'), {
      body: payload,
      signature: sign(payload, 'the-wrong-secret'),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a valid signature for a different body', async () => {
    const original = JSON.stringify(pushPayload('acme/monitored-api'));
    const tampered = JSON.stringify(pushPayload('acme/monitored-api', 'refs/heads/evil'));
    const res = await send('push', pushPayload('acme/monitored-api'), {
      body: tampered,
      signature: sign(original),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed JSON body', async () => {
    const body = '{ not json';
    const res = await send('push', {}, { body, signature: sign(body) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('push triggers real work', () => {
  it('starts a billed scan for a monitored repository', async () => {
    const res = await send('push', pushPayload('acme/monitored-api'));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const scanRows = getDb().select().from(scans).where(eq(scans.repositoryId, monitoredRepoId)).all();
    expect(scanRows).toHaveLength(1);
    expect(scanRows[0]!.trigger).toBe('push');
    expect(scanRows[0]!.ref).toBe('main');
    expect(scanRows[0]!.status).toBe('queued');

    const jobRows = getDb().select().from(jobs).where(eq(jobs.type, 'scan.repository')).all();
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]!.status).toBe('pending');
  });

  it('reserves credits for the scan', async () => {
    const before = getDb()
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.orgId, orgId))
      .all()
      .reduce((sum, t) => sum + t.amount, 0);

    await send('push', pushPayload('acme/monitored-api'));

    const after = getDb()
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.orgId, orgId))
      .all()
      .reduce((sum, t) => sum + t.amount, 0);

    expect(after).toBeLessThan(before);
  });

  it('ignores a push to a repository without monitoring enabled', async () => {
    const res = await send('push', pushPayload('acme/quiet-web'));
    expect(res.status).toBe(200);

    expect(getDb().select().from(scans).where(eq(scans.repositoryId, quietRepoId)).all()).toHaveLength(0);
    expect(getDb().select().from(jobs).all()).toHaveLength(0);
  });

  it('ignores a push to a repository we do not track', async () => {
    const res = await send('push', pushPayload('someone/else'));
    expect(res.status).toBe(200);
    expect(getDb().select().from(jobs).all()).toHaveLength(0);
  });

  it('does not start a second scan while one is already queued', async () => {
    await send('push', pushPayload('acme/monitored-api'));
    await send('push', pushPayload('acme/monitored-api'));

    expect(getDb().select().from(jobs).where(eq(jobs.type, 'scan.repository')).all()).toHaveLength(1);
  });
});

describe('installation lifecycle', () => {
  it('revokes the integration when the App is uninstalled', async () => {
    const installationId = '98765432';
    getDb()
      .insert(integrations)
      .values({
        id: newId('int'),
        orgId,
        provider: 'github',
        installationId,
        accountLogin: 'acme',
        accountType: 'Organization',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    const res = await send('installation', {
      action: 'deleted',
      installation: { id: Number(installationId) },
    });
    expect(res.status).toBe(200);

    const row = getDb()
      .select()
      .from(integrations)
      .where(and(eq(integrations.orgId, orgId), eq(integrations.installationId, installationId)))
      .get();
    expect(row?.status).toBe('revoked');
    expect(row?.revokedAt).not.toBeNull();
  });

  it('leaves other events alone but still acknowledges them', async () => {
    const res = await send('star', { action: 'created' });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(getDb().select().from(jobs).all()).toHaveLength(0);
  });
});
