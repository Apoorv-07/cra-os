import { Hono } from 'hono';
import type { AppEnv } from '../core/context.js';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { apiKeys, invites, organizations, organizationMembers, projects, users } from '../db/schema.js';
import { newId, newReferralCode, slugify } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import {generateToken, hashToken} from '../core/crypto.js';
import { audit } from '../core/audit.js';
import {ok, created, parseBody, errorResponse} from '../core/http.js';
import { requireAuth, requireOrg } from '../core/auth.js';
import {canManageMembers, type Role} from '../core/tenant.js';
import { sendMail } from '../core/mail.js';
import { env } from '../env.js';
import { createOrganizationForUser } from './auth.js';
import { getBalance, ledgerHistory } from '../modules/billing/ledger.js';
import type { AppContext } from '../core/context.js';

export const orgRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

orgRoutes.post('/', requireAuth, async (c) => {
  const body = await parseBody(
    c,
    z.object({
      name: z.string().min(1).max(120),
      isAgency: z.boolean().optional(),
      billingEmail: z.string().email().optional(),
      country: z.string().max(2).optional(),
    }),
  );

  const auth = c.get('auth')!;
  const orgId = createOrganizationForUser({
    userId: auth.user.id,
    name: body.name,
    isAgency: body.isAgency,
  });

  if (body.billingEmail || body.country) {
    getDb()
      .update(organizations)
      .set({ billingEmail: body.billingEmail ?? null, country: body.country ?? null, updatedAt: Date.now() })
      .where(eq(organizations.id, orgId))
      .run();
  }

  return created(c, { id: orgId, name: body.name });
});

orgRoutes.get('/', requireAuth, async (c) => {
  const auth = c.get('auth')!;
  const rows = getDb()
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      planKey: organizations.planKey,
      isAgency: organizations.isAgency,
      role: organizationMembers.role,
      createdAt: organizations.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(eq(organizationMembers.userId, auth.user.id))
    .all();

  return ok(c, rows);
});

orgRoutes.get('/:orgId', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) throw AppError.notFound('Organization');

  const memberCount = getDb()
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.orgId, orgId))
    .all().length;

  return ok(c, { ...org, memberCount, balance: getBalance(orgId) });
});

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  billingEmail: z.string().email().optional(),
  country: z.string().max(2).optional(),
  vatId: z.string().max(40).optional(),
  companyLegalName: z.string().max(200).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  autoTopupEnabled: z.boolean().optional(),
  autoTopupThresholdCredits: z.number().int().min(0).optional(),
  autoTopupPackKey: z.string().max(40).optional(),
  currency: z.enum(['USD', 'EUR', 'GBP']).optional(),
});

orgRoutes.patch('/:orgId', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const body = await parseBody(c, UpdateOrgSchema);
  getDb()
    .update(organizations)
    .set({
      ...(body.name ? { name: body.name, slug: slugify(body.name) } : {}),
      ...(body.billingEmail !== undefined ? { billingEmail: body.billingEmail } : {}),
      ...(body.country !== undefined ? { country: body.country } : {}),
      ...(body.vatId !== undefined ? { vatId: body.vatId } : {}),
      ...(body.companyLegalName !== undefined ? { companyLegalName: body.companyLegalName } : {}),
      ...(body.retentionDays !== undefined ? { retentionDays: body.retentionDays } : {}),
      ...(body.autoTopupEnabled !== undefined ? { autoTopupEnabled: body.autoTopupEnabled } : {}),
      ...(body.autoTopupThresholdCredits !== undefined ? { autoTopupThresholdCredits: body.autoTopupThresholdCredits } : {}),
      ...(body.autoTopupPackKey !== undefined ? { autoTopupPackKey: body.autoTopupPackKey } : {}),
      ...(body.currency ? { currency: body.currency } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(organizations.id, orgId))
    .run();

  audit({ orgId, action: 'org.updated', targetType: 'organization', targetId: orgId, meta: body, actorUserId: c.get('auth')!.user.id });
  return ok(c, { id: orgId, updated: true });
});

// ---------------------------------------------------------------------------
// Members & invites
// ---------------------------------------------------------------------------

orgRoutes.get('/:orgId/members', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  const rows = getDb()
    .select({
      id: organizationMembers.id,
      role: organizationMembers.role,
      createdAt: organizationMembers.createdAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.orgId, orgId))
    .all();
  return ok(c, rows);
});

