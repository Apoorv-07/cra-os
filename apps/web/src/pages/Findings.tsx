import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {AlertTriangle, Check, ChevronRight, Clock, EyeOff, Filter, ShieldCheck, Zap} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useFindings, useRepositories, useTriageFinding, type Finding } from '../lib/queries';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  Select,
  Skeleton,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
  useToast,
} from '../components/ui';
import { ErrorState } from '../components/errors';
import { PageHeader } from '../components/layout';
import { SEVERITY_CLASS, cx, formatDate, relativeTime, severity } from '../lib/format';

/**
 * Findings.
 *
 * The rule on this screen: lead with the decision, keep the science underneath.
 * A director should be able to read the headline and the recommended action
 * without knowing what EPSS is; the engineer fixing it can open the row and get
 * CVSS, EPSS, KEV, the manifest path and the evidence that supports the call.
 */

const PRIORITY_META = {
  act_now: {
    label: 'Act now',
    tone: 'critical' as const,
    className: 'border-fail/30 bg-fail/10 text-fail',
    description: 'Known exploited or actively exploited. Treat as an incident, not a backlog item.',
  },
  prioritise: {
    label: 'Prioritise',
    tone: 'high' as const,
    className: 'border-high/30 bg-high/10 text-high',
    description: 'Critical or high severity. Fix in the current cycle.',
  },
  monitor: {
    label: 'Monitor',
    tone: 'medium' as const,
    className: 'border-medium/30 bg-medium/10 text-medium',
    description: 'Moderate severity. Fold into normal maintenance.',
  },
  review: {
    label: 'Review',
    tone: 'low' as const,
    className: 'border-border bg-surface-2 text-muted',
    description: 'Low severity, dismissed, or already resolved.',
  },
};

const STATE_LABEL: Record<string, string> = {
  open: 'Open',
  fixed: 'Fixed',
  ignored: 'Dismissed',
  risk_accepted: 'Risk accepted',
};

