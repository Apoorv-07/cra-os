import { useState } from 'react';
import {Check, Copy as CopyIcon, ExternalLink, FileText, Link2Off, Package, Plus, Share2, ShieldCheck} from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  useGenerateReport,
  useRepositories,
  useReport,
  useReports,
  useRevokeShare,
  useShareReport,
  type ReportRow,
  type ReportSection,
} from '../lib/queries';
import {Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, Tabs, Table, Td, Th, Tr, useToast} from '../components/ui';
import { ErrorState } from '../components/errors';
import { PageHeader } from '../components/layout';
import { cx, formatDate } from '../lib/format';

/**
 * Reports.
 *
 * A report is a document, so this screen renders it like one: a title block,
 * sections that read top to bottom, and a footer that says what the document is
 * and is not. Sharing is explicit and revocable, and a shared link never
 * exposes administration controls or raw vulnerability detail.
 */

const KIND_META: Record<string, { label: string; description: string; credits: number }> = {
  readiness: {
    label: 'CRA readiness',
    description: 'Where you stand, how the score is built, and what to do next.',
    credits: 100,
  },
  findings: {
    label: 'Findings',
    description: 'Every open issue in the order we would fix it, with the recommended action.',
    credits: 25,
  },
  evidence_pack: {
    label: 'Evidence pack',
    description: 'What you hold, what it supports, and the checksums that prove it.',
    credits: 50,
  },
};

