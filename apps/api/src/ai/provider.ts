import { env } from '../env.js';
import { log } from '../core/logger.js';

/**
 * AI provider abstraction.
 *
 * Rules of engagement for AI in this product:
 *  1. **Deterministic first.** Every AI feature has a template-based fallback
 *     that works with no model configured. The product is never gated on a key.
 *  2. **Traceable.** Every generation persists the exact structured facts that
 *     were handed to the model (`sourcesJson`), so a human can verify the
 *     output against the underlying data.
 *  3. **No invention.** Prompts are constrained to the supplied facts and
 *     instructed to say "not recorded" rather than guess. Compliance facts are
 *     never generated from model knowledge.
 */

export interface AiResult {
  text: string;
  model: string | null;
  usedAi: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  complete(input: { system: string; user: string; maxTokens?: number }): Promise<string | null>;
}

class NoProvider implements AiProvider {
  readonly name = 'none';
  readonly available = false;
  async complete(): Promise<null> {
    return null;
  }
}

class OpenAIProvider implements AiProvider {
  readonly name = 'openai';
  get available(): boolean {
    return Boolean(env.OPENAI_API_KEY);
  }
  async complete(input: { system: string; user: string; maxTokens?: number }): Promise<string | null> {
    if (!env.OPENAI_API_KEY) return null;
    const res = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.AI_MODEL ?? 'gpt-4o-mini',
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        temperature: 0.2,
        max_tokens: input.maxTokens ?? 1400,
      }),
    });
    if (!res.ok) {
      log.warn('openai request failed', { status: res.status });
      return null;
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? null;
  }
}

class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  get available(): boolean {
    return Boolean(env.ANTHROPIC_API_KEY);
  }
  async complete(input: { system: string; user: string; maxTokens?: number }): Promise<string | null> {
    if (!env.ANTHROPIC_API_KEY) return null;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.AI_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: input.maxTokens ?? 1400,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      }),
    });
    if (!res.ok) {
      log.warn('anthropic request failed', { status: res.status });
      return null;
    }
    const json = (await res.json()) as { content?: Array<{ text?: string }> };
    return json.content?.[0]?.text ?? null;
  }
}

class WorkersAiProvider implements AiProvider {
  readonly name = 'workers-ai';
  get available(): boolean {
    return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
  }
  async complete(input: { system: string; user: string; maxTokens?: number }): Promise<string | null> {
    if (!this.available) return null;
    const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        max_tokens: input.maxTokens ?? 1400,
      }),
    });
    if (!res.ok) {
      log.warn('workers ai request failed', { status: res.status });
      return null;
    }
    const json = (await res.json()) as { result?: { response?: string } };
    return json.result?.response ?? null;
  }
}

export function aiProvider(): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'openai':
      return new OpenAIProvider();
    case 'anthropic':
      return new AnthropicProvider();
    case 'workers-ai':
      return new WorkersAiProvider();
    default:
      return new NoProvider();
  }
}

export async function describeProvider(): Promise<{ name: string; available: boolean; model: string | null }> {
  const provider = aiProvider();
  return { name: provider.name, available: provider.available, model: env.AI_MODEL ?? null };
}
