import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Clock,
  Download,
  FileText,
  Send,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, downloadUrl } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Modal,
  ProgressBar,
  Skeleton,
  Textarea,
  useToast,
} from '../components/ui';
import { PageHeader } from '../components/layout';
import {
  SEVERITY_CLASS,
  INCIDENT_STATE_CLASS,
  INCIDENT_PROGRESS,
  cx,
  formatDate,
  incidentLabel,
  relativeTime,
  severity,
} from '../lib/format';

interface Report {
  id: string;
  kind: 'early_warning' | 'notification' | 'final';
  bodyMarkdown: string;
  generatedBy: 'template' | 'ai';
  state: 'draft' | 'approved' | 'exported';
  approvedAt: number | null;
  createdAt: number;
  sourcesJson?: string | null;
}

interface IncidentDetailResponse {
  incident: {
    id: string;
    title: string;
    state: string;
    severity: string;
    repositoryId: string;
    awarenessAt: number;
    earlyWarningDueAt: number | null;
    notificationDueAt: number | null;
    finalReportDueAt: number | null;
    kevFlag: boolean;
    activelyExploited: boolean;
    severityRationale: string | null;
    vulnerabilityId: string;
  };
  facts: Record<string, unknown>;
  reports: Report[];
  timeline: Array<{ at: number; event: string; actor: string | null }>;
}

const KIND_LABEL: Record<Report['kind'], string> = {
  early_warning: 'Early warning · 24 hours',
  notification: 'Notification · 72 hours',
  final: 'Final report · 14 days',
};

const KIND_CREDITS: Record<Report['kind'], number> = {
  early_warning: 200,
  notification: 200,
  final: 200,
};

function Countdown({ dueAt, label }: { dueAt: number | null; label: string }) {
  if (!dueAt) {
    return (
      <div className="rounded-lg border border-border px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
        <p className="mt-1 text-sm text-faint">Not yet due</p>
      </div>
    );
  }
  const remaining = dueAt - Date.now();
  const total = 86_400_000;
  const overdue = remaining < 0;
  const pct = Math.max(0, Math.min(100, (1 - remaining / total) * 100));

  return (
    <div className={cx('rounded-lg border px-3 py-2.5', overdue ? 'border-fail/40 bg-fail/5' : 'border-border')}>
      <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
      <p className={cx('mt-1 text-sm font-medium', overdue ? 'text-fail' : 'text-text')}>{relativeTime(dueAt)}</p>
      <p className="mt-0.5 text-[11px] text-faint">{formatDate(dueAt)}</p>
      <ProgressBar value={overdue ? 100 : pct} className="mt-2" colour={overdue ? 'var(--color-fail)' : 'var(--color-accent)'} />
    </div>
  );
}

