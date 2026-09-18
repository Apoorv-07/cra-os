import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Check, CreditCard, Info, Receipt, Wallet } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, ApiError } from '../lib/api';
import { useBilling, useLedger, usePricing } from '../lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '../components/ui';
import { PageHeader, StatCard } from '../components/layout';
import { cx, formatDate, formatMoney, formatNumber } from '../lib/format';

const LEDGER_LABEL: Record<string, string> = {
  purchase: 'Purchase',
  grant: 'Grant',
  reservation: 'Reserved',
  commit: 'Charged',
  release: 'Released',
  expiry: 'Expired',
  refund: 'Refund',
  bonus: 'Bonus',
};

export function Billing() {
  const { orgId } = useAuth();
  const { data: billing, isLoading } = useBilling(orgId);
  const { data: ledger } = useLedger(orgId);
  const { data: pricing } = usePricing();
  const toast = useToast();
  const qc = useQueryClient();

  const [threshold, setThreshold] = useState('100');
  const [packKey, setPackKey] = useState('');
  const [busyPack, setBusyPack] = useState<string | null>(null);

  const topUp = useMutation({
    mutationFn: (enabled: boolean) =>
      api.post(`/organizations/${orgId}/billing/auto-topup`, {
        enabled,
        thresholdCredits: Number(threshold),
        packKey: packKey || null,
      }),
    onSuccess: (_r, enabled) => {
      toast.success(enabled ? 'Auto top-up enabled' : 'Auto top-up disabled');
      void qc.invalidateQueries({ queryKey: ['billing', orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not update auto top-up'),
  });

  const buy = async (key: string) => {
    setBusyPack(key);
    try {
      const result = await api.post<{ checkoutUrl?: string; message?: string }>(
        `/organizations/${orgId}/billing/checkout`,
        { packKey: key },
      );
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      toast.info(result.message ?? 'Checkout unavailable');
    } catch (err) {
      if (err instanceof ApiError && err.isCreditError === false && err.code === 'integration_error') {
        toast.error(err.hint ?? err.message);
      } else {
        toast.error(err instanceof Error ? err.message : 'Checkout failed');
      }
    } finally {
      setBusyPack(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const autoTopup = billing?.autoTopup ?? { enabled: false, thresholdCredits: 100, packKey: null };

  return (
    <>
      <PageHeader
        title="Credits"
        description="Prepaid credits, metered per action. Every movement is an immutable ledger entry, so the balance always reconciles."
        action={
          <Link to="/pricing">
            <Button icon={<ArrowUpRight size={14} />}>See pricing</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Balance"
          value={formatNumber(billing?.balance ?? 0)}
          hint={billing?.balance && billing.balance < 100 ? 'Running low' : 'Available now'}
          tone={billing?.balance && billing.balance < 100 ? 'warn' : 'good'}
          icon={<Wallet size={14} />}
        />
        <StatCard label="Lifetime purchased" value={formatNumber(billing?.lifetimePurchased ?? 0)} icon={<CreditCard size={14} />} />
        <StatCard label="Lifetime granted" value={formatNumber(billing?.lifetimeGranted ?? 0)} icon={<Check size={14} />} />
        <StatCard label="Lifetime consumed" value={formatNumber(billing?.lifetimeConsumed ?? 0)} icon={<Receipt size={14} />} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Buy credits"
              subtitle="Packs are applied immediately on payment confirmation"
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {(pricing?.packs ?? []).map((pack) => (
                <div
                  key={pack.id}
                  className={cx(
                    'rounded-lg border p-3.5',
                    pack.popular ? 'border-accent/50 bg-accent/5' : 'border-border bg-surface-2/40',
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium text-text">{pack.name}</span>
                    <span className="text-sm font-semibold">{formatMoney(pack.priceCents, pack.currency)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatNumber(pack.credits)} credits
                    {pack.bonusCredits > 0 ? <span className="text-pass"> + {formatNumber(pack.bonusCredits)}</span> : null}
                  </p>
                  <Button
                    className="mt-3 w-full"
                    variant={pack.popular ? 'primary' : 'secondary'}
                    size="sm"
                    loading={busyPack === pack.key}
                    onClick={() => buy(pack.key)}
                  >
                    Buy
                  </Button>
                </div>
              ))}
              {!pricing?.packs?.length ? (
                <p className="px-1 py-4 text-xs text-faint">No credit packs are configured on this deployment yet.</p>
              ) : null}
            </div>

            {!billing?.paymentsEnabled ? (
              <div className="px-4 pb-4">
                <Alert tone="warn" title="Payments are not configured on this deployment">
                  Set <span className="mono">PAYMENT_PROVIDER</span> and the provider credentials to enable checkout.
                  Until then, buying credits will fail honestly rather than pretend to succeed. Administrators can grant
                  credits directly from the admin console.
                </Alert>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Credit ledger"
              subtitle="Append-only. Reservations, charges and releases are all recorded."
            />
            {ledger && ledger.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Type</Th>
                    <Th>Description</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="text-right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <Tr key={entry.id}>
                      <Td className="text-xs text-muted">{formatDate(entry.createdAt)}</Td>
                      <Td>
                        <Badge>{LEDGER_LABEL[entry.type] ?? entry.type}</Badge>
                      </Td>
                      <Td className="max-w-xs truncate text-xs text-muted">{entry.description ?? '—'}</Td>
                      <Td
                        className={cx(
                          'text-right mono text-xs',
                          entry.amount > 0 ? 'text-pass' : entry.amount < 0 ? 'text-fail' : 'text-muted',
                        )}
                      >
                        {entry.amount > 0 ? '+' : ''}
                        {entry.amount}
                      </Td>
                      <Td className="text-right mono text-xs text-muted">{entry.balanceAfter}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="px-4 py-8 text-center text-xs text-faint">No movements yet.</p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Automatic top-up" subtitle="Never let a scan stall" />
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-text">Enable auto top-up</p>
                  <p className="text-[11px] text-faint">Buy a pack when the balance falls below a threshold.</p>
                </div>
                <Switch
                  checked={autoTopup.enabled}
                  onChange={(next) => topUp.mutate(next)}
                  disabled={topUp.isPending}
                />
              </div>

              <Field label="Threshold (credits)">
                <Input value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
              </Field>

              <Field label="Pack to buy">
                <Select value={packKey} onChange={(e) => setPackKey(e.target.value)}>
                  <option value="">Default pack</option>
                  {(pricing?.packs ?? []).map((pack) => (
                    <option key={pack.id} value={pack.key}>
                      {pack.name} — {formatMoney(pack.priceCents, pack.currency)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Button
                className="w-full"
                loading={topUp.isPending}
                onClick={() => topUp.mutate(autoTopup.enabled)}
                disabled={!autoTopup.enabled}
              >
                Save settings
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="What costs credits" />
            <ul className="divide-y divide-border">
              {(pricing?.usageRules ?? []).map((rule) => (
                <li key={rule.action} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs text-muted">{rule.label}</span>
                  <span className="mono text-xs text-text">{rule.credits}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-start gap-2">
                <Info size={13} className="mt-0.5 shrink-0 text-faint" />
                <p className="text-[11px] leading-relaxed text-muted">
                  Credits are reserved before work starts and released if it fails, so a failed scan never costs you
                  anything.
                </p>
              </div>
            </div>
          </Card>

          {(billing?.balance ?? 0) < 100 ? (
            <div className="rounded-lg border border-partial/30 bg-partial/5 px-3.5 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-partial" />
                <p className="text-[11px] leading-relaxed text-muted">
                  Your balance is low. A repository scan costs 10 credits and an Article 14 draft costs 200.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
