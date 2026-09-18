import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, Check, Database, RefreshCw, Users, Zap } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Skeleton,
  Switch,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
  useToast,
} from '../components/ui';
import { PageHeader, StatCard } from '../components/layout';
import { cx, formatDate, formatNumber } from '../lib/format';

interface Overview {
  counts: {
    users: number;
    organizations: number;
    repositories: number;
    scans: number;
    payments: number;
    vulnerabilities: number;
    controls: number;
  };
  revenue: { succeededCents: number; pendingCents: number };
  credits: { outstanding: number; lifetimeConsumed: number };
  queue: { pending: number; running: number; failed: number; dead: number; succeeded: number };
  infrastructure: {
    database: { ok: boolean; latencyMs?: number; tables?: number };
    payments: string;
    ai: string;
    storage: string;
    kev: { status: string; entries: number };
  };
}

type Tab = 'overview' | 'organizations' | 'users' | 'jobs' | 'flags';

export function AdminConsole() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');

  if (!user?.isSystemAdmin) {
    return (
      <Card>
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-text">Administrator access required</p>
          <p className="mt-1 text-xs text-muted">
            This console is restricted to accounts listed in <span className="mono">ADMIN_EMAILS</span>.
          </p>
          <Link to="/app">
            <Button className="mt-4">Back to dashboard</Button>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Admin console"
        description="Operational view of the platform: tenants, queue health, costs and configuration."
      />

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'organizations', label: 'Organisations' },
          { id: 'users', label: 'Users' },
          { id: 'jobs', label: 'Jobs' },
          { id: 'flags', label: 'Feature flags' },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === 'overview' ? <OverviewTab /> : null}
      {tab === 'organizations' ? <OrganizationsTab /> : null}
      {tab === 'users' ? <UsersTab /> : null}
      {tab === 'jobs' ? <JobsTab /> : null}
      {tab === 'flags' ? <FlagsTab /> : null}
    </>
  );
}

function OverviewTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api.get<Overview>('/admin/overview'),
    refetchInterval: 20_000,
  });
  const toast = useToast();
  const qc = useQueryClient();

  const syncKev = useMutation({
    mutationFn: () => api.post<unknown>('/admin/intel/kev-sync/now'),
    onSuccess: () => {
      toast.success('KEV catalogue synchronised');
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Sync failed'),
  });

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (!data) return <Card className="p-6 text-sm text-muted">Could not load the overview.</Card>;

  const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Organisations" value={formatNumber(data.counts.organizations)} />
        <StatCard label="Users" value={formatNumber(data.counts.users)} />
        <StatCard label="Repositories" value={formatNumber(data.counts.repositories)} />
        <StatCard label="Scans" value={formatNumber(data.counts.scans)} />
        <StatCard label="Vulnerabilities" value={formatNumber(data.counts.vulnerabilities)} />
        <StatCard label="Controls" value={formatNumber(data.counts.controls)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Payments succeeded" value={money(data.revenue.succeededCents)} hint="Gross, before fees" />
        <StatCard label="Payments pending" value={money(data.revenue.pendingCents)} />
        <StatCard label="Credits outstanding" value={formatNumber(data.credits.outstanding)} hint="Liability on the books" />
        <StatCard label="Credits consumed" value={formatNumber(data.credits.lifetimeConsumed)} hint="Lifetime" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Queue health" subtitle="Durable job queue with retries and a dead-letter state" />
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
            {Object.entries(data.queue).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-border px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-faint">{key}</p>
                <p
                  className={cx(
                    'mt-0.5 text-lg font-semibold tabular-nums',
                    key === 'dead' && Number(value) > 0
                      ? 'text-fail'
                      : key === 'failed' && Number(value) > 0
                        ? 'text-partial'
                        : 'text-text',
                  )}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Infrastructure" />
          <dl className="divide-y divide-border">
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="flex items-center gap-2 text-xs text-muted">
                <Database size={13} /> Database
              </dt>
              <dd>
                <Badge className={data.infrastructure.database.ok ? 'border-pass/30 bg-pass/10 text-pass' : 'border-fail/30 bg-fail/10 text-fail'}>
                  {data.infrastructure.database.ok ? `${data.infrastructure.database.tables} tables` : 'unhealthy'}
                </Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-xs text-muted">Payments provider</dt>
              <dd className="text-xs text-text">{data.infrastructure.payments}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-xs text-muted">AI provider</dt>
              <dd className="text-xs text-text">{data.infrastructure.ai}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-xs text-muted">Storage driver</dt>
              <dd className="text-xs text-text">{data.infrastructure.storage}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-xs text-muted">KEV catalogue</dt>
              <dd className="flex items-center gap-2">
                <span className="text-xs text-text">{formatNumber(data.infrastructure.kev.entries)} entries</span>
                <Button size="sm" variant="ghost" loading={syncKev.isPending} onClick={() => syncKev.mutate()} icon={<RefreshCw size={12} />}>
                  Sync
                </Button>
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      {data.queue.dead > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-fail/30 bg-fail/5 px-3.5 py-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-fail" />
          <p className="text-xs text-muted">
            {data.queue.dead} job(s) are in the dead-letter queue. Inspect them on the Jobs tab and retry once the
            underlying cause is fixed.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function OrganizationsTab() {
  const { data } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () =>
      api.get<
        Array<{ id: string; name: string; slug: string; planKey: string; isAgency: boolean; createdAt: number; balance: number | null }>
      >('/admin/organizations'),
  });
  const toast = useToast();
  const qc = useQueryClient();
  const [grant, setGrant] = useState<{ orgId: string; name: string } | null>(null);
  const [amount, setAmount] = useState('1000');

  const grantCredits = useMutation({
    mutationFn: () => api.post('/admin/credits/grant', { orgId: grant!.orgId, amount: Number(amount), reason: 'admin grant' }),
    onSuccess: () => {
      toast.success('Credits granted');
      setGrant(null);
      void qc.invalidateQueries({ queryKey: ['admin-orgs'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Grant failed'),
  });

  return (
    <>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Organisation</Th>
              <Th>Plan</Th>
              <Th>Balance</Th>
              <Th>Created</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((org) => (
              <Tr key={org.id}>
                <Td>
                  <p className="text-sm text-text">{org.name}</p>
                  <p className="mono text-[11px] text-faint">{org.id}</p>
                </Td>
                <Td>
                  <Badge>{org.planKey}</Badge>
                </Td>
                <Td className="mono text-xs text-muted">{formatNumber(org.balance ?? 0)}</Td>
                <Td className="text-xs text-muted">{formatDate(org.createdAt)}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setGrant({ orgId: org.id, name: org.name })}>
                    Grant credits
                  </Button>
                </Td>
              </Tr>
            ))}
            {!data?.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-faint">
                  No organisations yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Ledger integrity" subtitle="Recompute every balance from its transactions" />
        <div className="p-4">
          <IntegrityChecker orgs={data ?? []} />
        </div>
      </Card>

      {grant ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <Card className="w-full max-w-sm">
            <CardHeader title={`Grant credits to ${grant.name}`} />
            <div className="space-y-4 p-4">
              <Field label="Amount" hint="Positive integer">
                <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setGrant(null)}>Cancel</Button>
                <Button variant="primary" loading={grantCredits.isPending} onClick={() => grantCredits.mutate()} icon={<Zap size={13} />}>
                  Grant
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function IntegrityChecker({ orgs }: { orgs: Array<{ id: string; name: string }> }) {
  const [result, setResult] = useState<{ consistent: number; inconsistent: number; checked: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    let consistent = 0;
    let inconsistent = 0;
    for (const org of orgs) {
      try {
        const res = await api.get<{ consistent: boolean }>(`/admin/organizations/${org.id}/integrity`);
        if (res.consistent) consistent += 1;
        else inconsistent += 1;
      } catch {
        inconsistent += 1;
      }
    }
    setResult({ consistent, inconsistent, checked: orgs.length });
    setBusy(false);
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-xs text-muted">
        {result
          ? `${result.consistent} of ${result.checked} balances reconcile exactly. ${result.inconsistent} mismatch.`
          : 'Compares each cached balance against the sum of its ledger transactions.'}
      </p>
      <Button size="sm" loading={busy} onClick={run} disabled={!orgs.length} icon={<Check size={12} />}>
        Run check
      </Button>
    </div>
  );
}

function UsersTab() {
  const { data } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () =>
      api.get<
        Array<{ id: string; email: string; name: string | null; isSystemAdmin: boolean; status: string; lastLoginAt: number | null; createdAt: number }>
      >('/admin/users'),
  });

  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>User</Th>
            <Th>Status</Th>
            <Th>Role</Th>
            <Th>Last sign-in</Th>
            <Th>Created</Th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((row) => (
            <Tr key={row.id}>
              <Td>
                <p className="text-sm text-text">{row.name ?? row.email}</p>
                <p className="text-[11px] text-faint">{row.email}</p>
              </Td>
              <Td>
                <Badge className={row.status === 'active' ? 'border-pass/30 bg-pass/10 text-pass' : undefined}>{row.status}</Badge>
              </Td>
              <Td>{row.isSystemAdmin ? <Badge className="border-accent/30 bg-accent/10 text-accent">admin</Badge> : <span className="text-xs text-faint">user</span>}</Td>
              <Td className="text-xs text-muted">{row.lastLoginAt ? formatDate(row.lastLoginAt) : 'Never'}</Td>
              <Td className="text-xs text-muted">{formatDate(row.createdAt)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function JobsTab() {
  const [status, setStatus] = useState('dead');
  const { data } = useQuery({
    queryKey: ['admin-jobs', status],
    queryFn: () =>
      api.get<
        Array<{ id: string; type: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; createdAt: number }>
      >(`/admin/jobs${status ? `?status=${status}` : ''}`),
    refetchInterval: 10_000,
  });
  const qc = useQueryClient();
  const toast = useToast();

  const retry = useMutation({
    mutationFn: (jobId: string) => api.post(`/admin/jobs/${jobId}/retry`),
    onSuccess: () => {
      toast.success('Job requeued');
      void qc.invalidateQueries({ queryKey: ['admin-jobs'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Retry failed'),
  });

  return (
    <Card>
      <CardHeader
        title="Jobs"
        action={
          <div className="flex gap-1.5">
            {['dead', 'failed', 'running', 'pending', 'succeeded'].map((s) => (
              <Button key={s} size="sm" variant={status === s ? 'secondary' : 'ghost'} onClick={() => setStatus(s)}>
                {s}
              </Button>
            ))}
          </div>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th>Job</Th>
            <Th>Type</Th>
            <Th>Attempts</Th>
            <Th>Error</Th>
            <Th>Created</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((job) => (
            <Tr key={job.id}>
              <Td className="mono text-xs text-muted">{job.id}</Td>
              <Td className="text-xs text-text">{job.type}</Td>
              <Td className="mono text-xs text-muted">
                {job.attempts}/{job.maxAttempts}
              </Td>
              <Td className="max-w-md truncate text-xs text-fail">{job.lastError ?? '—'}</Td>
              <Td className="text-xs text-muted">{formatDate(job.createdAt)}</Td>
              <Td className="text-right">
                {job.status === 'dead' || job.status === 'failed' ? (
                  <Button size="sm" variant="ghost" onClick={() => retry.mutate(job.id)} icon={<RefreshCw size={12} />}>
                    Retry
                  </Button>
                ) : null}
              </Td>
            </Tr>
          ))}
          {!data?.length ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-xs text-faint">
                No jobs with status “{status}”.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </Card>
  );
}

function FlagsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-flags'],
    queryFn: () => api.get<Array<{ key: string; enabled: boolean; description: string | null; rolloutPct: number }>>('/admin/feature-flags'),
  });
  const qc = useQueryClient();
  const toast = useToast();

  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => api.post('/admin/feature-flags', { key, enabled }),
    onSuccess: () => {
      toast.success('Flag updated');
      void qc.invalidateQueries({ queryKey: ['admin-flags'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not update flag'),
  });

  if (isLoading) return <Skeleton className="h-40" />;

  return (
    <Card>
      <CardHeader title="Feature flags" subtitle="Take effect immediately — no redeploy" />
      <ul className="divide-y divide-border">
        {(data ?? []).map((flag) => (
          <li key={flag.key} className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="mono text-xs text-text">{flag.key}</p>
              <p className="mt-0.5 text-[11px] text-faint">{flag.description ?? 'No description'}</p>
            </div>
            <Switch
              checked={flag.enabled}
              label={flag.key}
              disabled={toggle.isPending}
              onChange={(next) => toggle.mutate({ key: flag.key, enabled: next })}
            />
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-[11px] text-faint">
        <Activity size={13} /> Flags are read on every request; there is no cache to invalidate.
      </div>
    </Card>
  );
}

export { Users };
