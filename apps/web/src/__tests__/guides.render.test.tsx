import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { ToastProvider } from '../components/ui';
import Guide from '../pages/Guide';
import { GUIDES } from '../content/guides';

/**
 * Guide pages are the SEO surface, so two things must hold for every one of
 * them: they mount without throwing, and they still carry the facts and the
 * disclaimer that make them worth indexing. A redesign that drops the
 * "not legal advice" line should fail here, not in production.
 */

beforeAll(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ data: { user: null } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
});

function mount(route: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/guides" element={<Guide />} />
              <Route path="/guides/:slug" element={<Guide />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CRA guides', () => {
  it('lists every guide at /guides', () => {
    const { getByText } = mount('/guides');
    for (const guide of GUIDES) {
      expect(getByText(guide.title)).toBeTruthy();
    }
  });

  it.each(GUIDES.map((g) => [g.slug, g.heading] as [string, string]))(
    'renders %s with its heading, disclaimer and CTA',
    (slug, heading) => {
      const { getByText, container } = mount(`/guides/${slug}`);

      // The heading is split per word for animation, so compare on the rendered
      // text of the h1 rather than an exact string match.
      const h1 = container.querySelector('h1');
      expect(h1).not.toBeNull();
      expect((h1?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(heading);

      // Every guide carries the disclaimer and a single call to action. The
      // disclaimer is scoped to the article: the site footer repeats the same
      // sentence, which would otherwise make the query ambiguous.
      const article = container.querySelector('article');
      expect(article?.textContent).toMatch(/not legal advice/i);
      expect(getByText('Connect a repository')).toBeTruthy();

      // Structured content rendered: at least one section heading in the body.
      expect(container.querySelectorAll('h2').length).toBeGreaterThan(0);
    },
  );

  it('sets the document title and meta description for crawlers', () => {
    mount('/guides/article-14-reporting');
    expect(document.title).toContain('Article 14');
    const description = document.head.querySelector('meta[name="description"]');
    expect(description?.getAttribute('content') ?? '').toMatch(/24-hour|72-hour/);
    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href') ?? '').toContain('/guides/article-14-reporting');
  });

  it('redirects an unknown slug rather than rendering an empty page', () => {
    const { container } = mount('/guides/not-a-real-guide');
    expect(container.querySelector('h1')).toBeNull();
  });
});
