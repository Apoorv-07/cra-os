import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  Layers,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useEstateReadiness, useRepositories, useScans, type AttentionItem } from '../lib/queries';
import { Badge, Button, Card, CardHeader, EmptyState, ProgressBar, Skeleton, Table, Td, Th, Tr } from '../components/ui';
import { ErrorState } from '../components/errors';
import { PageHeader } from '../components/layout';
import { cx, formatNumber, gradeColour, relativeTime } from '../lib/format';

/**
 * Overview — the command centre.
 *
 * The brief for this screen is one question: **what is my current CRA
 * compliance situation?** So the hierarchy is deliberate:
 *
 *   1. the posture, in one line, with the grade explained
 *   2. what needs a human today (never more than a handful)
 *   3. the evidence behind the answer
 *   4. the estate at a glance
 *
 * There is deliberately no row of decorative metrics. If a number does not
 * change what the user does next, it does not belong here.
 */

const SEVERITY_STYLE: Record<AttentionItem['severity'], { border: string; icon: string; label: string }> = {
  critical: { border: 'border-l-fail', icon: 'text-fail', label: 'Critical' },
  high: { border: 'border-l-high', icon: 'text-high', label: 'High' },
  medium: { border: 'border-l-partial', icon: 'text-partial', label: 'Medium' },
  low: { border: 'border-l-border', icon: 'text-faint', label: 'Low' },
};

const KIND_ICON: Record<string, typeof AlertTriangle> = {
  known_exploited: Zap,
  critical_finding: AlertTriangle,
  overdue_sla: Clock,
  control_gap: ShieldAlert,
  missing_evidence: FileCheck2,
  stale_scan: Clock,
  failed_scan: AlertTriangle,
  no_repositories: Boxes,
};

