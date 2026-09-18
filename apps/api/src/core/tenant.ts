import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { organizationMembers, organizations } from '../db/schema.js';
import { AppError } from './errors.js';

/**
 * Tenancy helpers.
 *
 * Every tenant-scoped query in the codebase goes through `orgScope` / these
 * guards so that "forgot the orgId predicate" fails loudly in tests rather than
 * silently leaking data. See `tests/unit/tenant-isolation.test.ts`.
 */

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function assertRole(actual: Role | undefined, required: Role): void {
  if (!actual || !hasRole(actual, required)) {
    throw AppError.forbidden(`This action requires the "${required}" role or higher.`);
  }
}

/** Writable roles are restricted: viewers never mutate. */
export const canWrite = (role: Role): boolean => hasRole(role, 'member');
export const canManageBilling = (role: Role): boolean => hasRole(role, 'admin');
export const canManageMembers = (role: Role): boolean => hasRole(role, 'admin');

export function membershipFor(orgId: string, userId: string): Role | null {
  const row = getDb()
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)))
    .get();
  return (row?.role as Role | undefined) ?? null;
}

export function requireMembership(orgId: string, userId: string): Role {
  const role = membershipFor(orgId, userId);
  if (!role) throw AppError.forbidden('You are not a member of this organization.');
  return role;
}

/** Rows that belong to an org, excluding soft-deleted ones. */
export function notDeleted<T>(column: T) {
  return isNull(column as never);
}

/** An org is visible if the user is a member, or it is a child of their agency. */
export function visibleOrgIds(userId: string): string[] {
  const db = getDb();
  const mine = db
    .select({ id: organizationMembers.orgId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .all()
    .map((r) => r.id);

  if (mine.length === 0) return [];

  const managed = db
    .select({ id: organizations.id })
    .from(organizations)
    .where(or(...mine.map((id) => eq(organizations.parentOrgId, id))))
    .all()
    .map((r) => r.id);

  return Array.from(new Set([...mine, ...managed]));
}
