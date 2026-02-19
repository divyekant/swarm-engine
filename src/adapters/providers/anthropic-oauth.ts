import Anthropic from '@anthropic-ai/sdk';
import type { ProviderAdapter, ProviderEvent, StreamParams } from '../../types.js';

const ALLOWED_HOSTS = [
  'api.anthropic.com',
  'anthropic.com',
];

function isAllowedAnthropicHost(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return ALLOWED_HOSTS.includes(hostname) || hostname.endsWith('.anthropic.com');
  } catch {
    return false;
  }
}

/**
 * Pricing and limits reused from the standard Anthropic provider.
 * OAuth subscription tokens access the same models.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 300, output: 1500 },
  'claude-opus-4-20250514': { input: 1500, output: 7500 },
  'claude-haiku-3-5-20241022': { input: 80, output: 400 },
};

const MODEL_LIMITS: Record<string, { contextWindow: number; maxOutput: number }> = {
  'claude-sonnet-4-20250514': { contextWindow: 200_000, maxOutput: 8192 },
  'claude-opus-4-20250514': { contextWindow: 200_000, maxOutput: 32_768 },
  'claude-haiku-3-5-20241022': { contextWindow: 200_000, maxOutput: 8192 },
};

const DEFAULT_PRICING = { input: 300, output: 1500 };
const DEFAULT_LIMITS = { contextWindow: 200_000, maxOutput: 8192 };

const REQUIRED_BETAS = ['oauth-2025-04-20', 'interleaved-thinking-2025-05-14'];

function lookupByPrefix<T>(table: Record<string, T>, model: string, fallback: T): T {
  if (table[model]) return table[model];
  for (const [key, value] of Object.entries(table)) {
    if (model.startsWith(key)) return value;
  }
  return fallback;
}

/**
 * Creates a custom fetch function that intercepts requests to inject OAuth auth.
 *
 * Matches the pattern from divyekant/memories llm_provider.py:
 * - Sets Authorization: Bearer <token>
 * - Removes x-api-key header
 * - Adds anthropic-beta: oauth-2025-04-20 header
 * - Appends ?beta=true to /v1/messages URL
 */
function createOAuthFetch(token: string): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);

    // Set Bearer auth, remove x-api-key
    headers.set('authorization', `Bearer ${token}`);
    headers.delete('x-api-key');

    // Merge beta headers
    const existing = headers.get('anthropic-beta') ?? '';
    const existingList = existing.split(',').map(b => b.trim()).filter(Boolean);
    const allBetas = [...new Set([...existingList, ...REQUIRED_BETAS])];
    headers.set('anthropic-beta', allBetas.join(','));

    // Append ?beta=true for /v1/messages
    let finalUrl = url;
    if (url.includes('/v1/messages')) {
      const separator = url.includes('?') ? '&' : '?';
      finalUrl = `${url}${separator}beta=true`;
    }

    return fetch(finalUrl, { ...init, headers });
  };
}

/**
 * Anthropic OAuth provider for Claude subscription tokens (sk-ant-oat01-*).
 *
 * Uses a custom fetch transport that replaces API key auth with Bearer token
 * auth and adds required beta headers. Same streaming behavior as the
 * standard AnthropicProvider.
 */
export class AnthropicOAuthProvider implements ProviderAdapter {
  private client: Anthropic;

  constructor(oauthToken: string, baseUrl?: string) {
    if (baseUrl && !isAllowedAnthropicHost(baseUrl)) {
      throw new Error(
        `"${baseUrl}" is not an allowed Anthropic host. OAuth tokens must only be sent to *.anthropic.com`,
      );
    }

    this.client = new Anthropic({
      apiKey: 'placeholder', // Overridden by custom fetch
      fetch: createOAuthFetch(oauthToken),
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

  async *stream(params: StreamParams): AsyncGenerator<ProviderEvent> {
    const systemMessage = params.messages.find(m => m.role === 'system');
    const nonSystemMessages = params.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const tools = params.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    const streamOptions: Anthropic.MessageCreateParamsStreaming = {
      model: params.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      messages: nonSystemMessages,
      stream: true,
      ...(systemMessage ? { system: systemMessage.content } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
    };

    const response = this.client.messages.stream(streamOptions, {
      signal: params.signal ?? undefined,
    });

    let currentToolId = '';
    let currentToolName = '';
    let currentToolInput = '';

    for await (const event of response) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          currentToolId = block.id;
          currentToolName = block.name;
          currentToolInput = '';
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'chunk', content: delta.text };
        } else if (delta.type === 'input_json_delta') {
          currentToolInput += delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolId) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(currentToolInput || '{}');
          } catch {
            // Malformed input; use empty object
          }
          yield {
            type: 'tool_use',
            id: currentToolId,
            name: currentToolName,
            input,
          };
          currentToolId = '';
          currentToolName = '';
          currentToolInput = '';
        }
      } else if (event.type === 'message_delta') {
        if (event.usage) {
          yield {
            type: 'usage',
            inputTokens: 0,
            outputTokens: event.usage.output_tokens,
          };
        }
      } else if (event.type === 'message_start') {
        if (event.message?.usage) {
          yield {
            type: 'usage',
            inputTokens: event.message.usage.input_tokens,
            outputTokens: 0,
          };
        }
      }
    }
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = lookupByPrefix(MODEL_PRICING, model, DEFAULT_PRICING);
    const inputCost = Math.ceil((inputTokens * pricing.input) / 1_000_000);
    const outputCost = Math.ceil((outputTokens * pricing.output) / 1_000_000);
    return inputCost + outputCost;
  }

  getModelLimits(model: string): { contextWindow: number; maxOutput: number } {
    return lookupByPrefix(MODEL_LIMITS, model, DEFAULT_LIMITS);
  }
}
