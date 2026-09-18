import { Link } from 'react-router-dom';
import {
  Boxes,
  Braces,
  FileCheck2,
  Gauge,
  GitBranch,
  Key,
  Server,
  ShieldAlert,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import {
  ActionLink,
  Accordion,
  GlassPanel,
  MarketingFooter,
  MarketingLayout,
  SectionIntro,
  SectionLabel,
  TraceLine,
} from '../components/marketing';
import {
  Atmosphere,
  Magnetic,
  Parallax,
  Reveal,
  RevealText,
  useCountUp,
} from '../lib/motion';

/**
 * Home — the public environment.
 *
 * Content, claims and navigation are unchanged from the previous version; what
 * changed is the composition. Sections are scenes with their own depth and
 * motion rather than rows of identical cards, and the hero shows the product's
 * output as a spatial object instead of a terminal window.
 */

const STEPS = [
  {
    n: '01',
    title: 'Connect a repository',
    body: 'Install the GitHub App, pick repositories, or upload a source archive. Least-privilege access — we read manifests and never execute your code.',
  },
  {
    n: '02',
    title: 'We build the inventory',
    body: 'Every manifest and lockfile is parsed into a normalised component model and emitted as CycloneDX 1.6 in JSON and XML.',
  },
  {
    n: '03',
    title: 'Match live intelligence',
    body: 'OSV, GitHub Advisories, NVD, CISA KEV and EPSS. Advisory ranges are re-validated locally, so a match is a real match.',
  },
  {
    n: '04',
    title: 'Get explainable readiness',
    body: '35 CRA controls scored with written rationale, evidence attached, and Article 14 drafts on the clock when something is exploited.',
  },
];

const FEATURES = [
  {
    icon: Boxes,
    title: 'SBOM you can hand over',
    body: 'CycloneDX 1.6, JSON and XML, regenerated on every scan with a checksum. Covers npm, PyPI, Go, Maven, Gradle, Cargo, Composer, NuGet, Ruby and container base images.',
    span: 'lg:col-span-3',
  },
  {
    icon: ShieldAlert,
    title: 'Vulnerability intelligence that triages',
    body: 'CVSS v3.1 computed from the vector, KEV flags for known exploitation, EPSS for 30-day likelihood. Sort by what is actually likely to be exploited.',
    span: 'lg:col-span-3',
  },
  {
    icon: Gauge,
    title: 'Readiness with reasons',
    body: 'Every control returns Met, Partial, Gap or Review with a sentence explaining why and what evidence was used. No black-box score.',
    span: 'lg:col-span-2',
  },
  {
    icon: FileCheck2,
    title: 'Evidence vault',
    body: 'Upload policies, threat models and test reports. Each artefact is checksummed, timestamped and mapped to the controls it satisfies.',
    span: 'lg:col-span-2',
  },
  {
    icon: ShieldCheck,
    title: 'Article 14 on the clock',
    body: 'Open an incident from a finding and get the early warning, notification and final-report drafts with the facts filled in. Review, edit, approve, export.',
    span: 'lg:col-span-2',
  },
];

const FAQ = [
  {
    q: 'Is this legal advice?',
    a: 'No. CRA Compliance OS produces engineering evidence: SBOMs, vulnerability matches, control assessments and report drafts. It tells you what your codebase and repository actually show. It does not tell you whether you are legally compliant, and nothing it produces is a certification.',
  },
  {
    q: 'What is the EU Cyber Resilience Act, in one paragraph?',
    a: 'The CRA is an EU regulation that imposes cybersecurity requirements on products with digital elements placed on the EU market. It requires a risk assessment, security by default, vulnerability handling, an SBOM, technical documentation, and reporting of actively exploited vulnerabilities. The reporting obligations under Article 14 apply from 11 September 2026: an early warning within 24 hours of becoming aware, a notification within 72 hours, and a final report within 14 days of a corrective measure becoming available. The remaining obligations apply from 11 December 2027.',
  },
  {
    q: 'When does it apply?',
    a: 'The regulation entered into force in December 2024. The main obligations apply from 11 December 2027, and the Article 14 incident reporting obligations apply from 11 September 2026. Penalties reach €15 million or 2.5% of worldwide annual turnover.',
  },
  {
    q: 'How is this different from a generic scanner?',
    a: 'A scanner tells you a CVE exists. This tells you which CRA obligation that CVE puts at risk, what evidence closes the gap, what to file with ENISA and by when — and it keeps the record, with timestamps and checksums, so you can prove what you knew and when.',
  },
  {
    q: 'Do you run my code?',
    a: 'No. We read dependency manifests and lockfiles. Nothing from your repository is executed, and scans run in isolated workers with bounded file counts and sizes.',
  },
  {
    q: 'How does pricing work?',
    a: 'Prepaid credits. A repository scan costs 10 credits, an SBOM 5, an evidence pack 50, and an Article 14 draft 200. New accounts start with 250 credits. Buy more whenever you need them; unused credits stay on your account.',
  },
];

const ECOSYSTEMS = [
  'npm',
  'PyPI',
  'Go modules',
  'Maven',
  'Gradle',
  'Cargo',
  'Composer',
  'NuGet',
  'RubyGems',
  'Container base images',
];

const ARCHITECTURE = [
  ['Scanning', 'Isolated workers. Manifests are read, never executed.'],
  ['Intelligence', 'OSV batch queries, KEV synced hourly, EPSS per CVE.'],
  ['Scoring', 'Deterministic rules first; models only draft prose.'],
  ['Billing', 'Append-only double-entry credit ledger with reservations.'],
  ['Data', 'Encrypted secrets, tenant-scoped queries, full audit log.'],
];

// ---------------------------------------------------------------------------
// Hero object — the scan result, as a spatial composition
// ---------------------------------------------------------------------------

function ReadinessObject() {
  const { ref: countRef, value: score } = useCountUp<HTMLSpanElement>(62);
  const { ref: compRef, value: components } = useCountUp<HTMLSpanElement>(412);

  const rows = [
    { label: 'cra.vuln.known_exploited', status: 'gap', tone: 'text-critical' },
    { label: 'cra.sbom.completeness', status: 'met', tone: 'text-pass' },
    { label: 'cra.incident.process', status: 'partial', tone: 'text-partial' },
  ];

  return (
    <div className="relative" data-cursor="Explore">
      {/* Depth: a soft light source behind the object. */}
      <div
        aria-hidden="true"
        className="absolute -inset-10 -z-10 rounded-full opacity-70 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at 60% 40%, rgba(109,140,255,0.32), transparent 65%)',
        }}
      />

      <Parallax speed={0.05} className="relative">
        <GlassPanel strong className="animate-float-slow p-6 sm:p-7">
          {/* Repository identity */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-iris/15 text-iris ring-1 ring-iris/25">
                <GitBranch size={16} />
              </span>
              <div>
                <p className="text-sm font-medium">acme/payments-api</p>
                <p className="text-[11px] text-faint">main · scanned 2 minutes ago</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-pass/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-pass ring-1 ring-pass/25">
              <span className="h-1 w-1 rounded-full bg-pass" />
              live
            </span>
          </div>

          {/* Inventory + findings, as two floating planes */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/8">
              <span ref={compRef} aria-hidden="true" className="text-2xl font-semibold tracking-tight text-text">
                {components}
              </span>
              <span className="sr-only">412</span>
              <p className="mt-0.5 text-[11px] text-faint">components</p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/8">
              <p className="text-2xl font-semibold tracking-tight text-text">
                18 <span className="text-sm font-normal text-faint">/ 4 re-checked</span>
              </p>
              <p className="mt-0.5 text-[11px] text-faint">advisories matched</p>
            </div>
          </div>

          {/* Severity spectrum */}
          <div className="mt-4 flex items-center gap-4 text-xs">
            {[
              ['critical', 2, 'text-critical'],
              ['high', 7, 'text-high'],
              ['medium', 9, 'text-medium'],
            ].map(([label, count, tone]) => (
              <span key={label as string} className="inline-flex items-baseline gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full bg-current ${tone}`} />
                <span className={`font-medium ${tone}`}>{count}</span>
                <span className="text-faint">{label}</span>
              </span>
            ))}
            <span className="ml-auto text-[11px] text-faint">KEV 1 · EPSS &gt; 10% 3</span>
          </div>

          <div className="mt-6 h-px bg-white/8" />

          {/* Readiness — the score, with its reasons */}
          <div className="mt-6 flex items-end justify-between gap-6">
            <div>
              <p className="eyebrow">CRA readiness</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span ref={countRef} aria-hidden="true" className="text-4xl font-semibold tracking-tight text-text">
                  {score}
                </span>
                <span className="sr-only">62</span>
                <span className="text-sm text-partial">· C</span>
              </p>
            </div>
            <div className="flex-1 space-y-1.5 text-[11px]">
              {rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <span className="truncate text-faint">{row.label}</span>
                  <span className={`shrink-0 font-medium ${row.tone}`}>{row.status}</span>
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>
      </Parallax>

      {/* Floating metadata — satellite planes that give the object context. */}
      <Magnetic strength={0.1} max={10}>
        <div className="absolute -left-6 bottom-16 hidden sm:block">
          <GlassPanel className="animate-float px-3.5 py-2.5">
            <p className="text-[11px] font-medium">CycloneDX 1.6</p>
            <p className="mono mt-0.5 text-[10px] text-faint">sha256:9f2c…e41a</p>
          </GlassPanel>
        </div>
      </Magnetic>

      <Magnetic strength={0.12} max={12}>
        <div className="absolute -right-5 -top-7 hidden sm:block">
          <GlassPanel className="animate-float px-3.5 py-2.5">
            <p className="text-[11px] font-medium text-critical">Article 14 clock</p>
            <p className="mono mt-0.5 text-[10px] text-faint">24h · 72h · 14d</p>
          </GlassPanel>
        </div>
      </Magnetic>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative">
      {/* Scene lighting for the hero only. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <Atmosphere variant="glow" intensity={1.15} />
      </div>

      <div className="mx-auto max-w-7xl px-5 pb-24 pt-16 sm:px-8 sm:pt-24 lg:pb-32">
        <div className="grid items-center gap-16 lg:grid-cols-[1.08fr_0.92fr] lg:gap-12">
          <div>
            <Reveal>
              <span className="glass inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[11px] text-muted">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pass/70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pass" />
                </span>
                Article 14 reporting obligations start 11 September 2026
              </span>
            </Reveal>

            <h1 className="display mt-8 text-display-1">
              <RevealText text="CRA compliance is an" className="block" />
              <RevealText
                text="engineering problem."
                className="ink-gradient block"
                stagger={54}
                delay={140}
              />
              <RevealText
                text="Treat it like one."
                className="block text-faint"
                stagger={54}
                delay={320}
              />
            </h1>

            <Reveal delay={520}>
              <p className="mt-8 max-w-xl text-lead leading-relaxed text-muted">
                Connect a repository. Get a real SBOM, real vulnerability matches against OSV, KEV
                and EPSS, an explainable CRA readiness score with written rationale, and Article 14
                report drafts on the clock. Evidence in, audit trail out — no questionnaire, no
                theatre.
              </p>
            </Reveal>

            <Reveal delay={620}>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <ActionLink to="/signup">Start free — 250 credits</ActionLink>
                <Magnetic strength={0.12} max={5}>
                  <a
                    href="#how"
                    className="link-underline text-sm text-muted transition-colors hover:text-text"
                  >
                    See how it works
                  </a>
                </Magnetic>
              </div>
            </Reveal>

            <Reveal delay={720}>
              <p className="mt-6 text-xs text-faint">
                No card required · Credits never expire while your account is active · Cancel any
                time
              </p>
            </Reveal>
          </div>

          <Reveal delay={260}>
            <div className="relative mx-auto max-w-md lg:max-w-none">
              <ReadinessObject />
            </div>
          </Reveal>
        </div>
      </div>

      <EcosystemStrip />
    </section>
  );
}

function EcosystemStrip() {
  const items = [...ECOSYSTEMS, ...ECOSYSTEMS];
  return (
    <div className="relative overflow-hidden border-y border-white/8 bg-white/[0.015] py-5">
      <p className="eyebrow mb-4 px-5 text-center sm:px-8">Parsed from your manifests</p>
      <div aria-hidden="true" className="flex w-max animate-marquee gap-10 px-6 text-sm text-faint">
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className="whitespace-nowrap">
            {item}
          </span>
        ))}
      </div>
      <p className="sr-only">
        Supported ecosystems: {ECOSYSTEMS.join(', ')}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function HowItWorks() {
  return (
    <section id="how" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionIntro
          label="How it works"
          title="From repository to filed report"
          body="Four steps, all of them backed by real data. Nothing here is a self-assessment tick-box."
        />

        <div className="mt-16 grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {STEPS.map((step, index) => (
            <Reveal key={step.n} delay={index * 110}>
              <div className="group relative h-full">
                {/* The connector reads as a path through the sequence. */}
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-9 hidden h-px w-full bg-gradient-to-r from-iris/40 to-transparent lg:block"
                />
                <span className="relative z-10 mono text-xs text-iris/80">{step.n}</span>
                <h3 className="mt-4 text-lg font-medium leading-snug tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-16">
          <TraceLine />
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionIntro
          label="Capabilities"
          title="What you actually get"
          body="Every artefact below is generated from your repository and stored with a checksum, so you can hand it over without re-running anything."
        />

        {/* Asymmetric bento: the composition breathes instead of tiling. */}
        <div className="mt-16 grid gap-4 lg:grid-cols-6">
          {FEATURES.map((f, index) => (
            <Reveal key={f.title} delay={index * 90} className={f.span}>
              <GlassPanel hoverable className="h-full p-7" data-cursor="Detail">
                <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-iris/12 text-iris ring-1 ring-iris/20">
                  <f.icon size={17} />
                </span>
                <h3 className="mt-5 text-base font-medium tracking-tight">{f.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{f.body}</p>
              </GlassPanel>
            </Reveal>
          ))}

          <Reveal delay={500} className="lg:col-span-6">
            <GlassPanel className="p-7">
              <div className="grid gap-8 sm:grid-cols-3">
                {[
                  {
                    icon: Braces,
                    title: 'Versioned REST API',
                    body: '/api/v1 with API keys, OpenAPI, pagination and idempotency.',
                  },
                  {
                    icon: GitBranch,
                    title: 'GitHub Action',
                    body: 'Fail a pull request when a critical or KEV finding appears.',
                  },
                  {
                    icon: Key,
                    title: 'Prepaid credits',
                    body: 'Pay for scans and reports. No per-seat licence, no annual contract.',
                  },
                ].map((item) => (
                  <div key={item.title} className="flex gap-4">
                    <item.icon size={17} className="mt-0.5 shrink-0 text-faint" />
                    <div>
                      <h3 className="text-sm font-medium">{item.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GlassPanel>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Audience() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <Atmosphere variant="glow" intensity={0.8} />
      </div>

      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid items-center gap-16 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Reveal>
              <SectionLabel>Who it is for</SectionLabel>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="display mt-5 text-display-3">
                Built for the people who have to <span className="ink-outline">answer</span>
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 max-w-xl text-lead leading-relaxed text-muted">
                If you ship software into the EU, someone will eventually ask what is in it, what is
                vulnerable, and what you did about it. This is the system that answers those
                questions from your repository rather than from memory.
              </p>
            </Reveal>

            <ul className="mt-10 space-y-4">
              {[
                'Engineering leads who need to prove vulnerability handling, not describe it',
                'Product security teams maintaining an SBOM across dozens of services',
                'Consultancies and agencies managing compliance for several clients at once',
                'Founders who must answer enterprise and procurement questionnaires with evidence',
              ].map((item, index) => (
                <Reveal key={item} delay={220 + index * 80}>
                  <li className="flex gap-3.5 text-sm leading-relaxed text-muted">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-iris" />
                    {item}
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>

          <Reveal delay={200}>
            <Parallax speed={0.04}>
              <GlassPanel strong className="p-7">
                <div className="flex items-center gap-2.5 text-faint">
                  <Server size={15} />
                  <p className="text-xs">Architecture, in one line each</p>
                </div>
                <dl className="mt-6">
                  {ARCHITECTURE.map(([term, definition]) => (
                    <div
                      key={term}
                      className="flex gap-5 border-t border-white/8 py-3.5 first:border-0 first:pt-0"
                    >
                      <dt className="w-24 shrink-0 text-xs text-faint">{term}</dt>
                      <dd className="text-sm leading-relaxed text-muted">{definition}</dd>
                    </div>
                  ))}
                </dl>
              </GlassPanel>
            </Parallax>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-5 sm:px-8">
        <SectionIntro label="Questions" title="Questions engineers ask first" />
        <div className="mt-14">
          <Accordion items={FAQ} />
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="relative overflow-hidden py-28 sm:py-40">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <Atmosphere variant="glow" intensity={1.3} />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 55% at 50% 45%, rgba(109,140,255,0.16), transparent 70%)',
          }}
        />
      </div>

      <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
        <Reveal>
          <span className="inline-grid h-12 w-12 place-items-center rounded-2xl bg-iris/12 text-iris ring-1 ring-iris/25">
            <Waypoints size={20} className="animate-float" />
          </span>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="display mt-8 text-display-2">
            Connect your first <span className="ink-gradient">repository</span>
          </h2>
        </Reveal>
        <Reveal delay={200}>
          <p className="mx-auto mt-6 max-w-xl text-lead leading-relaxed text-muted">
            A scan costs 10 credits. New accounts get 100. You will have an SBOM and a readiness
            score in under a minute.
          </p>
        </Reveal>
        <Reveal delay={300}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <ActionLink to="/signup">Start free</ActionLink>
            <Magnetic strength={0.12} max={5}>
              <Link
                to="/pricing"
                className="inline-flex h-12 items-center rounded-xl px-6 text-sm font-medium text-text ring-1 ring-white/15 transition-colors hover:bg-white/5"
              >
                See pricing
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Home() {
  return (
    <MarketingLayout navOverlay>
      <Hero />
      <HowItWorks />
      <Features />
      <Audience />
      <Faq />
      <Closing />
    </MarketingLayout>
  );
}

export { MarketingFooter };
