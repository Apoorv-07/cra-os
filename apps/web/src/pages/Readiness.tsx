import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Eye, Info, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useReadiness, useRepositories } from '../lib/queries';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Modal,
  ScoreRing,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '../components/ui';
import { PageHeader } from '../components/layout';
import { STATUS_CLASS, STATUS_LABEL, cx, formatDate, gradeColour, type ControlStatus } from '../lib/format';

interface ControlRow {
  id: string;
  key: string;
  title: string;
  domain: string;
  domainName: string;
  weight: number;
  status: ControlStatus;
  score: number;
  confidence: string;
  rationale: string;
  remediation: string | null;
  legalRef: string | null;
  obligation: string | null;
  evidence: string[];
  reviewedAt: number | null;
}

interface ReadinessDetail {
  score: number;
  grade: string;
  evaluatedAt: number;
  domains: Array<{ id: string; name: string; score: number; controls: number }>;
  controls: ControlRow[];
  topActions: string[];
}

/**
 * Readiness is the product's core promise, so this screen is deliberately
 * verbose: every control shows *why* it scored what it scored and what would
 * change the answer. A score you cannot interrogate is not evidence.
 */
export function ReadinessPage() {
  const { orgId } = useAuth();
  const { repositoryId } = useParams();
  const { data: repos } = useRepositories(orgId);
  const [selected, setSelected] = useState<string>(repositoryId ?? '');
  const [statusFilter, setStatusFilter] = useState<'all' | ControlStatus>('all');
  const [review, setReview] = useState<ControlRow | null>(null);
  const toast = useToast();
  const qc = useQueryClient();

  const repoId = repositoryId ?? (selected || repos?.[0]?.id);

  const { data, isLoading } = useQuery<ReadinessDetail>({
    queryKey: ['readiness-detail', repoId],
    queryFn: () => api.get<ReadinessDetail>(`/organizations/${orgId}/repositories/${repoId}/readiness`),
    enabled: Boolean(orgId && repoId),
  });

  const readinessFallback = useReadiness(orgId, repositoryId ? undefined : repoId);
  const detail = data ?? (readinessFallback.data as unknown as ReadinessDetail | undefined);

  const submitReview = useMutation({
    mutationFn: ({ controlId, status, note }: { controlId: string; status: ControlStatus; note: string }) =>
      api.post(`/organizations/${orgId}/repositories/${repoId}/assessments/${controlId}/review`, {
        status,
        note,
      }),
    onSuccess: () => {
      toast.success('Review recorded. The audit trail keeps the original assessment.');
      setReview(null);
      void qc.invalidateQueries({ queryKey: ['readiness-detail', repoId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not save the review'),
  });

  const byDomain = useMemo(() => {
    const groups = new Map<string, ControlRow[]>();
    for (const control of detail?.controls ?? []) {
      const list = groups.get(control.domainName ?? 'Other') ?? [];
      list.push(control);
      groups.set(control.domainName ?? 'Other', list);
    }
    return [...groups.entries()];
  }, [detail]);

  const filtered = useMemo(
    () =>
      (detail?.controls ?? []).filter((c) => statusFilter === 'all' || c.status === statusFilter),
    [detail, statusFilter],
  );

  const counts = useMemo(() => {
    const acc: Record<string, number> = { passed: 0, partial: 0, missing: 0, needs_review: 0, not_applicable: 0 };
    for (const control of detail?.controls ?? []) acc[control.status] = (acc[control.status] ?? 0) + 1;
    return acc;
  }, [detail]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!detail) {
    return (
      <>
        <PageHeader title="CRA readiness" description="Assess a repository against the CRA control catalogue." />
        <Card>
          <EmptyState
            icon={<ShieldCheck size={22} />}
            title="Nothing to assess yet"
            description="Add a repository and run a scan. Readiness is computed from real repository state, not from a questionnaire."
            action={
              <Link to="/app/onboarding">
                <Button variant="primary">Scan your first repository</Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="CRA readiness"
        description="Each control is evaluated from repository state, scan results and stored evidence. Scores are weighted; every row states the reason."
        action={
          <Select value={repoId ?? ''} onChange={(e) => setSelected(e.target.value)} className="min-w-56">
            {(repos ?? []).map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.fullName ?? repo.name}
              </option>
            ))}
          </Select>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <Card className="flex flex-col items-center px-5 py-6">
            <ScoreRing score={detail.score} grade={detail.grade} size={132} colour={gradeColour(detail.grade)} />
            <p className="mt-3 text-sm font-medium text-text">Weighted readiness</p>
            <p className="mt-1 text-[11px] text-faint">Evaluated {formatDate(detail.evaluatedAt)}</p>

            <div className="mt-4 grid w-full grid-cols-2 gap-1.5 text-[11px]">
              {(['passed', 'partial', 'missing', 'needs_review'] as const).map((status) => (
                <div key={status} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5">
                  <span className="text-muted">{STATUS_LABEL[status]}</span>
                  <span className="mono text-text">{counts[status] ?? 0}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="By domain" />
            <ul className="divide-y divide-border">
              {(detail.domains ?? []).map((domain) => (
                <li key={domain.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-text">{domain.name}</span>
                    <span className="mono text-[11px] text-muted">{Math.round(domain.score)}</span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(2, domain.score)}%`, background: gradeColour(domain.score >= 90 ? 'A' : domain.score >= 75 ? 'B' : domain.score >= 60 ? 'C' : domain.score >= 40 ? 'D' : 'E') }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {detail.topActions?.length ? (
            <Card>
              <CardHeader title="Do these first" />
              <ol className="divide-y divide-border">
                {detail.topActions.map((action, index) => (
                  <li key={action} className="flex gap-2.5 px-4 py-2.5 text-xs text-muted">
                    <span className="mono text-faint">{index + 1}</span>
                    <span className="leading-relaxed">{action}</span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
              {(['all', 'missing', 'partial', 'passed', 'needs_review'] as const).map((key) => (
                <Button key={key} size="sm" variant={statusFilter === key ? 'secondary' : 'ghost'} onClick={() => setStatusFilter(key)}>
                  {key === 'all' ? `All ${detail.controls.length}` : `${STATUS_LABEL[key]} ${counts[key] ?? 0}`}
                </Button>
              ))}
            </div>
          </Card>

          {byDomain.map(([domainName, controls]) => {
            const visible = controls.filter((c) => statusFilter === 'all' || c.status === statusFilter);
            if (!visible.length) return null;
            return (
              <Card key={domainName}>
                <CardHeader title={domainName} subtitle={`${controls.length} controls`} />
                <ul className="divide-y divide-border">
                  {visible.map((control) => (
                    <li key={control.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-text">{control.title}</span>
                            <Badge className={STATUS_CLASS[control.status]}>{STATUS_LABEL[control.status]}</Badge>
                            <Badge>weight {control.weight}</Badge>
                            {control.reviewedAt ? (
                              <Badge className="border-info/30 bg-info/10 text-info">
                                <Eye size={10} /> reviewed
                              </Badge>
                            ) : null}
                          </div>

                          <p className="mt-1.5 text-xs leading-relaxed text-muted">{control.rationale}</p>

                          {control.remediation && control.status !== 'passed' ? (
                            <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-partial">
                              <ChevronRight size={12} className="mt-0.5 shrink-0" />
                              {control.remediation}
                            </p>
                          ) : null}

                          {/* Provenance, not decoration: what the obligation is,
                              what supports the conclusion, and how sure we are —
                              with the control's identifier kept as a footnote
                              for the engineer who has to grep for it. */}
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                            {control.legalRef ? <span>{control.legalRef}</span> : null}
                            {control.evidence?.length ? (
                              <span>{control.evidence.length} supporting artefact{control.evidence.length === 1 ? '' : 's'}</span>
                            ) : null}
                            <span>confidence: {control.confidence}</span>
                            <details className="group inline-block">
                              <summary className="cursor-pointer list-none text-faint hover:text-muted">
                                details
                              </summary>
                              <span className="mono mt-1 block text-[11px] text-faint">{control.key}</span>
                              {control.evidence?.length ? (
                                <span className="mt-1 block text-[11px] text-faint">
                                  evidence: {control.evidence.join(', ')}
                                </span>
                              ) : null}
                            </details>
                          </div>
                        </div>

                        <Button size="sm" variant="ghost" onClick={() => setReview(control)}>
                          Review
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}

          {filtered.length === 0 ? (
            <Card>
              <EmptyState icon={<Check size={20} />} title="No controls match this filter" />
            </Card>
          ) : null}
        </div>
      </div>

      <Modal
        open={Boolean(review)}
        onClose={() => setReview(null)}
        title="Record a human review"
        footer={
          <>
            <Button onClick={() => setReview(null)}>Cancel</Button>
          </>
        }
      >
        {review ? (
          <ReviewForm
            control={review}
            onSave={(status, note) => submitReview.mutate({ controlId: review.key, status, note })}
            busy={submitReview.isPending}
          />
        ) : null}
      </Modal>

      <div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-surface/50 px-3.5 py-3">
        <Info size={14} className="mt-0.5 shrink-0 text-faint" />
        <p className="text-[11px] leading-relaxed text-muted">
          This assessment is engineering evidence generated from your repository and stored artefacts. It is not legal
          advice and it is not a conformity assessment. The controls are our structured reading of the CRA obligations,
          published with their rationale so you can disagree with them.
        </p>
      </div>
    </>
  );
}

function ReviewForm({
  control,
  onSave,
  busy,
}: {
  control: ControlRow;
  onSave: (status: ControlStatus, note: string) => void;
  busy: boolean;
}) {
  const [status, setStatus] = useState<ControlStatus>(control.status);
  const [note, setNote] = useState('');

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-text">{control.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{control.rationale}</p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted">Your assessment</span>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ControlStatus)}>
          <option value="passed">Met</option>
          <option value="partial">Partial</option>
          <option value="missing">Gap</option>
          <option value="needs_review">Needs review</option>
          <option value="not_applicable">Not applicable</option>
        </Select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted">Note</span>
        <Textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you check, and what did you find?"
        />
      </label>

      <div className={cx('flex', 'justify-end')}>
        <Button variant="primary" loading={busy} disabled={!note.trim()} onClick={() => onSave(status, note)}>
          Save review
        </Button>
      </div>
    </div>
  );
}