export function Findings() {
  const { orgId } = useAuth();
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  const repositoryId = params.get('repositoryId') ?? '';
  const priority = params.get('priority') ?? '';
  const severityFilter = params.get('severity') ?? '';
  const state = params.get('state') ?? 'open';
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const [detail, setDetail] = useState<Finding | null>(null);
  const [triage, setTriage] = useState<{ finding: Finding; state: string } | null>(null);

  const filters = useMemo(
    () => ({ repositoryId, priority, severity: severityFilter, state, q }),
    [repositoryId, priority, severityFilter, state, q],
  );

  const { data, isLoading, isError, error, refetch } = useFindings(orgId, filters);
  const { data: repos } = useRepositories(orgId);
  const triageMutation = useTriageFinding(orgId);

  // The summary is computed over every open finding, not the filtered page, so
  // the tab counts stay stable while the user filters.
  const { data: all } = useFindings(orgId, { state: 'all' });
  const summary = all?.summary;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const grouped = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      act_now: rows.filter((r) => r.priority === 'act_now'),
      prioritise: rows.filter((r) => r.priority === 'prioritise'),
      monitor: rows.filter((r) => r.priority === 'monitor'),
      review: rows.filter((r) => r.priority === 'review'),
    };
  }, [data]);

  const activeTab = (params.get('tab') ?? 'act_now') as keyof typeof grouped;

  if (isError) {
    return (
      <>
        <PageHeader title="Findings" description="Every open issue across your repositories, in the order we would fix them." />
        <ErrorState error={error} onRetry={() => void refetch()} title="Something went wrong while loading findings" />
      </>
    );
  }

  const totalOpen = summary?.open ?? 0;

  return (
    <>
      <PageHeader
        title="Findings"
        description={
          totalOpen > 0
            ? `${totalOpen} open finding${totalOpen === 1 ? '' : 's'} across ${summary?.repositoriesAffected ?? 0} repositor${summary?.repositoriesAffected === 1 ? 'y' : 'ies'}. Ordered by what we would fix first, not by raw severity.`
            : 'Every issue we can see in your repositories, ordered by what we would fix first.'
        }
        action={
          <Link to="/app/reports">
            <Button icon={<ShieldCheck size={14} />}>Generate report</Button>
          </Link>
        }
      />

      {/* The summary is a strip, not a row of cards: it supports the table. */}
      {summary ? (
        <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-4">
          {(
            [
              ['Act now', summary.actNow, 'text-fail'],
              ['Prioritise', summary.prioritise, 'text-high'],
              ['Monitor', summary.monitor, 'text-medium'],
              ['Known exploited', summary.knownExploited, 'text-fail'],
              ['Past due date', summary.overdueSla, 'text-partial'],
            ] as const
          ).map(([label, value, tone]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className={cx('mono text-lg font-semibold tabular-nums', value > 0 ? tone : 'text-faint')}>
                {value}
              </span>
              <span className="text-xs text-muted">{label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { id: 'act_now' as const, label: 'Act now', count: summary?.actNow },
            { id: 'prioritise' as const, label: 'Prioritise', count: summary?.prioritise },
            { id: 'monitor' as const, label: 'Monitor', count: summary?.monitor },
            { id: 'review' as const, label: 'Review', count: summary?.monitor !== undefined ? (summary?.open ?? 0) - (summary?.actNow ?? 0) - (summary?.prioritise ?? 0) - (summary?.monitor ?? 0) : undefined },
          ]}
          active={activeTab}
          onChange={(id) => setParam('tab', id)}
          className="flex-1"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Input
            placeholder="Search component, advisory or repository"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setParam('q', search);
            }}
          />
        </div>
        <Select value={repositoryId} onChange={(e) => setParam('repositoryId', e.target.value)} className="h-9 w-auto min-w-[160px]">
          <option value="">All repositories</option>
          {repos?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.fullName ?? r.name}
            </option>
          ))}
        </Select>
        <Select value={severityFilter} onChange={(e) => setParam('severity', e.target.value)} className="h-9 w-auto min-w-[130px]">
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Select value={state} onChange={(e) => setParam('state', e.target.value)} className="h-9 w-auto min-w-[140px]">
          <option value="open">Open</option>
          <option value="all">All states</option>
          <option value="fixed">Fixed</option>
          <option value="risk_accepted">Risk accepted</option>
          <option value="ignored">Dismissed</option>
        </Select>
        {repositoryId || severityFilter || q || state !== 'open' ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Filter size={13} />}
            onClick={() => {
              setSearch('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : grouped[activeTab].length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={22} />}
          title={totalOpen === 0 ? 'No open findings' : `Nothing in "${PRIORITY_META[activeTab].label}"`}
          description={
            totalOpen === 0
              ? 'Your latest scans found nothing to act on. New advisories are matched automatically as they are published.'
              : PRIORITY_META[activeTab].description
          }
          action={
            totalOpen > 0 ? (
              <Button size="sm" onClick={() => setParam('tab', 'act_now')}>
                Show what needs action
              </Button>
            ) : (
              <Link to="/app/repositories">
                <Button size="sm">Run a scan</Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-8">
          {(['act_now', 'prioritise', 'monitor', 'review'] as const)
            .filter((key) => grouped[key].length > 0)
            .map((key) => (
              <section key={key}>
                <div className="mb-2 flex items-baseline gap-3">
                  <h2 className={cx('text-sm font-semibold', key === 'act_now' ? 'text-fail' : key === 'prioritise' ? 'text-high' : 'text-text')}>
                    {PRIORITY_META[key].label}
                  </h2>
                  <span className="mono text-xs text-faint">{grouped[key].length}</span>
                  <span className="text-xs text-faint">{PRIORITY_META[key].description}</span>
                </div>
                <Table>
                  <thead>
                    <tr>
                      <Th>Finding</Th>
                      <Th>Repository</Th>
                      <Th>Recommended action</Th>
                      <Th>Status</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[key].map((row) => (
                      <Tr key={row.id} onClick={() => setDetail(row)}>
                        <Td>
                          <div className="flex items-start gap-2.5">
                            {row.vulnerability.kevFlag ? (
                              <Zap size={14} className="mt-0.5 shrink-0 text-fail" />
                            ) : (
                              <AlertTriangle
                                size={14}
                                className={cx(
                                  'mt-0.5 shrink-0',
                                  row.vulnerability.severity === 'critical'
                                    ? 'text-fail'
                                    : row.vulnerability.severity === 'high'
                                      ? 'text-high'
                                      : 'text-faint',
                                )}
                              />
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-text">{row.headline}</p>
                              <p className="mt-0.5 truncate text-[11px] text-faint">
                                <span className="mono">{row.vulnerability.sourceId}</span>
                                {row.component.manifestPath ? (
                                  <>
                                    {' · '}
                                    <span className="mono">{row.component.manifestPath}</span>
                                  </>
                                ) : null}
                              </p>
                            </div>
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap text-xs text-muted">{row.repository.name}</Td>
                        <Td className="max-w-[280px] text-xs text-muted">
                          <span className="line-clamp-2">{row.remediation ?? 'No fixed version published yet'}</span>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <Badge className={SEVERITY_CLASS[severity(row.vulnerability.severity)]}>
                              {row.vulnerability.severity ?? 'unrated'}
                            </Badge>
                            {row.slaDueAt && row.slaDueAt < Date.now() && row.state === 'open' ? (
                              <Badge className="border-partial/30 bg-partial/10 text-partial">
                                <Clock size={10} /> past due
                              </Badge>
                            ) : null}
                          </div>
                        </Td>
                        <Td className="w-8">
                          <ChevronRight size={14} className="text-faint" />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            ))}
        </div>
      )}

      {/* Detail: the "why does CRAOS think this?" answer, one click away. */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.headline ?? ''}
        footer={
          detail ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  icon={<Check size={13} />}
                  loading={triageMutation.isPending}
                  onClick={() => setTriage({ finding: detail, state: 'fixed' })}
                >
                  Mark fixed
                </Button>
                <Button size="sm" onClick={() => setTriage({ finding: detail, state: 'risk_accepted' })}>
                  Accept risk
                </Button>
                <Button size="sm" variant="ghost" icon={<EyeOff size={13} />} onClick={() => setTriage({ finding: detail, state: 'ignored' })}>
                  Dismiss
                </Button>
              </div>
              <Link to={`/app/repositories/${detail.repository.id}`}>
                <Button size="sm" variant="ghost">
                  Open repository
                </Button>
              </Link>
            </div>
          ) : undefined
        }
      >
        {detail ? (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Why this matters</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{detail.whyItMatters}</p>
            </div>

            {detail.remediation ? (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Recommended action</p>
                <p className="mt-1 text-sm text-text">{detail.remediation}</p>
              </div>
            ) : null}

            <div className="rounded-lg border border-border bg-surface-2/50 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Component</p>
              <p className="mt-1 text-sm text-text">
                {detail.component.name} <span className="mono text-muted">{detail.component.version ?? 'unknown'}</span>
              </p>
              <p className="mt-0.5 break-all text-[11px] text-faint mono">{detail.component.purl}</p>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">CRA expectations affected</p>
              <div className="flex flex-wrap gap-1.5">
                {detail.cra.map((c) => (
                  <Badge key={c.controlId} className="border-border bg-surface-2 text-muted">
                    {c.title}
                  </Badge>
                ))}
              </div>
            </div>

            <details className="rounded-lg border border-border">
              <summary className="cursor-pointer px-3 py-2 text-xs text-muted hover:text-text">
                Technical detail — scores, dates and identifiers
              </summary>
              <dl className="space-y-1.5 border-t border-border px-3 py-2.5 text-xs">
                {[
                  ['Advisory', detail.vulnerability.sourceId],
                  ['Severity', detail.vulnerability.severity ?? 'unrated'],
                  ['CVSS', detail.vulnerability.cvssScore !== null ? `${detail.vulnerability.cvssScore} ${detail.vulnerability.cvssVector ?? ''}` : '—'],
                  ['EPSS', detail.vulnerability.epssScore !== null ? detail.vulnerability.epssScore.toFixed(3) : '—'],
                  ['Known exploited', detail.vulnerability.kevFlag ? 'Yes (CISA KEV)' : 'No'],
                  ['Exploitability', detail.exploitability ?? 'unknown'],
                  ['Exposure', detail.exposure ?? 'unknown'],
                  ['Published', detail.vulnerability.publishedAt ? formatDate(detail.vulnerability.publishedAt) : '—'],
                  ['Detected', relativeTime(detail.detectedAt)],
                  ['State', STATE_LABEL[detail.state] ?? detail.state],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4">
                    <dt className="text-faint">{label}</dt>
                    <dd className="mono text-right text-muted">{value}</dd>
                  </div>
                ))}
              </dl>
            </details>

            {detail.vulnerability.summary ? (
              <p className="text-xs leading-relaxed text-muted">{detail.vulnerability.summary}</p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(triage)}
        onClose={() => setTriage(null)}
        title={triage?.state === 'fixed' ? 'Mark this finding as fixed?' : triage?.state === 'risk_accepted' ? 'Accept this risk?' : 'Dismiss this finding?'}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTriage(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={triageMutation.isPending}
              onClick={() => {
                if (!triage) return;
                triageMutation.mutate(
                  { findingId: triage.finding.id, state: triage.state },
                  {
                    onSuccess: () => {
                      toast.success(
                        triage.state === 'fixed'
                          ? 'Marked as fixed. The audit trail keeps the original assessment.'
                          : triage.state === 'risk_accepted'
                            ? 'Risk accepted and recorded with your name and the time.'
                            : 'Finding dismissed.',
                      );
                      setTriage(null);
                      setDetail(null);
                    },
                    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not update the finding'),
                  },
                );
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          {triage?.state === 'fixed'
            ? 'The finding moves out of your open queue. If a later scan still detects the component, it will reappear — that is deliberate.'
            : triage?.state === 'risk_accepted'
              ? 'The finding stays visible but stops counting as unhandled. Record why you are accepting it.'
              : 'Dismissed findings are hidden from the open queue but never deleted.'}
        </p>
        {triage ? (
          <p className="mt-2 text-xs text-faint">
            {triage.finding.component.name} {triage.finding.component.version} · {triage.finding.repository.name}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
