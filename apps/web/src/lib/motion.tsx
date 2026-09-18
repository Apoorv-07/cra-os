import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * Motion primitives for the public surfaces.
 *
 * Deliberately dependency-free: one shared rAF loop, direct transforms on refs
 * (no per-frame React state), passive listeners, and a hard stop under
 * `prefers-reduced-motion` or when the tab is hidden. Nothing here hijacks
 * scrolling — scroll-linked motion reads position, it never writes it, so the
 * wheel, keyboard, find-in-page and screen readers all keep native behaviour.
 *
 * Motion language
 *   FAST  ~200ms   pointer / magnetic response
 *   MEDIUM ~450ms  hovers, underlines, cursor states
 *   CINEMATIC 900ms  reveals and section entrances
 *   AMBIENT 9–34s  background drift
 */

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

/** `matchMedia` is absent in jsdom and some embedded webviews. */
const canMatchMedia = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    canMatchMedia() ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  );

  useEffect(() => {
    if (!canMatchMedia()) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (!canMatchMedia()) return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    setFine(mq.matches);
    const onChange = () => setFine(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return fine;
}

// ---------------------------------------------------------------------------
// Shared frame loop
// ---------------------------------------------------------------------------

export interface FrameState {
  /** Pointer position normalised to 0–1 across the viewport. */
  pointerX: number;
  pointerY: number;
  /** Raw client coordinates. */
  clientX: number;
  clientY: number;
  scrollY: number;
  /** Signed scroll velocity in px/s, smoothed. */
  velocity: number;
  /** Time since the previous frame in ms. */
  dt: number;
  time: number;
}

const state: FrameState = {
  pointerX: 0.5,
  pointerY: 0.5,
  clientX: 0,
  clientY: 0,
  scrollY: 0,
  velocity: 0,
  dt: 16,
  time: 0,
};

type FrameFn = (s: Readonly<FrameState>) => void;
const subscribers = new Set<FrameFn>();
let rafId = 0;
let lastTime = 0;
let lastScroll = 0;
let rawVelocity = 0;

function tick(now: number) {
  const dt = lastTime ? Math.min(64, now - lastTime) : 16;
  lastTime = now;

  // Exponential smoothing keeps parallax from jittering on trackpads.
  state.velocity += (rawVelocity - state.velocity) * 0.12;
  rawVelocity *= 0.86;
  state.dt = dt;
  state.time += dt;

  for (const fn of subscribers) fn(state);
  rafId = requestAnimationFrame(tick);
}

function ensureLoop() {
  if (rafId || subscribers.size === 0) return;
  lastTime = 0;
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (!rafId) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
}

function onPointerMove(e: PointerEvent) {
  state.clientX = e.clientX;
  state.clientY = e.clientY;
  state.pointerX = e.clientX / Math.max(1, window.innerWidth);
  state.pointerY = e.clientY / Math.max(1, window.innerHeight);
}

function onScroll() {
  const y = window.scrollY;
  rawVelocity = y - lastScroll;
  lastScroll = y;
  state.scrollY = y;
}

function onVisibility() {
  if (document.hidden) stopLoop();
  else ensureLoop();
}

let installed = false;
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  lastScroll = window.scrollY;
  state.scrollY = window.scrollY;
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
}

/** Subscribes to the shared frame loop. Transforms should be applied to refs. */
export function useFrame(fn: FrameFn, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    if (!enabled) return;
    const wrapper: FrameFn = (s) => ref.current(s);
    subscribers.add(wrapper);
    install();
    ensureLoop();
    onVisibility();
    return () => {
      subscribers.delete(wrapper);
      if (subscribers.size === 0) stopLoop();
    };
  }, [enabled]);
}

// ---------------------------------------------------------------------------
// Reveal — the primary entrance
// ---------------------------------------------------------------------------

