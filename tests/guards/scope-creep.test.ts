import { describe, it, expect } from 'vitest';
import { scopeCreepGuard } from '../../src/guards/scope-creep.js';
import type { ProviderAdapter, ProviderEvent } from '../../src/types.js';

function createMockProvider(response: string): ProviderAdapter {
  return {
    async *stream(): AsyncGenerator<ProviderEvent> {
      yield { type: 'chunk', content: response };
      yield { type: 'usage', inputTokens: 10, outputTokens: 5 };
    },
    estimateCost: () => 0,
    getModelLimits: () => ({ contextWindow: 100000, maxOutput: 4096 }),
  };
}

describe('scope creep guard', () => {
  it('returns not triggered when output is scoped', async () => {
    const provider = createMockProvider('SCOPED');
    const result = await scopeCreepGuard(
      'Build a login form',
      'Here is the login form with email and password fields.',
      provider,
    );
    expect(result.triggered).toBe(false);
    expect(result.message).toBe('');
  });

  it('returns triggered when output is overscoped', async () => {
    const provider = createMockProvider('OVERSCOPED: Added user registration and password reset beyond the request');
    const result = await scopeCreepGuard(
      'Build a login form',
      'Here is the login form, plus I also added user registration, password reset, and SSO integration.',
      provider,
    );
    expect(result.triggered).toBe(true);
    expect(result.message).toContain('OVERSCOPED');
  });

  it('requires a provider', async () => {
    await expect(
      scopeCreepGuard('task', 'output', undefined as any),
    ).rejects.toThrow('provider');
  });

  it('truncates long output to 3000 chars', async () => {
    let capturedContent = '';
    const provider: ProviderAdapter = {
      async *stream(params: any): AsyncGenerator<ProviderEvent> {
        capturedContent = params.messages[1].content;
        yield { type: 'chunk', content: 'SCOPED' };
        yield { type: 'usage', inputTokens: 10, outputTokens: 5 };
      },
      estimateCost: () => 0,
      getModelLimits: () => ({ contextWindow: 100000, maxOutput: 4096 }),
    };

    const longOutput = 'x'.repeat(5000);
    await scopeCreepGuard('task', longOutput, provider);

    // The output in the prompt should be truncated
    expect(capturedContent.length).toBeLessThan(5000 + 100); // 3000 + "Task: task\n\nOutput:\n" prefix
  });
});