export function Dashboard() {
  const { orgId, org } = useAuth();
  const { data: readiness, isLoading, isError, error, refetch } = useEstateReadiness(orgId);
  const { data: repos } = useRepositories(orgId);
  const { data: scans } = useScans(orgId);

  const activeScan = scans?.find((s) => s.status === 'running' || s.status === 'queued');
  const attention = readiness?.attention ?? [];
  const hasRepos = (repos?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title={org ? org.name : 'Overview'}
        description="Your current CRA compliance situation across every connected repository."
        action={
          <>
            <Link to="/app/reports">
              <Button icon={<FileText size={14} />}>Reports</Button>
            </Link>
            <Link to="/app/onboarding">
              <Button variant="primary" icon={<Plus size={14} />}>
                Add repository
              </Button>
            </Link>
          </>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} title="Something went wrong while assessing your readiness" />
      ) : (
        <div className="space-y-6">
          {/* 1. The answer ----------------------------------------------- */}
          <section>
            {isLoading || !readiness ? (
              <Skeleton className="h-36" />
            ) : (
              <Card className="overflow-hidden">
                <div className="grid gap-6 p-5 lg:grid-cols-[auto_1fr] lg:items-center">
                  <div className="flex items-center gap-5">
                    <ScoreDial score={readiness.score} grade={readiness.grade} hasRepos={hasRepos} />
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wider text-faint">CRA readiness</p>
                      <p className="mt-1 text-xl font-semibold tracking-tight text-text">
                        {hasRepos ? `${readiness.score} out of 100` : 'Not assessed yet'}
                      </p>
                      <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
                        {hasRepos
                          ? explanation(readiness.totals, readiness.repositories.length)
                          : 'Connect a repository and the first scan produces your posture in a few minutes.'}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-faint">
                        <span>
                          Assessed {relativeTime(readiness.evaluatedAt)} · {readiness.repositories.length} repositor
                          {readiness.repositories.length === 1 ? 'y' : 'ies'}
                        </span>
                        <Link to="/app/compliance" className="text-accent hover:underline">
                          See how this is calculated
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Domain breakdown: the "why" of the number, in one line each. */}
                  <div className="grid gap-x-8 gap-y-2.5 border-t border-border pt-4 sm:grid-cols-2 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                    {readiness.domains.slice(0, 8).map((domain) => (
                      <div key={domain.domain} className="flex items-center gap-3">
                        <span className="w-[104px] shrink-0 truncate text-xs text-muted" title={domain.name}>
                          {domain.name}
                        </span>
                        <ProgressBar
                          value={domain.score}
                          className="h-1.5 flex-1"
                          colour={domain.score >= 75 ? 'var(--color-pass)' : domain.score >= 45 ? 'var(--color-partial)' : 'var(--color-fail)'}
                        />
                        <span className="mono w-7 shrink-0 text-right text-[11px] text-faint">{domain.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </section>

          {/* 2. What needs a human --------------------------------------- */}
          {activeScan ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
              <span className="h-2 w-2 shrink-0 animate-pulse-soft rounded-full bg-accent" />
              <p className="flex-1 text-sm text-text">
                A scan is running. Results appear as soon as it finishes — you do not need to refresh.
              </p>
              <Link to={`/app/repositories/${activeScan.repositoryId}`}>
                <Button size="sm" variant="ghost" icon={<ArrowRight size={13} />}>
                  Watch
                </Button>
              </Link>
            </div>
          ) : null}

          <section>
            <div className="mb-2.5 flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-semibold text-text">
                {attention.length > 0 ? `${attention.length} thing${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} attention` : 'Nothing needs attention'}
              </h2>
              {attention.length > 0 ? (
                <Link to="/app/findings" className="text-xs text-accent hover:underline">
                  All findings
                </Link>
              ) : null}
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : attention.length === 0 ? (
              <Card>
                <div className="flex items-start gap-3 p-4">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-pass" />
                  <div>
                    <p className="text-sm font-medium text-text">You are on top of everything we can see</p>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
                      No open critical findings, no missed due dates and no unassessed gaps. Monitoring continues in the
                      background — if a new advisory matches your components, it will appear here.
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              <ul className="space-y-2">
                {attention.slice(0, 6).map((item) => {
                  const Icon = KIND_ICON[item.kind] ?? AlertTriangle;
                  const style = SEVERITY_STYLE[item.severity];
                  return (
                    <li key={item.id}>
                      <Card className={cx('border-l-2 transition-colors hover:bg-surface-2/40', style.border)}>
                        <div className="flex flex-wrap items-start gap-3 p-3.5">
                          <Icon size={16} className={cx('mt-0.5 shrink-0', style.icon)} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug text-text">{item.title}</p>
                            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{item.why}</p>
                          </div>
                          {item.href ? (
                            <Link to={item.href} className="shrink-0">
                              <Button size="sm" variant="secondary" icon={<ArrowRight size={13} />}>
                                {item.kind === 'missing_evidence' ? 'Add evidence' : item.kind === 'control_gap' ? 'Review' : 'Resolve'}
                              </Button>
                            </Link>
                          ) : null}
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 3. The estate ------------------------------------------------ */}
          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <CardHeader
                title="Repositories"
                subtitle={hasRepos ? `${repos?.length ?? 0} monitored` : undefined}
                action={
                  <Link to="/app/repositories" className="text-xs text-accent hover:underline">
                    View all
                  </Link>
                }
              />
              {!repos ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-9" />
                  ))}
                </div>
              ) : repos.length === 0 ? (
                <EmptyState
                  icon={<Boxes size={22} />}
                  title="No repositories yet"
                  description="Connect GitHub or upload a source archive. Your first scan produces an inventory, vulnerability matches and a readiness score."
                  action={
                    <Link to="/app/onboarding">
                      <Button variant="primary" icon={<ArrowRight size={14} />}>
                        Scan your first repository
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Repository</Th>
                      <Th>Readiness</Th>
                      <Th>Open findings</Th>
                      <Th>Last scan</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {repos.slice(0, 8).map((repo) => {
                      const estate = readiness?.repositories.find((r) => r.id === repo.id);
                      return (
                        <Tr key={repo.id} onClick={() => (window.location.href = `/app/repositories/${repo.id}`)}>
                          <Td>
                            <span className="text-sm text-text">{repo.fullName ?? repo.name}</span>
                          </Td>
                          <Td>
                            {repo.readinessScore !== null ? (
                              <div className="flex items-center gap-2">
                                <span
                                  className="mono text-sm font-medium"
                                  style={{ color: gradeColour(gradeFor(repo.readinessScore)) }}
                                >
                                  {Math.round(repo.readinessScore)}
                                </span>
                                <ProgressBar
                                  value={repo.readinessScore}
                                  className="w-16"
                                  colour={gradeColour(gradeFor(repo.readinessScore))}
                                />
                              </div>
                            ) : (
                              <span className="text-xs text-faint">Not assessed</span>
                            )}
                          </Td>
                          <Td>
                            <div className="flex items-center gap-1.5">
                              {(estate?.openKev ?? 0) > 0 ? (
                                <Badge className="border-fail/30 bg-fail/10 text-fail">
                                  <Zap size={10} /> {estate?.openKev}
                                </Badge>
                              ) : null}
                              {(estate?.openCritical ?? 0) > 0 ? (
                                <Badge className="border-fail/30 bg-fail/10 text-fail">{estate?.openCritical} critical</Badge>
                              ) : null}
                              {(estate?.openHigh ?? 0) > 0 ? (
                                <Badge className="border-high/30 bg-high/10 text-high">{estate?.openHigh} high</Badge>
                              ) : null}
                              {(estate?.openKev ?? 0) === 0 && (estate?.openCritical ?? 0) === 0 && (estate?.openHigh ?? 0) === 0 ? (
                                <span className="text-xs text-faint">None open</span>
                              ) : null}
                            </div>
                          </Td>
                          <Td className="whitespace-nowrap text-xs text-muted">{relativeTime(repo.lastScanAt)}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>

            <div className="space-y-5">
              {/* What we know, and what proves it. */}
              <Card>
                <CardHeader title="What this is based on" />
                <dl className="divide-y divide-border">
                  {[
                    { label: 'Components tracked', value: formatNumber(readiness?.inventory.components ?? 0), hint: readiness?.inventory.ecosystems.join(', ') || 'No components yet' },
                    { label: 'Evidence collected', value: formatNumber(readiness ? countEvidence(readiness) : 0), hint: 'Policies, reports and scan artefacts' },
                    { label: 'Expectations met', value: `${readiness?.totals.passed ?? 0} of ${totalAssessed(readiness?.totals)}`, hint: 'Across every active repository' },
                    {
                      label: 'Needs confirmation',
                      value: String((readiness?.totals.needsReview ?? 0) + (readiness?.totals.missing ?? 0)),
                      hint: 'Gaps or controls we could not confirm',
                    },
                  ].map((row) => (
                    <div key={row.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                      <div className="min-w-0">
                        <dt className="text-xs text-muted">{row.label}</dt>
                        <dd className="text-[11px] text-faint">{row.hint}</dd>
                      </div>
                      <dd className="mono shrink-0 text-sm font-medium tabular-nums text-text">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              {/* The next three moves, in the order we would make them. */}
              {readiness && readiness.actions.length > 0 ? (
                <Card>
                  <CardHeader
                    title="Recommended next steps"
                    subtitle="Highest impact first"
                    action={
                      <Link to="/app/compliance" className="text-xs text-accent hover:underline">
                        All gaps
                      </Link>
                    }
                  />
                  <ol className="divide-y divide-border">
                    {readiness.actions.slice(0, 4).map((action, index) => (
                      <li key={`${action.controlId}-${index}`} className="px-4 py-2.5">
                        <div className="flex items-start gap-2.5">
                          <span className="mono mt-0.5 text-[11px] text-faint">{String(index + 1).padStart(2, '0')}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-medium leading-snug text-text">{action.title}</p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{action.remediation}</p>
                            {action.repositoryName ? (
                              <p className="mt-1 text-[11px] text-faint">{action.repositoryName}</p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </Card>
              ) : null}

              <Card className="border-border bg-surface/40">
                <div className="flex items-start gap-2.5 p-3.5">
                  <ShieldCheck size={15} className="mt-0.5 shrink-0 text-pass" />
                  <p className="text-xs leading-relaxed text-muted">
                    Every status on this page carries the evidence behind it. Open any control to see what CRAOS found,
                    what it could not find, and what would change the answer.{' '}
                    <Link to="/app/evidence" className="text-accent hover:underline">
                      Open the evidence vault
                    </Link>
                  </p>
                </div>
              </Card>
            </div>
          </div>

          <p className="flex items-center gap-2 text-[11px] text-faint">
            <Layers size={12} />
            CRA Compliance OS helps you assess and evidence readiness for the Cyber Resilience Act. It does not certify
            conformity and is not legal advice.
          </p>
        </div>
      )}
    </>
  );
}

/** The dial is decoration; the number beside it is the answer. */
function ScoreDial({ score, grade, hasRepos }: { score: number; grade: string; hasRepos: boolean }) {
  const colour = gradeColour(hasRepos ? grade : null);
  const radius = 34;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative shrink-0">
      <svg width={84} height={84} className="-rotate-90" role="img" aria-label={`Readiness ${hasRepos ? `${score} out of 100` : 'not assessed'}`}>
        <circle cx={42} cy={42} r={radius} fill="none" stroke="var(--color-surface-3)" strokeWidth={7} />
        {hasRepos ? (
          <circle
            cx={42}
            cy={42}
            r={radius}
            fill="none"
            stroke={colour}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-lg font-semibold" style={{ color: hasRepos ? colour : 'var(--color-faint)' }}>
        {hasRepos ? grade : '—'}
      </span>
    </div>
  );
}

function gradeFor(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'E';
}

function totalAssessed(totals?: { passed: number; partial: number; missing: number; needsReview: number; notApplicable: number }): number {
  if (!totals) return 0;
  return totals.passed + totals.partial + totals.missing + totals.needsReview;
}

/**
 * How many distinct pieces of evidence the current assessment rests on.
 * Controls list evidence by id, so this counts unique artefacts — the number a
 * customer would quote when asked "what have you got?".
 */
function countEvidence(readiness: { assessments: Array<{ evidence?: string[] }> }): number {
  const ids = new Set<string>();
  for (const assessment of readiness.assessments) {
    for (const item of assessment.evidence ?? []) ids.add(item);
  }
  return ids.size;
}

function explanation(
  totals: { passed: number; partial: number; missing: number; needsReview: number },
  repositories: number,
): string {
  const needWork = totals.missing + totals.needsReview;
  if (repositories === 0) return 'Connect a repository to begin.';
  if (needWork === 0) {
    return `${totals.passed} CRA expectations are met with evidence across ${repositories} repositor${repositories === 1 ? 'y' : 'ies'}.`;
  }
  return `${totals.passed} expectations met, ${totals.partial} partially met, and ${needWork} still need attention across ${repositories} repositor${repositories === 1 ? 'y' : 'ies'}.`;
}
