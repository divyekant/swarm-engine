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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: Dynamic DAG Expansion', () => {
  it('coordinator emits sub-DAG that gets executed', async () => {
    const subDAG = JSON.stringify({
      nodes: [
        {
          id: 'worker1',
          agent: { id: 'worker1', name: 'Worker 1', role: 'worker', systemPrompt: 'Do work.' },
        },
        {
          id: 'worker2',
          agent: { id: 'worker2', name: 'Worker 2', role: 'worker', systemPrompt: 'Do work.' },
        },
      ],
      edges: [
        { from: 'coordinator', to: 'worker1' },
        { from: 'coordinator', to: 'worker2' },
      ],
    });

    let callCount = 0;
    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              callCount++;
              // First call is the coordinator, rest are dynamic workers
              const response = callCount === 1 ? subDAG : `worker-output-${callCount}`;
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
      .agent('coordinator', {
        id: 'coordinator',
        name: 'Coordinator',
        role: 'coordinator',
        systemPrompt: 'Plan and emit sub-DAG.',
      })
      .dynamicExpansion('coordinator')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'dynamic planning' }));

    // Coordinator + 2 dynamic workers = 3 agent_start events
    const agentStarts = eventsOfType(events, 'agent_start');
    expect(agentStarts.length).toBe(3);

    const startedNodes = agentStarts.map((e) => e.nodeId);
    expect(startedNodes).toContain('coordinator');
    expect(startedNodes).toContain('worker1');
    expect(startedNodes).toContain('worker2');

    // swarm_done should include all 3 nodes
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results.length).toBe(3);
  });

  it('non-JSON output from coordinator completes gracefully without expansion', async () => {
    let callCount = 0;
    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              callCount++;
              // Coordinator outputs plain text, not JSON
              const response = callCount === 1 ? 'This is just regular text, not a DAG' : 'done';
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
      .agent('coordinator', {
        id: 'coordinator',
        name: 'Coordinator',
        role: 'coordinator',
        systemPrompt: 'Plan.',
      })
      .dynamicExpansion('coordinator')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'non-json test' }));

    // Only the coordinator should have run
    const agentStarts = eventsOfType(events, 'agent_start');
    expect(agentStarts).toHaveLength(1);
    expect(agentStarts[0].nodeId).toBe('coordinator');

    // Should complete successfully
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(1);
  });

  it('dynamic sub-nodes connect to existing downstream nodes', async () => {
    const subDAG = JSON.stringify({
      nodes: [
        {
          id: 'dynamic1',
          agent: { id: 'dynamic1', name: 'Dynamic', role: 'worker', systemPrompt: 'Work.' },
        },
      ],
      edges: [
        { from: 'coordinator', to: 'dynamic1' },
        { from: 'dynamic1', to: 'finaliser' },
      ],
    });

    let callCount = 0;
    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              callCount++;
              const response = callCount === 1 ? subDAG : `output-${callCount}`;
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
      .agent('coordinator', {
        id: 'coordinator',
        name: 'Coordinator',
        role: 'coordinator',
        systemPrompt: 'Emit sub-DAG.',
      })
      .agent('finaliser', {
        id: 'finaliser',
        name: 'Finaliser',
        role: 'finaliser',
        systemPrompt: 'Finalise.',
      })
      .dynamicExpansion('coordinator')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'dynamic to existing' }));

    // All 3 nodes should have run: coordinator, dynamic1, finaliser
    const agentStarts = eventsOfType(events, 'agent_start');
    const startedNodes = agentStarts.map((e) => e.nodeId);
    expect(startedNodes).toContain('coordinator');
    expect(startedNodes).toContain('dynamic1');
    expect(startedNodes).toContain('finaliser');

    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results.length).toBe(3);
  });

  it('cost tracking includes dynamically added nodes', async () => {
    const subDAG = JSON.stringify({
      nodes: [
        {
          id: 'dyn',
          agent: { id: 'dyn', name: 'Dynamic', role: 'worker', systemPrompt: '' },
        },
      ],
      edges: [
        { from: 'coordinator', to: 'dyn' },
      ],
    });

    let callCount = 0;
    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              callCount++;
              const response = callCount === 1 ? subDAG : 'dynamic-output';
              for (const char of response) {
                yield { type: 'chunk' as const, content: char };
              }
              yield { type: 'usage' as const, inputTokens: 150, outputTokens: response.length };
            },
            estimateCost: () => 2,
            getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
          },
        },
      },
      defaults: { provider: 'test' },
    };

    const engine = new SwarmEngine(config);

    const dag = engine
      .dag()
      .agent('coordinator', {
        id: 'coordinator',
        name: 'Coordinator',
        role: 'coordinator',
        systemPrompt: '',
      })
      .dynamicExpansion('coordinator')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'cost tracking' }));

    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);

    // 2 calls total (coordinator + dyn)
    expect(swarmDones[0].totalCost.calls).toBe(2);
    expect(swarmDones[0].totalCost.inputTokens).toBe(300); // 150 per call
  });

  it('handles coordinator output with valid JSON but no nodes/edges gracefully', async () => {
    let callCount = 0;
    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              callCount++;
              // Coordinator outputs valid JSON but without nodes array
              const response = callCount === 1 ? '{"message": "no sub-dag needed"}' : 'done';
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
      .agent('coordinator', {
        id: 'coordinator',
        name: 'Coordinator',
        role: 'coordinator',
        systemPrompt: '',
      })
      .dynamicExpansion('coordinator')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'invalid json dag' }));

    // Only coordinator should have run
    const agentStarts = eventsOfType(events, 'agent_start');
    expect(agentStarts).toHaveLength(1);

    // Should complete successfully, not error
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(1);
  });

  it('multiple dynamic nodes run in parallel when topology allows', async () => {
    const subDAG = JSON.stringify({
      nodes: [
        {
          id: 'dyn_a',
          agent: { id: 'dyn_a', name: 'Dyn A', role: 'dyn-worker', systemPrompt: '' },
        },
        {
          id: 'dyn_b',
          agent: { id: 'dyn_b', name: 'Dyn B', role: 'dyn-worker', systemPrompt: '' },
        },
        {
          id: 'dyn_c',
          agent: { id: 'dyn_c', name: 'Dyn C', role: 'dyn-worker', systemPrompt: '' },
        },
      ],
      edges: [
        { from: 'coordinator', to: 'dyn_a' },
        { from: 'coordinator', to: 'dyn_b' },
        { from: 'coordinator', to: 'dyn_c' },
      ],
    });

    let callCount = 0;
    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              callCount++;
              const response = callCount === 1 ? subDAG : `dyn-output-${callCount}`;
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
      .agent('coordinator', {
        id: 'coordinator',
        name: 'Coordinator',
        role: 'coordinator',
        systemPrompt: '',
      })
      .dynamicExpansion('coordinator')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'parallel dynamic' }));

    // All 4 nodes should complete
    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones).toHaveLength(4);

    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(4);

    const resultNodes = swarmDones[0].results.map((r) => r.nodeId);
    expect(resultNodes).toContain('coordinator');
    expect(resultNodes).toContain('dyn_a');
    expect(resultNodes).toContain('dyn_b');
    expect(resultNodes).toContain('dyn_c');
  });
});
