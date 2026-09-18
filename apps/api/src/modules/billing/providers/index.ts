import { env } from '../../../env.js';
import { DodoProvider } from './dodo.js';
import { ManualProvider } from './manual.js';
import type { PaymentProvider } from './types.js';

/**
 * Provider registry.
 *
 * Only Dodo and manual are implemented today. Stripe and Paddle are supported
 * by the interface and can be added by implementing `PaymentProvider` and
 * registering the class here — no other module changes required.
 */

const registry: Record<string, () => PaymentProvider> = {
  dodo: () => new DodoProvider(),
  manual: () => new ManualProvider(),
};

export function paymentProvider(): PaymentProvider {
  return (registry[env.PAYMENT_PROVIDER] ?? registry.manual!)();
}

export function providerByName(name: string): PaymentProvider | null {
  const factory = registry[name];
  return factory ? factory() : null;
}

export function listProviders(): Array<{ name: string; configured: boolean }> {
  return Object.keys(registry).map((name) => {
    const p = registry[name]!();
    return { name, configured: p.configured };
  });
}

export * from './types.js';
