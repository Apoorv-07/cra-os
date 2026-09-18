import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Boxes, Check, Upload } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Button, Field, GitHubMark as GithubIcon, Input, ProgressBar, useToast } from '../components/ui';
import { useScanStatus } from '../lib/queries';
import { cx } from '../lib/format';
import { GlassPanel, SectionLabel } from '../components/marketing';
import { Atmosphere, Magnetic, Reveal, RevealText } from '../lib/motion';

/**
 * First-run flow: get one repository scanned as fast as possible.
 *
 * Uploading an archive is offered alongside GitHub because it needs no OAuth
 * round trip — the value (an SBOM and a readiness score) arrives in one step,
 * and connecting GitHub later is a settings action, not a prerequisite.
 */

export function Onboarding() {
  const { orgId, capabilities } = useAuth();
  const toast = useToast();
  const _navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [repoId, setRepoId] = useState<string | null>(null);

  const { data: status } = useScanStatus(orgId, scanId ?? undefined);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !orgId) throw new Error('Choose an archive first.');
      const form = new FormData();
      form.append('file', file);
      form.append('name', name.trim() || file.name.replace(/\.(tar\.gz|tgz)$/i, ''));
      return api.upload<{ id: string; scanId: string }>(`/organizations/${orgId}/repositories/upload`, form);
    },
    onSuccess: (result) => {
      setRepoId(result.id);
      setScanId(result.scanId);
      void qc.invalidateQueries({ queryKey: ['repositories', orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Upload failed'),
  });

  const done = status?.status === 'succeeded';
  const failed = status?.status === 'failed';

  return (
    <div className="relative mx-auto max-w-4xl px-5 py-14 sm:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <Atmosphere variant="glow" intensity={0.7} />
      </div>

      <Reveal>
        <SectionLabel>First run</SectionLabel>
      </Reveal>
      <RevealText
        as="h1"
        text="Scan your first repository"
        className="display mt-5 block text-display-3"
      />
      <Reveal delay={120}>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
          We will generate an SBOM, match vulnerabilities against live intelligence, and score your
          CRA readiness. A scan costs 10 credits.
        </p>
      </Reveal>

      {!scanId ? (
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <Reveal delay={180}>
          <GlassPanel hoverable className="h-full p-7" data-cursor="Upload">
            <div className="flex items-center gap-2">
              <Upload size={16} className="text-accent" />
              <h3 className="text-sm font-semibold">Upload a source archive</h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              A <span className="mono">.tar.gz</span> or <span className="mono">.tgz</span> of your project. We read
              dependency manifests only — nothing is executed. Best for a first look or an air-gapped codebase.
            </p>

            <div className="mt-4 space-y-3">
              <Field label="Project name" hint="Optional — defaults to the archive name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="payments-api" />
              </Field>

              <div>
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
                    'w-full rounded-lg border border-dashed px-3 py-6 text-center transition-colors',
                    file ? 'border-accent/50 bg-accent/5' : 'border-border hover:border-border-strong hover:bg-surface-2',
                  )}
                >
                  {file ? (
                    <span className="text-xs text-text">{file.name}</span>
                  ) : (
                    <span className="text-xs text-muted">
                      Click to choose an archive
                      <span className="block text-[11px] text-faint mt-1">Maximum 25 MB</span>
                    </span>
                  )}
                </button>
              </div>

              <Button
                variant="primary"
                className="w-full"
                disabled={!file}
                loading={upload.isPending}
                onClick={() => upload.mutate()}
                icon={<ArrowRight size={14} />}
              >
                Upload and scan
              </Button>
            </div>
          </GlassPanel>
          </Reveal>

          <Reveal delay={260}>
          <GlassPanel hoverable className="h-full p-7" data-cursor="Connect">
            <div className="flex items-center gap-2">
              <GithubIcon size={16} className="text-accent" />
              <h3 className="text-sm font-semibold">Connect GitHub</h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Install the GitHub App to scan repositories continuously, get push-triggered scans, and run the GitHub
              Action in CI.
            </p>

            {capabilities.githubApp ? (
              <a href={`/api/v1/organizations/${orgId}/integrations/github/install`} className="mt-4 block">
                <Button variant="primary" className="w-full" icon={<GithubIcon size={14} />}>
                  Install GitHub App
                </Button>
              </a>
            ) : (
              <div className="mt-4 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
                GitHub integration is not configured on this deployment yet. Set{' '}
                <span className="mono text-text">GITHUB_APP_ID</span>,{' '}
                <span className="mono text-text">GITHUB_APP_PRIVATE_KEY</span> and{' '}
                <span className="mono text-text">GITHUB_APP_WEBHOOK_SECRET</span> to enable it. Upload an archive in the
                meantime.
              </div>
            )}

            <div className="mt-4 space-y-2 border-t border-border pt-4">
              {['Continuous monitoring on a schedule', 'Push and pull-request scans', 'Fails CI on severity thresholds', 'Read-only, least-privilege access'].map(
                (item) => (
                  <div key={item} className="flex items-start gap-2 text-xs text-muted">
                    <Check size={13} className="mt-0.5 shrink-0 text-pass" />
                    {item}
                  </div>
                ),
              )}
            </div>
          </GlassPanel>
          </Reveal>
        </div>
      ) : (
        <Reveal delay={140} className="mt-12">
        <GlassPanel strong className="p-7">
          <div className="flex items-center gap-3">
            {done ? (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-pass/15 text-pass">
                <Check size={16} />
              </span>
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent/15 text-accent">
                <Boxes size={16} className="animate-pulse-soft" />
              </span>
            )}
            <div>
              <h3 className="text-sm font-semibold">
                {done ? 'Scan complete' : failed ? 'Scan failed' : 'Scanning your repository'}
              </h3>
              <p className="text-xs text-muted">{status?.message ?? 'Queued'}</p>
            </div>
          </div>

          <div className="mt-5">
            <ProgressBar value={status?.progressPct ?? 0} colour={failed ? 'var(--color-fail)' : done ? 'var(--color-pass)' : undefined} />
            <div className="mt-1.5 flex justify-between text-[11px] text-faint">
              <span>{status?.message ?? 'Preparing'}</span>
              <span className="mono">{status?.progressPct ?? 0}%</span>
            </div>
          </div>

          {status?.error ? (
            <div className="mt-4 rounded-lg border border-fail/30 bg-fail/5 px-3 py-2 text-xs text-fail">{status.error}</div>
          ) : null}

          {done ? (
            <div className="mt-6 flex flex-wrap gap-2">
              <Link to={repoId ? `/app/repositories/${repoId}` : '/app/repositories'}>
                <Button variant="primary" icon={<ArrowRight size={14} />}>
                  See results
                </Button>
              </Link>
              <Link to="/app">
                <Button>Go to dashboard</Button>
              </Link>
            </div>
          ) : null}
        </GlassPanel>
        </Reveal>
      )}

      <Reveal delay={320}>
        <div className="mt-10 flex items-center justify-between border-t border-white/8 pt-6 text-xs">
          <Magnetic strength={0.1} max={4}>
            <Link to="/app" className="text-muted transition-colors hover:text-text">
              Skip for now
            </Link>
          </Magnetic>
          <Magnetic strength={0.1} max={4}>
            <Link to="/pricing" className="text-muted transition-colors hover:text-text">
              See credit costs
            </Link>
          </Magnetic>
        </div>
      </Reveal>
    </div>
  );
}
