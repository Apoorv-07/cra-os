import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileText, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Skeleton } from '../components/ui';
import { formatDate, formatNumber } from '../lib/format';
import { GlassPanel, MarketingFooter, SectionLabel } from '../components/marketing';
import { Atmosphere, Reveal, RevealText, useCountUp } from '../lib/motion';

interface SharedEvidence {
  title: string;
  description: string | null;
  type: string;
  sha256: string;
  createdAt: number;
  mimeType: string | null;
}

interface SharedRepository {
  repository: {
    name: string;
    readinessScore: number | null;
    lastScanAt: number | null;
    componentCount: number;
    criticalCount: number;
    highCount: number;
    kevCount: number;
  };
  note: string;
}

/**
 * Public, read-only share view.
 *
 * Deliberately narrow: it shows posture and artefact checksums, never a list of
 * open vulnerabilities. A public page that enumerates unpatched CVEs is a
 * shopping list for an attacker, and no amount of marketing value is worth that.
 */
export function ShareReport() {
  const token = window.location.pathname.split('/').pop() ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['share', token],
    queryFn: () => api.get<SharedEvidence | SharedRepository>(`/share/${token}`),
    retry: false,
  });

  return (
    <div className="relative min-h-screen overflow-x-clip bg-void grain">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        <Atmosphere variant="glow" intensity={0.9} />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/8 bg-void/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2.5 px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <ShieldCheck size={18} className="text-iris" />
            <span className="text-sm font-semibold tracking-tight">CRA Compliance OS</span>
          </Link>
          <span className="ml-auto text-[11px] uppercase tracking-wider text-faint">
            Read-only shared report
          </span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-72 rounded-xl" />
            <Skeleton className="mt-6 h-48 rounded-2xl" />
          </div>
        ) : error ? (
          <Reveal>
            <GlassPanel strong className="p-10 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-partial/10 text-partial ring-1 ring-partial/25">
                <AlertTriangle size={20} />
              </span>
              <p className="mt-5 text-base font-medium text-text">This link is not available</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
                It may have expired or been revoked by the organisation that created it.
              </p>
              <Link to="/" className="mt-7 inline-block">
                <Button>Go home</Button>
              </Link>
            </GlassPanel>
          </Reveal>
        ) : data && 'repository' in data ? (
          <>
            <Reveal>
              <SectionLabel>{data.note}</SectionLabel>
            </Reveal>
            <RevealText
              as="h1"
              text={data.repository.name}
              className="display mt-5 block text-display-3"
            />
            <Reveal delay={120}>
              <p className="mono mt-4 text-[11px] uppercase tracking-wider text-faint">
                Last scan {data.repository.lastScanAt ? formatDate(data.repository.lastScanAt) : 'not available'}
              </p>
            </Reveal>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Components', value: data.repository.componentCount },
                { label: 'Critical', value: data.repository.criticalCount, tone: 'text-critical' },
                { label: 'High', value: data.repository.highCount, tone: 'text-high' },
                { label: 'Known exploited', value: data.repository.kevCount, tone: 'text-critical' },
              ].map((item, index) => (
                <Reveal key={item.label} delay={index * 80}>
                  <GlassPanel className="p-5">
                    <p className="text-xs text-muted">{item.label}</p>
                    <p className={`mt-2 text-2xl font-semibold tabular-nums ${item.tone ?? 'text-text'}`}>
                      <Counter value={item.value} />
                    </p>
                  </GlassPanel>
                </Reveal>
              ))}
            </div>

            {data.repository.readinessScore !== null ? (
              <Reveal delay={340}>
                <GlassPanel strong className="mt-5 p-7">
                  <p className="eyebrow">CRA readiness</p>
                  <p className="mt-2 flex items-baseline gap-2">
                    <span className="display text-4xl text-text">
                      <Counter value={Math.round(data.repository.readinessScore)} />
                    </span>
                    <span className="text-sm text-faint">/ 100</span>
                  </p>
                </GlassPanel>
              </Reveal>
            ) : null}
          </>
        ) : data ? (
          <>
            <Reveal>
              <span className="inline-grid h-11 w-11 place-items-center rounded-2xl bg-iris/12 text-iris ring-1 ring-iris/20">
                <FileText size={17} />
              </span>
            </Reveal>
            <RevealText
              as="h1"
              text={data.title}
              className="display mt-6 block text-display-3"
            />
            <Reveal delay={120}>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
                {data.description ?? 'No description provided.'}
              </p>
            </Reveal>

            <Reveal delay={220}>
              <GlassPanel strong className="mt-10 p-7">
                <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="eyebrow">SHA-256</p>
                    <p className="mono mt-2 break-all text-xs text-text">{(data as SharedEvidence).sha256}</p>
                  </div>
                  <div>
                    <p className="eyebrow">Recorded</p>
                    <p className="mono mt-2 text-xs text-text">{formatDate(data.createdAt)} UTC</p>
                  </div>
                </div>
              </GlassPanel>
            </Reveal>
          </>
        ) : null}

        <Reveal delay={380}>
          <div className="mt-10 border-t border-white/8 pt-6">
            <p className="max-w-2xl text-[11px] leading-relaxed text-faint">
              Shared reports show posture and artefact integrity only. They are engineering evidence,
              not legal advice and not a certification of compliance with the EU Cyber Resilience
              Act.
            </p>
          </div>
        </Reveal>
      </main>

      <MarketingFooter />
    </div>
  );
}

/** Counts up when the figure first appears — honest, not decorative: the value
 *  is rendered as text immediately for crawlers and assistive technology. */
function Counter({ value }: { value: number }) {
  const { ref, value: shown } = useCountUp<HTMLSpanElement>(value, 900);
  return (
    <span ref={ref}>
      {formatNumber(shown)}
      <span className="sr-only"> ({formatNumber(value)})</span>
    </span>
  );
}
