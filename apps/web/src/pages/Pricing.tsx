import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Info, Sparkles } from 'lucide-react';
import { usePricing } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { api, ApiError } from '../lib/api';
import { Button, Skeleton, useToast } from '../components/ui';
import { cx, formatMoney, formatNumber } from '../lib/format';
import {
  ActionLink,
  GlassPanel,
  MarketingLayout,
  SectionIntro,
  SectionLabel,
  TraceLine,
} from '../components/marketing';
import { Magnetic, Parallax, Reveal, RevealText, useCountUp } from '../lib/motion';

/**
 * Pricing.
 *
 * Identical commercial logic to before — checkout, error handling and the
 * "never pretend a charge happened" rule are untouched. The pricing objects are
 * now floating planes with different weights instead of four identical cards.
 */

export function PricingPage() {
  const { data, isLoading } = usePricing();
  const { user, orgId } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const buy = async (packKey: string) => {
    if (!user || !orgId) {
      navigate('/signup');
      return;
    }
    setBusy(packKey);
    try {
      const result = await api.post<{ checkoutUrl?: string; checkoutId?: string; message?: string }>(
        `/organizations/${orgId}/billing/checkout`,
        { packKey, provider: 'dodo' },
      );
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      toast.info(result.message ?? 'Checkout is not configured yet.');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.hint
            ? `${err.message} ${err.hint}`
            : err.message
          : 'Could not start checkout.';
      toast.error(message);
      if (err instanceof ApiError && err.code === 'integration_error') {
        // Payments are genuinely unconfigured; say so plainly rather than faking success.
        console.warn('payment provider not configured', err.details);
      }
    } finally {
      setBusy(null);
    }
  };

  const packs = data?.packs ?? [];
  const popularIndex = packs.findIndex((p) => p.popular);

  return (
    <MarketingLayout>
      <section className="relative pt-16 sm:pt-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid items-end gap-12 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <Reveal>
                <SectionLabel>Pricing</SectionLabel>
              </Reveal>
              <h1 className="display mt-6 text-display-2">
                <RevealText text="Pay for work done," className="block" />
                <RevealText text="not for seats" className="ink-gradient block" delay={120} />
              </h1>
              <Reveal delay={260}>
                <p className="mt-7 max-w-xl text-lead leading-relaxed text-muted">
                  Every action has a published credit cost. Credits sit on your account until you use
                  them. There is no per-seat licence, so adding a colleague is free, and there is no
                  annual commitment.
                </p>
              </Reveal>
            </div>

            <Reveal delay={180}>
              <Parallax speed={0.03}>
                <GlassPanel strong className="p-7">
                  <p className="eyebrow">Starter balance</p>
                  <FreeCreditCounter />
                  <p className="mt-4 text-sm leading-relaxed text-muted">
                    Enough for roughly ten repository scans. No card, no expiry while your account is
                    active.
                  </p>
                  <div className="mt-6">
                    <ActionLink to="/signup">Create an account</ActionLink>
                  </div>
                </GlassPanel>
              </Parallax>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        {isLoading ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {packs.map((pack, index) => {
              const featured = index === popularIndex;
              return (
                <Reveal
                  key={pack.id}
                  delay={index * 90}
                  className={cx(featured && 'lg:-translate-y-4')}
                >
                  <GlassPanel
                    hoverable
                    strong={featured}
                    className={cx(
                      'flex h-full flex-col p-7',
                      featured && 'ring-1 ring-iris/30',
                    )}
                    data-cursor={featured ? 'Most popular' : 'Buy'}
                  >
                    {featured ? (
                      <span className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-iris/15 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-iris ring-1 ring-iris/25">
                        <Sparkles size={10} />
                        Most popular
                      </span>
                    ) : null}

                    <h2 className="text-sm font-medium tracking-tight">{pack.name}</h2>

                    <p className="mt-4 text-3xl font-semibold tracking-tight text-text">
                      {formatMoney(pack.priceCents, pack.currency)}
                    </p>

                    <p className="mt-2 text-sm text-muted">
                      {formatNumber(pack.credits)} credits
                      {pack.bonusCredits > 0 ? (
                        <span className="text-pass"> + {formatNumber(pack.bonusCredits)} bonus</span>
                      ) : null}
                    </p>

                    <p className="mono mt-1 text-[11px] text-faint">
                      {formatMoney(
                        Math.round((pack.priceCents / (pack.credits + pack.bonusCredits)) * 1000) / 1000,
                        pack.currency,
                      )}{' '}
                      per credit
                    </p>

                    <div className="mt-7 flex-1" />

                    <Magnetic strength={0.12} max={5}>
                      <Button
                        variant={featured ? 'primary' : 'secondary'}
                        className="w-full"
                        loading={busy === pack.key}
                        onClick={() => buy(pack.key)}
                      >
                        Buy {pack.name}
                      </Button>
                    </Magnetic>
                  </GlassPanel>
                </Reveal>
              );
            })}
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <GlassPanel className="flex items-start gap-3 p-4">
            <Info size={15} className="mt-0.5 shrink-0 text-iris" />
            <p className="text-xs leading-relaxed text-muted">
              Payments are processed by our payment provider. Prices are shown in USD by default and
              can be displayed in EUR or GBP. Taxes are calculated at checkout.
            </p>
          </GlassPanel>
          <GlassPanel className="flex items-start gap-3 p-4">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-partial" />
            <p className="text-xs leading-relaxed text-muted">
              If checkout is not yet enabled on this deployment, the button will tell you instead of
              pretending to charge you. Nothing is billed unless a payment provider confirms it.
            </p>
          </GlassPanel>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-24 sm:px-8">
        <SectionIntro
          label="Credit costs"
          title="What each action costs"
          body="Costs are configuration, not code — the admin console can change them without a redeploy."
        />

        <Reveal delay={120} className="mt-12">
          <div className="overflow-hidden rounded-2xl border border-white/8">
            <table className="w-full text-sm">
              <caption className="sr-only">Credit cost per billable action</caption>
              <thead>
                <tr className="bg-white/[0.03]">
                  <th scope="col" className="px-6 py-3 text-left text-[11px] uppercase tracking-wider text-faint">
                    Action
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-[11px] uppercase tracking-wider text-faint">
                    Credits
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data?.usageRules ?? []).map((rule) => (
                  <tr key={rule.action} className="border-t border-white/6">
                    <th scope="row" className="px-6 py-3.5 text-left font-normal">
                      <span className="text-text">{rule.label}</span>
                      <span className="mono ml-2.5 text-[11px] text-faint">{rule.action}</span>
                    </th>
                    <td className="mono px-6 py-3.5 text-right text-muted">
                      {formatNumber(rule.credits)}
                    </td>
                  </tr>
                ))}
                {!data?.usageRules?.length ? (
                  <tr>
                    <td colSpan={2} className="px-6 py-8 text-center text-xs text-faint">
                      Usage rules are still loading.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-28 sm:px-8">
        <div className="mt-6">
          <TraceLine />
        </div>
        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {[
            {
              title: 'Free',
              price: '250 credits',
              body: 'Enough for your first repository: several scans and one readiness report. No card required.',
              items: ['Unlimited team members', 'SBOM export', 'CRA readiness score', 'Evidence vault'],
            },
            {
              title: 'Pay as you go',
              price: 'Credit packs',
              body: 'Buy credits when you need them. Enable auto top-up so scans never stall.',
              items: [
                'Auto top-up at a threshold you set',
                'Itemised ledger for every movement',
                'Refunds and bonuses in the ledger',
                'No expiry while active',
              ],
            },
            {
              title: 'Agency / enterprise',
              price: 'Talk to us',
              body: 'Multiple client organisations, shared reporting, invoicing and custom controls.',
              items: ['Client workspaces', 'Consolidated invoicing', 'Custom credit pricing', 'Priority support'],
            },
          ].map((tier, index) => (
            <Reveal key={tier.title} delay={index * 110}>
              <div className="h-full">
                <p className="eyebrow">{tier.title}</p>
                <p className="mt-3 text-xl font-semibold tracking-tight text-text">{tier.price}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted">{tier.body}</p>
                <ul className="mt-6 space-y-2.5">
                  {tier.items.map((item) => (
                    <li key={item} className="flex gap-2.5 text-sm text-muted">
                      <Check size={14} className="mt-0.5 shrink-0 text-pass" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={280} className="mt-20 text-center">
          <p className="text-lead text-muted">Questions about volume, invoicing or agencies?</p>
          <div className="mt-6">
            <Magnetic strength={0.12} max={5}>
              <Link
                to="/signup"
                className="link-underline text-sm font-medium text-text"
              >
                Start free, then talk to us
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </section>
    </MarketingLayout>
  );
}

function FreeCreditCounter() {
  const { ref, value } = useCountUp<HTMLSpanElement>(100, 1200);
  return (
    <p className="mt-3 flex items-baseline gap-2">
      <span ref={ref} className="display text-5xl text-text">
        {value}
      </span>
      <span className="text-sm text-faint">credits free</span>
    </p>
  );
}
