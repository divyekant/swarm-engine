import { describe, it, expect } from 'vitest';
import { createProvider } from '../../../src/adapters/providers/index.js';
import type { ProviderAdapter, ProviderEvent } from '../../../src/types.js';

describe('createProvider', () => {
  it('creates a custom provider from adapter', () => {
    const mockAdapter: ProviderAdapter = {
      async *stream() {
        yield { type: 'chunk' as const, content: 'hello' };
        yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 };
      },
      estimateCost: () => 1,
      getModelLimits: () => ({ contextWindow: 128000, maxOutput: 4096 }),
    };

    const provider = createProvider({ type: 'custom', adapter: mockAdapter });
    expect(provider).toBe(mockAdapter);
  });

  it('throws for missing adapter on custom', () => {
    expect(() => createProvider({ type: 'custom' })).toThrow('Custom provider requires adapter');
  });

  it('throws for missing api key on anthropic', () => {
    expect(() => createProvider({ type: 'anthropic' })).toThrow('Anthropic provider requires apiKey');
  });

  it('throws for missing api key on openai', () => {
    expect(() => createProvider({ type: 'openai' })).toThrow('OpenAI provider requires apiKey');
  });

  it('creates anthropic provider with api key', () => {
    const provider = createProvider({ type: 'anthropic', apiKey: 'test-key' });
    expect(provider).toBeDefined();
    expect(provider.estimateCost).toBeTypeOf('function');
    expect(provider.stream).toBeTypeOf('function');
    expect(provider.getModelLimits).toBeTypeOf('function');
  });

  it('creates openai provider with api key', () => {
    const provider = createProvider({ type: 'openai', apiKey: 'test-key' });
    expect(provider).toBeDefined();
    expect(provider.estimateCost).toBeTypeOf('function');
    expect(provider.stream).toBeTypeOf('function');
    expect(provider.getModelLimits).toBeTypeOf('function');
  });

  it('creates ollama provider without api key', () => {
    const provider = createProvider({ type: 'ollama' });
    expect(provider).toBeDefined();
    expect(provider.estimateCost).toBeTypeOf('function');
  });

  it('throws for google provider (not yet implemented)', () => {
    expect(() => createProvider({ type: 'google' })).toThrow('Google provider not yet implemented');
  });

  it('custom provider streams correctly', async () => {
    const events: ProviderEvent[] = [];
    const mockAdapter: ProviderAdapter = {
      async *stream() {
        yield { type: 'chunk' as const, content: 'hello ' };
        yield { type: 'chunk' as const, content: 'world' };
        yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 };
      },
      estimateCost: () => 1,
      getModelLimits: () => ({ contextWindow: 128000, maxOutput: 4096 }),
    };

    const provider = createProvider({ type: 'custom', adapter: mockAdapter });
    for await (const event of provider.stream({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 100,
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'chunk', content: 'hello ' });
    expect(events[1]).toEqual({ type: 'chunk', content: 'world' });
    expect(events[2]).toEqual({ type: 'usage', inputTokens: 10, outputTokens: 5 });
  });
});

describe('AnthropicProvider', () => {
  it('estimates cost for known models', () => {
    const provider = createProvider({ type: 'anthropic', apiKey: 'test-key' });
    const cost = provider.estimateCost('claude-sonnet-4-20250514', 1_000_000, 1_000_000);
    // 300 cents input + 1500 cents output = 1800 cents
    expect(cost).toBe(1800);
  });

  it('estimates cost for unknown models with default pricing', () => {
    const provider = createProvider({ type: 'anthropic', apiKey: 'test-key' });
    const cost = provider.estimateCost('unknown-model', 1_000_000, 1_000_000);
    // default: 300 + 1500 = 1800
    expect(cost).toBe(1800);
  });

  it('matches model by prefix', () => {
    const provider = createProvider({ type: 'anthropic', apiKey: 'test-key' });
    const cost = provider.estimateCost('claude-sonnet-4-20250514-v2', 1_000_000, 0);
    // Should match claude-sonnet-4-20250514 prefix: 300 cents
    expect(cost).toBe(300);
  });

  it('returns model limits for known models', () => {
    const provider = createProvider({ type: 'anthropic', apiKey: 'test-key' });
    const limits = provider.getModelLimits('claude-opus-4-20250514');
    expect(limits.contextWindow).toBe(200_000);
    expect(limits.maxOutput).toBe(32_768);
  });

  it('returns default limits for unknown models', () => {
    const provider = createProvider({ type: 'anthropic', apiKey: 'test-key' });
    const limits = provider.getModelLimits('unknown-model');
    expect(limits.contextWindow).toBe(200_000);
    expect(limits.maxOutput).toBe(8192);
  });
});

describe('OpenAIProvider', () => {
  it('estimates cost for known models', () => {
    const provider = createProvider({ type: 'openai', apiKey: 'test-key' });
    const cost = provider.estimateCost('gpt-4o', 1_000_000, 1_000_000);
    // 250 + 1000 = 1250 cents
    expect(cost).toBe(1250);
  });

  it('estimates cost for gpt-4.1-nano', () => {
    const provider = createProvider({ type: 'openai', apiKey: 'test-key' });
    const cost = provider.estimateCost('gpt-4.1-nano', 1_000_000, 1_000_000);
    // 10 + 40 = 50 cents
    expect(cost).toBe(50);
  });

  it('returns model limits for gpt-4o', () => {
    const provider = createProvider({ type: 'openai', apiKey: 'test-key' });
    const limits = provider.getModelLimits('gpt-4o');
    expect(limits.contextWindow).toBe(128_000);
    expect(limits.maxOutput).toBe(16_384);
  });

  it('returns model limits for gpt-4.1', () => {
    const provider = createProvider({ type: 'openai', apiKey: 'test-key' });
    const limits = provider.getModelLimits('gpt-4.1');
    expect(limits.contextWindow).toBe(1_047_576);
    expect(limits.maxOutput).toBe(32_768);
  });
});

describe('OllamaProvider', () => {
  it('always returns zero cost', () => {
    const provider = createProvider({ type: 'ollama' });
    expect(provider.estimateCost('llama3', 100_000, 50_000)).toBe(0);
  });

  it('returns default model limits', () => {
    const provider = createProvider({ type: 'ollama' });
    const limits = provider.getModelLimits('llama3');
    expect(limits.contextWindow).toBe(128_000);
    expect(limits.maxOutput).toBe(4096);
  });
});
