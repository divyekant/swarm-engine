import { describe, it, expect } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';
import { DAGGraph } from '../../src/dag/graph.js';
import { DAGExecutor } from '../../src/dag/executor.js';
import { Scheduler } from '../../src/dag/scheduler.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { SwarmMemory } from '../../src/memory/index.js';
import type { AgentRunner, AgentRunParams } from '../../src/agent/runner.js';
import type { SwarmEvent, AgentDescriptor, CostSummary } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal agent descriptor. */
function agent(id: string): AgentDescriptor {
  return { id, name: id, role: id, systemPrompt: '' };
}

/** Create an empty CostSummary. */
function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

/**
 * Build a mock AgentRunner that tracks execution counts per node.
 * Each node run yields: agent_start, agent_chunk, agent_done.
 */
function createMockRunner(
  outputMap: Record<string, string>,
  runCounts?: Map<string, number>,
): AgentRunner {
  const runner = {
    async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
      const { nodeId, agent: agentDesc } = params;

      // Track how many times each node runs
      if (runCounts) {
        runCounts.set(nodeId, (runCounts.get(nodeId) ?? 0) + 1);
      }

      yield {
        type: 'agent_start',
        nodeId,
        agentRole: agentDesc.role,
        agentName: agentDesc.name,
      };

      const output = outputMap[nodeId] ?? `output-${nodeId}`;

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
  } as AgentRunner;

  return runner;
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

describe('Cycle/Loop Support', () => {
  describe('Scheduler cycle tracking', () => {
    it('getCycleCount returns 0 for untracked edges', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(scheduler.getCycleCount('a', 'b')).toBe(0);
    });

    it('incrementCycleCount increments and returns the new count', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(scheduler.incrementCycleCount('a', 'b')).toBe(1);
      expect(scheduler.incrementCycleCount('a', 'b')).toBe(2);
      expect(scheduler.incrementCycleCount('a', 'b')).toBe(3);
      expect(scheduler.getCycleCount('a', 'b')).toBe(3);
    });

    it('tracks cycle counts independently per edge', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'b')
        .edge('a', 'c')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.incrementCycleCount('a', 'b');
      scheduler.incrementCycleCount('a', 'b');
      scheduler.incrementCycleCount('a', 'c');

      expect(scheduler.getCycleCount('a', 'b')).toBe(2);
      expect(scheduler.getCycleCount('a', 'c')).toBe(1);
    });

    it('resetNodeForCycle sets a completed node back to pending', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markRunning('b');
      scheduler.markCompleted('b');
      expect(scheduler.getStatus('b')).toBe('completed');

      scheduler.resetNodeForCycle('b');
      expect(scheduler.getStatus('b')).toBe('pending');
    });

    it('resetNodeForCycle sets a failed node back to pending', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markRunning('b');
      scheduler.markFailed('b');
      expect(scheduler.getStatus('b')).toBe('failed');

      scheduler.resetNodeForCycle('b');
      expect(scheduler.getStatus('b')).toBe('pending');
    });

    it('resetNodeForCycle throws on unknown node', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(() => scheduler.resetNodeForCycle('nonexistent')).toThrow('Unknown node');
    });

    it('a reset node becomes ready again when dependencies are completed', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      // Complete A, then run and complete B
      scheduler.markRunning('a');
      scheduler.markCompleted('a');
      scheduler.markRunning('b');
      scheduler.markCompleted('b');
      expect(scheduler.isDone()).toBe(true);

      // Reset B -- scheduler is no longer done
      scheduler.resetNodeForCycle('b');
      expect(scheduler.isDone()).toBe(false);

      // B should be ready again since A is completed
      const ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('b');
    });
  });

  describe('simple loop A -> B (maxCycles: 3)', () => {
    it('runs B exactly 3 times and emits loop_iteration events', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b', { maxCycles: 3 })
        .build();
      const graph = new DAGGraph(dag);

      const runCounts = new Map<string, number>();
      const runner = createMockRunner({ a: 'output-a', b: 'output-b' }, runCounts);
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'loop task');
      const events = await collectEvents(executor.execute());

      // A should run exactly once
      expect(runCounts.get('a')).toBe(1);

      // B should run exactly 3 times (maxCycles = 3 total iterations)
      expect(runCounts.get('b')).toBe(3);

      // Should have 3 loop_iteration events
      const loopEvents = eventsOfType(events, 'loop_iteration');
      expect(loopEvents).toHaveLength(3);

      // Verify iteration numbers are 1, 2, 3
      expect(loopEvents[0]).toEqual({
        type: 'loop_iteration',
        nodeId: 'b',
        iteration: 1,
        maxIterations: 3,
      });
      expect(loopEvents[1]).toEqual({
        type: 'loop_iteration',
        nodeId: 'b',
        iteration: 2,
        maxIterations: 3,
      });
      expect(loopEvents[2]).toEqual({
        type: 'loop_iteration',
        nodeId: 'b',
        iteration: 3,
        maxIterations: 3,
      });

      // Should end with swarm_done
      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
    });

    it('emits agent_start for each iteration of B', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b', { maxCycles: 2 })
        .build();
      const graph = new DAGGraph(dag);

      const runner = createMockRunner({ a: 'ok', b: 'ok' });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'loop starts');
      const events = await collectEvents(executor.execute());

      // A gets 1 agent_start, B gets 2 agent_starts (maxCycles: 2)
      const startEvents = eventsOfType(events, 'agent_start');
      const aStarts = startEvents.filter((e) => e.nodeId === 'a');
      const bStarts = startEvents.filter((e) => e.nodeId === 'b');
      expect(aStarts).toHaveLength(1);
      expect(bStarts).toHaveLength(2);
    });
  });

  describe('loop stops at maxCycles', () => {
    it('does not reset node beyond maxCycles', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b', { maxCycles: 1 })
        .build();
      const graph = new DAGGraph(dag);

      const runCounts = new Map<string, number>();
      const runner = createMockRunner({ a: 'ok', b: 'ok' }, runCounts);
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'single cycle');
      const events = await collectEvents(executor.execute());

      // With maxCycles:1, B should run exactly 1 time (iteration 1 = maxCycles, no reset)
      expect(runCounts.get('b')).toBe(1);

      // 1 loop_iteration event
      const loopEvents = eventsOfType(events, 'loop_iteration');
      expect(loopEvents).toHaveLength(1);
      expect(loopEvents[0].iteration).toBe(1);
      expect(loopEvents[0].maxIterations).toBe(1);

      // Execution completes normally
      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
    });

    it('proceeds normally after cycle limit is reached', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b', { maxCycles: 2 })
        .build();
      const graph = new DAGGraph(dag);

      const runCounts = new Map<string, number>();
      const runner = createMockRunner({ a: 'ok', b: 'refined' }, runCounts);
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'limit test');
      const events = await collectEvents(executor.execute());

      // B runs exactly 2 times
      expect(runCounts.get('b')).toBe(2);

      // Swarm completes successfully
      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].results.length).toBeGreaterThanOrEqual(2); // A + B results
    });
  });

  describe('loop with downstream node', () => {
    it('runs downstream node C only after B finishes all cycles', async () => {
      // A -> B (cycle, maxCycles:2) -> C
      // C should only run once after B's final completion
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'b', { maxCycles: 2 })
        .edge('b', 'c')
        .build();
      const graph = new DAGGraph(dag);

      const runCounts = new Map<string, number>();
      const runner = createMockRunner({ a: 'ok', b: 'refined', c: 'final' }, runCounts);
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'downstream test');
      const events = await collectEvents(executor.execute());

      // A runs once
      expect(runCounts.get('a')).toBe(1);

      // B runs 2 times (maxCycles: 2)
      expect(runCounts.get('b')).toBe(2);

      // C runs once after B's final completion
      expect(runCounts.get('c')).toBe(1);

      // Verify event ordering: loop_iteration events come before C starts
      const loopEvents = eventsOfType(events, 'loop_iteration');
      const cStartEvents = eventsOfType(events, 'agent_start').filter((e) => e.nodeId === 'c');
      expect(loopEvents).toHaveLength(2);
      expect(cStartEvents).toHaveLength(1);

      // The last loop_iteration should come before C's agent_start
      const lastLoopIdx = events.indexOf(loopEvents[loopEvents.length - 1]);
      const cStartIdx = events.indexOf(cStartEvents[0]);
      expect(lastLoopIdx).toBeLessThan(cStartIdx);

      // Swarm completes with all results
      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
    });

    it('passes the latest output from B to downstream C', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'b', { maxCycles: 2 })
        .edge('b', 'c')
        .build();
      const graph = new DAGGraph(dag);

      let iterationCount = 0;
      let cUpstreamOutput: string | undefined;

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc, upstreamOutputs } = params;

          if (nodeId === 'c') {
            const bOutput = (upstreamOutputs ?? []).find((u) => u.nodeId === 'b');
            cUpstreamOutput = bOutput?.output;
          }

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          let output: string;
          if (nodeId === 'b') {
            iterationCount++;
            output = `refined-v${iterationCount}`;
          } else {
            output = `output-${nodeId}`;
          }

          yield {
            type: 'agent_done',
            nodeId,
            agentRole: agentDesc.role,
            output,
            cost: emptyCost(),
          };
        },
      } as AgentRunner;

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'output chaining');
      await collectEvents(executor.execute());

      // C should receive B's latest output (from the final iteration)
      expect(cUpstreamOutput).toBe('refined-v2');
    });
  });

  describe('edge without maxCycles', () => {
    it('does not trigger any loop behavior for normal edges', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b') // No maxCycles
        .build();
      const graph = new DAGGraph(dag);

      const runCounts = new Map<string, number>();
      const runner = createMockRunner({ a: 'ok', b: 'ok' }, runCounts);
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'no loop');
      const events = await collectEvents(executor.execute());

      // Each node runs exactly once
      expect(runCounts.get('a')).toBe(1);
      expect(runCounts.get('b')).toBe(1);

      // No loop_iteration events
      const loopEvents = eventsOfType(events, 'loop_iteration');
      expect(loopEvents).toHaveLength(0);
    });
  });
});
