import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Boxes, Play, Plus, RefreshCw, Upload } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useRepositories, useStartScan } from '../lib/queries';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  ProgressBar,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '../components/ui';
import { PageHeader } from '../components/layout';
import { cx, formatDate, formatNumber, gradeColour, relativeTime } from '../lib/format';

function AddRepositoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { orgId, capabilities } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose an archive first.');
      const form = new FormData();
      form.append('file', file);
      form.append('name', name.trim() || file.name.replace(/\.(tar\.gz|tgz)$/i, ''));
      return api.upload<{ id: string; scanId: string }>(`/organizations/${orgId}/repositories/upload`, form);
    },
    onSuccess: () => {
      toast.success('Uploaded. Scanning now.');
      void qc.invalidateQueries({ queryKey: ['repositories', orgId] });
      onClose();
      setFile(null);
      setName('');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Upload failed'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a repository"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>
            Upload and scan
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {capabilities.githubApp ? (
          <div>
            <h4 className="text-xs font-medium text-text">Connect from GitHub</h4>
            <p className="mt-1 text-xs text-muted">
              Pick repositories from your GitHub installation. We request read-only access to metadata and contents.
            </p>
            <a href={`/api/v1/organizations/${orgId}/integrations/github/install`}>
              <Button className="mt-2.5" >
                Install or configure GitHub App
              </Button>
            </a>
          </div>
        ) : null}

        <div className={cx(capabilities.githubApp && 'border-t border-border pt-5')}>
          <h4 className="text-xs font-medium text-text">Upload a source archive</h4>
          <p className="mt-1 text-xs text-muted">
            A <span className="mono">.tar.gz</span> or <span className="mono">.tgz</span> export of the project. Useful
            for air-gapped codebases or a one-off assessment.
          </p>

          <div className="mt-3 space-y-3">
            <Field label="Repository name" hint="Optional">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="payments-api" />
            </Field>
            <input
              ref={fileRef}
              type="file"
              accept=".tar.gz,.tgz"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className={cx(
                'w-full rounded-lg border border-dashed px-3 py-5 text-center text-xs transition-colors',
                file ? 'border-accent/50 bg-accent/5 text-text' : 'border-border text-muted hover:border-border-strong',
              )}
            >
              {file ? file.name : 'Click to choose an archive (max 25 MB)'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function Repositories() {
  const { orgId } = useAuth();
  const { data: repos, isLoading } = useRepositories(orgId);
  const { data: _unused } = useRepositories(orgId); // keep the list warm for scans polling
  void _unused;
  const startScan = useStartScan(orgId);
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Repositories"
        description="Every connected repository, its latest scan and its current readiness score."
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
            Add repository
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : repos && repos.length > 0 ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Repository</Th>
                <Th>Provider</Th>
                <Th>Readiness</Th>
                <Th>Last scan</Th>
                <Th>Monitoring</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {repos.map((repo) => (
                <Tr key={repo.id}>
                  <Td>
                    <Link to={`/app/repositories/${repo.id}`} className="text-sm font-medium text-text hover:text-accent">
                      {repo.fullName ?? repo.name}
                    </Link>
                    <div className="text-[11px] text-faint">{repo.defaultBranch ? `default: ${repo.defaultBranch}` : 'archive upload'}</div>
                  </Td>
                  <Td className="text-xs text-muted capitalize">{repo.provider}</Td>
                  <Td>
                    {repo.readinessScore !== null ? (
                      <div className="flex items-center gap-2">
                        <ProgressBar
                          value={repo.readinessScore}
                          className="w-24"
                          colour={gradeColour(repo.readinessScore >= 90 ? 'A' : repo.readinessScore >= 75 ? 'B' : repo.readinessScore >= 60 ? 'C' : repo.readinessScore >= 40 ? 'D' : 'E')}
                        />
                        <span className="mono text-[11px] text-muted">{Math.round(repo.readinessScore)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{repo.lastScanAt ? relativeTime(repo.lastScanAt) : 'Never'}</Td>
                  <Td>
                    <Badge className={repo.monitoringEnabled ? 'border-pass/30 bg-pass/10 text-pass' : undefined}>
                      {repo.monitoringEnabled ? 'On' : 'Off'}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={startScan.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        startScan.mutate(repo.id, {
                          onSuccess: () => toast.success('Scan started — 10 credits reserved'),
                          onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not start scan'),
                        });
                      }}
                      icon={<RefreshCw size={12} />}
                    >
                      Scan
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<Boxes size={22} />}
            title="No repositories connected"
            description="Connect GitHub or upload a source archive. One scan produces a CycloneDX SBOM, vulnerability matches against OSV, KEV and EPSS, and a CRA readiness score with written rationale."
            action={
              <div className="flex gap-2">
                <Link to="/app/onboarding">
                  <Button variant="primary" icon={<Play size={14} />}>
                    Start onboarding
                  </Button>
                </Link>
                <Button icon={<Upload size={14} />} onClick={() => setAddOpen(true)}>
                  Add repository
                </Button>
              </div>
            }
          />
        </Card>
      )}

      <AddRepositoryModal open={addOpen} onClose={() => setAddOpen(false)} />

      <div className="mt-6 text-[11px] text-faint">
        Next scan due {formatDate(Date.now() + 86_400_000)} · {formatNumber(repos?.length ?? 0)} repositories tracked
      </div>
    </>
  );
}
