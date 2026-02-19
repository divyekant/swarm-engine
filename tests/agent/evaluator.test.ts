import { describe, it, expect } from 'vitest';
import { evaluate } from '../../src/agent/evaluator.js';
import type { Evaluator, ProviderAdapter, ProviderEvent } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock ProviderAdapter that returns the given text from stream().
 */
function createMockProvider(responseText: string): ProviderAdapter {
  return {
    async *stream(): AsyncGenerator<ProviderEvent> {
      yield { type: 'chunk', content: responseText };
      yield { type: 'usage', inputTokens: 10, outputTokens: responseText.length };
    },
    estimateCost: () => 0,
    getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  describe('rule evaluator', () => {
    it('returns the target from the rule function', async () => {
      const evaluator: Evaluator = {
        type: 'rule',
        fn: (output: string) => (output.includes('yes') ? 'approve' : 'reject'),
      };

      expect(await evaluate(evaluator, 'yes please')).toBe('approve');
      expect(await evaluate(evaluator, 'no thanks')).toBe('reject');
    });

    it('passes the full output string to the rule function', async () => {
      let receivedOutput = '';
      const evaluator: Evaluator = {
        type: 'rule',
        fn: (output: string) => {
          receivedOutput = output;
          return 'target';
        },
      };

      await evaluate(evaluator, 'the full agent output');
      expect(receivedOutput).toBe('the full agent output');
    });
  });

  describe('regex evaluator', () => {
    it('returns matchTarget when the pattern matches', async () => {
      const evaluator: Evaluator = {
        type: 'regex',
        pattern: 'approved|lgtm',
        matchTarget: 'deploy',
        elseTarget: 'review',
      };

      expect(await evaluate(evaluator, 'This is approved')).toBe('deploy');
      expect(await evaluate(evaluator, 'lgtm, ship it')).toBe('deploy');
    });

    it('returns elseTarget when the pattern does not match', async () => {
      const evaluator: Evaluator = {
        type: 'regex',
        pattern: 'approved|lgtm',
        matchTarget: 'deploy',
        elseTarget: 'review',
      };

      expect(await evaluate(evaluator, 'needs more work')).toBe('review');
      expect(await evaluate(evaluator, 'rejected')).toBe('review');
    });

    it('supports regex special characters', async () => {
      const evaluator: Evaluator = {
        type: 'regex',
        pattern: '^\\d{3}-\\d{4}$',
        matchTarget: 'valid',
        elseTarget: 'invalid',
      };

      expect(await evaluate(evaluator, '123-4567')).toBe('valid');
      expect(await evaluate(evaluator, 'abc-defg')).toBe('invalid');
    });

    it('supports case-sensitive matching by default', async () => {
      const evaluator: Evaluator = {
        type: 'regex',
        pattern: 'APPROVED',
        matchTarget: 'yes',
        elseTarget: 'no',
      };

      expect(await evaluate(evaluator, 'APPROVED')).toBe('yes');
      expect(await evaluate(evaluator, 'approved')).toBe('no');
    });
  });

  describe('llm evaluator', () => {
    it('returns the trimmed LLM response as the target', async () => {
      const provider = createMockProvider('  deploy  ');
      const evaluator: Evaluator = {
        type: 'llm',
        prompt: 'Classify this output as "deploy" or "review".',
      };

      const result = await evaluate(evaluator, 'The code looks good', provider);
      expect(result).toBe('deploy');
    });

    it('throws when no provider is given', async () => {
      const evaluator: Evaluator = {
        type: 'llm',
        prompt: 'Classify this output.',
      };

      await expect(evaluate(evaluator, 'some output')).rejects.toThrow(
        'LLM evaluator requires a provider',
      );
    });

    it('passes the evaluator prompt and agent output to the provider', async () => {
      let capturedMessages: { role: string; content: string }[] = [];

      const provider: ProviderAdapter = {
        async *stream(params) {
          capturedMessages = params.messages;
          yield { type: 'chunk', content: 'target-a' };
          yield { type: 'usage', inputTokens: 10, outputTokens: 8 };
        },
        estimateCost: () => 0,
        getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
      };

      const evaluator: Evaluator = {
        type: 'llm',
        prompt: 'Pick one: target-a or target-b',
      };

      await evaluate(evaluator, 'agent said something', provider);

      expect(capturedMessages).toHaveLength(2);
      expect(capturedMessages[0].role).toBe('system');
      expect(capturedMessages[0].content).toBe('Return ONLY the target label, nothing else.');
      expect(capturedMessages[1].role).toBe('user');
      expect(capturedMessages[1].content).toContain('Pick one: target-a or target-b');
      expect(capturedMessages[1].content).toContain('agent said something');
    });

    it('uses the specified model from the evaluator', async () => {
      let capturedModel = '';

      const provider: ProviderAdapter = {
        async *stream(params) {
          capturedModel = params.model;
          yield { type: 'chunk', content: 'ok' };
          yield { type: 'usage', inputTokens: 5, outputTokens: 2 };
        },
        estimateCost: () => 0,
        getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
      };

      const evaluator: Evaluator = {
        type: 'llm',
        prompt: 'Pick a target',
        model: 'gpt-4o-mini',
      };

      await evaluate(evaluator, 'output', provider);
      expect(capturedModel).toBe('gpt-4o-mini');
    });

    it('defaults model to "default" when not specified', async () => {
      let capturedModel = '';

      const provider: ProviderAdapter = {
        async *stream(params) {
          capturedModel = params.model;
          yield { type: 'chunk', content: 'ok' };
          yield { type: 'usage', inputTokens: 5, outputTokens: 2 };
        },
        estimateCost: () => 0,
        getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
      };

      const evaluator: Evaluator = {
        type: 'llm',
        prompt: 'Pick a target',
      };

      await evaluate(evaluator, 'output', provider);
      expect(capturedModel).toBe('default');
    });

    it('uses tight maxTokens of 50', async () => {
      let capturedMaxTokens = 0;

      const provider: ProviderAdapter = {
        async *stream(params) {
          capturedMaxTokens = params.maxTokens;
          yield { type: 'chunk', content: 'ok' };
          yield { type: 'usage', inputTokens: 5, outputTokens: 2 };
        },
        estimateCost: () => 0,
        getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
      };

      const evaluator: Evaluator = {
        type: 'llm',
        prompt: 'Pick a target',
      };

      await evaluate(evaluator, 'output', provider);
      expect(capturedMaxTokens).toBe(50);
    });

    it('concatenates multiple chunks from the provider', async () => {
      const provider: ProviderAdapter = {
        async *stream() {
          yield { type: 'chunk' as const, content: 'tar' };
          yield { type: 'chunk' as const, content: 'get' };
          yield { type: 'chunk' as const, content: '-b' };
          yield { type: 'usage' as const, inputTokens: 5, outputTokens: 8 };
        },
        estimateCost: () => 0,
        getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
      };

      const evaluator: Evaluator = {
        type: 'llm',
        prompt: 'Pick a target',
      };

      const result = await evaluate(evaluator, 'output', provider);
      expect(result).toBe('target-b');
    });
  });
});