orgRoutes.post('/:orgId/members/invite', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const auth = c.get('auth')!;
  if (!canManageMembers(auth.role as Role)) throw AppError.forbidden();

  const body = await parseBody(c, z.object({ email: z.string().email(), role: z.enum(['admin', 'member', 'viewer']) }));
  const { token, hash } = generateToken();

  getDb()
    .insert(invites)
    .values({
      id: newId('inv'),
      orgId,
      email: body.email.toLowerCase(),
      role: body.role,
      tokenHash: hash,
      invitedByUserId: auth.user.id,
      expiresAt: Date.now() + 7 * 86_400_000,
      createdAt: Date.now(),
    })
    .run();

  const link = `${env.WEB_URL}/invite/${token}`;
  await sendMail({
    to: body.email,
    subject: `You've been invited to a CRA Compliance OS workspace`,
    text: `You were invited to join a workspace. Accept here: ${link}`,
    html: `<p>You were invited to join a CRA Compliance OS workspace.</p><p><a href="${link}">Accept the invitation</a></p>`,
  });

  audit({ orgId, action: 'member.invited', targetType: 'invite', meta: { email: body.email, role: body.role }, actorUserId: auth.user.id });
  return created(c, { invited: true });
});

orgRoutes.post('/:orgId/members/accept', requireAuth, async (c) => {
  const orgId = c.req.param('orgId');
  const body = await parseBody(c, z.object({ token: z.string().min(10) }));
  const auth = c.get('auth')!;
  const db = getDb();

  const invite = db.select().from(invites).where(eq(invites.tokenHash, hashToken(body.token))).get();
  if (!invite || invite.orgId !== orgId) throw AppError.notFound('Invitation');
  if (invite.acceptedAt || invite.revokedAt || invite.expiresAt < Date.now()) {
    throw AppError.conflict('That invitation is no longer valid.');
  }

  const existing = db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, auth.user.id)))
    .get();
  if (!existing) {
    db.insert(organizationMembers)
      .values({
        id: newId('mem'),
        orgId,
        userId: auth.user.id,
        role: invite.role,
        invitedByUserId: invite.invitedByUserId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
  }

  db.update(invites).set({ acceptedAt: Date.now() }).where(eq(invites.id, invite.id)).run();
  audit({ orgId, action: 'member.joined', targetType: 'organization', targetId: orgId, actorUserId: auth.user.id });

  return ok(c, { orgId, role: invite.role });
});

orgRoutes.patch('/:orgId/members/:memberId', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const auth = c.get('auth')!;
  if (!canManageMembers(auth.role as Role)) throw AppError.forbidden();

  const memberId = c.req.param('memberId');
  const body = await parseBody(c, z.object({ role: z.enum(['owner', 'admin', 'member', 'viewer']) }));

  const member = getDb().select().from(organizationMembers).where(eq(organizationMembers.id, memberId)).get();
  if (!member || member.orgId !== orgId) throw AppError.notFound('Member');

  // Prevent removing the last owner.
  if (member.role === 'owner' && body.role !== 'owner') {
    const owners = getDb()
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, 'owner')))
      .all();
    if (owners.length <= 1) throw AppError.conflict('An organization must keep at least one owner.');
  }

  getDb().update(organizationMembers).set({ role: body.role, updatedAt: Date.now() }).where(eq(organizationMembers.id, memberId)).run();
  audit({ orgId, action: 'member.role_changed', targetType: 'member', targetId: memberId, meta: { role: body.role }, actorUserId: auth.user.id });
  return ok(c, { id: memberId, role: body.role });
});

orgRoutes.delete('/:orgId/members/:memberId', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const auth = c.get('auth')!;
  if (!canManageMembers(auth.role as Role)) throw AppError.forbidden();

  const memberId = c.req.param('memberId');
  const member = getDb().select().from(organizationMembers).where(eq(organizationMembers.id, memberId)).get();
  if (!member || member.orgId !== orgId) throw AppError.notFound('Member');
  if (member.role === 'owner') throw AppError.conflict('Transfer ownership before removing an owner.');

  getDb().delete(organizationMembers).where(eq(organizationMembers.id, memberId)).run();
  audit({ orgId, action: 'member.removed', targetType: 'member', targetId: memberId, actorUserId: auth.user.id });
  return ok(c, { removed: true });
});

// ---------------------------------------------------------------------------
// Projects (products placed on the EU market)
// ---------------------------------------------------------------------------

