import { useEffect } from 'react';

/**
 * Document head management for the marketing and guide pages.
 *
 * The app is a single-page bundle, so title and description tags have to be
 * written at runtime. Search engines execute JavaScript for indexed pages, and
 * the crawler-facing routes (`/`, `/pricing`, `/guides/*`, `/legal/*`) are the
 * ones that matter — the authenticated app behind `/app` should never be
 * indexed.
 */

interface SeoOptions {
  title: string;
  description: string;
  /** Path only; the origin is derived from the current location. */
  path: string;
  /** Set on pages that must never be indexed. */
  noindex?: boolean;
}

/** Creates or updates `<meta name="…" content="…">` (or the `property` form). */
function upsertMeta(attribute: 'name' | 'property', key: string, content: string): void {
  const selector = `meta[${attribute}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attribute, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useSeo({ title, description, path, noindex = false }: SeoOptions): void {
  useEffect(() => {
    const url = `${window.location.origin}${path}`;

    document.title = title;
    upsertMeta('name', 'description', description);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:url', url);
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta(
      'name',
      'robots',
      noindex ? 'noindex, nofollow' : 'index, follow, max-snippet:-1, max-image-preview:large',
    );
    upsertLink('canonical', url);
  }, [title, description, path, noindex]);
}