export function IncidentDetail({ incidentId }: { incidentId: string }) {
  const { orgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Report | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [correctiveOpen, setCorrectiveOpen] = useState(false);
  const [corrective, setCorrective] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => api.get<IncidentDetailResponse>(`/organizations/${orgId}/incidents/${incidentId}`),
    enabled: Boolean(orgId && incidentId),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['incident', incidentId] });

  const generate = useMutation({
    mutationFn: (kind: Report['kind']) =>
      api.post<{ drafts: Report[] }>(`/organizations/${orgId}/incidents/${incidentId}/drafts`, { kind }),
    onSuccess: () => {
      toast.success('Draft generated from your scan data');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not generate the draft'),
  });

  const save = useMutation({
    mutationFn: ({ reportId, body }: { reportId: string; body: string }) =>
      api.patch(`/organizations/${orgId}/incidents/${incidentId}/reports/${reportId}`, { bodyMarkdown: body }),
    onSuccess: () => {
      toast.success('Draft updated');
      setEditing(null);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not save'),
  });

  const approve = useMutation({
    mutationFn: (reportId: string) => api.post(`/organizations/${orgId}/incidents/${incidentId}/reports/${reportId}/approve`, { note }),
    onSuccess: () => {
      toast.success('Approved and recorded in the audit trail');
      setNote('');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not approve'),
  });

  const correctiveMeasure = useMutation({
    mutationFn: (description: string) =>
      api.post(`/organizations/${orgId}/incidents/${incidentId}/corrective-measure`, { description }),
    onSuccess: () => {
      toast.success('Corrective measure recorded — the 14-day final report clock has started');
      setCorrectiveOpen(false);
      setCorrective('');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not record'),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <div className="px-4 py-10 text-center text-sm text-muted">Incident not found.</div>
      </Card>
    );
  }

  const { incident, reports, timeline } = data;
  const sev = severity(incident.severity);
  const hasKind = (kind: Report['kind']) => reports.some((r) => r.kind === kind);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/app/incidents" className="hover:text-muted">
            Incidents
          </Link>
        }
        title={incident.title}
        description={`Article 14 reporting · aware ${formatDate(incident.awarenessAt)}`}
        action={
          <>
            <Badge className={SEVERITY_CLASS[sev]}>{sev}</Badge>
            {incident.kevFlag ? (
              <Badge className="border-critical/40 bg-critical/15 text-critical">
                <Zap size={10} /> KEV
              </Badge>
            ) : null}
            <Badge className={INCIDENT_STATE_CLASS[incident.state]}>{incidentLabel(incident.state)}</Badge>
          </>
        }
      />

      {/* Where this incident sits in the reporting workflow. */}
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {INCIDENT_PROGRESS.filter((state) => state !== 'closed' || incident.state === 'closed').map((state, index) => {
          const position = INCIDENT_PROGRESS.indexOf(incident.state);
          const done = index < position;
          const current = index === position;
          return (
            <span key={state} className="flex items-center gap-2">
              {index > 0 ? <span className="text-faint">→</span> : null}
              <span
                className={cx(
                  'text-[11px]',
                  current ? 'font-medium text-text' : done ? 'text-muted' : 'text-faint',
                )}
              >
                {incidentLabel(state)}
              </span>
            </span>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Countdown dueAt={incident.earlyWarningDueAt} label="Early warning · 24 hours" />
        <Countdown dueAt={incident.notificationDueAt} label="Notification · 72 hours" />
        <Countdown dueAt={incident.finalReportDueAt} label="Final report · 14 days" />
      </div>

      {incident.severityRationale ? (
        <div className="mt-4">
          <Alert tone="info" title="Why this severity">
            {incident.severityRationale}
          </Alert>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Report drafts"
              subtitle="Generated from your scan data. Review and edit before any submission."
              action={
                <div className="flex gap-1.5">
                  {(['early_warning', 'notification', 'final'] as const).map((kind) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant={hasKind(kind) ? 'ghost' : 'secondary'}
                      loading={generate.isPending}
                      disabled={hasKind(kind)}
                      onClick={() => generate.mutate(kind)}
                      icon={<Sparkles size={12} />}
                    >
                      {hasKind(kind) ? 'Done' : `${kind === 'early_warning' ? '24h' : kind === 'notification' ? '72h' : 'Final'} draft`}
                    </Button>
                  ))}
                </div>
              }
            />

            {reports.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <FileText size={20} className="mx-auto text-faint" />
                <p className="mt-2 text-sm text-text">No drafts yet</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
                  Generating a draft costs {KIND_CREDITS.early_warning} credits. It fills in what your repository and
                  scans already know: product, component, advisory, severity, fix status and the applicable deadline.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {reports.map((report) => (
                  <div key={report.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">{KIND_LABEL[report.kind]}</span>
                        <Badge
                          className={
                            report.state === 'approved'
                              ? 'border-pass/30 bg-pass/10 text-pass'
                              : report.state === 'exported'
                                ? 'border-info/30 bg-info/10 text-info'
                                : undefined
                          }
                        >
                          {report.state === 'draft' ? 'Draft' : report.state === 'approved' ? 'Approved' : 'Exported'}
                        </Badge>
                        <Badge className={report.generatedBy === 'ai' ? 'border-accent/30 bg-accent/10 text-accent' : undefined}>
                          {report.generatedBy === 'ai' ? 'model draft' : 'template'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(report);
                            setDraft(report.bodyMarkdown);
                          }}
                        >
                          Edit
                        </Button>
                        <a href={downloadUrl(`/organizations/${orgId}/incidents/${incidentId}/reports/${report.id}/export`)}>
                          <Button size="sm" variant="ghost" icon={<Download size={12} />}>
                            Export
                          </Button>
                        </a>
                        {report.state === 'draft' ? (
                          <Button size="sm" variant="success" onClick={() => approve.mutate(report.id)} icon={<Check size={12} />}>
                            Approve
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <pre className="mt-2.5 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2/50 p-3 font-sans text-xs leading-relaxed text-muted">
                      {report.bodyMarkdown}
                    </pre>

                    {report.approvedAt ? (
                      <p className="mt-2 text-[11px] text-pass">Approved {formatDate(report.approvedAt)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Actions" />
            <div className="space-y-2 p-4">
              <Button
                className="w-full"
                icon={<Clock size={13} />}
                onClick={() => setCorrectiveOpen(true)}
                disabled={Boolean(incident.finalReportDueAt)}
              >
                {incident.finalReportDueAt ? 'Corrective measure recorded' : 'Record corrective measure'}
              </Button>
              <p className="text-[11px] leading-relaxed text-faint">
                Recording a corrective measure starts the 14-day clock for the final report, as Article 14 requires.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Timeline" subtitle="Immutable audit trail" />
            <ul className="divide-y divide-border">
              {(timeline ?? []).map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="px-4 py-2.5">
                  <p className="text-xs text-text">{entry.event}</p>
                  <p className="text-[11px] text-faint">
                    {formatDate(entry.at)}
                    {entry.actor ? ` · ${entry.actor}` : ''}
                  </p>
                </li>
              ))}
              {!timeline?.length ? <li className="px-4 py-6 text-center text-xs text-faint">Nothing recorded yet.</li> : null}
            </ul>
          </Card>

          <div className="rounded-lg border border-partial/30 bg-partial/5 px-3.5 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-partial" />
              <p className="text-[11px] leading-relaxed text-muted">
                Every draft is labelled <span className="text-text">Draft — engineering evidence</span>. Nothing here is
                legal advice, and the platform does not submit anything to a regulator on your behalf.
              </p>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit ${editing ? KIND_LABEL[editing.kind] : ''}`}
        width="max-w-3xl"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => editing && save.mutate({ reportId: editing.id, body: draft })}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea rows={20} value={draft} onChange={(e) => setDraft(e.target.value)} className="mono text-xs" />
          <p className="text-[11px] text-faint">
            Edits are versioned in the audit trail. Saving does not approve or file anything.
          </p>
        </div>
      </Modal>

      <Modal
        open={correctiveOpen}
        onClose={() => setCorrectiveOpen(false)}
        title="Record corrective measure"
        footer={
          <>
            <Button onClick={() => setCorrectiveOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={correctiveMeasure.isPending}
              disabled={corrective.trim().length < 10}
              onClick={() => correctiveMeasure.mutate(corrective)}
              icon={<Send size={13} />}
            >
              Record and start 14-day clock
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            rows={5}
            value={corrective}
            onChange={(e) => setCorrective(e.target.value)}
            placeholder="What was done, or what is planned, to mitigate the vulnerability? Include versions shipped and dates."
          />
          <p className="text-[11px] text-faint">
            This appears in the final report as the corrective measure, and starts the 14-day submission window.
          </p>
        </div>
      </Modal>
    </>
  );
}
