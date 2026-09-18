import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * This project runs Vitest with `globals: false`, so Testing Library cannot
 * auto-register its cleanup hook. Without this, every test would render into
 * the previous test's DOM and text assertions would find duplicates.
 */
afterEach(() => {
  cleanup();
});

/**
 * jsdom shims for the browser APIs the motion layer uses.
 *
 * `IntersectionObserver` reports elements as immediately visible so tests
 * exercise the revealed state, and `matchMedia` reports a desktop pointer with
 * no reduced-motion preference — the default experience a visitor gets.
 */

class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [1];

  constructor(private callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (!('IntersectionObserver' in globalThis)) {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    ImmediateIntersectionObserver;
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('hover: hover'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