function ReportDocument({ reportId }: { reportId: string }) {
  const { orgId } = useAuth();
  const { data, isLoading, isError, error } = useReport(orgId, reportId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (isError) return <ErrorState error={error} title="Something went wrong while loading this report" />;
  if (!data?.content) return <EmptyState title="This report has no content yet" />;

  const { content } = data;

  return (
    <article className="mx-auto max-w-3xl">
      <header className="border-b border-border pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-accent/30 bg-accent/10 text-accent">{KIND_META[data.kind]?.label ?? data.kind}</Badge>
          <span className="text-xs text-faint">{data.organisation}</span>
          <span className="text-xs text-faint">·</span>
          <span className="text-xs text-faint">{formatDate(data.createdAt)}</span>
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-text">{data.title}</h1>
        <p className="mt-1 text-sm text-muted">Scope: {content.scope}</p>
      </header>

      <div className="divide-y divide-border">
        {content.sections.map((section) => (
          <Section key={section.id} section={section} />
        ))}
      </div>

      <footer className="mt-8 rounded-lg border border-border bg-surface/50 px-4 py-3">
        <p className="text-[11px] leading-relaxed text-faint">{content.disclaimer}</p>
      </footer>
    </article>
  );
}

function Section({ section }: { section: ReportSection }) {
  return (
    <section className="py-6">
      <h2 className="text-sm font-semibold text-text">{section.heading}</h2>

      {section.kind === 'prose' && section.body ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{section.body}</p>
      ) : null}

      {section.kind === 'metrics' && section.metrics ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {section.metrics.map((metric) => (
            <div key={metric.label}>
              <dt className="text-[11px] uppercase tracking-wider text-faint">{metric.label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-text">{metric.value}</dd>
              {metric.description ? <dd className="text-[11px] text-faint">{metric.description}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}

      {section.kind === 'list' && section.items ? (
        <ol className="mt-3 space-y-3">
          {section.items.map((item, index) => (
            <li key={`${item.title}-${index}`} className="flex gap-3">
              <span className="mono mt-0.5 text-[11px] text-faint">{String(index + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <p
                  className={cx(
                    'text-sm',
                    item.tone === 'critical' ? 'text-text' : item.tone === 'warning' ? 'text-text' : 'text-text',
                  )}
                >
                  {item.title}
                </p>
                {item.detail ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {section.kind === 'table' && section.table ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {section.table.columns.map((column) => (
                  <th
                    key={column}
                    className="border-b border-border px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-faint"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, index) => (
                <tr key={index} className="hover:bg-surface-2/40">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cx(
                        'border-b border-border/60 px-3 py-2 align-top text-xs',
                        cellIndex === 0 ? 'text-text' : cellIndex === row.length - 1 ? 'text-faint' : 'text-muted',
                      )}
                    >
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function Reports() {
  const { orgId } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [kind, setKind] = useState<'readiness' | 'findings' | 'evidence_pack'>('readiness');
  const [repositoryId, setRepositoryId] = useState('');
  const [title, setTitle] = useState('');
  const [shareFor, setShareFor] = useState<ReportRow | null>(null);

  const { data, isLoading, isError, error, refetch } = useReports(orgId);
  const { data: repos } = useRepositories(orgId);
  const generate = useGenerateReport(orgId);
  const share = useShareReport(orgId);
  const revoke = useRevokeShare(orgId);

  const reports = data ?? [];

  if (view) {
    return (
      <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => setView(null)}>
            ← All reports
          </Button>
          <div className="flex items-center gap-2">
            <ShareButton row={reports.find((r) => r.id === view) ?? null} onShare={setShareFor} sharing={share.isPending} />
          </div>
        </div>
        <ReportDocument reportId={view} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Documents you can hand to a customer, an auditor or your own board. Every claim in them traces back to stored evidence."
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            Generate report
          </Button>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} title="Something went wrong while loading reports" />
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText size={22} />}
            title="No reports yet"
            description="Generate a readiness report to show where you stand, a findings report to hand to engineering, or an evidence pack for an auditor."
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                Generate your first report
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Report</Th>
                <Th>Scope</Th>
                <Th>Generated</Th>
                <Th>Shared</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {reports.map((row) => (
                <Tr key={row.id} onClick={() => setView(row.id)}>
                  <Td>
                    <div className="flex items-start gap-2.5">
                      {row.kind === 'evidence_pack' ? (
                        <Package size={14} className="mt-0.5 shrink-0 text-faint" />
                      ) : row.kind === 'findings' ? (
                        <FileText size={14} className="mt-0.5 shrink-0 text-faint" />
                      ) : (
                        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-faint" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text">{row.title}</p>
                        <p className="mt-0.5 text-[11px] text-faint">{KIND_META[row.kind]?.label ?? row.kind}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {row.repositoryId ? repos?.find((r) => r.id === row.repositoryId)?.fullName ?? 'Repository' : 'Whole organisation'}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDate(row.createdAt)}</Td>
                  <Td>
                    {row.shared ? (
                      <Badge className="border-pass/30 bg-pass/10 text-pass">
                        <Check size={10} /> Live · {row.shareViewCount} view{row.shareViewCount === 1 ? '' : 's'}
                      </Badge>
                    ) : (
                      <span className="text-xs text-faint">Not shared</span>
                    )}
                  </Td>
                  <Td className="w-10">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <ShareButton row={row} onShare={setShareFor} sharing={share.isPending} compact />
                      {row.shared ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Link2Off size={13} />}
                          aria-label="Revoke link"
                          loading={revoke.isPending}
                          onClick={() =>
                            revoke.mutate(row.id, {
                              onSuccess: () => toast.success('Link revoked. Anyone with it now sees nothing.'),
                              onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not revoke'),
                            })
                          }
                        />
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Generate */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Generate a report"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={generate.isPending}
              onClick={() =>
                generate.mutate(
                  { kind, repositoryId: repositoryId || undefined, title: title.trim() || undefined },
                  {
                    onSuccess: (result) => {
                      toast.success(`Report ready. ${result.creditsCharged} credits used.`);
                      setCreateOpen(false);
                      setTitle('');
                      setView(result.id);
                    },
                    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not generate the report'),
                  },
                )
              }
            >
              Generate · {KIND_META[kind].credits} credits
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">Type</p>
            <Tabs
              tabs={(['readiness', 'findings', 'evidence_pack'] as const).map((k) => ({ id: k, label: KIND_META[k].label }))}
              active={kind}
              onChange={setKind}
            />
            <p className="mt-2 text-xs leading-relaxed text-muted">{KIND_META[kind].description}</p>
          </div>

          <Field label="Scope">
            <Select value={repositoryId} onChange={(e) => setRepositoryId(e.target.value)}>
              <option value="">Whole organisation</option>
              {repos?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName ?? r.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Title (optional)" hint="Defaults to the report type and scope.">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Board update — September" />
          </Field>

          <p className="text-xs leading-relaxed text-faint">
            Reports are generated from your data at this moment and stored with a timestamp. Generating again later
            creates a second report — your history is never rewritten.
          </p>
        </div>
      </Modal>

      {/* Share */}
      <Modal
        open={Boolean(shareFor)}
        onClose={() => setShareFor(null)}
        title={shareFor?.shared ? 'Share link' : 'Create a share link'}
        footer={
          <Button variant="ghost" size="sm" onClick={() => setShareFor(null)}>
            Close
          </Button>
        }
      >
        {shareFor ? (
          <SharePanel
            row={shareFor}
            onCreate={(days) =>
              share.mutate(
                { reportId: shareFor.id, expiresInDays: days },
                {
                  onSuccess: () => toast.success('Share link created.'),
                  onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not create the link'),
                },
              )
            }
            creating={share.isPending}
          />
        ) : null}
      </Modal>
    </>
  );
}

function ShareButton({
  row,
  onShare,
  sharing,
  compact,
}: {
  row: ReportRow | null;
  onShare: (row: ReportRow) => void;
  sharing: boolean;
  compact?: boolean;
}) {
  if (!row) return null;
  return (
    <Button
      size="sm"
      variant={compact ? 'ghost' : 'secondary'}
      icon={<Share2 size={13} />}
      loading={sharing}
      onClick={() => onShare(row)}
      aria-label="Share report"
    >
      {compact ? null : row.shared ? 'Manage link' : 'Share'}
    </Button>
  );
}

function SharePanel({
  row,
  onCreate,
  creating,
}: {
  row: ReportRow;
  onCreate: (days: number) => void;
  creating: boolean;
}) {
  const [days, setDays] = useState(30);
  const [copied, setCopied] = useState(false);
  const url = row.shareToken ? `${window.location.origin}/share/${row.shareToken}` : null;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Anyone with this link can read the report without signing in. They see the report and its evidence — never your
        settings, billing or administration screens.
      </p>

      {url ? (
        <div className="flex items-center gap-2">
          <Input readOnly value={url} className="mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button
            size="sm"
            icon={copied ? <Check size={13} /> : <CopyIcon size={13} />}
            onClick={() => {
              void navigator.clipboard.writeText(url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Link expires after">
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </Select>
            </Field>
          </div>
          <Button variant="primary" size="sm" loading={creating} onClick={() => onCreate(days)}>
            Create link
          </Button>
        </div>
      )}

      {url ? (
        <div className="flex items-center justify-between gap-2 text-xs text-faint">
          <span>{row.shareExpiresAt ? `Expires ${formatDate(row.shareExpiresAt)}` : 'No expiry set'}</span>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            Open <ExternalLink size={11} />
          </a>
        </div>
      ) : null}
    </div>
  );
}

export { KIND_META };