export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
  style,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article' | 'span';
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      node.dataset.visible = 'true';
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            node.dataset.visible = 'true';
            observer.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const styleWithDelay = { ...style, ['--reveal-delay' as string]: `${delay}ms` };

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${className ?? ''}`}
      data-visible="false"
      style={styleWithDelay}
    >
      {children}
    </Tag>
  );
}

/** Plain ASCII space: never let a non-breaking space leak into composed text. */
const SPACE = '\u0020';

/**
 * Word-by-word typographic reveal.
 * The accessible name is set on the wrapper so screen readers read one clean
 * string instead of a stream of fragments.
 */
export function RevealText({
  text,
  className,
  stagger = 42,
  delay = 0,
  as: Tag = 'span',
}: {
  text: string;
  className?: string;
  stagger?: number;
  delay?: number;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      node.dataset.visible = 'true';
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            node.dataset.visible = 'true';
            observer.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const words = text.split(' ');

  return (
    <Tag ref={ref as never} className={className} data-visible="false" aria-label={text}>
      {words.map((word, index) => (
        <span key={`${word}-${index}`} aria-hidden="true" className="reveal-word">
          <span style={{ ['--word-delay' as string]: `${delay + index * stagger}ms` }}>{word}</span>
          {SPACE}
        </span>
      ))}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Magnetic pointer response
// ---------------------------------------------------------------------------

/**
 * Pulls an element gently toward the pointer when it is nearby.
 * The effect is bounded (default 6px) so it reads as material, not as a toy,
 * and it never moves an element out from under the user's click target.
 */
export function Magnetic({
  children,
  strength = 0.18,
  radius = 140,
  max = 8,
  className,
  style,
}: {
  children: ReactNode;
  strength?: number;
  radius?: number;
  max?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const rect = useRef<DOMRect | null>(null);
  const current = useRef({ x: 0, y: 0 });
  const target = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const invalidate = () => {
      rect.current = null;
    };
    window.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', invalidate, { passive: true });
    return () => {
      window.removeEventListener('scroll', invalidate);
      window.removeEventListener('resize', invalidate);
    };
  }, []);

  useFrame((s) => {
    const node = ref.current;
    if (!node) return;

    if (!rect.current) rect.current = node.getBoundingClientRect();
    const r = rect.current;

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = s.clientX - cx;
    const dy = s.clientY - cy;

    // Distance to the element's edge, not its centre, so wide buttons behave.
    const edgeX = Math.max(0, Math.abs(dx) - r.width / 2);
    const edgeY = Math.max(0, Math.abs(dy) - r.height / 2);
    const distance = Math.hypot(edgeX, edgeY);

    if (distance > radius) {
      target.current = { x: 0, y: 0 };
    } else {
      const falloff = 1 - distance / radius;
      target.current = {
        x: Math.max(-max, Math.min(max, dx * strength * falloff)),
        y: Math.max(-max, Math.min(max, dy * strength * falloff)),
      };
    }

    // Spring-ish lerp toward the target.
    const ease = 0.16;
    current.current.x += (target.current.x - current.current.x) * ease;
    current.current.y += (target.current.y - current.current.y) * ease;

    if (Math.abs(current.current.x) < 0.01 && Math.abs(current.current.y) < 0.01) {
      node.style.transform = '';
      return;
    }
    node.style.transform = `translate3d(${current.current.x.toFixed(2)}px, ${current.current.y.toFixed(2)}px, 0)`;
  }, !reduced && fine);

  useEffect(() => {
    if (reduced || !fine) {
      if (ref.current) ref.current.style.transform = '';
    }
  }, [reduced, fine]);

  return (
    <span ref={ref} className={`magnetic inline-block ${className ?? ''}`} style={style}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Parallax — reads scroll, writes only transforms
// ---------------------------------------------------------------------------

export function Parallax({
  children,
  speed = 0.06,
  rotate = 0,
  className,
  style,
}: {
  children: ReactNode;
  speed?: number;
  rotate?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const smoothing = useRef(0);

  useFrame((s) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const viewportCentre = window.innerHeight / 2;
    const offset = rect.top + rect.height / 2 - viewportCentre;

    // Velocity adds a little inertia: fast scrolling briefly overshoots.
    const desired = -offset * speed + Math.max(-40, Math.min(40, s.velocity * 0.35));
    smoothing.current += (desired - smoothing.current) * 0.1;

    const rot = rotate ? rotate * (smoothing.current / 100) : 0;
    node.style.transform = `translate3d(0, ${smoothing.current.toFixed(2)}px, 0)${rot ? ` rotate(${rot.toFixed(3)}deg)` : ''}`;
  }, !reduced);

  useEffect(() => {
    if (reduced && ref.current) ref.current.style.transform = '';
  }, [reduced]);

  return (
    <div ref={ref} className={className} style={{ willChange: 'transform', ...style }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atmosphere — the living background
// ---------------------------------------------------------------------------

/**
 * The living background.
 *
 * `full` renders three large blurred gradients — expensive, so it belongs to the
 * page-level fixed layer and nowhere else. `glow` is a single unblurred radial
 * gradient: the same sense of light in a section, at a fraction of the
 * compositing cost, which is what keeps a mid-range phone at 60fps.
 */
export function Atmosphere({
  className,
  intensity = 1,
  variant = 'full',
}: {
  className?: string;
  intensity?: number;
  variant?: 'full' | 'glow';
}) {
  const reduced = useReducedMotion();
  const layer = useRef<HTMLDivElement | null>(null);

  useFrame((s) => {
    const node = layer.current;
    if (!node) return;
    // The field drifts a few pixels with the pointer and breathes with scroll
    // velocity — enough to feel alive, not enough to distract.
    const px = (s.pointerX - 0.5) * 28 * intensity;
    const py = (s.pointerY - 0.5) * 22 * intensity;
    const vy = Math.max(-30, Math.min(30, s.velocity * 0.18)) * intensity;
    node.style.transform = `translate3d(${px.toFixed(2)}px, ${(py + vy).toFixed(2)}px, 0)`;
  }, !reduced);

  if (variant === 'glow') {
    return (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`}
      >
        <div
          ref={layer}
          className="absolute inset-0 will-change-transform"
          style={{
            background: `radial-gradient(70% 60% at 50% 40%, rgba(109,140,255,${0.16 * intensity}), transparent 70%)`,
          }}
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`}
    >
      <div ref={layer} className="absolute inset-0 will-change-transform">
        <div
          className="aurora animate-drift-a"
          style={{
            top: '-18%',
            left: '-8%',
            width: '58vw',
            height: '58vw',
            background: 'radial-gradient(circle at 50% 50%, rgba(109,140,255,0.5), transparent 62%)',
          }}
        />
        <div
          className="aurora animate-drift-b"
          style={{
            top: '18%',
            right: '-14%',
            width: '52vw',
            height: '52vw',
            background: 'radial-gradient(circle at 50% 50%, rgba(155,123,255,0.38), transparent 64%)',
          }}
        />
        <div
          className="aurora animate-drift-a"
          style={{
            bottom: '-26%',
            left: '22%',
            width: '46vw',
            height: '46vw',
            animationDelay: '-9s',
            background: 'radial-gradient(circle at 50% 50%, rgba(79,209,197,0.22), transparent 66%)',
          }}
        />
        {/* A horizon line gives the space a floor to sit on. */}
        <div
          className="absolute inset-x-0 bottom-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(255,255,255,0.16) 30%, rgba(255,255,255,0.16) 70%, transparent)',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cursor system
// ---------------------------------------------------------------------------

/**
 * A calm custom cursor for pointer devices only.
 *
 * The native cursor is hidden only while this is active and only on non-input
 * elements, so text editing and form entry keep precise system behaviour.
 * Touch devices and reduced-motion users never see it.
 */
export function CursorSystem() {
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const dot = useRef<HTMLDivElement | null>(null);
  const ring = useRef<HTMLDivElement | null>(null);
  const label = useRef<HTMLSpanElement | null>(null);
  const pos = useRef({ x: -100, y: -100, rx: -100, ry: -100 });
  const enabled = fine && !reduced;

  useEffect(() => {
    if (!enabled) return;
    document.body.dataset.customCursor = 'on';
    return () => {
      delete document.body.dataset.customCursor;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onOver = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const host = target?.closest?.('[data-cursor]') as HTMLElement | null;
      const node = ring.current;
      if (!node) return;
      if (host) {
        node.dataset.state = 'active';
        if (label.current) label.current.textContent = host.dataset.cursor ?? '';
      } else {
        node.dataset.state = 'idle';
      }
    };
    const onLeave = () => {
      if (ring.current) ring.current.dataset.state = 'hidden';
    };
    const onEnter = () => {
      if (ring.current) ring.current.dataset.state = 'idle';
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerenter', onEnter);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerenter', onEnter);
    };
  }, [enabled]);

  useFrame((s) => {
    if (pos.current.x < 0) {
      pos.current = { x: s.clientX, y: s.clientY, rx: s.clientX, ry: s.clientY };
    }
    pos.current.x = s.clientX;
    pos.current.y = s.clientY;
    // The ring trails the dot, which is what makes it feel physical.
    pos.current.rx += (s.clientX - pos.current.rx) * 0.18;
    pos.current.ry += (s.clientY - pos.current.ry) * 0.18;

    if (dot.current) {
      dot.current.style.transform = `translate3d(${pos.current.x}px, ${pos.current.y}px, 0) translate(-50%, -50%)`;
    }
    if (ring.current) {
      ring.current.style.transform = `translate3d(${pos.current.rx}px, ${pos.current.ry}px, 0) translate(-50%, -50%)`;
    }
  }, enabled);

  if (!enabled) return null;

  return (
    <>
      <div ref={dot} className="cursor-dot" aria-hidden="true" />
      <div ref={ring} className="cursor-ring" data-state="idle" aria-hidden="true">
        <span ref={label} className="cursor-label" />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/** Tracks whether an element is currently on screen — used to pause work. */
export function useInView<T extends HTMLElement>(margin = '-10%') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [margin]);

  return { ref, inView };
}

/** A number that counts up once when it first scrolls into view. */
export function useCountUp<T extends HTMLElement = HTMLElement>(target: number, duration = 1400) {
  const [value, setValue] = useState(0);
  const { ref, inView } = useInView<T>('0px');
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, target, duration, reduced]);

  return { ref, value };
}
