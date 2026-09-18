import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { ToastProvider } from '../components/ui';
import { Home } from '../pages/Home';
import { PricingPage } from '../pages/Pricing';
import { LegalPage } from '../pages/Legal';
import { Login, Signup } from '../pages/Auth';
import { ShareReport } from '../pages/ShareReport';

/**
 * Marketing render smoke tests.
 *
 * These exist to catch the failure mode a type-check cannot: a page that
 * compiles but throws on mount (bad hook order, a provider that expects a
 * browser API jsdom does not implement, a component reading `window` too early).
 *
 * They also assert that the copy is still present, so a redesign can never
 * silently delete the claims, the pricing facts or the legal text.
 */

const _originalFetch = globalThis.fetch;

/** Headings are split per word for animation, so compare on normalised text. */
const normalise = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();

beforeAll(() => {
  // Every request the providers make on mount is answered locally.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (data: unknown) =>
      new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.includes('/billing/pricing')) {
      return json({
        currency: 'USD',
        packs: [
          {
            id: 'pk_1',
            key: 'starter',
            name: 'Starter',
            credits: 1000,
            priceCents: 2900,
            currency: 'USD',
            bonusCredits: 0,
            popular: false,
            active: true,
          },
          {
            id: 'pk_2',
            key: 'growth',
            name: 'Growth',
            credits: 5000,
            priceCents: 12900,
            currency: 'USD',
            bonusCredits: 500,
            popular: true,
            active: true,
          },
        ],
        usageRules: [{ action: 'scan.repository', label: 'Repository scan', credits: 10 }],
      });
    }
    if (url.includes('/share/')) {
      return json({
        repository: {
          name: 'acme/payments-api',
          readinessScore: 62,
          lastScanAt: Date.now(),
          componentCount: 412,
          criticalCount: 2,
          highCount: 7,
          kevCount: 1,
        },
        note: 'Shared by acme',
      });
    }
    // Default: treat the caller as signed out.
    return new Response(JSON.stringify({ error: { code: 'unauthenticated' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
});

function mount(ui: React.ReactNode, route = '/') {
  const element = route.includes(':page') ? ui : ui;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/*" element={element} />
              <Route path="/legal/:page" element={element} />
              <Route path="/share/:token" element={element} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('marketing pages mount without throwing', () => {
  it('home renders the claims, the steps and the FAQ', () => {
    const { getByText, getByRole, container } = mount(<Home />);

    expect(getByRole('heading', { level: 1 })).toBeTruthy();
    expect(getByText(/Article 14 reporting obligations start 11 September 2026/i)).toBeTruthy();
    expect(getByText('Connect a repository')).toBeTruthy();
    expect(getByText('Get explainable readiness')).toBeTruthy();
    expect(getByText('SBOM you can hand over')).toBeTruthy();
    expect(getByText(/Is this legal advice\?/)).toBeTruthy();

    // The hero object replaced the old terminal preview, and the animated
    // figures still expose their real value to assistive technology.
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).toContain('412');
    expect(container.textContent).toContain('62');

    // Sections keep their ids so in-page navigation still resolves.
    expect(container.querySelector('#how')).toBeTruthy();
    expect(container.querySelector('#features')).toBeTruthy();
    expect(container.querySelector('#faq')).toBeTruthy();
  });

  it('pricing renders the catalogue returned by the API', async () => {
    const { getByText, getAllByText, findByText, container } = mount(<PricingPage />);
    // RevealText splits headings per word, so assert on the composed text.
    expect(normalise(container.querySelector('h1')?.textContent)).toContain('Pay for work done');
    // Packs arrive from the API, so wait for them like a visitor would.
    expect(await findByText('Starter')).toBeTruthy();
    expect(getByText('Growth')).toBeTruthy();
    expect(getAllByText(/Buy (Starter|Growth)/).length).toBe(2);
    expect(getByText('Repository scan')).toBeTruthy();
  });

  it('legal renders every block of the policy and the disclaimer', () => {
    const { getByText, getAllByText, container } = mount(<LegalPage />, '/legal/privacy');
    expect(normalise(container.querySelector('h1')?.textContent)).toContain('Privacy Policy');
    // Present twice by design: as a section heading and in the sticky contents.
    expect(getAllByText('What we process').length).toBeGreaterThanOrEqual(1);
    expect(getByText(/We do not execute code from your repositories/)).toBeTruthy();
    expect(getByText(/Last updated/)).toBeTruthy();
  });

  it('auth pages render their forms and the evidence promise', () => {
    const login = mount(<Login />);
    expect(login.getByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(normalise(login.container.querySelector('h2')?.textContent)).toContain(
      'Turn your repositories into',
    );
    cleanup();

    const signup = mount(<Signup />);
    expect(signup.getByRole('button', { name: /create account/i })).toBeTruthy();
  });

  it('the shared report renders posture without enumerating vulnerabilities', async () => {
    const { getByText, findByText, container } = mount(<ShareReport />, '/share/abc123');
    expect(await findByText('acme/payments-api')).toBeTruthy();
    expect(getByText('Components')).toBeTruthy();
    expect(getByText('Known exploited')).toBeTruthy();

    // A public page must never list CVE ids.
    expect(container.textContent).not.toMatch(/CVE-\d{4}-\d+/);
  });
});
