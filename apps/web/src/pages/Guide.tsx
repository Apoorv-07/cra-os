import { Link, useParams, Navigate } from 'react-router-dom';
import { MarketingLayout, SectionLabel } from '../components/marketing';
import { Reveal, RevealText } from '../lib/motion';
import { useSeo } from '../lib/seo';
import { GUIDES, guideBySlug, type GuideSection } from '../content/guides';

/**
 * Long-form CRA reference guides.
 *
 * Rendered from structured content rather than hand-written JSX so that adding
 * a guide is an editing job, not a component job. Every page carries the same
 * disclaimer and the same single call to action; nothing here pretends to be
 * legal advice, because a compliance product that overstates itself is worse
 * than no product.
 */

const LAST_REVIEWED = '18 September 2026';

const anchor = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function Section({ section, index }: { section: GuideSection; index: number }) {
  return (
    <section id={anchor(section.h)} className="scroll-mt-28">
      <Reveal delay={index * 30}>
        <h2 className="text-lg font-medium tracking-tight text-text">{section.h}</h2>
      </Reveal>

      <div className="mt-4 max-w-2xl space-y-4">
        {section.p?.map((paragraph) => (
          <Reveal key={paragraph.slice(0, 40)} delay={index * 30}>
            <p className="text-sm leading-[1.75] text-muted">{paragraph}</p>
          </Reveal>
        ))}

        {section.bullets ? (
          <Reveal delay={index * 30}>
            <ul className="mt-5 space-y-3">
              {section.bullets.map((bullet) => (
                <li key={bullet.slice(0, 40)} className="flex gap-3 text-sm leading-[1.7] text-muted">
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-iris/70" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        ) : null}

        {section.steps ? (
          <Reveal delay={index * 30}>
            <dl className="mt-5 space-y-4 border-l border-white/8 pl-5">
              {section.steps.map((step) => (
                <div key={step.label}>
                  <dt className="mono text-[11px] uppercase tracking-wider text-accent">{step.label}</dt>
                  <dd className="mt-1.5 text-sm leading-[1.7] text-muted">{step.text}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}

function GuideIndex() {
  useSeo({
    title: 'EU Cyber Resilience Act guides for engineering teams — CRA Compliance OS',
    description:
      'Plain-English guides to the EU Cyber Resilience Act: readiness checklist, SBOM requirements, Article 14 reporting, and what the regulation means for software teams.',
    path: '/guides',
  });

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-4xl px-5 pb-28 pt-16 sm:px-8 sm:pt-24">
        <Reveal>
          <SectionLabel>Guides</SectionLabel>
        </Reveal>
        <RevealText
          as="h1"
          text="EU Cyber Resilience Act guides for engineering teams"
          className="display mt-6 block text-display-3"
        />
        <Reveal delay={140}>
          <p className="mt-6 max-w-2xl text-lead leading-relaxed text-muted">
            Written for the people who have to produce the evidence, not for the people who file it.
            Engineering context — not legal advice.
          </p>
        </Reveal>

        <div className="mt-14 space-y-4">
          {GUIDES.map((item, index) => (
            <Reveal key={item.slug} delay={index * 40}>
              <Link
                to={`/guides/${item.slug}`}
                className="group block rounded-xl border border-white/8 px-6 py-6 transition hover:border-iris/30 hover:bg-white/[0.02]"
              >
                <h2 className="text-base font-medium tracking-tight text-text">{item.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </MarketingLayout>
  );
}

export default function Guide() {
  const { slug } = useParams<{ slug: string }>();
  const guide = guideBySlug(slug);

  useSeo({
    title: guide ? `${guide.title} — CRA Compliance OS` : 'EU CRA guides — CRA Compliance OS',
    description:
      guide?.description ??
      'Plain-English guides to the EU Cyber Resilience Act for engineering teams.',
    path: guide ? `/guides/${guide.slug}` : '/guides',
  });

  if (!slug) return <GuideIndex />;

  // An unknown slug is a 404, not a blank page.
  if (!guide) return <Navigate to="/" replace />;

  const related = guide.related.map(guideBySlug).filter((g): g is NonNullable<typeof g> => Boolean(g));

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-7xl px-5 pb-28 pt-16 sm:px-8 sm:pt-24">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-20">
          <article className="min-w-0">
            <Reveal>
              <SectionLabel>{guide.eyebrow}</SectionLabel>
            </Reveal>

            <RevealText as="h1" text={guide.heading} className="display mt-6 block text-display-3" />

            <Reveal delay={120}>
              <p className="mono mt-5 text-[11px] uppercase tracking-wider text-faint">
                Last reviewed {LAST_REVIEWED}
              </p>
            </Reveal>

            <Reveal delay={180}>
              <p className="mt-6 max-w-2xl text-lead leading-relaxed text-muted">{guide.intro}</p>
            </Reveal>

            <div className="mt-14 space-y-12">
              {guide.sections.map((section, index) => (
                <Section key={section.h} section={section} index={index} />
              ))}
            </div>

            {/* The disclaimer travels with the content, not just the footer. */}
            <Reveal>
              <p className="mt-14 max-w-2xl rounded-lg border border-white/8 bg-white/[0.02] px-5 py-4 text-[13px] leading-relaxed text-faint">
                This guide is engineering context, not legal advice. Confirm your obligations against
                the regulation itself and with your own advisers.
              </p>
            </Reveal>

            {/* Call to action — one, and only after the content has been useful. */}
            <Reveal>
              <div className="mt-10 max-w-2xl rounded-xl border border-iris/20 bg-iris/[0.04] px-6 py-7">
                <h2 className="text-base font-medium tracking-tight text-text">{guide.cta.heading}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{guide.cta.body}</p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    to="/signup"
                    className="rounded-md bg-iris px-4 py-2 text-sm font-medium text-void transition hover:brightness-110"
                  >
                    Connect a repository
                  </Link>
                  <Link to="/pricing" className="text-sm text-muted underline-offset-4 hover:text-text hover:underline">
                    See pricing
                  </Link>
                </div>
              </div>
            </Reveal>

            {related.length > 0 ? (
              <Reveal>
                <nav aria-label="Related guides" className="mt-16 border-t border-white/8 pt-8">
                  <p className="eyebrow">Keep reading</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {related.map((item) => (
                      <Link
                        key={item.slug}
                        to={`/guides/${item.slug}`}
                        className="group rounded-lg border border-white/8 px-5 py-4 transition hover:border-iris/30 hover:bg-white/[0.02]"
                      >
                        <span className="block text-sm font-medium text-text">{item.title}</span>
                        <span className="mt-1.5 block text-[13px] leading-relaxed text-faint">
                          {item.description.slice(0, 110)}…
                        </span>
                      </Link>
                    ))}
                  </div>
                </nav>
              </Reveal>
            ) : null}
          </article>

          {/* Sticky contents — these are long documents. */}
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <p className="eyebrow">On this page</p>
              <nav aria-label="On this page" className="mt-5 space-y-3 text-[13px]">
                {guide.sections.map((section) => (
                  <a
                    key={section.h}
                    href={`#${anchor(section.h)}`}
                    className="block leading-snug text-faint transition hover:text-text"
                  >
                    {section.h}
                  </a>
                ))}
              </nav>

              <p className="eyebrow mt-10">All guides</p>
              <nav aria-label="All guides" className="mt-4 space-y-3 text-[13px]">
                {GUIDES.map((item) => (
                  <Link
                    key={item.slug}
                    to={`/guides/${item.slug}`}
                    className={
                      item.slug === guide.slug
                        ? 'block leading-snug text-text'
                        : 'block leading-snug text-faint transition hover:text-text'
                    }
                  >
                    {item.title}
                  </Link>
                ))}
              </nav>

              <Link
                to="/signup"
                className="mt-8 inline-block rounded-md border border-white/10 px-4 py-2 text-[13px] text-text transition hover:border-iris/40"
              >
                Start free — 250 credits
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </MarketingLayout>
  );
}
