import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Atmosphere, CursorSystem, Magnetic, Reveal, useReducedMotion } from '../lib/motion';
import { cx } from '../lib/format';

/**
 * Shared public-surface shell.
 *
 * The authenticated product keeps its own dense, quiet chrome; everything here
 * belongs to the public environment: atmosphere, custom cursor, glass
 * materials, display typography and a footer that is identical on every page.
 */

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function MarketingLayout({
  children,
  showNav = true,
  showFooter = true,
  navOverlay = false,
}: {
  children: ReactNode;
  showNav?: boolean;
  showFooter?: boolean;
  navOverlay?: boolean;
}) {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-void text-text grain">
      {/* Fixed atmosphere sits behind everything and never intercepts input. */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <Atmosphere intensity={0.85} />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 80% at 50% -10%, rgba(109,140,255,0.10), transparent 60%), radial-gradient(90% 60% at 50% 110%, rgba(155,123,255,0.07), transparent 60%)',
          }}
        />
      </div>

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-iris focus:px-3 focus:py-2 focus:text-sm focus:text-void"
      >
        Skip to content
      </a>

      <CursorSystem />
      {showNav ? <MarketingNav overlay={navOverlay} /> : null}

      <main id="main">{children}</main>

      {showFooter ? <MarketingFooter /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export function MarketingNav({ overlay = false }: { overlay?: boolean }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cx(
        'sticky top-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-500 ease-out-expo',
        overlay && !scrolled
          ? 'border-b border-transparent bg-transparent'
          : 'border-b border-white/10 bg-void/70 backdrop-blur-xl',
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5" data-cursor="Home">
          <ShieldCheck size={19} className="text-iris" />
          <span className="text-sm font-semibold tracking-tight">CRA Compliance OS</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-7 text-sm text-muted md:flex">
          <a href="/#how" className="link-underline hover:text-text">
            How it works
          </a>
          <a href="/#features" className="link-underline hover:text-text">
            Features
          </a>
          <Link to="/pricing" className="link-underline hover:text-text">
            Pricing
          </Link>
          <a href="/#faq" className="link-underline hover:text-text">
            FAQ
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link to="/login">
            <button
              type="button"
              className="hidden h-9 items-center rounded-lg px-3 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text sm:inline-flex"
            >
              Sign in
            </button>
          </Link>
          <Magnetic strength={0.14} max={5}>
            <Link
              to="/signup"
              className="group inline-flex h-9 items-center gap-2 rounded-lg bg-text px-3.5 text-sm font-semibold text-void transition-transform duration-200 ease-out-expo hover:bg-white"
              data-cursor="Start"
            >
              Start free
              <ArrowRight
                size={14}
                className="transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5"
              />
            </Link>
          </Magnetic>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export function MarketingFooter() {
  return (
    <footer className="relative border-t border-white/8">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <ShieldCheck size={18} className="text-iris" />
              <span className="text-sm font-semibold tracking-tight">CRA Compliance OS</span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
              Continuous EU Cyber Resilience Act evidence for software teams. Engineering evidence
              tooling — not legal advice, and not a certification body.
            </p>
            <p className="mt-6 max-w-md text-[11px] leading-relaxed text-faint">
              Article 14 reporting obligations apply from 11 September 2026; the main obligations
              from 11 December 2027. Nothing produced by this product is a conformity assessment.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
            <div className="space-y-3">
              <p className="eyebrow">Product</p>
              <FooterLink to="/pricing">Pricing</FooterLink>
              <FooterLink to="/signup">Start free</FooterLink>
              <FooterLink to="/login">Sign in</FooterLink>
              <FooterLink href="/api/v1/openapi.json">API reference</FooterLink>
            </div>
            <div className="space-y-3">
              <p className="eyebrow">Guides</p>
              <FooterLink to="/guides">All guides</FooterLink>
              <FooterLink to="/guides/cra-readiness-checklist">Readiness checklist</FooterLink>
              <FooterLink to="/guides/cra-sbom-requirements">SBOM requirements</FooterLink>
              <FooterLink to="/guides/article-14-reporting">Article 14 reporting</FooterLink>
            </div>
            <div className="space-y-3">
              <p className="eyebrow">Company</p>
              <FooterLink to="/legal/privacy">Privacy</FooterLink>
              <FooterLink to="/legal/terms">Terms</FooterLink>
              <FooterLink to="/legal/security">Security</FooterLink>
              <FooterLink to="/legal/dpa">DPA</FooterLink>
              <FooterLink to="/legal/subprocessors">Subprocessors</FooterLink>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/8 pt-6 text-[11px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} CRA Compliance OS</span>
          <span>Engineering evidence, not legal advice.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ to, href, children }: { to?: string; href?: string; children: ReactNode }) {
  const className = 'block text-muted transition-colors hover:text-text';
  if (to) return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('eyebrow inline-flex items-center gap-2.5', className)}>
      <span className="h-px w-7 bg-gradient-to-r from-iris/70 to-transparent" />
      {children}
    </span>
  );
}

/** A translucent surface. Used for depth, not as a bordered box. */
export function GlassPanel({
  children,
  className,
  strong = false,
  hoverable = false,
  style,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
  hoverable?: boolean;
  style?: React.CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cx(
        strong ? 'glass-strong' : 'glass',
        'sheen-top rounded-2xl',
        hoverable && 'hoverable sheen-hover',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/** Link styled as a primary action, with magnetic pointer response. */
export function ActionLink({
  to,
  href,
  children,
  variant = 'primary',
  className,
}: {
  to?: string;
  href?: string;
  children: ReactNode;
  variant?: 'primary' | 'quiet';
  className?: string;
}) {
  const styles = cx(
    'group inline-flex h-12 items-center gap-2.5 rounded-xl px-6 text-sm font-semibold transition-colors duration-300',
    variant === 'primary'
      ? 'bg-text text-void hover:bg-white'
      : 'text-text ring-1 ring-white/15 hover:bg-white/5',
    className,
  );

  const inner = (
    <>
      {children}
      <ArrowRight
        size={15}
        className="transition-transform duration-500 ease-out-expo group-hover:translate-x-1"
      />
    </>
  );

  return (
    <Magnetic strength={0.16} max={7}>
      {to ? (
        <Link to={to} className={styles} data-cursor="Go">
          {inner}
        </Link>
      ) : (
        <a href={href} className={styles} data-cursor="Go">
          {inner}
        </a>
      )}
    </Magnetic>
  );
}

/**
 * Accordion with a real height transition (grid-template-rows 0fr→1fr), so
 * opening is animated instead of an instant display flip.
 */
export function Accordion({ items }: { items: Array<{ q: string; a: string }> }) {
  const [open, setOpen] = useState<number | null>(0);
  const reduced = useReducedMotion();

  return (
    <div className="divide-y divide-white/8 border-y border-white/8">
      {items.map((item, index) => {
        const isOpen = open === index;
        return (
          <div key={item.q}>
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-panel-${index}`}
                onClick={() => setOpen(isOpen ? null : index)}
                className={cx(
                  'flex w-full items-start gap-5 py-6 text-left transition-colors duration-300',
                  isOpen ? 'text-text' : 'text-text/80 hover:text-text',
                )}
              >
                <span
                  className={cx(
                    'mt-2 h-1.5 w-1.5 shrink-0 rounded-full transition-all duration-500 ease-out-expo',
                    isOpen ? 'scale-150 bg-iris' : 'bg-faint',
                  )}
                />
                <span className="flex-1 text-base font-medium leading-snug sm:text-lg">{item.q}</span>
                <span
                  aria-hidden="true"
                  className={cx(
                    'mt-1 shrink-0 text-xl leading-none text-faint transition-transform duration-500 ease-out-expo',
                    isOpen && 'rotate-45 text-iris',
                  )}
                >
                  +
                </span>
              </button>
            </h3>
            <div
              id={`faq-panel-${index}`}
              role="region"
              className={cx('grid transition-all duration-500 ease-out-expo', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
              style={{ transitionDuration: reduced ? '1ms' : undefined }}
            >
              <div className="overflow-hidden">
                <p className="max-w-3xl pb-6 pl-9 text-sm leading-relaxed text-muted">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Section entrance with a label, heading and optional supporting copy. */
export function SectionIntro({
  label,
  title,
  body,
  align = 'left',
}: {
  label: string;
  title: ReactNode;
  body?: ReactNode;
  align?: 'left' | 'center';
}) {
  return (
    <div className={cx('max-w-3xl', align === 'center' && 'mx-auto text-center')}>
      <Reveal>
        <SectionLabel>{label}</SectionLabel>
      </Reveal>
      <Reveal delay={80}>
        <h2 className="display mt-5 text-display-3 text-text">{title}</h2>
      </Reveal>
      {body ? (
        <Reveal delay={160}>
          <p className="mt-5 text-lead leading-relaxed text-muted">{body}</p>
        </Reveal>
      ) : null}
    </div>
  );
}

/** A thin line that draws itself when scrolled into view. */
export function TraceLine({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} aria-hidden="true" className={cx('h-px w-full bg-white/8/60', className)}>
      <div
        className={cx('h-px w-full origin-left bg-gradient-to-r from-iris/80 via-violet/40 to-transparent', visible && 'animate-trace')}
        style={{ transform: visible ? undefined : 'scaleX(0)' }}
      />
    </div>
  );
}
