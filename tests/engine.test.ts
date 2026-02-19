import { describe, it, expect, vi } from 'vitest';
import { SwarmEngine } from '../src/engine.js';
import { DAGBuilder } from '../src/dag/builder.js';
import type { SwarmEngineConfig, SwarmEvent, ProviderAdapter, NodeResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a test SwarmEngineConfig with a custom provider that streams
 * a predetermined response.
 */
function createTestConfig(responseText: string = 'test output'): SwarmEngineConfig {
  return {
    providers: {
      test: {
        type: 'custom',
        adapter: {
          async *stream() {
            for (const char of responseText) {
              yield { type: 'chunk' as const, content: char };
            }
            yield { type: 'usage' as const, inputTokens: 100, outputTokens: responseText.length };
          },
          estimateCost: () => 1,
          getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
        },
      },
    },
    defaults: { provider: 'test' },
  };
}

/**
 * Collect all events from an async generator into an array.
 */
async function collectEvents(gen: AsyncGenerator<SwarmEvent>): Promise<SwarmEvent[]> {
  const events: SwarmEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/**
 * Filter events by type.
 */
function eventsOfType<T extends SwarmEvent['type']>(
  events: SwarmEvent[],
  type: T,
): Extract<SwarmEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<SwarmEvent, { type: T }>[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SwarmEngine', () => {
  describe('constructor', () => {
    it('creates engine with providers', () => {
      const config = createTestConfig();
      const engine = new SwarmEngine(config);

      expect(engine).toBeInstanceOf(SwarmEngine);
    });

    it('creates engine with multiple providers', () => {
      const config: SwarmEngineConfig = {
        providers: {
          test1: {
            type: 'custom',
            adapter: {
              async *stream() {
                yield { type: 'chunk' as const, content: 'hello' };
                yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 };
              },
              estimateCost: () => 1,
              getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
            },
          },
          test2: {
            type: 'custom',
            adapter: {
              async *stream() {
                yield { type: 'chunk' as const, content: 'world' };
                yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 };
              },
              estimateCost: () => 1,
              getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
            },
          },
        },
        defaults: { provider: 'test1' },
      };

      const engine = new SwarmEngine(config);
      expect(engine).toBeInstanceOf(SwarmEngine);
    });
  });

  describe('dag()', () => {
    it('returns a DAGBuilder instance', () => {
      const engine = new SwarmEngine(createTestConfig());
      const builder = engine.dag();

      expect(builder).toBeInstanceOf(DAGBuilder);
    });

    it('returns a new DAGBuilder each time', () => {
      const engine = new SwarmEngine(createTestConfig());
      const builder1 = engine.dag();
      const builder2 = engine.dag();

      expect(builder1).not.toBe(builder2);
    });
  });

  describe('run()', () => {
    it('validates DAG and emits error on invalid', async () => {
      const engine = new SwarmEngine(createTestConfig());

      // Create a DAG with a node referencing a non-existent provider
      const dag = new DAGBuilder()
        .agent('a', {
          id: 'a',
          name: 'Agent A',
          role: 'worker',
          systemPrompt: 'You are a worker.',
          providerId: 'nonexistent',
        })
        .build();

      const events = await collectEvents(
        engine.run({ dag, task: 'do something' }),
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('swarm_error');
      if (events[0].type === 'swarm_error') {
        expect(events[0].message).toContain('DAG validation failed');
        expect(events[0].message).toContain('nonexistent');
        expect(events[0].completedNodes).toEqual([]);
      }
    });

    it('validates DAG cycle without maxCycles and emits error', async () => {
      const engine = new SwarmEngine(createTestConfig());

      const dag = new DAGBuilder()
        .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
        .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
        .edge('a', 'b')
        .edge('b', 'a') // cycle without maxCycles
        .build();

      const events = await collectEvents(
        engine.run({ dag, task: 'cycle test' }),
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('swarm_error');
      if (events[0].type === 'swarm_error') {
        expect(events[0].message).toContain('DAG validation failed');
        expect(events[0].message).toContain('cycle');
      }
    });

    it('executes a simple single-node DAG end-to-end', async () => {
      const engine = new SwarmEngine(createTestConfig('hello world'));

      const dag = engine
        .dag()
        .agent('writer', {
          id: 'writer',
          name: 'Writer',
          role: 'writer',
          systemPrompt: 'You write things.',
        })
        .build();

      const events = await collectEvents(
        engine.run({ dag, task: 'Write a greeting' }),
      );

      // Should have swarm_start
      const starts = eventsOfType(events, 'swarm_start');
      expect(starts).toHaveLength(1);
      expect(starts[0].nodeCount).toBe(1);

      // Should have agent_start
      const agentStarts = eventsOfType(events, 'agent_start');
      expect(agentStarts).toHaveLength(1);
      expect(agentStarts[0].nodeId).toBe('writer');
      expect(agentStarts[0].agentRole).toBe('writer');

      // Should have agent_chunk events (one per character of 'hello world')
      const chunks = eventsOfType(events, 'agent_chunk');
      expect(chunks.length).toBeGreaterThan(0);
      const fullOutput = chunks.map((c) => c.content).join('');
      expect(fullOutput).toBe('hello world');

      // Should have agent_done
      const agentDones = eventsOfType(events, 'agent_done');
      expect(agentDones).toHaveLength(1);
      expect(agentDones[0].output).toBe('hello world');

      // Should end with swarm_done
      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(1);
      expect(swarmDones[0].results).toHaveLength(1);
      expect(swarmDones[0].results[0].nodeId).toBe('writer');
      expect(swarmDones[0].results[0].output).toBe('hello world');
    });

    it('executes a 2-node pipeline end-to-end', async () => {
      const engine = new SwarmEngine(createTestConfig('pipeline result'));

      const dag = engine
        .dag()
        .agent('planner', {
          id: 'planner',
          name: 'Planner',
          role: 'planner',
          systemPrompt: 'You plan.',
        })
        .agent('executor', {
          id: 'executor',
          name: 'Executor',
          role: 'executor',
          systemPrompt: 'You execute.',
        })
        .edge('planner', 'executor')
        .build();

      const events = await collectEvents(
        engine.run({ dag, task: 'Plan and execute' }),
      );

      // Both agents should have started and completed
      const agentStarts = eventsOfType(events, 'agent_start');
      expect(agentStarts).toHaveLength(2);
      const startedRoles = agentStarts.map((e) => e.agentRole);
      expect(startedRoles).toContain('planner');
      expect(startedRoles).toContain('executor');

      const agentDones = eventsOfType(events, 'agent_done');
      expect(agentDones).toHaveLength(2);

      // Swarm should complete with 2 results
      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(1);
      expect(swarmDones[0].results).toHaveLength(2);
    });

    it('respects budget limits', async () => {
      // Create a config with a very tight budget (1 cent)
      const config: SwarmEngineConfig = {
        providers: {
          test: {
            type: 'custom',
            adapter: {
              async *stream() {
                // Produce a large output to trigger cost
                yield { type: 'chunk' as const, content: 'expensive output' };
                yield {
                  type: 'usage' as const,
                  inputTokens: 100_000,
                  outputTokens: 100_000,
                };
              },
              estimateCost: () => 500, // 500 cents
              getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
            },
          },
        },
        defaults: { provider: 'test' },
        limits: { maxSwarmBudgetCents: 1 },
      };

      const engine = new SwarmEngine(config);

      const dag = engine
        .dag()
        .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
        .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
        .edge('a', 'b')
        .build();

      const events = await collectEvents(
        engine.run({ dag, task: 'budget test' }),
      );

      // Should see budget_exceeded event
      const budgetExceeded = eventsOfType(events, 'budget_exceeded');
      expect(budgetExceeded).toHaveLength(1);

      // Should see swarm_error (not swarm_done)
      const swarmErrors = eventsOfType(events, 'swarm_error');
      expect(swarmErrors).toHaveLength(1);
      expect(swarmErrors[0].message).toBe('Budget exceeded');

      // Should NOT see swarm_done
      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(0);
    });

    it('supports cancellation via AbortSignal', async () => {
      const engine = new SwarmEngine(createTestConfig('output'));

      const dag = engine
        .dag()
        .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
        .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
        .edge('a', 'b')
        .build();

      // Abort before execution starts
      const controller = new AbortController();
      controller.abort();

      const events = await collectEvents(
        engine.run({ dag, task: 'cancel test', signal: controller.signal }),
      );

      // Should have swarm_start and swarm_cancelled
      const starts = eventsOfType(events, 'swarm_start');
      expect(starts).toHaveLength(1);

      const cancelled = eventsOfType(events, 'swarm_cancelled');
      expect(cancelled).toHaveLength(1);

      // No agents should have started
      const agentStarts = eventsOfType(events, 'agent_start');
      expect(agentStarts).toHaveLength(0);
    });

    it('supports mid-execution cancellation via AbortSignal', async () => {
      const controller = new AbortController();

      // Create a provider that aborts after first node
      const config: SwarmEngineConfig = {
        providers: {
          test: {
            type: 'custom',
            adapter: {
              async *stream() {
                yield { type: 'chunk' as const, content: 'done' };
                yield { type: 'usage' as const, inputTokens: 10, outputTokens: 4 };
                // Abort after yielding so the first node completes
                controller.abort();
              },
              estimateCost: () => 1,
              getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
            },
          },
        },
        defaults: { provider: 'test' },
      };

      const engine = new SwarmEngine(config);

      const dag = engine
        .dag()
        .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
        .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
        .edge('a', 'b')
        .build();

      const events = await collectEvents(
        engine.run({ dag, task: 'mid-cancel', signal: controller.signal }),
      );

      // Node a should have completed
      const agentDones = eventsOfType(events, 'agent_done');
      expect(agentDones.some((e) => e.nodeId === 'a')).toBe(true);

      // Should have swarm_cancelled
      const cancelled = eventsOfType(events, 'swarm_cancelled');
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].completedNodes).toContain('a');

      // Node b should NOT have started
      const agentStarts = eventsOfType(events, 'agent_start');
      expect(agentStarts.map((e) => e.nodeId)).not.toContain('b');
    });

    it('calls onSwarmComplete lifecycle hook after execution', async () => {
      const onSwarmComplete = vi.fn();

      const config: SwarmEngineConfig = {
        ...createTestConfig('lifecycle result'),
        lifecycle: { onSwarmComplete },
      };

      const engine = new SwarmEngine(config);

      const dag = engine
        .dag()
        .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
        .build();

      await collectEvents(engine.run({ dag, task: 'lifecycle test' }));

      expect(onSwarmComplete).toHaveBeenCalledOnce();
      expect(onSwarmComplete).toHaveBeenCalledWith(
        dag.id,
        expect.arrayContaining([
          expect.objectContaining({ nodeId: 'a' }),
        ]),
      );
    });

    it('does not call onSwarmComplete on validation failure', async () => {
      const onSwarmComplete = vi.fn();

      const config: SwarmEngineConfig = {
        ...createTestConfig(),
        lifecycle: { onSwarmComplete },
      };

      const engine = new SwarmEngine(config);

      const dag = new DAGBuilder()
        .agent('a', {
          id: 'a',
          name: 'A',
          role: 'a',
          systemPrompt: '',
          providerId: 'nonexistent',
        })
        .build();

      await collectEvents(engine.run({ dag, task: 'will fail validation' }));

      expect(onSwarmComplete).not.toHaveBeenCalled();
    });

    it('uses noop defaults for adapters when not provided', async () => {
      // Just providing providers and no adapters should work fine
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

      const dag = engine
        .dag()
        .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
        .build();

      const events = await collectEvents(
        engine.run({ dag, task: 'noop defaults test' }),
      );

      // Should execute successfully
      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(1);
    });
  });
});
