import { newId } from '../../../core/ids.js';
import { AppError } from '../../../core/errors.js';
import type { CheckoutInput, CheckoutResult, PaymentProvider, WebhookVerification } from './types.js';

/**
 * Manual / self-hosted provider.
 *
 * Credits are granted by an administrator or by an invoiced bank transfer.
 * This is a **real** path, not a mock: no money is simulated, nothing is
 * claimed as paid. It exists so the product is fully usable (and sellable via
 * invoice) before card processing is switched on, and so the ledger can be
 * exercised end-to-end in tests without external dependencies.
 */
export class ManualProvider implements PaymentProvider {
  readonly name = 'manual' as const;
  readonly configured = true;

  async createCheckout(_input: CheckoutInput): Promise<CheckoutResult> {
    throw AppError.integration(
      'Online card checkout is not enabled on this deployment.',
      'Configure DODO_API_KEY to enable self-serve checkout, or contact us for invoiced billing.',
    );
  }

  verifyWebhook(): WebhookVerification {
    // No signature scheme exists for manual grants; grants are made by an
    // authenticated administrator through the API, not through a webhook.
    throw AppError.integration('The manual provider does not accept webhooks.');
  }
}

export const newManualReference = (): string => `manual_${newId('pay')}`;
