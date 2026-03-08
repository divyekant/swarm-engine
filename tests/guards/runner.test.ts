import { describe, it, expect } from 'vitest';
import { runGuards } from '../../src/guards/runner.js';
import type { Guard, ProviderAdapter, ProviderEvent } from '../../src/types.js';

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

describe('runGuards', () => {
  it('returns empty results when no guards', async () => {
    const results = await runGuards([], 'task', 'output');
    expect(results).toEqual([]);
  });

  it('runs evidence guard and returns warning', async () => {
    const guards: Guard[] = [{ id: 'ev', type: 'evidence', mode: 'warn' }];
    const results = await runGuards(guards, 'task', 'All tests pass.');
    expect(results).toHaveLength(1);
    expect(results[0].guardId).toBe('ev');
    expect(results[0].triggered).toBe(true);
    expect(results[0].blocked).toBe(false);
  });

  it('evidence guard in block mode sets blocked', async () => {
    const guards: Guard[] = [{ id: 'ev', type: 'evidence', mode: 'block' }];
    const results = await runGuards(guards, 'task', 'All tests pass.');
    expect(results[0].blocked).toBe(true);
  });

  it('runs scope-creep guard with provider', async () => {
    const provider = createMockProvider('OVERSCOPED: added extra features');
    const guards: Guard[] = [{ id: 'sc', type: 'scope-creep', mode: 'warn' }];
    const results = await runGuards(guards, 'Build X', 'Built X plus Y and Z', provider);
    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
  });

  it('skips scope-creep guard when no provider', async () => {
    const guards: Guard[] = [{ id: 'sc', type: 'scope-creep', mode: 'warn' }];
    const results = await runGuards(guards, 'task', 'output');
    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(false);
    expect(results[0].skipped).toBe(true);
  });

  it('sorts guards: evidence first, then scope-creep', async () => {
    const provider = createMockProvider('SCOPED');
    const guards: Guard[] = [
      { id: 'sc', type: 'scope-creep', mode: 'warn' },
      { id: 'ev', type: 'evidence', mode: 'warn' },
    ];
    const results = await runGuards(guards, 'task', 'All tests pass.', provider);
    expect(results[0].guardId).toBe('ev');
    expect(results[1].guardId).toBe('sc');
  });
});
