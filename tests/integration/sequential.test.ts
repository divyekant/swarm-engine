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
function createSequentialConfig(responses: string[]): SwarmEngineConfig {
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

describe('Integration: Sequential Pipeline', () => {
  it('executes A -> B -> C pipeline in order', async () => {
    const engine = new SwarmEngine(
      createSequentialConfig(['output from A', 'output from B', 'output from C']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'Agent A', role: 'planner', systemPrompt: 'Plan things.' })
      .agent('b', { id: 'b', name: 'Agent B', role: 'developer', systemPrompt: 'Develop things.' })
      .agent('c', { id: 'c', name: 'Agent C', role: 'reviewer', systemPrompt: 'Review things.' })
      .edge('a', 'b')
      .edge('b', 'c')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'Build a feature' }));

    // Verify swarm_start
    const starts = eventsOfType(events, 'swarm_start');
    expect(starts).toHaveLength(1);
    expect(starts[0].nodeCount).toBe(3);

    // Verify all 3 agents started and completed
    const agentStarts = eventsOfType(events, 'agent_start');
    expect(agentStarts).toHaveLength(3);

    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones).toHaveLength(3);

    // Verify swarm_done with all 3 results
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(3);
  });

  it('agents execute in sequential order: A before B before C', async () => {
    const engine = new SwarmEngine(
      createSequentialConfig(['alpha', 'beta', 'gamma']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'first', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'second', systemPrompt: '' })
      .agent('c', { id: 'c', name: 'C', role: 'third', systemPrompt: '' })
      .edge('a', 'b')
      .edge('b', 'c')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'sequential test' }));

    const agentStarts = eventsOfType(events, 'agent_start');
    const startOrder = agentStarts.map((e) => e.nodeId);
    expect(startOrder).toEqual(['a', 'b', 'c']);

    const agentDones = eventsOfType(events, 'agent_done');
    const doneOrder = agentDones.map((e) => e.nodeId);
    expect(doneOrder).toEqual(['a', 'b', 'c']);
  });

  it('chains output from upstream nodes to downstream nodes', async () => {
    const receivedMessages: { nodeId: string; messages: string }[] = [];

    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream(params) {
              // Record what messages were sent to each call
              const messagesStr = params.messages.map((m) => m.content).join(' | ');
              receivedMessages.push({ nodeId: `call-${receivedMessages.length}`, messages: messagesStr });

              const responses = ['upstream output', 'downstream output'];
              const response = responses[receivedMessages.length - 1] ?? 'default';
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
      .agent('a', { id: 'a', name: 'A', role: 'writer', systemPrompt: 'Write.' })
      .agent('b', { id: 'b', name: 'B', role: 'editor', systemPrompt: 'Edit.' })
      .edge('a', 'b')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'do work' }));

    // Verify the second call (node B) received node A's output in its messages
    expect(receivedMessages.length).toBe(2);
    // The second call should contain upstream output from A
    const secondCallMessages = receivedMessages[1].messages;
    expect(secondCallMessages).toContain('upstream output');

    // Verify agent_done outputs
    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones[0].output).toBe('upstream output');
    expect(agentDones[1].output).toBe('downstream output');
  });

  it('accumulates cost across all nodes in swarm_done', async () => {
    const engine = new SwarmEngine(
      createSequentialConfig(['one', 'two', 'three']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .agent('c', { id: 'c', name: 'C', role: 'c', systemPrompt: '' })
      .edge('a', 'b')
      .edge('b', 'c')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'cost test' }));

    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);

    // Total cost should reflect all 3 agents
    const totalCost = swarmDones[0].totalCost;
    expect(totalCost.calls).toBe(3);
    expect(totalCost.inputTokens).toBe(300); // 100 per agent
  });

  it('skips downstream nodes when a middle node fails', async () => {
    let callCount = 0;
    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              callCount++;
              if (callCount === 2) {
                // Second node (B) throws an error
                throw new Error('Agent B failed');
              }
              const response = `output-${callCount}`;
              yield { type: 'chunk' as const, content: response };
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
      .edge('a', 'b')
      .edge('b', 'c')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'failure test' }));

    // A should have completed
    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones).toHaveLength(1);
    expect(agentDones[0].nodeId).toBe('a');

    // B should have errored
    const agentErrors = eventsOfType(events, 'agent_error');
    expect(agentErrors).toHaveLength(1);
    expect(agentErrors[0].nodeId).toBe('b');

    // C should never have started (skipped due to B's failure)
    const agentStarts = eventsOfType(events, 'agent_start');
    const startedNodes = agentStarts.map((e) => e.nodeId);
    expect(startedNodes).toContain('a');
    expect(startedNodes).toContain('b');
    expect(startedNodes).not.toContain('c');

    // swarm_done should still be emitted with partial results
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(1); // only A completed
  });

  it('emits swarm_progress events between node completions', async () => {
    const engine = new SwarmEngine(
      createSequentialConfig(['x', 'y']),
    );

    const dag = engine
      .dag()
      .agent('a', { id: 'a', name: 'A', role: 'a', systemPrompt: '' })
      .agent('b', { id: 'b', name: 'B', role: 'b', systemPrompt: '' })
      .edge('a', 'b')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'progress test' }));

    const progress = eventsOfType(events, 'swarm_progress');
    expect(progress.length).toBeGreaterThanOrEqual(2);

    // First progress after A completes
    expect(progress[0].completed).toBe(1);
    expect(progress[0].total).toBe(2);
  });
});
