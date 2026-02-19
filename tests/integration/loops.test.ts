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
function createLoopConfig(responses: string[]): SwarmEngineConfig {
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

describe('Integration: Loop / Iterative Refinement', () => {
  it('executes A -> B with maxCycles: 3, B runs 3 times', async () => {
    // A runs once, B runs 3 times (cycles)
    const engine = new SwarmEngine(
      createLoopConfig(['initial', 'iter-1', 'iter-2', 'iter-3']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'writer', systemPrompt: 'Write draft.' })
      .agent('b', { id: 'b', name: 'B', role: 'refiner', systemPrompt: 'Refine output.' })
      .edge('a', 'b', { maxCycles: 3 })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'iterative refinement' }));

    // B should have started 3 times (one for each cycle iteration)
    const agentStarts = eventsOfType(events, 'agent_start');
    const bStarts = agentStarts.filter((e) => e.nodeId === 'b');
    expect(bStarts).toHaveLength(3);

    // A should have started exactly once
    const aStarts = agentStarts.filter((e) => e.nodeId === 'a');
    expect(aStarts).toHaveLength(1);
  });

  it('emits loop_iteration events with correct iteration numbers', async () => {
    const engine = new SwarmEngine(
      createLoopConfig(['start', 'cycle-1', 'cycle-2', 'cycle-3']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .edge('a', 'b', { maxCycles: 3 })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'loop iteration test' }));

    const loopIterations = eventsOfType(events, 'loop_iteration');
    expect(loopIterations).toHaveLength(3);

    // Iterations should be 1, 2, 3
    expect(loopIterations[0].iteration).toBe(1);
    expect(loopIterations[0].maxIterations).toBe(3);
    expect(loopIterations[0].nodeId).toBe('b');

    expect(loopIterations[1].iteration).toBe(2);
    expect(loopIterations[1].maxIterations).toBe(3);

    expect(loopIterations[2].iteration).toBe(3);
    expect(loopIterations[2].maxIterations).toBe(3);
  });

  it('downstream node C runs only after B completes all iterations', async () => {
    // A -> B (3 cycles) -> C
    const engine = new SwarmEngine(
      createLoopConfig(['start', 'iter-1', 'iter-2', 'iter-3', 'final']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .agent('c', { id: 'c', name: 'C', role: 'c', systemPrompt: '' })
      .edge('a', 'b', { maxCycles: 3 })
      .edge('b', 'c')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'downstream after loop' }));

    // C should have started
    const agentStarts = eventsOfType(events, 'agent_start');
    const startedNodes = agentStarts.map((e) => e.nodeId);
    expect(startedNodes).toContain('c');

    // C should start only after B's last iteration
    const bDones = eventsOfType(events, 'agent_done').filter((e) => e.nodeId === 'b');
    const cStart = agentStarts.find((e) => e.nodeId === 'c');
    const lastBDoneIndex = events.lastIndexOf(bDones[bDones.length - 1]);
    const cStartIndex = events.indexOf(cStart!);
    expect(cStartIndex).toBeGreaterThan(lastBDoneIndex);
  });

  it('the last output from B flows downstream to C', async () => {
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

              // A=0, B-iter1=1, B-iter2=2, B-iter3=3, C=4
              const responses = ['from A', 'B-iter1', 'B-iter2', 'B-final', 'from C'];
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
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .agent('c', { id: 'c', name: 'C', role: 'c', systemPrompt: '' })
      .edge('a', 'b', { maxCycles: 3 })
      .edge('b', 'c')
      .build();

    await collectEvents(engine.run({ dag, task: 'output chaining' }));

    // C (callIndex=4) should receive B's last output ("B-final")
    const cCall = receivedMessages[4];
    expect(cCall).toBeDefined();
    expect(cCall.content).toContain('B-final');
  });

  it('cost accumulates across all loop iterations', async () => {
    const engine = new SwarmEngine(
      createLoopConfig(['draft', 'v1', 'v2', 'v3']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .edge('a', 'b', { maxCycles: 3 })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'cost loop test' }));

    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);

    // A runs once + B runs 3 times = 4 calls
    expect(swarmDones[0].totalCost.calls).toBe(4);
    expect(swarmDones[0].totalCost.inputTokens).toBe(400); // 100 per call
  });

  it('swarm_done results contain all iterations of the looped node', async () => {
    const engine = new SwarmEngine(
      createLoopConfig(['start', 'loop-1', 'loop-2']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .edge('a', 'b', { maxCycles: 2 })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'results test' }));

    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);

    // Should have results for A and multiple B iterations
    const agentDones = eventsOfType(events, 'agent_done');
    const bDones = agentDones.filter((e) => e.nodeId === 'b');
    expect(bDones).toHaveLength(2);

    // The last B output should be the final one
    expect(bDones[bDones.length - 1].output).toBe('loop-2');
  });

  it('single cycle (maxCycles: 1) runs the node exactly once', async () => {
    const engine = new SwarmEngine(
      createLoopConfig(['initial', 'single-run']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .edge('a', 'b', { maxCycles: 1 })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'single cycle' }));

    const bStarts = eventsOfType(events, 'agent_start').filter((e) => e.nodeId === 'b');
    expect(bStarts).toHaveLength(1);

    const loopIterations = eventsOfType(events, 'loop_iteration');
    expect(loopIterations).toHaveLength(1);
    expect(loopIterations[0].iteration).toBe(1);
    expect(loopIterations[0].maxIterations).toBe(1);
  });
});
