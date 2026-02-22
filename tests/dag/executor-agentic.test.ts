import { describe, it, expect, vi } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';
import { DAGGraph } from '../../src/dag/graph.js';
import { DAGExecutor } from '../../src/dag/executor.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { SwarmMemory } from '../../src/memory/index.js';
import type { AgentRunParams } from '../../src/agent/runner.js';
import type { AgenticRunnerParams } from '../../src/agent/agentic-runner.js';
import type { SwarmEvent, AgentDescriptor, CostSummary } from '../../src/types.js';
import type { AgenticAdapter } from '../../src/adapters/agentic/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal agent descriptor. */
function agent(id: string, providerId?: string): AgentDescriptor {
  return { id, name: id, role: id, systemPrompt: '', providerId };
}

/** Create an empty CostSummary. */
function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

/**
 * Build a mock standard AgentRunner whose `run` method yields predetermined events
 * per node. Tracks which nodes it was called for.
 */
function createMockStandardRunner(outputMap: Record<string, string>) {
  const calledWith: string[] = [];

  const runner = {
    async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
      const { nodeId, agent: agentDesc } = params;
      calledWith.push(nodeId);

      yield {
        type: 'agent_start',
        nodeId,
        agentRole: agentDesc.role,
        agentName: agentDesc.name,
      };

      const output = outputMap[nodeId] ?? `standard-output-${nodeId}`;

      yield {
        type: 'agent_chunk',
        nodeId,
        agentRole: agentDesc.role,
        content: output,
      };

      yield {
        type: 'agent_done',
        nodeId,
        agentRole: agentDesc.role,
        output,
        cost: emptyCost(),
      };
    },
  };

  return { runner: runner as any, calledWith };
}

/**
 * Build a mock AgenticRunner whose `run` method yields predetermined events
 * per node. Tracks which nodes it was called for and what params were passed.
 */
function createMockAgenticRunner(outputMap: Record<string, string>) {
  const calledWith: string[] = [];
  const receivedParams: AgenticRunnerParams[] = [];

  const runner = {
    async *run(params: AgenticRunnerParams): AsyncGenerator<SwarmEvent> {
      const { nodeId, agent: agentDesc } = params;
      calledWith.push(nodeId);
      receivedParams.push(params);

      yield {
        type: 'agent_start',
        nodeId,
        agentRole: agentDesc.role,
        agentName: agentDesc.name,
      };

      const output = outputMap[nodeId] ?? `agentic-output-${nodeId}`;

      yield {
        type: 'agent_chunk',
        nodeId,
        agentRole: agentDesc.role,
        content: output,
      };

      yield {
        type: 'agent_done',
        nodeId,
        agentRole: agentDesc.role,
        output,
        cost: emptyCost(),
      };
    },
  };

  return { runner: runner as any, calledWith, receivedParams };
}

