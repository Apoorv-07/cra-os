import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { NotFound } from './NotFound';
import { MarketingLayout, SectionLabel } from '../components/marketing';
import { Reveal, RevealText, useFrame, useReducedMotion } from '../lib/motion';
import { cx } from '../lib/format';

/**
 * Legal and trust pages.
 *
 * These describe what the product actually does today. They deliberately claim
 * no certification (no ISO 27001, no SOC 2) because we do not hold one, and a
 * compliance product that lies about its own compliance is worthless.
 */

const LAST_UPDATED = '14 September 2026';

const SECTIONS: Record<string, { title: string; intro: string; blocks: Array<{ h: string; p: string[] }> }> = {
  privacy: {
    title: 'Privacy Policy',
    intro:
      'This policy explains what personal data CRA Compliance OS processes, why, how long it is kept, and what you can ask us to do with it.',
    blocks: [
      {
        h: 'What we process',
        p: [
          'Account data: your email address, name, password hash, session records and, if you connect GitHub, the identifier of your GitHub account.',
          'Organisation data: organisation names, memberships, roles, API keys and billing records.',
          'Repository metadata: repository names, default branches, commit SHAs, dependency manifests and the components derived from them.',
          'Operational logs: request logs, audit events and job histories needed to run and secure the service.',
        ],
      },
      {
        h: 'Why we process it',
        p: [
          'To provide the service you asked for: authenticating you, scanning repositories, generating SBOMs, scoring readiness and producing report drafts.',
          'To bill you correctly: credits, reservations, invoices and tax records.',
          'To keep the service secure: audit trails, rate limiting, abuse detection and incident investigation.',
        ],
      },
      {
        h: 'What we do not do',
        p: [
          'We do not execute code from your repositories. Scans read dependency manifests and lockfiles only.',
          'We do not sell your data, and we do not train models on your repository contents.',
          'We do not publish your scan results. Reports are private unless you create an explicit share link.',
        ],
      },
      {
        h: 'Retention and deletion',
        p: [
          'Account data is retained while your account is active. Scan records, SBOMs and evidence are retained so that your history and audit trail remain intact; you can delete individual artefacts at any time.',
          'You can request full export or deletion of your organisation’s data from Settings, or by emailing privacy@example.com. Deletion requests are completed within 30 days, subject to records we must keep for tax or legal reasons.',
        ],
      },
      {
        h: 'Your rights',
        p: [
          'Depending on where you live, you may have rights of access, rectification, erasure, portability, restriction and objection. Contact privacy@example.com and we will respond within 30 days.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    intro: 'The agreement between you and CRA Compliance OS for use of the service.',
    blocks: [
      {
        h: 'The service',
        p: [
          'CRA Compliance OS produces technical evidence: software bills of materials, vulnerability matches, control assessments and report drafts derived from your repositories and the artefacts you upload.',
        ],
      },
      {
        h: 'Not legal advice',
        p: [
          'The service does not provide legal advice and is not a conformity assessment body. Nothing it produces is a certification of compliance with the EU Cyber Resilience Act or any other law. Outputs are drafts and engineering evidence intended for review by a qualified person before any external use.',
        ],
      },
      {
        h: 'Credits and payment',
        p: [
          'Access to billable actions is metered in prepaid credits. Credits are consumed when an action completes. Failed actions are not charged. Purchased credits are non-refundable except where required by law, and any refund is recorded in your ledger.',
        ],
      },
      {
        h: 'Your responsibilities',
        p: [
          'You are responsible for having the right to connect a repository and for the accuracy of the evidence you upload. You must not use the service to scan systems you are not authorised to assess.',
        ],
      },
      {
        h: 'Availability and liability',
        p: [
          'We aim for continuous availability but do not promise uninterrupted service. To the extent permitted by law, our liability is limited to the amounts you paid in the twelve months before the claim. Nothing limits liability that cannot lawfully be limited.',
        ],
      },
    ],
  },
  security: {
    title: 'Security',
    intro: 'How the service is built and operated. Written to be checked, not to be skimmed.',
    blocks: [
      {
        h: 'Tenant isolation',
        p: [
          'Every tenant-scoped table carries an organisation identifier, and every query in the application applies it explicitly. Object-level checks re-verify ownership before any read or write, so a missing filter cannot silently expose another customer’s data.',
        ],
      },
      {
        h: 'Secrets and encryption',
        p: [
          'Secrets at rest (GitHub installation tokens, API keys, payment keys) are encrypted with AES-256-GCM before storage. Sessions are opaque random tokens; passwords are hashed with scrypt. Traffic is served over TLS in production.',
          'We do not currently hold ISO 27001 or SOC 2 certification. If and when we obtain one, this page will say so with evidence.',
        ],
      },
      {
        h: 'Scan isolation',
        p: [
          'Repository scanning never executes code from the scanned repository. Manifests are read with bounded file counts, file sizes, path depth and total archive size, so a hostile repository cannot exhaust the worker.',
        ],
      },
      {
        h: 'Webhooks and integrity',
        p: [
          'Incoming webhooks (payments, GitHub) are verified with HMAC signatures and timestamp tolerance before processing, and are made idempotent so a replay cannot double-grant credits or duplicate work.',
        ],
      },
      {
        h: 'Audit trail',
        p: [
          'Security-relevant actions — sign-ins, key creation, role changes, approvals, exports, credit movements — are recorded in an append-only audit log with actor, target, IP and timestamp.',
        ],
      },
      {
        h: 'Reporting a vulnerability',
        p: [
          'Email security@example.com. We acknowledge within three working days and will not pursue researchers acting in good faith within scope.',
        ],
      },
    ],
  },
  dpa: {
    title: 'Data Processing Addendum',
    intro: 'Terms governing our processing of personal data on your behalf, where you are a controller.',
    blocks: [
      {
        h: 'Roles',
        p: ['You are the controller of personal data in your repositories and evidence. We act as a processor for that data, and as a controller for account and billing data.'],
      },
      {
        h: 'Subprocessors',
        p: [
          'A current list of subprocessors is published on the Subprocessors page. We notify customers of material changes before they take effect.',
        ],
      },
      {
        h: 'Transfers',
        p: [
          'Data is processed in the regions where our infrastructure runs. Where personal data leaves the EEA, transfers rely on the European Commission’s Standard Contractual Clauses.',
        ],
      },
      {
        h: 'Security measures',
        p: ['The technical and organisational measures described on the Security page apply to all processing under this addendum.'],
      },
      {
        h: 'Deletion and return',
        p: [
          'On termination you may request export or deletion of your data. We complete deletion within 30 days, excluding records required by law.',
        ],
      },
    ],
  },
  subprocessors: {
    title: 'Subprocessors',
    intro: 'Third parties that may process data on our behalf in order to operate the service.',
    blocks: [
      {
        h: 'Infrastructure and data',
        p: [
          'Cloudflare — application hosting, object storage, queues and DNS.',
          'Whatever relational database you configure for your deployment; the self-hosted default is SQLite on your own volume.',
        ],
      },
      {
        h: 'Source control',
        p: ['GitHub — repository metadata and file contents, when you connect the GitHub App or sign in with GitHub.'],
      },
      {
        h: 'Payments',
        p: ['Dodo Payments — checkout sessions, payment status and payout records. Card data is handled by the provider and never reaches our servers.'],
      },
      {
        h: 'Vulnerability intelligence (public sources)',
        p: [
          'OSV.dev — vulnerability records, queried by package and version.',
          'FIRST — EPSS exploitation probability scores, queried by CVE identifier.',
          'CISA — Known Exploited Vulnerabilities catalogue, synchronised periodically.',
          'These queries transmit package names and versions only. They do not identify you, your organisation or your repository.',
        ],
      },
      {
        h: 'Transactional email',
        p: ['Resend — sign-in and notification emails, when configured.'],
      },
      {
        h: 'Model providers',
        p: [
          'OpenAI or Anthropic — used only to re-word report drafts built from your own data, and only when you explicitly request a draft. Where a model is unavailable or unconfigured, the service falls back to a deterministic template.',
        ],
      },
    ],
  },
};

/** Reading progress: reads scroll position, never writes it. */
function ReadingProgress() {
  const bar = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  useFrame(() => {
    const node = bar.current;
    if (!node) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    node.style.transform = `scaleX(${progress.toFixed(4)})`;
  }, !reduced);

  return (
    <div aria-hidden="true" className="fixed left-0 top-16 z-40 h-px w-full bg-white/8">
      <div ref={bar} className="h-px w-full origin-left bg-gradient-to-r from-iris via-violet to-teal" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
}

export function LegalPage() {
  const { page } = useParams();
  const content = page ? SECTIONS[page] : undefined;
  const [active, setActive] = useState<string | null>(null);

  // Highlight the section currently being read.
  useEffect(() => {
    if (!content) return;
    const headings = Array.from(document.querySelectorAll('[data-legal-section]'));
    if (!headings.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.getAttribute('data-legal-section'));
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );
    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [content, page]);

  if (!content) return <NotFound />;

  return (
    <MarketingLayout>
      <ReadingProgress />

      <div className="mx-auto max-w-7xl px-5 pb-28 pt-16 sm:px-8 sm:pt-24">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-20">
          {/* The document */}
          <article className="min-w-0">
            <Reveal>
              <SectionLabel>Legal</SectionLabel>
            </Reveal>

            <RevealText as="h1" text={content.title} className="display mt-6 block text-display-3" />

            <Reveal delay={120}>
              <p className="mono mt-5 text-[11px] uppercase tracking-wider text-faint">
                Last updated {LAST_UPDATED}
              </p>
            </Reveal>

            <Reveal delay={180}>
              <p className="mt-6 max-w-2xl text-lead leading-relaxed text-muted">{content.intro}</p>
            </Reveal>

            <div className="mt-14 space-y-12">
              {content.blocks.map((block, index) => (
                <section
                  key={block.h}
                  id={block.h.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
                  data-legal-section={block.h}
                  className="scroll-mt-28"
                >
                  <Reveal delay={index * 40}>
                    <h2 className="text-lg font-medium tracking-tight text-text">{block.h}</h2>
                  </Reveal>
                  <div className="mt-4 max-w-2xl space-y-4">
                    {block.p.map((paragraph) => (
                      <Reveal key={paragraph} delay={index * 40}>
                        <p className="text-sm leading-[1.75] text-muted">{paragraph}</p>
                      </Reveal>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* Cross-links to the other legal pages */}
            <Reveal>
              <nav aria-label="Legal documents" className="mt-20 border-t border-white/8 pt-8">
                <p className="eyebrow">Other documents</p>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
                  {Object.entries(SECTIONS).map(([key, value]) => (
                    <Link
                      key={key}
                      to={`/legal/${key}`}
                      className={cx(
                        'link-underline',
                        key === page ? 'text-text' : 'text-muted hover:text-text',
                      )}
                    >
                      {value.title}
                    </Link>
                  ))}
                </div>
              </nav>
            </Reveal>
          </article>

          {/* Contents — sticky, so long documents stay navigable */}
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <p className="eyebrow">Contents</p>
              <nav aria-label="On this page" className="mt-5 space-y-3 text-sm">
                {content.blocks.map((block) => {
                  const slug = block.h.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                  return (
                    <a
                      key={block.h}
                      href={`#${slug}`}
                      className={cx(
                        'block leading-snug transition-colors duration-300',
                        active === block.h ? 'text-text' : 'text-faint hover:text-muted',
                      )}
                    >
                      {block.h}
                    </a>
                  );
                })}
              </nav>

              <div className="mt-10 border-t border-white/8 pt-6">
                <p className="text-[11px] leading-relaxed text-faint">
                  These pages describe what the product does today. No certification is claimed
                  because none is held.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </MarketingLayout>
  );
}
