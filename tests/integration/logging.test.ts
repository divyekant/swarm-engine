import { describe, it, expect, vi } from 'vitest';
import { SwarmEngine } from '../../src/engine.js';
import type { SwarmEngineConfig, SwarmEvent, LogEntry } from '../../src/types.js';

async function collectEvents(gen: AsyncGenerator<SwarmEvent>): Promise<SwarmEvent[]> {
  const events: SwarmEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('SwarmEngine logging integration', () => {
  it('sends log entries to onLog callback during execution', async () => {
    const logs: LogEntry[] = [];
    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              yield { type: 'chunk' as const, content: 'ok' };
              yield { type: 'usage' as const, inputTokens: 10, outputTokens: 2 };
            },
            estimateCost: () => 1,
            getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
          },
        },
      },
      defaults: { provider: 'test' },
      logging: { level: 'debug', onLog: (entry) => logs.push(entry) },
    };

    const engine = new SwarmEngine(config);
    const dag = engine.dag()
      .agent('a', { id: 'a', name: 'A', role: 'writer', systemPrompt: 'Write.' })
      .agent('b', { id: 'b', name: 'B', role: 'editor', systemPrompt: 'Edit.' })
      .edge('a', 'b')
      .build();

    await collectEvents(engine.run({ dag, task: 'test logging' }));

    // Should have info-level logs for engine init, validation, node start/done
    const infoLogs = logs.filter(l => l.level === 'info');
    expect(infoLogs.length).toBeGreaterThanOrEqual(4);
    expect(infoLogs.some(l => l.message.includes('initialized'))).toBe(true);
    expect(infoLogs.some(l => l.message.includes('completed') && l.context?.nodeId === 'a')).toBe(true);
    expect(infoLogs.some(l => l.message.includes('completed') && l.context?.nodeId === 'b')).toBe(true);

    // Should have debug-level logs for context assembly, provider selection
    const debugLogs = logs.filter(l => l.level === 'debug');
    expect(debugLogs.length).toBeGreaterThan(0);
  });

  it('produces no logs when logging config is omitted', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              yield { type: 'chunk' as const, content: 'ok' };
              yield { type: 'usage' as const, inputTokens: 10, outputTokens: 2 };
            },
            estimateCost: () => 1,
            getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
          },
        },
      },
    };

    const engine = new SwarmEngine(config);
    const dag = engine.dag()
      .agent('a', { id: 'a', name: 'A', role: 'worker', systemPrompt: '' })
      .build();

    await collectEvents(engine.run({ dag, task: 'silent' }));

    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('respects log level filtering', async () => {
    const logs: LogEntry[] = [];
    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              yield { type: 'chunk' as const, content: 'ok' };
              yield { type: 'usage' as const, inputTokens: 10, outputTokens: 2 };
            },
            estimateCost: () => 1,
            getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
          },
        },
      },
      defaults: { provider: 'test' },
      logging: { level: 'warn', onLog: (entry) => logs.push(entry) },
    };

    const engine = new SwarmEngine(config);
    const dag = engine.dag()
      .agent('a', { id: 'a', name: 'A', role: 'worker', systemPrompt: '' })
      .build();

    await collectEvents(engine.run({ dag, task: 'warn only' }));

    expect(logs.every(l => l.level === 'warn' || l.level === 'error')).toBe(true);
  });
});