/** Create a mock AgenticAdapter. */
function createMockAgenticAdapter(): AgenticAdapter {
  return {
    async *run() {
      yield { type: 'result' as const, output: 'adapter-result' };
    },
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

describe('DAGExecutor agentic routing', () => {
  describe('routing agentic vs standard nodes', () => {
    it('routes agentic nodes to AgenticRunner and standard nodes to AgentRunner', async () => {
      // Node 'a' is standard (no providerId), node 'b' is agentic (providerId = 'claude-code')
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b', 'claude-code'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);

      const { runner: standardRunner, calledWith: standardCalls } = createMockStandardRunner({
        a: 'standard-output-a',
      });
      const { runner: agenticRunner, calledWith: agenticCalls } = createMockAgenticRunner({
        b: 'agentic-output-b',
      });

      const adapter = createMockAgenticAdapter();
      const agenticAdapters = new Map<string, AgenticAdapter>();
      agenticAdapters.set('claude-code', adapter);

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(
        graph,
        standardRunner,
        costTracker,
        memory,
        'mixed routing task',
        undefined,   // signal
        undefined,   // provider
        undefined,   // providers
        undefined,   // limits
        agenticRunner,
        agenticAdapters,
      );

      const events = await collectEvents(executor.execute());

      // Standard runner should have been called for node 'a' only
      expect(standardCalls).toEqual(['a']);

      // Agentic runner should have been called for node 'b' only
      expect(agenticCalls).toEqual(['b']);

      // Both nodes should have completed
      const doneEvents = eventsOfType(events, 'agent_done');
      expect(doneEvents).toHaveLength(2);
      expect(doneEvents.map(e => e.nodeId).sort()).toEqual(['a', 'b']);

      // Swarm should complete successfully
      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
      expect(swarmDone[0].results).toHaveLength(2);
    });

    it('routes all nodes to standard runner when no agenticRunner is provided', async () => {
      // Even if node has an agentic providerId, without agenticRunner it should use standard
      const dag = new DAGBuilder()
        .agent('a', agent('a', 'claude-code'))
        .build();
      const graph = new DAGGraph(dag);

      const { runner: standardRunner, calledWith: standardCalls } = createMockStandardRunner({
        a: 'standard-fallback',
      });

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      // No agenticRunner or agenticAdapters provided
      const executor = new DAGExecutor(
        graph,
        standardRunner,
        costTracker,
        memory,
        'no agentic runner',
      );

      const events = await collectEvents(executor.execute());

      // Standard runner should handle the node
      expect(standardCalls).toEqual(['a']);

      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
    });

    it('routes to standard runner when adapter is missing for agentic provider', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a', 'claude-code'))
        .build();
      const graph = new DAGGraph(dag);

      const { runner: standardRunner, calledWith: standardCalls } = createMockStandardRunner({
        a: 'standard-fallback',
      });
      const { runner: agenticRunner, calledWith: agenticCalls } = createMockAgenticRunner({});

      // Provide agentic runner but NO adapter for 'claude-code'
      const agenticAdapters = new Map<string, AgenticAdapter>();

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(
        graph,
        standardRunner,
        costTracker,
        memory,
        'missing adapter',
        undefined,
        undefined,
        undefined,
        undefined,
        agenticRunner,
        agenticAdapters,
      );

      const events = await collectEvents(executor.execute());

      // Should fall back to standard runner since adapter is missing
      expect(standardCalls).toEqual(['a']);
      expect(agenticCalls).toEqual([]);

      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
    });
  });

  describe('upstream outputs passing', () => {
    it('passes upstream outputs from standard nodes to agentic nodes', async () => {
      // A (standard) -> B (agentic)
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b', 'claude-code'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);

      const { runner: standardRunner } = createMockStandardRunner({
        a: 'upstream-from-a',
      });
      const { runner: agenticRunner, receivedParams } = createMockAgenticRunner({
        b: 'agentic-result-b',
      });

      const adapter = createMockAgenticAdapter();
      const agenticAdapters = new Map<string, AgenticAdapter>();
      agenticAdapters.set('claude-code', adapter);

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(
        graph,
        standardRunner,
        costTracker,
        memory,
        'upstream test',
        undefined,
        undefined,
        undefined,
        undefined,
        agenticRunner,
        agenticAdapters,
      );

      await collectEvents(executor.execute());

      // The agentic runner should have received upstream outputs from node 'a'
      expect(receivedParams).toHaveLength(1);
      const bParams = receivedParams[0];
      expect(bParams.nodeId).toBe('b');
      expect(bParams.upstreamOutputs).toHaveLength(1);
      expect(bParams.upstreamOutputs![0].nodeId).toBe('a');
      expect(bParams.upstreamOutputs![0].output).toBe('upstream-from-a');
    });

    it('passes the correct adapter to the agentic runner', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a', 'claude-code'))
        .build();
      const graph = new DAGGraph(dag);

      const { runner: standardRunner } = createMockStandardRunner({});
      const { runner: agenticRunner, receivedParams } = createMockAgenticRunner({
        a: 'agentic-result',
      });

      const adapter = createMockAgenticAdapter();
      const agenticAdapters = new Map<string, AgenticAdapter>();
      agenticAdapters.set('claude-code', adapter);

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(
        graph,
        standardRunner,
        costTracker,
        memory,
        'adapter pass test',
        undefined,
        undefined,
        undefined,
        undefined,
        agenticRunner,
        agenticAdapters,
      );

      await collectEvents(executor.execute());

      expect(receivedParams).toHaveLength(1);
      expect(receivedParams[0].adapter).toBe(adapter);
    });
  });

  describe('backward compatibility', () => {
    it('works with existing constructor signature (no agentic params)', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);

      const { runner, calledWith } = createMockStandardRunner({
        a: 'output-a',
        b: 'output-b',
      });

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      // Old-style constructor call with no agentic params
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'compat task');
      const events = await collectEvents(executor.execute());

      expect(calledWith).toEqual(['a', 'b']);

      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
      expect(swarmDone[0].results).toHaveLength(2);
    });

    it('works with all existing optional params plus new agentic params', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);

      const { runner, calledWith } = createMockStandardRunner({ a: 'ok' });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const controller = new AbortController();

      const executor = new DAGExecutor(
        graph,
        runner,
        costTracker,
        memory,
        'full params',
        controller.signal,       // signal
        undefined,               // provider
        new Map(),               // providers
        { maxConcurrentAgents: 2 }, // limits
        undefined,               // agenticRunner (not provided)
        new Map(),               // agenticAdapters (empty)
      );

      const events = await collectEvents(executor.execute());
      expect(calledWith).toEqual(['a']);

      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
    });
  });

  describe('parallel execution with agentic nodes', () => {
    it('routes parallel agentic and standard nodes correctly', async () => {
      // root (standard) -> b (agentic), c (standard) -> merge (standard)
      const dag = new DAGBuilder()
        .agent('root', agent('root'))
        .agent('b', agent('b', 'claude-code'))
        .agent('c', agent('c'))
        .agent('merge', agent('merge'))
        .edge('root', 'b')
        .edge('root', 'c')
        .edge('b', 'merge')
        .edge('c', 'merge')
        .build();
      const graph = new DAGGraph(dag);

      const { runner: standardRunner, calledWith: standardCalls } = createMockStandardRunner({
        root: 'root-output',
        c: 'standard-c-output',
        merge: 'merged-output',
      });
      const { runner: agenticRunner, calledWith: agenticCalls } = createMockAgenticRunner({
        b: 'agentic-b-output',
      });

      const adapter = createMockAgenticAdapter();
      const agenticAdapters = new Map<string, AgenticAdapter>();
      agenticAdapters.set('claude-code', adapter);

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(
        graph,
        standardRunner,
        costTracker,
        memory,
        'parallel mixed task',
        undefined,
        undefined,
        undefined,
        undefined,
        agenticRunner,
        agenticAdapters,
      );

      const events = await collectEvents(executor.execute());

      // Standard runner should handle root, c, and merge
      expect(standardCalls.sort()).toEqual(['c', 'merge', 'root']);

      // Agentic runner should handle b
      expect(agenticCalls).toEqual(['b']);

      // All 4 nodes should complete
      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
      expect(swarmDone[0].results).toHaveLength(4);
    });
  });
});
