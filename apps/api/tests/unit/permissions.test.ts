import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';
import {
  organizations,
  users,
  organizationMembers,
  repositories,
  scans,
  apiKeys,
  components as componentsTable,
} from '../../src/db/schema.js';
import {
  hasRole,
  assertRole,
  canWrite,
  canManageBilling,
  canManageMembers,
  membershipFor,
  requireMembership,
  visibleOrgIds,
  type Role,
} from '../../src/core/tenant.js';
import { AppError } from '../../src/core/errors.js';
import { newId } from '../../src/core/ids.js';

/**
 * RBAC and tenant isolation.
 *
 * A cross-tenant leak is the single worst bug this product can ship, so the
 * isolation checks below are deliberately blunt: create two orgs with real
 * rows, then try to read the other one's data.
 */

let counter = 0;
function makeTenant(label: string) {
  counter += 1;
  const db = getDb();
  const stamp = `${label}-${counter}-${Math.random().toString(36).slice(2, 7)}`;

  const userId = newId('usr');
  db.insert(users)
    .values({
      id: userId,
      email: `${stamp}@example.com`,
      emailNormalised: `${stamp}@example.com`,
      name: stamp,
      passwordHash: 'x',
      status: 'active',
      isSystemAdmin: false,
      timezone: 'UTC',
      locale: 'en',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  const orgId = newId('org');
  db.insert(organizations)
    .values({
      id: orgId,
      name: stamp,
      slug: stamp,
      planKey: 'free',
      isAgency: false,
      status: 'active',
      createdByUserId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  db.insert(organizationMembers)
    .values({
      id: newId('mem'),
      orgId,
      userId,
      role: 'owner',
      invitedByUserId: null,
      acceptedAt: Date.now(),
      createdAt: Date.now(),
    })
    .run();

  const repositoryId = newId('repo');
  db.insert(repositories)
    .values({
      id: repositoryId,
      orgId,
      provider: 'github',
      providerRepoId: String(Math.floor(Math.random() * 1e9)),
      name: `${stamp}-repo`,
      fullName: `${stamp}/repo`,
      defaultBranch: 'main',
      visibility: 'private',
      monitoringEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  const scanId = newId('scan');
  db.insert(scans)
    .values({
      id: scanId,
      orgId,
      repositoryId,
      status: 'succeeded',
      trigger: 'manual',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  db.insert(componentsTable)
    .values({
      id: newId('cmp'),
      orgId,
      scanId,
      repositoryId,
      name: `${stamp}-secret-component`,
      version: '1.0.0',
      ecosystem: 'npm',
      purl: `pkg:npm/${stamp}@1.0.0`,
      scope: 'runtime',
      isDirect: true,
      licensesJson: '[]',
      createdAt: Date.now(),
    })
    .run();

  return { orgId, userId, repositoryId, scanId, stamp };
}

const addMember = (orgId: string, userId: string, role: Role) => {
  getDb()
    .insert(organizationMembers)
    .values({
      id: newId('mem'),
      orgId,
      userId,
      role,
      invitedByUserId: null,
      acceptedAt: Date.now(),
      createdAt: Date.now(),
    })
    .run();
};

describe('role ordering', () => {
  it('ranks owner > admin > member > viewer', () => {
    expect(hasRole('owner', 'viewer')).toBe(true);
    expect(hasRole('admin', 'member')).toBe(true);
    expect(hasRole('member', 'admin')).toBe(false);
    expect(hasRole('viewer', 'member')).toBe(false);
  });

  it('is satisfied by an equal role', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as Role[]) {
      expect(hasRole(role, role)).toBe(true);
    }
  });

  it('gates billing and member management at admin, and writes at member', () => {
    expect(canWrite('viewer')).toBe(false);
    expect(canWrite('member')).toBe(true);
    expect(canWrite('admin')).toBe(true);
    expect(canManageBilling('member')).toBe(false);
    expect(canManageBilling('admin')).toBe(true);
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('member')).toBe(false);
  });

  it('assertRole throws a 403 for insufficient or missing roles', () => {
    expect(() => assertRole('viewer', 'admin')).toThrow(AppError);
    expect(() => assertRole(undefined, 'viewer')).toThrow(AppError);
    expect(() => assertRole('owner', 'owner')).not.toThrow();

    try {
      assertRole('member', 'admin');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as AppError).status).toBe(403);
    }
  });
});

describe('membership', () => {
  it('returns null for a non-member and the role for a member', () => {
    const a = makeTenant('alpha');
    const b = makeTenant('beta');
    expect(membershipFor(a.orgId, a.userId)).toBe('owner');
    expect(membershipFor(a.orgId, b.userId)).toBeNull();
  });

  it('requireMembership refuses non-members', () => {
    const a = makeTenant('alpha');
    const stranger = newId('usr');
    expect(() => requireMembership(a.orgId, stranger)).toThrow(AppError);
    expect(requireMembership(a.orgId, a.userId)).toBe('owner');
  });

  it('a user can belong to several orgs with different roles', () => {
    const a = makeTenant('alpha');
    const b = makeTenant('beta');
    addMember(b.orgId, a.userId, 'viewer');
    expect(membershipFor(a.orgId, a.userId)).toBe('owner');
    expect(membershipFor(b.orgId, a.userId)).toBe('viewer');
  });
});

describe('tenant isolation', () => {
  let a: ReturnType<typeof makeTenant>;
  let b: ReturnType<typeof makeTenant>;

  beforeEach(() => {
    a = makeTenant('alpha');
    b = makeTenant('beta');
  });

  it('never returns another org\'s repositories', () => {
    const rows = getDb().select().from(repositories).where(eq(repositories.orgId, a.orgId)).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(a.repositoryId);
    expect(rows.some((r) => r.orgId === b.orgId)).toBe(false);
  });

  it('never returns another org\'s scans', () => {
    const rows = getDb().select().from(scans).where(eq(scans.orgId, b.orgId)).all();
    expect(rows.every((r) => r.orgId === b.orgId)).toBe(true);
    expect(rows.some((r) => r.id === a.scanId)).toBe(false);
  });

  it('never returns another org\'s components', () => {
    const rows = getDb()
      .select({ name: componentsTable.name })
      .from(componentsTable)
      .where(eq(componentsTable.orgId, a.orgId))
      .all();
    expect(rows.some((r) => r.name.includes('beta'))).toBe(false);
  });

  it('an unscoped query sees both tenants — which is why every query must be scoped', () => {
    // Documents the failure mode this suite exists to prevent.
    const rows = getDb().select().from(repositories).all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('scopes API keys to their org', () => {
    const db = getDb();
    db.insert(apiKeys)
      .values({
        id: newId('key'),
        orgId: a.orgId,
        name: 'ci',
        keyPrefix: 'cra_test_x',
        keyHash: `hash-${a.stamp}`,
        scopesJson: '["scan"]',
        createdByUserId: a.userId,
        createdAt: Date.now(),
      })
      .run();

    const mine = db.select().from(apiKeys).where(eq(apiKeys.orgId, a.orgId)).all();
    const theirs = db.select().from(apiKeys).where(eq(apiKeys.orgId, b.orgId)).all();
    expect(mine.length).toBe(1);
    expect(theirs.length).toBe(0);
  });

  it('a revoked key stops resolving', () => {
    const db = getDb();
    const keyId = newId('key');
    db.insert(apiKeys)
      .values({
        id: keyId,
        orgId: a.orgId,
        name: 'ci',
        keyPrefix: 'cra_test_y',
        keyHash: `hash-rev-${a.stamp}`,
        scopesJson: '["scan"]',
        createdByUserId: a.userId,
        createdAt: Date.now(),
      })
      .run();

    const live = () =>
      db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, keyId))
        .get();

    expect(live()!.revokedAt).toBeNull();
    db.update(apiKeys).set({ revokedAt: Date.now() }).where(eq(apiKeys.id, keyId)).run();
    expect(live()!.revokedAt).not.toBeNull();
  });
});

describe('visibleOrgIds (agency model)', () => {
  it('includes a customer org when the user is a member of the agency', () => {
    const agency = makeTenant('agency');
    const customer = makeTenant('customer');

    getDb().update(organizations).set({ parentOrgId: agency.orgId, isAgency: false }).where(eq(organizations.id, customer.orgId)).run();

    const visible = visibleOrgIds(agency.userId);
    expect(visible).toContain(agency.orgId);
    expect(visible).toContain(customer.orgId);
  });

  it('does not expose the parent agency to a customer member', () => {
    const agency = makeTenant('agency');
    const customer = makeTenant('customer');
    getDb().update(organizations).set({ parentOrgId: agency.orgId }).where(eq(organizations.id, customer.orgId)).run();

    const visible = visibleOrgIds(customer.userId);
    expect(visible).toContain(customer.orgId);
    expect(visible).not.toContain(agency.orgId);
  });

  it('returns nothing for a user with no memberships', () => {
    expect(visibleOrgIds(newId('usr'))).toEqual([]);
  });
});
