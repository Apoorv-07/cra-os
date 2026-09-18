import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Copy,
  Key,
  Link2,
  Trash2,
  Users,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useRepositories } from '../lib/queries';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CopyButton,
  GitHubMark as GithubIcon,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '../components/ui';
import { PageHeader } from '../components/layout';
import { formatDate, initials } from '../lib/format';

interface Member {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  createdAt: number;
}

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

function MembersCard() {
  const { orgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member');

  const { data: members, isLoading } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => api.get<Member[]>(`/organizations/${orgId}/members`),
    enabled: Boolean(orgId),
  });

  const invite = useMutation({
    mutationFn: () => api.post(`/organizations/${orgId}/members`, { email: email.trim(), role }),
    onSuccess: () => {
      toast.success('Invitation created');
      setInviteOpen(false);
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['members', orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not invite'),
  });

  const setRoleMutation = useMutation({
    mutationFn: ({ userId, role: next }: { userId: string; role: string }) =>
      api.patch(`/organizations/${orgId}/members/${userId}`, { role: next }),
    onSuccess: () => {
      toast.success('Role updated');
      void qc.invalidateQueries({ queryKey: ['members', orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not change role'),
  });

  return (
    <Card>
      <CardHeader
        title="Members"
        subtitle="Roles are enforced server-side on every request"
        action={
          <Button size="sm" variant="primary" onClick={() => setInviteOpen(true)}>
            Invite
          </Button>
        }
      />
      {isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Joined</Th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((member) => (
              <Tr key={member.id}>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full border border-border bg-surface-2 text-[10px] font-semibold text-muted">
                      {initials(member.name, member.email)}
                    </span>
                    <div>
                      <p className="text-xs text-text">{member.name ?? member.email}</p>
                      <p className="text-[11px] text-faint">{member.email}</p>
                    </div>
                  </div>
                </Td>
                <Td>
                  <Select
                    value={member.role}
                    className="h-7 w-28 text-xs"
                    disabled={member.role === 'owner'}
                    onChange={(e) => setRoleMutation.mutate({ userId: member.userId, role: e.target.value })}
                  >
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                </Td>
                <Td className="text-xs text-muted">{formatDate(member.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a team member"
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={invite.isPending} disabled={!email.includes('@')} onClick={() => invite.mutate()}>
              Send invitation
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />
          </Field>
          <Field label="Role" hint="Owners manage billing; viewers can read everything but change nothing.">
            <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

function ApiKeysCard() {
  const { orgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('CI pipeline');
  const [scope, setScope] = useState('read');
  const [created, setCreated] = useState<string | null>(null);

  const { data: keys, isLoading } = useQuery({
    queryKey: ['api-keys', orgId],
    queryFn: () => api.get<ApiKeyRow[]>(`/organizations/${orgId}/api-keys`),
    enabled: Boolean(orgId),
  });

  const create = useMutation({
    mutationFn: () => api.post<{ key: string }>(`/organizations/${orgId}/api-keys`, { name, scopes: [scope] }),
    onSuccess: (result) => {
      setCreated(result.key);
      void qc.invalidateQueries({ queryKey: ['api-keys', orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not create key'),
  });

  const revoke = useMutation({
    mutationFn: (keyId: string) => api.del(`/organizations/${orgId}/api-keys/${keyId}`),
    onSuccess: () => {
      toast.success('Key revoked — it stops working immediately');
      void qc.invalidateQueries({ queryKey: ['api-keys', orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not revoke'),
  });

  return (
    <Card>
      <CardHeader
        title="API keys"
        subtitle="Scoped, revocable, and shown in full exactly once"
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)} icon={<Key size={13} />}>
            Create key
          </Button>
        }
      />
      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-10" />
        </div>
      ) : keys && keys.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Prefix</Th>
              <Th>Scopes</Th>
              <Th>Last used</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <Tr key={key.id}>
                <Td className="text-xs text-text">{key.name}</Td>
                <Td className="mono text-xs text-muted">{key.prefix}…</Td>
                <Td>
                  <div className="flex gap-1">
                    {key.scopes.map((s) => (
                      <Badge key={s}>{s}</Badge>
                    ))}
                  </div>
                </Td>
                <Td className="text-xs text-muted">{key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(key.id)} icon={<Trash2 size={12} />}>
                    Revoke
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          icon={<Key size={20} />}
          title="No API keys"
          description="Create a key to drive scans and reports from CI or your own tooling."
          action={
            <Button onClick={() => setCreateOpen(true)} icon={<Key size={13} />}>
              Create key
            </Button>
          }
        />
      )}

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreated(null);
        }}
        title={created ? 'Copy your key now' : 'Create an API key'}
        footer={
          created ? (
            <Button
              variant="primary"
              onClick={() => {
                setCreateOpen(false);
                setCreated(null);
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                Create
              </Button>
            </>
          )
        }
      >
        {created ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              This is the only time the key is shown. Store it in your secret manager.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2.5">
              <code className="mono flex-1 break-all text-xs text-text">{created}</code>
              <CopyButton value={created} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Scope">
              <Select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="read">read — fetch scans, SBOMs and readiness</option>
                <option value="scan">scan — start scans</option>
                <option value="admin">admin — full organisation access</option>
              </Select>
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function IntegrationsCard() {
  const { orgId, capabilities } = useAuth();
  const { data: repos } = useRepositories(orgId);
  const connected = (repos ?? []).some((r) => r.provider === 'github');

  return (
    <Card>
      <CardHeader title="Integrations" subtitle="Source control and CI" />
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <GithubIcon size={18} className="text-faint" />
            <div>
              <p className="text-sm text-text">GitHub</p>
              <p className="text-[11px] text-faint">
                {connected ? 'Repositories connected via the GitHub App' : 'Not connected'}
              </p>
            </div>
          </div>
          {capabilities.githubApp ? (
            <a href={`/api/v1/organizations/${orgId}/integrations/github/install`}>
              <Button size="sm">{connected ? 'Manage installation' : 'Install GitHub App'}</Button>
            </a>
          ) : (
            <Badge>Not configured</Badge>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Link2 size={18} className="text-faint" />
            <div>
              <p className="text-sm text-text">GitHub Action</p>
              <p className="text-[11px] text-faint">
                Add <span className="mono">uses: cra-compliance-os/scan@v1</span> to a workflow to scan on every push and
                fail the build on severity thresholds.
              </p>
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={() => navigator.clipboard?.writeText('uses: cra-compliance-os/scan@v1')}>
            Copy
          </Button>
        </div>
      </div>
    </Card>
  );
}

function BadgeCard() {
  const { orgId } = useAuth();
  const { data: repos } = useRepositories(orgId);
  const repo = repos?.[0];
  const [enabled, setEnabled] = useState(Boolean(repo?.badgeEnabled));
  const qc = useQueryClient();

  const toggle = useMutation({
    mutationFn: (next: boolean) => api.patch(`/organizations/${orgId}/repositories/${repo!.id}/badge`, { enabled: next }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['repositories', orgId] }),
  });

  if (!repo) return null;

  return (
    <Card>
      <CardHeader title="Public readiness badge" subtitle="Share posture without exposing findings" />
      <div className="space-y-3 p-4">
        <p className="text-[11px] leading-relaxed text-muted">
          The badge shows an aggregate readiness grade only. It never reveals component names or open vulnerabilities —
          that would hand an attacker a target list.
        </p>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span className="text-xs text-text">Show badge</span>
          <Switch
            checked={enabled}
            label="Show badge"
            onChange={(next) => {
              setEnabled(next);
              toggle.mutate(next);
            }}
          />
        </div>
        <div className="rounded-lg border border-border bg-surface-2 p-2.5">
          <code className="mono block break-all text-[11px] text-muted">
            ![CRA readiness]({window.location.origin}/api/v1/badge/{repo.badgeToken}.svg)
          </code>
        </div>
        <img src={`/api/v1/badge/${repo.badgeToken}.svg`} alt="CRA readiness badge" className="h-5" />
      </div>
    </Card>
  );
}

export function Settings() {
  const { org, capabilities } = useAuth();

  return (
    <>
      <PageHeader title="Settings" description="Organisation, team, API access and integrations." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organisation" subtitle="Tenant-scoped: nothing here is shared between customers" />
          <dl className="divide-y divide-border">
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-xs text-muted">Name</dt>
              <dd className="text-xs text-text">{org?.name ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-xs text-muted">Plan</dt>
              <dd>
                <Badge>{org?.planKey ?? 'free'}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-xs text-muted">Slug</dt>
              <dd className="mono text-xs text-muted">{org?.slug ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-xs text-muted">Payments</dt>
              <dd>
                <Badge className={capabilities.payments ? 'border-pass/30 bg-pass/10 text-pass' : undefined}>
                  {capabilities.payments ? 'Configured' : 'Not configured'}
                </Badge>
              </dd>
            </div>
          </dl>
          <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-[11px] text-faint">
            <Building2 size={13} /> Organisation settings are per-workspace; agencies can create one per client.
          </div>
        </Card>

        <div className="space-y-4">
          <IntegrationsCard />
          <BadgeCard />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <MembersCard />
        <ApiKeysCard />
      </div>

      <div className="mt-6 flex items-center gap-2 text-[11px] text-faint">
        <Users size={13} /> Need per-client workspaces? Agency mode lets you create an organisation per customer under one
        login.
      </div>
    </>
  );
}