orgRoutes.get('/:orgId/projects', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  return ok(c, getDb().select().from(projects).where(eq(projects.orgId, orgId)).all());
});

orgRoutes.post('/:orgId/projects', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const body = await parseBody(
    c,
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(2000).optional(),
      productName: z.string().max(200).optional(),
      productVersion: z.string().max(60).optional(),
      supportPeriodMonths: z.number().int().min(1).max(360).optional(),
    }),
  );

  const id = newId('prj');
  getDb()
    .insert(projects)
    .values({
      id,
      orgId,
      name: body.name,
      slug: slugify(body.name),
      description: body.description ?? null,
      productName: body.productName ?? null,
      productVersion: body.productVersion ?? null,
      supportPeriodMonths: body.supportPeriodMonths ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  return created(c, { id, name: body.name });
});

orgRoutes.patch('/:orgId/projects/:projectId', requireAuth, requireOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const projectId = c.req.param('projectId');
  const body = await parseBody(
    c,
    z.object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(2000).optional(),
      productName: z.string().max(200).optional(),
      productVersion: z.string().max(60).optional(),
      supportPeriodMonths: z.number().int().min(1).max(360).optional(),
    }),
  );

  const project = getDb().select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project || project.orgId !== orgId) throw AppError.notFound('Project');

  getDb().update(projects).set({ ...body, updatedAt: Date.now() }).where(eq(projects.id, projectId)).run();
  return ok(c, { id: projectId, updated: true });
});

orgRoutes.delete('/:orgId/projects/:projectId', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const projectId = c.req.param('projectId');
  const project = getDb().select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project || project.orgId !== orgId) throw AppError.notFound('Project');
  getDb().update(projects).set({ deletedAt: Date.now(), updatedAt: Date.now() }).where(eq(projects.id, projectId)).run();
  return ok(c, { deleted: true });
});

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

orgRoutes.get('/:orgId/api-keys', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const rows = getDb().select().from(apiKeys).where(eq(apiKeys.orgId, orgId)).all();
  return ok(
    c,
    rows.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: JSON.parse(k.scopesJson),
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    })),
  );
});

orgRoutes.post('/:orgId/api-keys', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const auth = c.get('auth')!;
  const body = await parseBody(
    c,
    z.object({
      name: z.string().min(1).max(80),
      scopes: z.array(z.string()).default(['scans:read', 'scans:write', 'sbom:read']),
      expiresInDays: z.number().int().min(1).max(3650).optional(),
    }),
  );

  const secret = newReferralCode() + newReferralCode() + newReferralCode() + newReferralCode();
  const prefix = `cra_${env.NODE_ENV === 'production' ? 'live' : 'test'}`;
  const fullKey = `${prefix}_${secret}`;
  const id = newId('key');

  getDb()
    .insert(apiKeys)
    .values({
      id,
      orgId,
      name: body.name,
      keyPrefix: prefix,
      keyHash: hashToken(fullKey),
      scopesJson: JSON.stringify(body.scopes),
      expiresAt: body.expiresInDays ? Date.now() + body.expiresInDays * 86_400_000 : null,
      createdByUserId: auth.user.id,
      createdAt: Date.now(),
    })
    .run();

  audit({ orgId, action: 'api_key.created', targetType: 'api_key', targetId: id, actorUserId: auth.user.id });

  // The full key is returned exactly once and never stored in plaintext.
  return created(c, { id, name: body.name, key: fullKey, prefix });
});

orgRoutes.delete('/:orgId/api-keys/:keyId', requireAuth, requireOrg('admin'), async (c) => {
  const orgId = c.get('orgId')!;
  const keyId = c.req.param('keyId');
  const key = getDb().select().from(apiKeys).where(eq(apiKeys.id, keyId)).get();
  if (!key || key.orgId !== orgId) throw AppError.notFound('API key');

  getDb().update(apiKeys).set({ revokedAt: Date.now() }).where(eq(apiKeys.id, keyId)).run();
  audit({ orgId, action: 'api_key.revoked', targetType: 'api_key', targetId: keyId, actorUserId: c.get('auth')!.user.id });
  return ok(c, { revoked: true });
});

orgRoutes.get('/:orgId/credits', requireAuth, requireOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;
  return ok(c, { balance: getBalance(orgId), history: ledgerHistory(orgId, 50) });
});

orgRoutes.onError((err, c) => errorResponse(c as AppContext, err));
