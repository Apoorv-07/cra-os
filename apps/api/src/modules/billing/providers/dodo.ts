import { env } from '../../../env.js';
import { AppError } from '../../../core/errors.js';
import { verifyStandardWebhook } from '../../../core/crypto.js';
import { log } from '../../../core/logger.js';
import type {
  CheckoutInput,
  CheckoutResult,
  PaymentProvider,
  WebhookVerification,
} from './types.js';

/**
 * Dodo Payments provider.
 *
 * Dodo is a Merchant of Record, which means it becomes the legal seller and
 * handles VAT/sales tax, fraud and chargebacks across 190+ countries. That is
 * the deciding factor for an India-based operator selling into the EU, UK, US,
 * CA and AU: no foreign tax registrations, and native support for usage-based
 * and credit-based billing.
 *
 * API reference implemented here:
 *   POST {base}/checkouts   -> { session_id, checkout_url, payment_id, ... }
 *   Webhooks                -> Standard Webhooks (webhook-id/timestamp/signature)
 */

const TEST_BASE = 'https://test.dodopayments.com';
const LIVE_BASE = 'https://live.dodopayments.com';

export class DodoProvider implements PaymentProvider {
  readonly name = 'dodo' as const;

  get configured(): boolean {
    return Boolean(env.DODO_API_KEY);
  }

  private get baseUrl(): string {
    const explicit = env.DODO_BASE_URL;
    if (explicit && explicit !== LIVE_BASE) return explicit;
    return env.DODO_ENV === 'live' ? LIVE_BASE : TEST_BASE;
  }

  private assertConfigured(): string {
    if (!env.DODO_API_KEY) {
      throw AppError.integration(
        'Payments are not configured on this deployment.',
        'Set DODO_API_KEY (and DODO_WEBHOOK_SECRET) to enable checkout.',
      );
    }
    return env.DODO_API_KEY;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const apiKey = this.assertConfigured();

    if (!input.pack && !input.plan) {
      throw AppError.badRequest('A credit pack or plan is required to start checkout.');
    }

    const productId = input.pack?.providerProductId ?? input.plan?.providerProductId ?? null;
    if (!productId) {
      throw AppError.integration(
        `No payment product is mapped for "${input.pack?.key ?? input.plan?.key}".`,
        'Create the product in the Dodo dashboard and set providerProductId in the admin pricing console.',
      );
    }

    const body: Record<string, unknown> = {
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: {
        email: input.customerEmail,
        name: input.customerName ?? input.orgName,
      },
      return_url: input.returnUrl,
      metadata: {
        ...input.metadata,
        org_id: input.orgId,
        ...(input.pack ? { pack_key: input.pack.key } : {}),
        ...(input.plan ? { plan_key: input.plan.key } : {}),
      },
    };

    const res = await fetch(`${this.baseUrl}/checkouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, any>;

    if (!res.ok) {
      log.error('dodo checkout failed', { status: res.status, body: json });
      throw AppError.integration(
        `Payment provider rejected the checkout request (${res.status}).`,
        json?.message ? String(json.message) : undefined,
      );
    }

    return {
      provider: 'dodo',
      checkoutId: String(json.session_id ?? json.checkout_id ?? ''),
      checkoutUrl: String(json.checkout_url ?? ''),
      paymentId: json.payment_id ? String(json.payment_id) : null,
      clientSecret: json.client_secret ? String(json.client_secret) : null,
      raw: json,
    };
  }

  verifyWebhook(input: { rawBody: string; headers: Record<string, string | undefined> }): WebhookVerification {
    const secret = env.DODO_WEBHOOK_SECRET;
    if (!secret) {
      throw AppError.integration('DODO_WEBHOOK_SECRET is not configured; cannot verify webhooks.');
    }

    const id = input.headers['webhook-id'] ?? '';
    const timestamp = input.headers['webhook-timestamp'] ?? '';
    const signature = input.headers['webhook-signature'] ?? '';

    const valid = verifyStandardWebhook({
      secret,
      id,
      timestamp,
      signaturesHeader: signature,
      payload: input.rawBody,
    });

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      /* invalid JSON is rejected below */
    }

    return {
      valid,
      eventId: id,
      type: typeof payload.type === 'string' ? payload.type : '',
      payload,
    };
  }

  async fetchPayment(paymentId: string): Promise<{ status: string; raw: unknown } | null> {
    const apiKey = this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw AppError.integration(`Failed to fetch payment (${res.status}).`);
    const json = (await res.json()) as Record<string, unknown>;
    return { status: String(json.status ?? 'unknown'), raw: json };
  }
}
