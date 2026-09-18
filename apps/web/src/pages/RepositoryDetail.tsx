import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Boxes, Download, FileCheck2, RefreshCw, ShieldAlert, Zap } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, downloadUrl } from '../lib/api';
import {
  useComponents,
  useRepository,
  useScans,
  useScanStatus,
  useStartScan,
  useVulnerabilities,
  type VulnerabilityRow,
} from '../lib/queries';
import {Alert, Badge, Button, Card, EmptyState, ProgressBar, Skeleton, Table, Tabs, Td, Th, Tr, useToast} from '../components/ui';
import { PageHeader } from '../components/layout';
import { PageError } from '../components/errors';
import {
  cx,
  ecosystemLabel,
  formatDate,
  formatNumber,
  gradeColour,
  relativeTime,
  SEVERITY_CLASS,
  severity,
  STATUS_CLASS,
  STATUS_LABEL,
  truncate,
  type ControlStatus,
} from '../lib/format';

type Tab = 'vulnerabilities' | 'components' | 'impact' | 'evidence' | 'scans';

function ScanProgress({ orgId, scanId }: { orgId: string; scanId: string }) {
  const { data } = useScanStatus(orgId, scanId);
  if (!data) return null;
  if (data.status !== 'running' && data.status !== 'queued') return null;

  return (
    <Card className="mb-4 border-accent/30">
      <div className="flex items-center gap-3 px-4 py-3">
        <RefreshCw size={15} className="animate-spin text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-xs text-text">{data.message ?? 'Working'}</p>
            <span className="mono shrink-0 text-[11px] text-faint">{data.progressPct}%</span>
          </div>
          <ProgressBar value={data.progressPct} className="mt-2" />
        </div>
      </div>
      {data.events.length ? (
        <div className="border-t border-border px-4 py-2">
          <div className="max-h-24 space-y-0.5 overflow-y-auto">
            {data.events.slice(-6).map((event, index) => (
              <p key={`${event.createdAt}-${index}`} className="mono text-[11px] text-faint">
                {event.message ?? event.status}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function VulnerabilityList({ orgId, scanId }: { orgId: string; scanId: string }) {
  const { data, isLoading } = useVulnerabilities(orgId, scanId);
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'exploited' | 'critical' | 'high'>('all');
  const qc = useQueryClient();

  const openIncident = useMutation({
    mutationFn: (componentVulnerabilityId: string) =>
      api.post<{ id: string }>(`/organizations/${orgId}/incidents`, { componentVulnerabilityId }),
    onSuccess: (result) => {
      toast.success('Incident opened — Article 14 clocks started');
      void qc.invalidateQueries({ queryKey: ['incidents', orgId] });
      navigate(`/app/incidents/${result.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not open an incident'),
  });

  const rows = useMemo(() => {
    const all = data ?? [];
    const sorted = [...all].sort((a, b) => {
      if (a.vulnerability.kevFlag !== b.vulnerability.kevFlag) return a.vulnerability.kevFlag ? -1 : 1;
      const ae = a.vulnerability.epssScore ?? -1;
      const be = b.vulnerability.epssScore ?? -1;
      if (ae !== be) return be - ae;
      return (b.vulnerability.cvssScore ?? 0) - (a.vulnerability.cvssScore ?? 0);
    });
    switch (filter) {
      case 'exploited':
        return sorted.filter((r) => r.vulnerability.kevFlag);
      case 'critical':
        return sorted.filter((r) => severity(r.vulnerability.severity) === 'critical');
      case 'high':
        return sorted.filter((r) => ['critical', 'high'].includes(severity(r.vulnerability.severity)));
      default:
        return sorted;
    }
  }, [data, filter]);

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }

  if (!data?.length) {
    return (
      <EmptyState
        icon={<ShieldAlert size={22} />}
        title="No known vulnerabilities"
        description="Nothing in this scan matched OSV, GitHub Advisories, NVD or the CISA KEV catalogue. Re-scan after dependency updates to keep that true."
      />
    );
  }

  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2">
        {([
          ['all', `All ${data.length}`],
          ['exploited', 'Known exploited'],
          ['critical', 'Critical'],
          ['high', 'High and above'],
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? 'secondary' : 'ghost'}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Severity</Th>
            <Th>Advisory</Th>
            <Th>Component</Th>
            <Th>Fix</Th>
            <Th>CVSS</Th>
            <Th>EPSS</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <VulnerabilityRowView key={row.id} row={row} onOpenIncident={(id) => openIncident.mutate(id)} busy={openIncident.isPending} />
          ))}
        </tbody>
      </Table>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-faint">No findings match this filter.</p>
      ) : null}
    </>
  );
}

function VulnerabilityRowView({
  row,
  onOpenIncident,
  busy,
}: {
  row: VulnerabilityRow;
  onOpenIncident: (id: string) => void;
  busy: boolean;
}) {
  const sev = severity(row.vulnerability.severity);
  const epss = row.vulnerability.epssScore;

  return (
    <Tr>
      <Td>
        <div className="flex items-center gap-1.5">
          <Badge className={SEVERITY_CLASS[sev]}>{sev}</Badge>
          {row.vulnerability.kevFlag ? (
            <span title="Listed in the CISA Known Exploited Vulnerabilities catalogue">
              <Badge className="border-critical/40 bg-critical/15 text-critical">
                <Zap size={10} /> KEV
              </Badge>
            </span>
          ) : null}
        </div>
      </Td>
      <Td>
        <span className="mono text-xs text-text">{truncate(row.vulnerability.sourceId, 26)}</span>
        <p className="mt-0.5 max-w-md truncate text-xs text-muted" title={row.vulnerability.summary ?? ''}>
          {row.vulnerability.summary ?? 'No summary provided by the source.'}
        </p>
      </Td>
      <Td>
        <span className="mono text-xs text-text">{row.component.name}</span>
        <span className="ml-1.5 text-[11px] text-faint">{row.component.version ?? ''}</span>
        <p className="text-[11px] text-faint">{ecosystemLabel(row.component.ecosystem)}</p>
      </Td>
      <Td>
        {row.fixedVersion ? (
          <span className="mono text-xs text-pass">{row.fixedVersion}</span>
        ) : (
          <span className="text-xs text-faint">none</span>
        )}
      </Td>
      <Td className="mono text-xs text-muted">{row.vulnerability.cvssScore ?? '—'}</Td>
      <Td>
        {epss !== null && epss !== undefined ? (
          <span className={cx('mono text-xs', epss >= 0.1 ? 'text-critical' : epss >= 0.01 ? 'text-partial' : 'text-muted')}>
            {(epss * 100).toFixed(2)}%
          </span>
        ) : (
          <span className="text-xs text-faint">—</span>
        )}
      </Td>
      <Td className="text-right">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onOpenIncident(row.id)} icon={<AlertTriangle size={12} />}>
          Open incident
        </Button>
      </Td>
    </Tr>
  );
}

function ComponentList({ orgId, scanId }: { orgId: string; scanId: string }) {
  const { data, isLoading } = useComponents(orgId, scanId);
  const [query, setQuery] = useState('');

  const rows = useMemo(
    () => (data ?? []).filter((c) => `${c.name} ${c.version ?? ''}`.toLowerCase().includes(query.toLowerCase())),
    [data, query],
  );

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="border-b border-border px-4 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter components…"
          className="h-8 w-full max-w-xs rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-text placeholder:text-faint focus:border-accent/60"
        />
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Component</Th>
            <Th>Version</Th>
            <Th>Ecosystem</Th>
            <Th>Scope</Th>
            <Th>Manifest</Th>
            <Th>PURL</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((component) => (
            <Tr key={component.id}>
              <Td className="text-sm text-text">{component.name}</Td>
              <Td className="mono text-xs text-muted">{component.version ?? '—'}</Td>
              <Td className="text-xs text-muted">{ecosystemLabel(component.ecosystem)}</Td>
              <Td>
                <Badge>{component.scope}</Badge>
              </Td>
              <Td className="mono text-[11px] text-faint">{component.manifestPath ?? '—'}</Td>
              <Td className="mono text-[11px] text-faint">{truncate(component.purl, 48)}</Td>
            </Tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-xs text-faint">
                No components match “{query}”.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </>
  );
}

function CraImpact({ orgId, repositoryId }: { orgId: string; repositoryId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['readiness-detail', repositoryId],
    queryFn: () =>
      api.get<{
        score: number;
        grade: string;
        controls: Array<{
          id: string;
          title: string;
          domain: string;
          status: string;
          rationale: string;
          remediation: string;
          legalRef: string | null;
          weight: number;
        }>;
      }>(`/organizations/${orgId}/repositories/${repositoryId}/readiness`),
    enabled: Boolean(orgId && repositoryId),
  });

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  const gaps = (data?.controls ?? []).filter((c) => c.status === 'missing' || c.status === 'needs_review');
  const met = (data?.controls ?? []).filter((c) => c.status === 'passed' || c.status === 'partial');

  if (!data) return <EmptyState title="Readiness has not been assessed yet" description="Run a scan to evaluate this repository against the CRA control catalogue." />;

  return (
    <div className="divide-y divide-border">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-text">
            {gaps.length > 0 ? `${gaps.length} CRA expectation${gaps.length === 1 ? '' : 's'} affected` : 'No CRA gaps'}
          </h3>
          <Link to={`/app/compliance/${repositoryId}`} className="text-xs text-accent hover:underline">
            Open the full control register
          </Link>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          These are the obligations this repository currently falls short of. Each one states why, and what would change
          the answer.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {gaps.map((control) => (
          <li key={control.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text">{control.title}</span>
                  <Badge className={STATUS_CLASS[control.status as ControlStatus]}>{STATUS_LABEL[control.status as ControlStatus]}</Badge>
                  {control.legalRef ? <span className="text-[11px] text-faint">{control.legalRef}</span> : null}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{control.rationale}</p>
                {control.remediation ? (
                  <p className="mt-1 text-xs leading-relaxed text-partial">{control.remediation}</p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {met.length > 0 ? (
        <div className="px-4 py-3">
          <p className="text-xs text-faint">
            {met.length} expectation{met.length === 1 ? '' : 's'} met or partially met.{' '}
            <Link to={`/app/compliance/${repositoryId}`} className="text-accent hover:underline">
              See all
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RepositoryEvidence({ orgId, repositoryId }: { orgId: string; repositoryId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['evidence', orgId],
    queryFn: () =>
      api.get<
        Array<{
          id: string;
          title: string;
          type: string;
          description: string | null;
          fileName: string | null;
          sizeBytes: number | null;
          sha256: string;
          createdAt: number;
          repositoryId: string | null;
        }>
      >(`/organizations/${orgId}/evidence`),
    enabled: Boolean(orgId),
  });

  const rows = (data ?? []).filter((row) => row.repositoryId === repositoryId);

  if (isLoading) return <Skeleton className="m-4 h-24" />;

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<FileCheck2 size={22} />}
        title="No evidence stored for this repository"
        description="Scan output shows what your code contains. Policies, runbooks and test reports show how you work — both are needed for a defensible posture."
        action={
          <Link to="/app/evidence">
            <Button size="sm" variant="primary">
              Add evidence
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start gap-3 px-4 py-2.5">
          <FileCheck2 size={14} className="mt-0.5 shrink-0 text-faint" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-text">{row.title}</p>
            <p className="mt-0.5 text-[11px] text-faint">
              {row.fileName ?? 'Artefact'} · {formatDate(row.createdAt)}
            </p>
          </div>
          <span className="mono shrink-0 text-[11px] text-faint" title={row.sha256}>
            {row.sha256.slice(0, 12)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RepositoryDetail({ repositoryId }: { repositoryId: string }) {
  const { orgId } = useAuth();
  const { data: repo, isLoading, isError, error } = useRepository(orgId, repositoryId);
  const { data: scans } = useScans(orgId, repositoryId);
  const startScan = useStartScan(orgId);
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('vulnerabilities');

  const latest = scans?.[0];
  const activeScan = scans?.find((s) => s.status === 'running' || s.status === 'queued');

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  if (isError) {
    return <PageError error={error} title="Something went wrong while loading this repository" />;
  }

  if (!repo) {
    return (
      <EmptyState
        icon={<Boxes size={22} />}
        title="Repository not found"
        description="It may have been deleted, or it belongs to another organisation."
        action={
          <Link to="/app/repositories">
            <Button variant="primary">Back to repositories</Button>
          </Link>
        }
      />
    );
  }

  // The one-line verdict a reader gets before any table.
  const openKev = latest?.kevCount ?? 0;
  const critical = latest?.criticalCount ?? 0;
  const high = latest?.highCount ?? 0;
  const total = latest?.vulnerabilityCount ?? 0;
  const healthy = openKev === 0 && critical === 0 && high === 0;
  const statusLine = !latest
    ? 'Not scanned yet'
    : healthy
      ? 'No critical or high findings'
      : openKev > 0
        ? 'Needs attention — known exploited vulnerability'
        : 'Needs attention';

  const attention: Array<{ title: string; why: string; action: ReactNode; severity: 'critical' | 'high' | 'medium' }> = [];

  if (openKev > 0) {
    attention.push({
      title: `${openKev} known exploited vulnerabilit${openKev === 1 ? 'y' : 'ies'}`,
      why: 'Confirmed exploitation in the wild. This is both a remediation duty and an Article 24-hour reporting trigger.',
      severity: 'critical',
      action: (
        <Button size="sm" variant="primary" onClick={() => setTab('vulnerabilities')}>
          Review finding
        </Button>
      ),
    });
  }
  if (critical > 0) {
    attention.push({
      title: `${critical} critical vulnerabilit${critical === 1 ? 'y' : 'ies'}`,
      why: 'Critical issues in shipped components are expected to be handled without undue delay.',
      severity: 'high',
      action: (
        <Button size="sm" onClick={() => setTab('vulnerabilities')}>
          Review findings
        </Button>
      ),
    });
  }
  if (high > 0) {
    attention.push({
      title: `${high} high-severity vulnerabilit${high === 1 ? 'y' : 'ies'}`,
      why: 'Fix these in the current cycle so they do not become critical findings later.',
      severity: 'medium',
      action: (
        <Button size="sm" onClick={() => setTab('vulnerabilities')}>
          Review findings
        </Button>
      ),
    });
  }
  attention.push({
    title: 'Check CRA impact and collect evidence',
    why: 'Findings explain what is wrong; the control register explains which obligations it affects, and evidence is what makes the posture defensible.',
    severity: 'medium',
    action: (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setTab('impact')}>
          CRA impact
        </Button>
        <Link to="/app/evidence">
          <Button size="sm">Add evidence</Button>
        </Link>
      </div>
    ),
  });

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/app/repositories" className="hover:text-muted">
            Repositories
          </Link>
        }
        title={repo.fullName ?? repo.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cx('font-medium', healthy && latest ? 'text-pass' : latest ? 'text-partial' : 'text-muted')}>
              {statusLine}
            </span>
            {latest ? (
              <>
                <span className="text-faint">·</span>
                <span>
                  Scanned {relativeTime(latest.finishedAt ?? latest.createdAt)} · {formatNumber(total)} finding
                  {total === 1 ? '' : 's'}
                </span>
              </>
            ) : null}
            <span className="text-faint">·</span>
            <span>{repo.monitoringEnabled ? 'Monitoring on' : 'Monitoring off'}</span>
          </span>
        }
        action={
          <>
            <a href={downloadUrl(`/organizations/${orgId}/repositories/${repo.id}/sbom/latest`)}>
              <Button icon={<Download size={14} />}>Software inventory</Button>
            </a>
            <Button
              variant="primary"
              icon={<RefreshCw size={14} />}
              loading={startScan.isPending}
              onClick={() =>
                startScan.mutate(repo.id, {
                  onSuccess: () => toast.success('Scan started — credits are reserved until it finishes'),
                  onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not start scan'),
                })
              }
            >
              {latest ? 'Scan again' : 'Scan now'}
            </Button>
          </>
        }
      />

      {activeScan ? <ScanProgress orgId={orgId!} scanId={activeScan.id} /> : null}

      {latest?.status === 'failed' ? (
        <div className="mb-4">
          <Alert tone="error" title="The last scan failed">
            {latest.errorMessage ?? 'Unknown error.'} Credits were released automatically — a failed scan is never
            charged.
          </Alert>
        </div>
      ) : null}

      {/* Current health: the answer, then the shape of the problem. */}
      <Card className="overflow-hidden">
        <div className="grid gap-5 p-5 lg:grid-cols-[auto_1fr_auto] lg:items-center">
          <div className="flex items-center gap-4">
            <div className="relative">
              <svg width={72} height={72} className="-rotate-90" role="img" aria-label={`Readiness ${repo.readinessScore ?? 'not assessed'}`}>
                <circle cx={36} cy={36} r={30} fill="none" stroke="var(--color-surface-3)" strokeWidth={6} />
                {repo.readinessScore !== null ? (
                  <circle
                    cx={36}
                    cy={36}
                    r={30}
                    fill="none"
                    stroke={gradeColour(gradeForScore(repo.readinessScore))}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray={`${(repo.readinessScore / 100) * 2 * Math.PI * 30} ${2 * Math.PI * 30}`}
                  />
                ) : null}
              </svg>
              <span className="absolute inset-0 grid place-items-center text-sm font-semibold" style={{ color: repo.readinessScore !== null ? gradeColour(gradeForScore(repo.readinessScore)) : 'var(--color-faint)' }}>
                {repo.readinessScore !== null ? Math.round(repo.readinessScore) : '—'}
              </span>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-faint">CRA readiness</p>
              <p className="mt-0.5 text-sm font-medium text-text">
                {repo.readinessScore !== null ? `${Math.round(repo.readinessScore)} out of 100` : 'Not assessed'}
              </p>
              <Link to={`/app/compliance/${repo.id}`} className="mt-1 block text-[11px] text-accent hover:underline">
                Why this score
              </Link>
            </div>
          </div>

          <div className="border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-faint">Findings in the latest scan</p>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              {(
                [
                  ['Known exploited', openKev, 'text-fail'],
                  ['Critical', critical, 'text-fail'],
                  ['High', high, 'text-high'],
                  ['Medium', latest?.mediumCount ?? 0, 'text-medium'],
                  ['Low', latest?.lowCount ?? 0, 'text-muted'],
                ] as const
              ).map(([label, value, tone]) => (
                <div key={label} className="flex items-baseline gap-1.5">
                  <span className={cx('mono text-base font-semibold tabular-nums', value > 0 ? tone : 'text-faint')}>
                    {value}
                  </span>
                  <span className="text-[11px] text-muted">{label}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-faint">
              {formatNumber(latest?.componentCount ?? 0)} components tracked
              {latest?.finishedAt ? ` · scan took ${latest.durationMs ? `${(latest.durationMs / 1000).toFixed(1)}s` : '—'}` : ''}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4 text-[11px] sm:grid-cols-3 lg:border-l lg:border-t-0 lg:grid-cols-1 lg:pl-5 lg:pt-0">
            {[
              ['Software inventory', latest?.componentCount ? 'Available' : 'Not generated', latest?.componentCount ? 'text-pass' : 'text-faint'],
              ['Evidence', 'See tab', 'text-muted'],
              ['Monitoring', repo.monitoringEnabled ? 'On' : 'Off', repo.monitoringEnabled ? 'text-pass' : 'text-faint'],
            ].map(([label, value, tone]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 lg:justify-start lg:gap-2">
                <dt className="text-faint">{label}</dt>
                <dd className={cx('font-medium', tone)}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      {/* What needs attention here — never more than a handful. */}
      {latest ? (
        <section className="mt-6">
          <h2 className="mb-2.5 text-sm font-semibold text-text">What needs attention in this repository</h2>
          <ul className="space-y-2">
            {attention.slice(0, 4).map((item) => (
              <li key={item.title}>
                <Card
                  className={cx(
                    'border-l-2',
                    item.severity === 'critical' ? 'border-l-fail' : item.severity === 'high' ? 'border-l-high' : 'border-l-partial',
                  )}
                >
                  <div className="flex flex-wrap items-start gap-3 p-3.5">
                    <AlertTriangle
                      size={16}
                      className={cx('mt-0.5 shrink-0', item.severity === 'critical' ? 'text-fail' : item.severity === 'high' ? 'text-high' : 'text-partial')}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug text-text">{item.title}</p>
                      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{item.why}</p>
                    </div>
                    <div className="shrink-0">{item.action}</div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
          <Tabs
            tabs={[
              { id: 'vulnerabilities', label: 'Findings', count: latest?.vulnerabilityCount },
              { id: 'components', label: 'Components', count: latest?.componentCount },
              { id: 'impact', label: 'CRA impact' },
              { id: 'evidence', label: 'Evidence' },
              { id: 'scans', label: 'Scan history', count: scans?.length },
            ]}
            active={tab}
            onChange={setTab}
            className="border-0"
          />
          <div className="flex items-center gap-2">
            {latest ? (
              <span className="text-[11px] text-faint">Last scan {relativeTime(latest.finishedAt ?? latest.createdAt)}</span>
            ) : null}
            <Link to={`/app/compliance/${repo.id}`}>
              <Button size="sm" variant="ghost" icon={<ArrowRight size={12} />}>
                Full control register
              </Button>
            </Link>
          </div>
        </div>

        <div className="border-t border-border">
          {!latest ? (
            <EmptyState
              icon={<Boxes size={22} />}
              title="No scans yet"
              description="Run a scan to build the component inventory and match it against live vulnerability intelligence."
              action={
                <Button variant="primary" loading={startScan.isPending} onClick={() => startScan.mutate(repo.id)} icon={<RefreshCw size={14} />}>
                  Scan now
                </Button>
              }
            />
          ) : tab === 'vulnerabilities' ? (
            <VulnerabilityList orgId={orgId!} scanId={latest.id} />
          ) : tab === 'components' ? (
            <ComponentList orgId={orgId!} scanId={latest.id} />
          ) : tab === 'impact' ? (
            <CraImpact orgId={orgId!} repositoryId={repo.id} />
          ) : tab === 'evidence' ? (
            <RepositoryEvidence orgId={orgId!} repositoryId={repo.id} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Started</Th>
                  <Th>Trigger</Th>
                  <Th>Result</Th>
                  <Th>Components</Th>
                  <Th>Findings</Th>
                  <Th>Credits</Th>
                  <Th>Duration</Th>
                </tr>
              </thead>
              <tbody>
                {(scans ?? []).map((scan) => (
                  <Tr key={scan.id}>
                    <Td className="text-xs text-muted">{formatDate(scan.createdAt)}</Td>
                    <Td className="text-xs text-muted">{SCAN_TRIGGER_LABEL[scan.trigger] ?? scan.trigger}</Td>
                    <Td>
                      <Badge
                        className={cx(
                          scan.status === 'succeeded' && 'border-pass/30 bg-pass/10 text-pass',
                          scan.status === 'failed' && 'border-fail/30 bg-fail/10 text-fail',
                          (scan.status === 'running' || scan.status === 'queued') && 'border-partial/30 bg-partial/10 text-partial',
                        )}
                      >
                        {SCAN_STATUS_LABEL[scan.status] ?? scan.status}
                      </Badge>
                    </Td>
                    <Td className="mono text-xs text-muted">{scan.componentCount}</Td>
                    <Td className="mono text-xs text-muted">{scan.vulnerabilityCount}</Td>
                    <Td className="mono text-xs text-muted">{scan.creditsCharged}</Td>
                    <Td className="mono text-xs text-muted">{scan.durationMs ? `${(scan.durationMs / 1000).toFixed(1)}s` : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      {latest ? (
        <p className="mt-4 text-[11px] text-faint">
          Scan {latest.id} · {latest.ref ? `ref ${latest.ref}` : 'archive'} ·{' '}
          {latest.commitSha ? `commit ${latest.commitSha.slice(0, 7)}` : 'no commit'}
        </p>
      ) : null}
    </>
  );
}

const SCAN_STATUS_LABEL: Record<string, string> = {
  succeeded: 'Completed',
  failed: 'Failed',
  running: 'Running',
  queued: 'Queued',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

const SCAN_TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manual',
  push: 'Code push',
  schedule: 'Scheduled',
  api: 'API',
  action: 'CI action',
  onboarding: 'Onboarding',
};

function gradeForScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'E';
}

export { gradeColour };
