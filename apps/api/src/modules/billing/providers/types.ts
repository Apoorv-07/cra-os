import type { CreditPack, Plan } from '../../../db/schema.js';

/**
 * Payment provider contract.
 *
 * The platform never talks to a payment processor directly — everything goes
 * through this interface, so Dodo (today) can be swapped for Stripe, Paddle or
 * another Merchant of Record without touching the credit ledger or the routes.
 */

export type ProviderName = 'dodo' | 'stripe' | 'paddle' | 'manual';

export interface CheckoutInput {
  orgId: string;
  orgName: string;
  customerEmail: string;
  customerName?: string | null;
  pack?: CreditPack;
  plan?: Plan;
  currency: string;
  returnUrl: string;
  metadata: Record<string, string>;
}

export interface CheckoutResult {
  provider: ProviderName;
  checkoutId: string;
  checkoutUrl: string;
  paymentId?: string | null;
  clientSecret?: string | null;
  raw?: unknown;
}

export interface WebhookVerification {
  valid: boolean;
  /** Provider-side event id, used as our idempotency key. */
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly configured: boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Verifies the raw body against the provider's signature scheme. */
  verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
  }): WebhookVerification;
  /** Best-effort reconciliation used by the admin console and by retries. */
  fetchPayment?(paymentId: string): Promise<{ status: string; raw: unknown } | null>;
}

/** Shape of the money-bearing part of a provider payload, normalised. */
export interface NormalisedPayment {
  providerPaymentId: string;
  status: 'succeeded' | 'failed' | 'refunded' | 'pending' | 'disputed' | 'cancelled';
  amountCents: number;
  currency: string;
  orgId?: string;
  packKey?: string;
  planKey?: string;
  checkoutId?: string;
  customerId?: string;
  receiptUrl?: string;
  raw: unknown;
}

export function normaliseDodoPayment(event: {
  type: string;
  payload: Record<string, unknown>;
}): NormalisedPayment {
  // Dodo nests fields under `data`, but we stay tolerant of both shapes.
  const raw = event.payload;
  const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>;

  const metadata = (data.metadata ?? {}) as Record<string, string>;

  const type = event.type.toLowerCase();
  let status: NormalisedPayment['status'] = 'pending';
  if (type.endsWith('succeeded') || type.endsWith('completed') || data.status === 'succeeded') {
    status = 'succeeded';
  } else if (type.endsWith('failed')) status = 'failed';
  else if (type.includes('refund')) status = 'refunded';
  else if (type.includes('dispute')) status = 'disputed';
  else if (type.endsWith('cancelled')) status = 'cancelled';

  return {
    providerPaymentId: String(data.payment_id ?? data.id ?? raw.payment_id ?? ''),
    status,
    amountCents: Number(data.total_amount ?? data.amount ?? 0),
    currency: String(data.currency ?? 'USD'),
    orgId: metadata.org_id ?? metadata.orgId,
    packKey: metadata.pack_key ?? metadata.packKey,
    planKey: metadata.plan_key ?? metadata.planKey,
    checkoutId: metadata.checkout_id ? String(metadata.checkout_id) : undefined,
    customerId: (data.customer as Record<string, unknown> | undefined)?.customer_id
      ? String((data.customer as Record<string, unknown>).customer_id)
      : undefined,
    receiptUrl: typeof data.receipt_url === 'string' ? data.receipt_url : undefined,
    raw,
  };
}
