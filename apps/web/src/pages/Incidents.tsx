import { Link } from 'react-router-dom';
import {AlertTriangle, ShieldAlert, Zap} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useIncidents, useRepositories } from '../lib/queries';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ProgressBar,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '../components/ui';
import { PageHeader } from '../components/layout';
import { ErrorState } from '../components/errors';
import {
  INCIDENT_STATE_CLASS,
  SEVERITY_CLASS,
  cx,
  formatDate,
  incidentLabel,
  relativeTime,
  severity,
} from '../lib/format';

/** Clocks, not statuses: what matters is whether the deadline has passed. */

/**
 * Article 14 clock helper.
 *
 * The regulation gives you 24 hours from awareness for the early warning,
 * 72 hours for the notification, and 14 days from the corrective measure for
 * the final report. The UI shows the remaining time, not just the deadline,
 * because under an active incident nobody wants to do date arithmetic.
 */
function ClockCell({ dueAt, label }: { dueAt: number | null; label: string }) {
  if (!dueAt) return <span className="text-xs text-faint">not yet due</span>;

  const remaining = dueAt - Date.now();
  const overdue = remaining < 0;
  const urgent = remaining < 6 * 3_600_000;

  return (
    <div>
      <p className={cx('text-xs', overdue ? 'text-fail' : urgent ? 'text-partial' : 'text-muted')}>
        {label} · {relativeTime(dueAt)}
      </p>
      <p className="text-[11px] text-faint">{formatDate(dueAt)}</p>
    </div>
  );
}

export function Incidents() {
  const { orgId } = useAuth();
  const { data: incidents, isLoading, isError, error, refetch } = useIncidents(orgId);
  const { data: repos } = useRepositories(orgId);

  const open = (incidents ?? []).filter((i) => i.state !== 'closed');
  const overdue = open.filter((i) => {
    const next = i.earlyWarningDueAt ?? i.notificationDueAt;
    return next !== null && next < Date.now();
  });
  const exploited = open.filter((i) => i.kevFlag || i.activelyExploited);

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Article 14 reporting for actively exploited vulnerabilities: 24-hour early warning, 72-hour notification, and a final report within 14 days of a corrective measure becoming available. Drafts are engineering evidence for review before filing."
      />

      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-border bg-surface/50 px-3.5 py-3">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-partial" />
        <p className="text-xs leading-relaxed text-muted">
          These drafts assemble what your repository and scans actually show. They are not legal advice, they do not
          file anything on your behalf, and they must be reviewed by a qualified person before submission to ENISA or
          your national CSIRT.
        </p>
      </div>

      {/* What needs a person, before any table. */}
      {incidents && incidents.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-4">
          {(
            [
              ['Open', open.length, open.length > 0 ? 'text-text' : 'text-faint'],
              ['Clock overdue', overdue.length, overdue.length > 0 ? 'text-fail' : 'text-faint'],
              ['Actively exploited', exploited.length, exploited.length > 0 ? 'text-fail' : 'text-faint'],
            ] as const
          ).map(([label, value, tone]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className={cx('mono text-lg font-semibold tabular-nums', tone)}>{value}</span>
              <span className="text-xs text-muted">{label}</span>
            </div>
          ))}
          {overdue.length > 0 ? (
            <p className="w-full text-xs leading-relaxed text-fail">
              {overdue.length} incident{overdue.length === 1 ? ' is' : 's are'} past the 24-hour or 72-hour deadline.
              File what you have — a late report is better than no report.
            </p>
          ) : null}
        </div>
      ) : null}

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} title="Something went wrong while loading incidents" />
      ) : (
      <>
      <Card className="mt-6">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : incidents && incidents.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Incident</Th>
                <Th>Severity</Th>
                <Th>State</Th>
                <Th>Early warning (24h)</Th>
                <Th>Notification (72h)</Th>
                <Th>Final report (14d)</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => {
                const sev = severity(incident.severity);
                return (
                  <Tr key={incident.id} onClick={() => (window.location.href = `/app/incidents/${incident.id}`)}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text">{incident.title}</span>
                        {incident.kevFlag ? (
                          <Badge className="border-critical/40 bg-critical/15 text-critical">
                            <Zap size={10} /> KEV
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-faint">
                        {repos?.find((r) => r.id === incident.repositoryId)?.name ?? 'Repository'} · aware{' '}
                        {formatDate(incident.awarenessAt)}
                      </p>
                    </Td>
                    <Td>
                      <Badge className={SEVERITY_CLASS[sev]}>{sev}</Badge>
                    </Td>
                    <Td>
                      <Badge className={INCIDENT_STATE_CLASS[incident.state]}>{incidentLabel(incident.state)}</Badge>
                    </Td>
                    <Td>
                      <ClockCell dueAt={incident.earlyWarningDueAt} label="24h" />
                    </Td>
                    <Td>
                      <ClockCell dueAt={incident.notificationDueAt} label="72h" />
                    </Td>
                    <Td>
                      <ClockCell dueAt={incident.finalReportDueAt} label="14d" />
                    </Td>
                    <Td className="text-right">
                      <Link to={`/app/incidents/${incident.id}`}>
                        <Button size="sm" variant="ghost">
                          Open
                        </Button>
                      </Link>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon={<ShieldAlert size={22} />}
            title="No incidents"
            description="When a finding is being actively exploited, open an incident from the vulnerability list and the reporting clocks start immediately."
            action={
              <Link to="/app/repositories">
                <Button>Review repositories</Button>
              </Link>
            }
          />
        )}
      </Card>

      {open.length > 0 ? (
        <Card className="mt-4">
          <CardHeader title="Reporting windows" subtitle="Progress against the Article 14 deadlines" />
          <div className="space-y-3 p-4">
            {open.slice(0, 5).map((incident) => {
              const total = (incident.notificationDueAt ?? incident.earlyWarningDueAt ?? Date.now()) - incident.awarenessAt;
              const elapsed = Date.now() - incident.awarenessAt;
              return (
                <div key={incident.id}>
                  <div className="flex justify-between text-[11px]">
                    <span className="truncate text-muted">{incident.title}</span>
                    <span className="text-faint">{relativeTime(incident.earlyWarningDueAt)}</span>
                  </div>
                  <ProgressBar
                    value={Math.min(100, (elapsed / Math.max(total, 1)) * 100)}
                    className="mt-1"
                    colour={elapsed > total ? 'var(--color-fail)' : undefined}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
      </>
      )}
    </>
  );
}
