import { describe, it, expect } from 'vitest';
import { SwarmEngine } from '../../src/engine.js';
import type { SwarmEngineConfig, SwarmEvent } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectEvents(gen: AsyncGenerator<SwarmEvent>): Promise<SwarmEvent[]> {
  const events: SwarmEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function eventsOfType<T extends SwarmEvent['type']>(
  events: SwarmEvent[],
  type: T,
): Extract<SwarmEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<SwarmEvent, { type: T }>[];
}

/**
 * Create a config where the provider returns different responses based on call order.
 */
function createParallelConfig(responses: string[]): SwarmEngineConfig {
  let callCount = 0;
  return {
    providers: {
      test: {
        type: 'custom',
        adapter: {
          async *stream() {
            const response = responses[callCount++] ?? 'default';
            for (const char of response) {
              yield { type: 'chunk' as const, content: char };
            }
            yield { type: 'usage' as const, inputTokens: 100, outputTokens: response.length };
          },
          estimateCost: () => 1,
          getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
        },
      },
    },
    defaults: { provider: 'test' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: Parallel Fan-Out/Fan-In', () => {
  it('executes A -> (B, C parallel) -> D topology', async () => {
    // A runs first, then B and C run in parallel, then D runs last
    const engine = new SwarmEngine(
      createParallelConfig(['from A', 'from B', 'from C', 'from D']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'coordinator', systemPrompt: 'Coordinate.' })
      .agent('b', { id: 'b', name: 'B', role: 'worker-1', systemPrompt: 'Work 1.' })
      .agent('c', { id: 'c', name: 'C', role: 'worker-2', systemPrompt: 'Work 2.' })
      .agent('d', { id: 'd', name: 'D', role: 'aggregator', systemPrompt: 'Aggregate.' })
      .edge('a', 'b')
      .edge('a', 'c')
      .edge('b', 'd')
      .edge('c', 'd')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'parallel work' }));

    // All 4 agents should start and complete
    const agentStarts = eventsOfType(events, 'agent_start');
    expect(agentStarts).toHaveLength(4);

    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones).toHaveLength(4);

    // swarm_done should have all 4 results
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(4);

    const resultNodeIds = swarmDones[0].results.map((r) => r.nodeId);
    expect(resultNodeIds).toContain('a');
    expect(resultNodeIds).toContain('b');
    expect(resultNodeIds).toContain('c');
    expect(resultNodeIds).toContain('d');
  });

  it('A completes before B and C start', async () => {
    const engine = new SwarmEngine(
      createParallelConfig(['alpha', 'beta', 'gamma', 'delta']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'root', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'branch-1', systemPrompt: '' })
      .agent('c', { id: 'c', name: 'C', role: 'branch-2', systemPrompt: '' })
      .agent('d', { id: 'd', name: 'D', role: 'sink', systemPrompt: '' })
      .edge('a', 'b')
      .edge('a', 'c')
      .edge('b', 'd')
      .edge('c', 'd')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'ordering test' }));

    const agentStarts = eventsOfType(events, 'agent_start');
    const startOrder = agentStarts.map((e) => e.nodeId);

    // A must start first
    expect(startOrder[0]).toBe('a');

    // D must start last (after both B and C complete)
    expect(startOrder[3]).toBe('d');

    // B and C should be in positions 1 and 2 (parallel, order may vary)
    const middleNodes = startOrder.slice(1, 3).sort();
    expect(middleNodes).toEqual(['b', 'c']);
  });

  it('fan-in node D receives outputs from both B and C', async () => {
    const receivedMessages: { callIndex: number; content: string }[] = [];
    let callCount = 0;

    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream(params) {
              const idx = callCount++;
              const allContent = params.messages.map((m) => m.content).join(' | ');
              receivedMessages.push({ callIndex: idx, content: allContent });

              const responses = ['root output', 'branch B output', 'branch C output', 'aggregated'];
              const response = responses[idx] ?? 'default';
              for (const char of response) {
                yield { type: 'chunk' as const, content: char };
              }
              yield { type: 'usage' as const, inputTokens: 100, outputTokens: response.length };
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
      .agent('a', { id: 'a', name: 'A', role: 'root', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'branch-b', systemPrompt: '' })
      .agent('c', { id: 'c', name: 'C', role: 'branch-c', systemPrompt: '' })
      .agent('d', { id: 'd', name: 'D', role: 'aggregator', systemPrompt: '' })
      .edge('a', 'b')
      .edge('a', 'c')
      .edge('b', 'd')
      .edge('c', 'd')
      .build();

    await collectEvents(engine.run({ dag, task: 'fan-in test' }));

    // The last call (D, index 3) should have received both B's and C's output
    const dCall = receivedMessages[3];
    expect(dCall).toBeDefined();
    expect(dCall.content).toContain('branch B output');
    expect(dCall.content).toContain('branch C output');
  });

  it('accumulates cost across all 4 nodes', async () => {
    const engine = new SwarmEngine(
      createParallelConfig(['a', 'b', 'c', 'd']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .agent('c', { id: 'c', name: 'C', role: 'c', systemPrompt: '' })
      .agent('d', { id: 'd', name: 'D', role: 'd', systemPrompt: '' })
      .edge('a', 'b')
      .edge('a', 'c')
      .edge('b', 'd')
      .edge('c', 'd')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'cost test' }));

    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].totalCost.calls).toBe(4);
    expect(swarmDones[0].totalCost.inputTokens).toBe(400);
  });

  it('cancellation during parallel execution stops remaining work', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              callCount++;
              const response = `output-${callCount}`;
              yield { type: 'chunk' as const, content: response };
              yield { type: 'usage' as const, inputTokens: 100, outputTokens: response.length };
              // Abort after the first node completes
              if (callCount === 1) {
                controller.abort();
              }
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
      .agent('a', { id: 'a', name: 'A', role: 'root', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .agent('c', { id: 'c', name: 'C', role: 'c', systemPrompt: '' })
      .edge('a', 'b')
      .edge('a', 'c')
      .build();

    const events = await collectEvents(
      engine.run({ dag, task: 'cancel test', signal: controller.signal }),
    );

    // Should see swarm_cancelled
    const cancelled = eventsOfType(events, 'swarm_cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].completedNodes).toContain('a');

    // Should NOT have swarm_done
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(0);
  });

  it('handles triple fan-out A -> (B, C, D) all parallel', async () => {
    const engine = new SwarmEngine(
      createParallelConfig(['root', 'one', 'two', 'three']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .agent('c', { id: 'c', name: 'C', role: 'c', systemPrompt: '' })
      .agent('d', { id: 'd', name: 'D', role: 'd', systemPrompt: '' })
      .edge('a', 'b')
      .edge('a', 'c')
      .edge('a', 'd')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'triple fan-out' }));

    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones).toHaveLength(4);

    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(4);
  });
});
