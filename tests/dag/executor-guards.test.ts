import { describe, it, expect } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';
import { DAGGraph } from '../../src/dag/graph.js';
import { DAGExecutor } from '../../src/dag/executor.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { SwarmMemory } from '../../src/memory/index.js';
import type { SwarmEvent, CostSummary, Guard } from '../../src/types.js';

function agent(id: string) {
  return { id, name: id, role: id, systemPrompt: '' };
}
function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

function createMockRunner(outputMap: Record<string, string>) {
  return {
    async *run(params: any): AsyncGenerator<SwarmEvent> {
      const output = outputMap[params.nodeId] ?? `output-${params.nodeId}`;
      yield { type: 'agent_start', nodeId: params.nodeId, agentRole: params.agent.role, agentName: params.agent.name };
      yield { type: 'agent_done', nodeId: params.nodeId, agentRole: params.agent.role, output, cost: emptyCost() };
    },
  };
}

describe('executor guard integration', () => {
  it('emits guard_warning for evidence guard in warn mode', async () => {
    const runner = createMockRunner({ dev: 'All tests pass and everything works correctly.' });

    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .build();

    // Set guards on the node directly
    dag.nodes[0].guards = [{ id: 'ev', type: 'evidence', mode: 'warn' as const }];

    const graph = new DAGGraph(dag);
    const executor = new DAGExecutor(
      graph, runner as any, new CostTracker(null, null),
      new SwarmMemory(), 'test task',
    );

    const events: SwarmEvent[] = [];
    for await (const event of executor.execute()) {
      events.push(event);
    }

    const warning = events.find(e => e.type === 'guard_warning');
    expect(warning).toBeDefined();
    expect(warning).toMatchObject({ nodeId: 'dev', guardId: 'ev', guardType: 'evidence' });
    // Node should still complete (warn mode)
    expect(events.find(e => e.type === 'swarm_done')).toBeDefined();
  });

  it('blocks node for evidence guard in block mode', async () => {
    const runner = createMockRunner({ dev: 'All tests pass.' });

    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .agent('next', agent('next'))
      .edge('dev', 'next')
      .build();

    dag.nodes[0].guards = [{ id: 'ev', type: 'evidence', mode: 'block' as const }];

    const graph = new DAGGraph(dag);
    const executor = new DAGExecutor(
      graph, runner as any, new CostTracker(null, null),
      new SwarmMemory(), 'test task',
    );

    const events: SwarmEvent[] = [];
    for await (const event of executor.execute()) {
      events.push(event);
    }

    const blocked = events.find(e => e.type === 'guard_blocked');
    expect(blocked).toBeDefined();
    // Downstream node should be skipped
    expect(events.find(e => e.type === 'swarm_done')).toBeDefined();
    // The 'next' node should NOT have started since 'dev' was blocked
    const nextStart = events.find(e => e.type === 'agent_start' && (e as any).nodeId === 'next');
    expect(nextStart).toBeUndefined();
  });

  it('uses engine-wide default guards when node has none', async () => {
    const runner = createMockRunner({ dev: 'All tests pass.' });

    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .build();

    const graph = new DAGGraph(dag);
    const defaultGuards: Guard[] = [{ id: 'ev', type: 'evidence', mode: 'warn' }];

    const executor = new DAGExecutor(
      graph, runner as any, new CostTracker(null, null),
      new SwarmMemory(), 'test task',
      undefined, // signal
      undefined, // provider
      undefined, // providers
      undefined, // limits
      undefined, // agenticRunner
      undefined, // agenticAdapters
      undefined, // persistence
      undefined, // lifecycle
      undefined, // logger
      defaultGuards, // defaultGuards
    );

    const events: SwarmEvent[] = [];
    for await (const event of executor.execute()) {
      events.push(event);
    }

    const warning = events.find(e => e.type === 'guard_warning');
    expect(warning).toBeDefined();
  });

  it('does not trigger guards when output has evidence', async () => {
    const runner = createMockRunner({
      dev: 'All tests pass.\n\n```\n$ npm test\n✓ 42 tests passed\n```',
    });

    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .build();

    dag.nodes[0].guards = [{ id: 'ev', type: 'evidence', mode: 'block' as const }];

    const graph = new DAGGraph(dag);
    const executor = new DAGExecutor(
      graph, runner as any, new CostTracker(null, null),
      new SwarmMemory(), 'test task',
    );

    const events: SwarmEvent[] = [];
    for await (const event of executor.execute()) {
      events.push(event);
    }

    // No guard events since evidence was present
    expect(events.find(e => e.type === 'guard_warning')).toBeUndefined();
    expect(events.find(e => e.type === 'guard_blocked')).toBeUndefined();
    expect(events.find(e => e.type === 'swarm_done')).toBeDefined();
  });

  it('node-level guards override engine-wide defaults', async () => {
    const runner = createMockRunner({ dev: 'All tests pass.' });

    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .build();

    // Node has a warn-mode guard (should warn, not block)
    dag.nodes[0].guards = [{ id: 'node-ev', type: 'evidence', mode: 'warn' as const }];

    // Engine default would block
    const defaultGuards: Guard[] = [{ id: 'engine-ev', type: 'evidence', mode: 'block' }];

    const graph = new DAGGraph(dag);
    const executor = new DAGExecutor(
      graph, runner as any, new CostTracker(null, null),
      new SwarmMemory(), 'test task',
      undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined,
      undefined,
      defaultGuards,
    );

    const events: SwarmEvent[] = [];
    for await (const event of executor.execute()) {
      events.push(event);
    }

    // Should use node-level guard (warn), not engine default (block)
    const warning = events.find(e => e.type === 'guard_warning');
    expect(warning).toBeDefined();
    expect((warning as any).guardId).toBe('node-ev');
    // Should NOT be blocked
    expect(events.find(e => e.type === 'guard_blocked')).toBeUndefined();
    expect(events.find(e => e.type === 'swarm_done')).toBeDefined();
  });
});
