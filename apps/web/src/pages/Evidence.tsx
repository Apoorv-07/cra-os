import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, FileText, Hash, Package, Sparkles, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, downloadUrl } from '../lib/api';
import { useControls, useEstateReadiness, useRepositories } from '../lib/queries';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '../components/ui';
import { PageHeader } from '../components/layout';
import { ErrorState } from '../components/errors';
import { cx, formatBytes, formatDate, truncate } from '../lib/format';

interface EvidenceRow {
  id: string;
  orgId: string;
  repositoryId: string | null;
  title: string;
  description: string | null;
  type: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string;
  storageKey: string;
  controlIdsJson: string | null;
  createdAt: number;
}

const TYPES = [
  { value: 'document', label: 'Policy or procedure' },
  { value: 'remediation', label: 'Remediation record' },
  { value: 'report', label: 'Test or audit report' },
  { value: 'sbom', label: 'SBOM' },
  { value: 'other', label: 'Other' },
];

export function EvidenceVault() {
  const { orgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: repos } = useRepositories(orgId);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('document');
  const [repositoryId, setRepositoryId] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['evidence', orgId],
    queryFn: () => api.get<EvidenceRow[]>(`/organizations/${orgId}/evidence`),
    enabled: Boolean(orgId),
  });
  const { data: controls } = useControls(orgId);
  const { data: readiness } = useEstateReadiness(orgId);

  const controlTitle = (id: string) => controls?.find((c) => c.id === id)?.title ?? id.replace('cra.', '');

  // Coverage answers the question an auditor actually asks: how much of what
  // you claim is backed by something you can hand over?
  const coveredControls = new Set<string>();
  for (const row of data ?? []) {
    for (const id of (JSON.parse(row.controlIdsJson ?? '[]') as string[])) coveredControls.add(id);
  }
  const totalControls = controls?.length ?? readiness?.assessments.length ?? 0;

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file first.');
      const form = new FormData();
      form.append('file', file);
      form.append('title', title.trim() || file.name);
      form.append('type', type);
      if (repositoryId) form.append('repositoryId', repositoryId);
      return api.upload<{ id: string; sha256: string }>(`/organizations/${orgId}/evidence`, form);
    },
    onSuccess: () => {
      toast.success('Evidence stored with a checksum and timestamp');
      void qc.invalidateQueries({ queryKey: ['evidence', orgId] });
      setUploadOpen(false);
      setFile(null);
      setTitle('');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Upload failed'),
  });

  const classify = useMutation({
    mutationFn: (evidenceId: string) => api.post<{ controlIds: string[] }>(`/organizations/${orgId}/evidence/${evidenceId}/classify`),
    onSuccess: (result) => {
      toast.success(`Mapped to ${result.controlIds.length} control(s)`);
      void qc.invalidateQueries({ queryKey: ['evidence', orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Classification failed'),
  });

  const remove = useMutation({
    mutationFn: (evidenceId: string) => api.del(`/organizations/${orgId}/evidence/${evidenceId}`),
    onSuccess: () => {
      toast.success('Evidence deleted');
      void qc.invalidateQueries({ queryKey: ['evidence', orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Delete failed'),
  });

  const pack = useMutation({
    mutationFn: (repoId: string) =>
      api.post<{ fileName: string; sizeBytes: number; sha256: string }>(
        `/organizations/${orgId}/repositories/${repoId}/evidence-pack`,
        {},
      ),
    onSuccess: (result) => {
      toast.success(`Evidence pack ready · ${result.fileName}`);
      if (repositoryId) window.location.href = downloadUrl(`/organizations/${orgId}/repositories/${repositoryId}/evidence-pack/latest`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not generate the pack'),
  });

  return (
    <>
      <PageHeader
        title="Evidence"
        description="The receipts behind every claim CRAOS makes. Each artefact is stored with a SHA-256 checksum and an immutable timestamp, then mapped to the CRA expectation it supports." 
        action={
          <Button variant="primary" icon={<Upload size={14} />} onClick={() => setUploadOpen(true)}>
            Upload evidence
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/50 px-3.5 py-3">
        <Package size={14} className="text-faint" />
        <p className="flex-1 text-xs text-muted">
          Generate a signed evidence pack containing the SBOM, findings, control assessments and attached artefacts —
          one file you can send to a customer or auditor. Costs 50 credits.
        </p>
        <Select value={repositoryId} onChange={(e) => setRepositoryId(e.target.value)} className="min-w-48">
          <option value="">Choose a repository…</option>
          {(repos ?? []).map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.fullName ?? repo.name}
            </option>
          ))}
        </Select>
        <Button disabled={!repositoryId} loading={pack.isPending} onClick={() => pack.mutate(repositoryId)}>
          Generate pack
        </Button>
      </div>

      {data && data.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-4">
          <div className="flex items-baseline gap-2">
            <span className="mono text-lg font-semibold tabular-nums text-text">{data.length}</span>
            <span className="text-xs text-muted">artefact{data.length === 1 ? '' : 's'} stored</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="mono text-lg font-semibold tabular-nums text-text">{coveredControls.size}</span>
            <span className="text-xs text-muted">
              of {totalControls || '—'} CRA expectation{totalControls === 1 ? '' : 's'} now have supporting evidence
            </span>
          </div>
          {coveredControls.size < totalControls ? (
            <p className="w-full text-xs leading-relaxed text-faint">
              The rest are still claims without receipts. Uploading a policy, runbook or test report is usually enough.
            </p>
          ) : null}
        </div>
      ) : null}

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} title="Something went wrong while loading evidence" />
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Artefact</Th>
                <Th>Type</Th>
                <Th>Repository</Th>
                <Th>Size</Th>
                <Th>Uploaded</Th>
                <Th>Controls</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="shrink-0 text-faint" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-text">{row.title}</p>
                        <p className="mono text-[11px] text-faint" title={row.sha256}>
                          <Hash size={9} className="inline" /> {truncate(row.sha256, 22)}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-xs text-muted">{TYPES.find((t) => t.value === row.type)?.label ?? row.type}</Td>
                  <Td className="text-xs text-muted">
                    {repos?.find((r) => r.id === row.repositoryId)?.name ?? 'Organisation-wide'}
                  </Td>
                  <Td className="text-xs text-muted">{row.sizeBytes ? formatBytes(row.sizeBytes) : '—'}</Td>
                  <Td className="text-xs text-muted">{formatDate(row.createdAt)}</Td>
                  <Td>
                    {(() => {
                      const ids = JSON.parse(row.controlIdsJson ?? '[]') as string[];
                      return ids.length ? (
                        <div className="flex flex-wrap gap-1">
                          {ids.slice(0, 2).map((id) => (
                            <Badge key={id}>{controlTitle(id)}</Badge>
                          ))}
                          {ids.length > 2 ? <Badge>+{ids.length - 2}</Badge> : null}
                        </div>
                      ) : (
                        <button
                          className="text-[11px] text-accent hover:underline"
                          disabled={classify.isPending}
                          onClick={() => classify.mutate(row.id)}
                        >
                          Map to controls
                        </button>
                      );
                    })()}
                  </Td>
                  <Td className="text-right">
                    <div className={cx('flex', 'justify-end', 'gap-1')}>
                      <a href={downloadUrl(`/organizations/${orgId}/evidence/${row.id}/download`)}>
                        <Button size="sm" variant="ghost">
                          Download
                        </Button>
                      </a>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm('Delete this evidence permanently?')) remove.mutate(row.id);
                        }}
                        icon={<Trash2 size={12} />}
                      />
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<FileCheck2 size={22} />}
            title="The vault is empty"
            description="Upload the documents that prove your process: vulnerability handling policy, support period statement, threat model, penetration test reports, or a previous SBOM."
            action={
              <Button variant="primary" icon={<Upload size={14} />} onClick={() => setUploadOpen(true)}>
                Upload evidence
              </Button>
            }
          />
        </Card>
      )}

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload evidence"
        footer={
          <>
            <Button onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>
              Store evidence
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vulnerability handling policy v2.1" />
          </Field>

          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Repository" hint="Optional — leave blank for organisation-wide evidence">
            <Select value={repositoryId} onChange={(e) => setRepositoryId(e.target.value)}>
              <option value="">Organisation-wide</option>
              {(repos ?? []).map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.fullName ?? repo.name}
                </option>
              ))}
            </Select>
          </Field>

          <div>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className={cx(
                'w-full rounded-lg border border-dashed px-3 py-6 text-center text-xs transition-colors',
                file ? 'border-accent/50 bg-accent/5 text-text' : 'border-border text-muted hover:border-border-strong',
              )}
            >
              {file ? file.name : 'Click to choose a file'}
            </button>
            <p className="mt-1.5 text-[11px] text-faint">
              Stored content-addressed with SHA-256. Uploaded files are immutable: to replace one, upload a new version.
            </p>
          </div>
        </div>
      </Modal>

      <Card className="mt-6">
        <CardHeader
          title="Automatic mapping"
          subtitle="Optional, and it never invents facts"
        />
        <div className="flex items-start gap-2.5 p-4">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-faint" />
          <p className="text-xs leading-relaxed text-muted">
            Mapping uses a model only to suggest which controls an artefact satisfies, and every suggestion is validated
            against the control catalogue. If the model is unavailable or unconfident, the artefact is matched by its
            type instead. It costs 2 credits and never changes your stored file.
          </p>
        </div>
      </Card>
    </>
  );
}
