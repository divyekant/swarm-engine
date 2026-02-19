import { describe, it, expect, vi } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';
import { DAGGraph } from '../../src/dag/graph.js';
import { DAGExecutor } from '../../src/dag/executor.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { SwarmMemory } from '../../src/memory/index.js';
import { AgentRunner } from '../../src/agent/runner.js';
import type { AgentRunParams } from '../../src/agent/runner.js';
import type { SwarmEvent, AgentDescriptor, CostSummary, ProviderAdapter } from '../../src/types.js';
import { ContextAssembler } from '../../src/context/assembler.js';
import { NoopContextProvider, NoopMemoryProvider, NoopCodebaseProvider, NoopPersonaProvider } from '../../src/adapters/defaults.js';

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
 * Build a mock AgentRunner whose `run` method yields predetermined events
 * per node. The `outputMap` maps nodeId -> output text. Each node run will
 * yield: agent_start, agent_chunk (with the output), agent_done.
 */
function createMockRunner(
  outputMap: Record<string, string>,
  options?: {
    failNodes?: Set<string>;
    delayMs?: number;
  },
): AgentRunner {
  const runner = {
    async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
      const { nodeId, agent: agentDesc } = params;

      yield {
        type: 'agent_start',
        nodeId,
        agentRole: agentDesc.role,
        agentName: agentDesc.name,
      };

      if (options?.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }

      if (options?.failNodes?.has(nodeId)) {
        yield {
          type: 'agent_error',
          nodeId,
          agentRole: agentDesc.role,
          message: `Node ${nodeId} failed`,
          errorType: 'unknown',
        };
        return;
      }

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

describe('DAGExecutor', () => {
  describe('single node', () => {
    it('executes a single-node DAG and emits correct event sequence', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const runner = createMockRunner({ a: 'hello from a' });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'do the thing');
      const events = await collectEvents(executor.execute());

      // Should start with swarm_start
      expect(events[0]).toEqual({
        type: 'swarm_start',
        dagId: graph.id,
        nodeCount: 1,
      });

      // Should have agent_start, agent_chunk, agent_done
      const agentStarts = eventsOfType(events, 'agent_start');
      expect(agentStarts).toHaveLength(1);
      expect(agentStarts[0].nodeId).toBe('a');

      const agentChunks = eventsOfType(events, 'agent_chunk');
      expect(agentChunks).toHaveLength(1);
      expect(agentChunks[0].content).toBe('hello from a');

      const agentDones = eventsOfType(events, 'agent_done');
      expect(agentDones).toHaveLength(1);
      expect(agentDones[0].output).toBe('hello from a');

      // Should have swarm_progress
      const progress = eventsOfType(events, 'swarm_progress');
      expect(progress.length).toBeGreaterThanOrEqual(1);
      expect(progress[progress.length - 1].completed).toBe(1);

      // Should end with swarm_done
      const lastEvent = events[events.length - 1];
      expect(lastEvent.type).toBe('swarm_done');
      if (lastEvent.type === 'swarm_done') {
        expect(lastEvent.results).toHaveLength(1);
        expect(lastEvent.results[0].nodeId).toBe('a');
        expect(lastEvent.results[0].output).toBe('hello from a');
      }
    });
  });

  describe('sequential pipeline', () => {
    it('executes A -> B -> C in order with outputs chaining', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'b')
        .edge('b', 'c')
        .build();
      const graph = new DAGGraph(dag);

      // Track the order of execution and upstream outputs received
      const executionOrder: string[] = [];
      const receivedUpstream: Record<string, string[]> = {};

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc, upstreamOutputs } = params;

          executionOrder.push(nodeId);
          receivedUpstream[nodeId] = (upstreamOutputs ?? []).map(u => u.nodeId);

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          const output = `output-${nodeId}`;

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

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'pipeline task');
      const events = await collectEvents(executor.execute());

      // Verify execution order
      expect(executionOrder).toEqual(['a', 'b', 'c']);

      // Verify upstream outputs were passed correctly
      expect(receivedUpstream['a']).toEqual([]);
      expect(receivedUpstream['b']).toEqual(['a']);
      expect(receivedUpstream['c']).toEqual(['b']);

      // Verify swarm_done
      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].results).toHaveLength(3);

      // Results should be in execution order
      const resultIds = doneEvents[0].results.map(r => r.nodeId);
      expect(resultIds).toEqual(['a', 'b', 'c']);
    });
  });

  describe('parallel fan-out/fan-in', () => {
    it('executes A -> (B, C) -> D with B and C in parallel', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .agent('d', agent('d'))
        .edge('a', 'b')
        .edge('a', 'c')
        .edge('b', 'd')
        .edge('c', 'd')
        .build();
      const graph = new DAGGraph(dag);

      const executionBatches: string[][] = [];
      let currentBatch: string[] = [];
      let batchIndex = 0;

      const receivedUpstream: Record<string, string[]> = {};

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc, upstreamOutputs } = params;

          receivedUpstream[nodeId] = (upstreamOutputs ?? []).map(u => u.nodeId).sort();

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          const output = `output-${nodeId}`;

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

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'fan-out task');
      const events = await collectEvents(executor.execute());

      // Verify upstream outputs for fan-in node D
      expect(receivedUpstream['a']).toEqual([]);
      expect(receivedUpstream['b']).toEqual(['a']);
      expect(receivedUpstream['c']).toEqual(['a']);
      expect(receivedUpstream['d']).toEqual(['b', 'c']);

      // Verify all nodes completed
      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].results).toHaveLength(4);

      // Verify agent_start events for all 4 nodes
      const startEvents = eventsOfType(events, 'agent_start');
      expect(startEvents).toHaveLength(4);
      const startedNodeIds = startEvents.map(e => e.nodeId);
      expect(startedNodeIds).toContain('a');
      expect(startedNodeIds).toContain('b');
      expect(startedNodeIds).toContain('c');
      expect(startedNodeIds).toContain('d');
    });

    it('provides all upstream outputs to the fan-in node', async () => {
      const dag = new DAGBuilder()
        .agent('root', agent('root'))
        .agent('left', agent('left'))
        .agent('right', agent('right'))
        .agent('merge', agent('merge'))
        .edge('root', 'left')
        .edge('root', 'right')
        .edge('left', 'merge')
        .edge('right', 'merge')
        .build();
      const graph = new DAGGraph(dag);

      let mergeUpstream: { nodeId: string; agentRole: string; output: string }[] = [];

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc, upstreamOutputs } = params;

          if (nodeId === 'merge') {
            mergeUpstream = upstreamOutputs ?? [];
          }

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          yield {
            type: 'agent_done',
            nodeId,
            agentRole: agentDesc.role,
            output: `result-${nodeId}`,
            cost: emptyCost(),
          };
        },
      } as AgentRunner;

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'merge task');
      await collectEvents(executor.execute());

      // Merge node should receive outputs from both left and right
      expect(mergeUpstream).toHaveLength(2);
      const upstreamNodeIds = mergeUpstream.map(u => u.nodeId).sort();
      expect(upstreamNodeIds).toEqual(['left', 'right']);
      expect(mergeUpstream.find(u => u.nodeId === 'left')?.output).toBe('result-left');
      expect(mergeUpstream.find(u => u.nodeId === 'right')?.output).toBe('result-right');
    });
  });

  describe('node failure', () => {
    it('skips downstream nodes when a node fails', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'b')
        .edge('b', 'c')
        .build();
      const graph = new DAGGraph(dag);

      const runner = createMockRunner(
        { a: 'ok', b: 'ignored', c: 'ignored' },
        { failNodes: new Set(['b']) },
      );

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'fail task');
      const events = await collectEvents(executor.execute());

      // Node a should succeed
      const doneAgents = eventsOfType(events, 'agent_done');
      expect(doneAgents).toHaveLength(1);
      expect(doneAgents[0].nodeId).toBe('a');

      // Node b should fail
      const errorEvents = eventsOfType(events, 'agent_error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].nodeId).toBe('b');

      // Node c should be skipped (never started)
      const startEvents = eventsOfType(events, 'agent_start');
      const startedNodeIds = startEvents.map(e => e.nodeId);
      expect(startedNodeIds).not.toContain('c');

      // Swarm should still complete (with partial results)
      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
      expect(swarmDone[0].results).toHaveLength(1); // Only node a completed
    });

    it('skips all descendants of a failed node in a diamond', async () => {
      // a -> b -> d
      // a -> c -> d
      // If b fails, d should be skipped
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .agent('d', agent('d'))
        .edge('a', 'b')
        .edge('a', 'c')
        .edge('b', 'd')
        .edge('c', 'd')
        .build();
      const graph = new DAGGraph(dag);

      const runner = createMockRunner(
        { a: 'ok', c: 'ok' },
        { failNodes: new Set(['b']) },
      );

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'diamond fail');
      const events = await collectEvents(executor.execute());

      // Node d should not have started (skipped because b failed)
      const startEvents = eventsOfType(events, 'agent_start');
      const startedNodeIds = startEvents.map(e => e.nodeId);
      expect(startedNodeIds).not.toContain('d');

      // Should still finish the swarm
      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
    });
  });

  describe('cancellation', () => {
    it('emits swarm_cancelled when signal is aborted before execution', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);

      const controller = new AbortController();
      controller.abort(); // Abort immediately

      const runner = createMockRunner({ a: 'ok', b: 'ok' });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'cancelled task', controller.signal);
      const events = await collectEvents(executor.execute());

      // Should have swarm_start followed by swarm_cancelled
      expect(events[0].type).toBe('swarm_start');

      const cancelledEvents = eventsOfType(events, 'swarm_cancelled');
      expect(cancelledEvents).toHaveLength(1);

      // No agents should have started
      const agentStarts = eventsOfType(events, 'agent_start');
      expect(agentStarts).toHaveLength(0);
    });

    it('emits swarm_cancelled when signal is aborted during execution', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);

      const controller = new AbortController();

      // Runner that aborts after node a completes
      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc } = params;

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          yield {
            type: 'agent_done',
            nodeId,
            agentRole: agentDesc.role,
            output: `output-${nodeId}`,
            cost: emptyCost(),
          };

          // Abort after node a completes so node b won't run
          if (nodeId === 'a') {
            controller.abort();
          }
        },
      } as AgentRunner;

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'mid-cancel task', controller.signal);
      const events = await collectEvents(executor.execute());

      // Node a should have completed
      const agentDones = eventsOfType(events, 'agent_done');
      expect(agentDones.some(e => e.nodeId === 'a')).toBe(true);

      // Should have swarm_cancelled
      const cancelledEvents = eventsOfType(events, 'swarm_cancelled');
      expect(cancelledEvents).toHaveLength(1);
      expect(cancelledEvents[0].completedNodes).toContain('a');

      // Node b should not have been started
      const agentStarts = eventsOfType(events, 'agent_start');
      expect(agentStarts.map(e => e.nodeId)).not.toContain('b');
    });
  });

  describe('budget tracking', () => {
    it('emits budget_warning at 80% usage', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);

      // Budget = 10 cents. Node a will cost 9 cents (90% > 80% threshold).
      // gpt-4o pricing: input=250, output=1000 per million tokens
      // inputCost = ceil((20000*250)/1e6) = ceil(5) = 5
      // outputCost = ceil((4000*1000)/1e6) = ceil(4) = 4
      // total per node = 9 cents
      const costTracker = new CostTracker(10);

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc } = params;

          costTracker.recordUsage(agentDesc.id, nodeId, {
            inputTokens: 20000,
            outputTokens: 4000,
            model: 'gpt-4o',
          });

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          yield {
            type: 'agent_done',
            nodeId,
            agentRole: agentDesc.role,
            output: `output-${nodeId}`,
            cost: emptyCost(),
          };
        },
      } as AgentRunner;

      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'budget task');
      const events = await collectEvents(executor.execute());

      // Should see at least one budget-related event
      const budgetWarnings = eventsOfType(events, 'budget_warning');
      const budgetExceeded = eventsOfType(events, 'budget_exceeded');
      expect(budgetWarnings.length + budgetExceeded.length).toBeGreaterThanOrEqual(1);
    });

    it('emits budget_exceeded and stops when over budget', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'b')
        .edge('b', 'c')
        .build();
      const graph = new DAGGraph(dag);

      // Set a tiny budget: 1 cent
      const costTracker = new CostTracker(1);

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc } = params;

          // Record high usage to blow past budget
          costTracker.recordUsage(agentDesc.id, nodeId, {
            inputTokens: 100000,
            outputTokens: 100000,
            model: 'claude-opus-4-20250514',
          });

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          yield {
            type: 'agent_done',
            nodeId,
            agentRole: agentDesc.role,
            output: `output-${nodeId}`,
            cost: emptyCost(),
          };
        },
      } as AgentRunner;

      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'over budget');
      const events = await collectEvents(executor.execute());

      // Should emit budget_exceeded
      const budgetExceeded = eventsOfType(events, 'budget_exceeded');
      expect(budgetExceeded).toHaveLength(1);

      // Should emit swarm_error (not swarm_done)
      const swarmErrors = eventsOfType(events, 'swarm_error');
      expect(swarmErrors).toHaveLength(1);
      expect(swarmErrors[0].message).toBe('Budget exceeded');

      // Should not have swarm_done
      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(0);
    });
  });

  describe('progress tracking', () => {
    it('emits swarm_progress events after each node completion', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'b')
        .edge('b', 'c')
        .build();
      const graph = new DAGGraph(dag);

      const runner = createMockRunner({ a: 'ok', b: 'ok', c: 'ok' });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'progress task');
      const events = await collectEvents(executor.execute());

      const progressEvents = eventsOfType(events, 'swarm_progress');
      expect(progressEvents.length).toBeGreaterThanOrEqual(3);

      // All progress events should report total = 3
      for (const p of progressEvents) {
        expect(p.total).toBe(3);
      }

      // The last progress event should show all nodes completed
      const lastProgress = progressEvents[progressEvents.length - 1];
      expect(lastProgress.completed).toBe(3);
    });
  });

  describe('node task fallback', () => {
    it('uses node-specific task if available, otherwise falls back to swarm task', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();

      // Manually set task on node a
      dag.nodes[0].task = 'custom task for a';

      const graph = new DAGGraph(dag);

      const receivedTasks: Record<string, string> = {};

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc, task } = params;
          receivedTasks[nodeId] = task;

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          yield {
            type: 'agent_done',
            nodeId,
            agentRole: agentDesc.role,
            output: 'done',
            cost: emptyCost(),
          };
        },
      } as AgentRunner;

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'swarm-level task');
      await collectEvents(executor.execute());

      // Node a should use its own task
      expect(receivedTasks['a']).toBe('custom task for a');
      // Node b should fall back to the swarm task
      expect(receivedTasks['b']).toBe('swarm-level task');
    });
  });

  describe('result properties', () => {
    it('includes durationMs in results', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);

      const runner = createMockRunner({ a: 'result' }, { delayMs: 10 });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'timing task');
      const events = await collectEvents(executor.execute());

      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].results[0].durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('edge cases', () => {
    it('handles a DAG with multiple root nodes', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .build(); // No edges -- all are roots
      const graph = new DAGGraph(dag);

      const runner = createMockRunner({ a: 'a-out', b: 'b-out', c: 'c-out' });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'multi root');
      const events = await collectEvents(executor.execute());

      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].results).toHaveLength(3);
    });

    it('passes the AbortSignal to the AgentRunner', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);

      const controller = new AbortController();
      let receivedSignal: AbortSignal | undefined;

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          receivedSignal = params.signal;
          const { nodeId, agent: agentDesc } = params;

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          yield {
            type: 'agent_done',
            nodeId,
            agentRole: agentDesc.role,
            output: 'done',
            cost: emptyCost(),
          };
        },
      } as AgentRunner;

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'signal test', controller.signal);
      await collectEvents(executor.execute());

      expect(receivedSignal).toBe(controller.signal);
    });
  });

  describe('limits enforcement', () => {
    it('respects maxConcurrentAgents by limiting parallel batch size', async () => {
      // 3 root nodes (all ready at once) but maxConcurrentAgents = 1
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .build();
      const graph = new DAGGraph(dag);

      let concurrentCount = 0;
      let maxConcurrent = 0;

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          const { nodeId, agent: agentDesc } = params;
          yield { type: 'agent_start', nodeId, agentRole: agentDesc.role, agentName: agentDesc.name };
          await new Promise(r => setTimeout(r, 10));
          yield { type: 'agent_done', nodeId, agentRole: agentDesc.role, output: `out-${nodeId}`, cost: emptyCost() };
          concurrentCount--;
        },
      } as AgentRunner;

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'concurrency test', undefined, undefined, undefined, { maxConcurrentAgents: 1 });
      const events = await collectEvents(executor.execute());

      expect(maxConcurrent).toBeLessThanOrEqual(1);
      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].results).toHaveLength(3);
    });

    it('stops swarm when maxSwarmDurationMs exceeded', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc } = params;
          yield { type: 'agent_start', nodeId, agentRole: agentDesc.role, agentName: agentDesc.name };
          await new Promise(r => setTimeout(r, 100));
          yield { type: 'agent_done', nodeId, agentRole: agentDesc.role, output: `out-${nodeId}`, cost: emptyCost() };
        },
      } as AgentRunner;

      const costTracker = new CostTracker();
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'duration test', undefined, undefined, undefined, { maxSwarmDurationMs: 50 });
      const events = await collectEvents(executor.execute());

      const errorEvents = eventsOfType(events, 'swarm_error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
      expect(errorEvents.some(e => e.message.includes('duration'))).toBe(true);
    });

    it('emits budget_exceeded when per-agent budget is exceeded', async () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);

      const costTracker = new CostTracker(null, 1); // perAgentBudget = 1 cent

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc } = params;
          // Record 9 cents of usage — blows past per-agent 1 cent budget
          costTracker.recordUsage(agentDesc.id, nodeId, {
            inputTokens: 20000,
            outputTokens: 4000,
            model: 'gpt-4o',
          });
          yield { type: 'agent_start', nodeId, agentRole: agentDesc.role, agentName: agentDesc.name };
          yield { type: 'agent_done', nodeId, agentRole: agentDesc.role, output: `out-${nodeId}`, cost: emptyCost() };
        },
      } as AgentRunner;

      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'agent budget test');
      const events = await collectEvents(executor.execute());

      const budgetEvents = eventsOfType(events, 'budget_exceeded');
      expect(budgetEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('per-node provider routing', () => {
    it('resolves provider from providers map when node has providerId', async () => {
      const nodeA = { ...agent('a'), providerId: 'fast' };
      const nodeB = { ...agent('b'), providerId: 'cheap' };
      const dag = new DAGBuilder()
        .agent('a', nodeA)
        .agent('b', nodeB)
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);

      // Track which provider was used per node by capturing stream output
      const receivedContent: Record<string, string> = {};

      const fastProvider: ProviderAdapter = {
        async *stream() { yield { type: 'chunk' as const, content: 'fast' }; yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 }; },
        estimateCost: () => 1,
        getModelLimits: () => ({ contextWindow: 999_999, maxOutput: 4096 }),
      };
      const cheapProvider: ProviderAdapter = {
        async *stream() { yield { type: 'chunk' as const, content: 'cheap' }; yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 }; },
        estimateCost: () => 0,
        getModelLimits: () => ({ contextWindow: 111_111, maxOutput: 2048 }),
      };
      const defaultProvider: ProviderAdapter = {
        async *stream() { yield { type: 'chunk' as const, content: 'default' }; yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 }; },
        estimateCost: () => 0,
        getModelLimits: () => ({ contextWindow: 500_000, maxOutput: 8192 }),
      };

      const providers = new Map<string, ProviderAdapter>();
      providers.set('fast', fastProvider);
      providers.set('cheap', cheapProvider);

      const costTracker = new CostTracker();
      const assembler = new ContextAssembler({
        context: new NoopContextProvider(),
        memory: new NoopMemoryProvider(),
        codebase: new NoopCodebaseProvider(),
        persona: new NoopPersonaProvider(),
      });
      const runner = new AgentRunner(defaultProvider, assembler, costTracker, providers);
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'route task', undefined, defaultProvider, providers);
      const events = await collectEvents(executor.execute());

      // Collect chunk content per node
      for (const event of events) {
        if (event.type === 'agent_chunk') {
          receivedContent[event.nodeId] = (receivedContent[event.nodeId] ?? '') + event.content;
        }
      }

      // Node a has providerId 'fast' -> should use fastProvider -> content 'fast'
      expect(receivedContent['a']).toBe('fast');
      // Node b has providerId 'cheap' -> should use cheapProvider -> content 'cheap'
      expect(receivedContent['b']).toBe('cheap');

      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].results).toHaveLength(2);
    });

    it('falls back to default provider when providerId is not in the map', async () => {
      const nodeA = { ...agent('a'), providerId: 'nonexistent' };
      const dag = new DAGBuilder()
        .agent('a', nodeA)
        .build();
      const graph = new DAGGraph(dag);

      const defaultProvider: ProviderAdapter = {
        async *stream() { yield { type: 'chunk' as const, content: 'default' }; yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 }; },
        estimateCost: () => 0,
        getModelLimits: () => ({ contextWindow: 500_000, maxOutput: 8192 }),
      };

      const providers = new Map<string, ProviderAdapter>();

      const costTracker = new CostTracker();
      const assembler = new ContextAssembler({
        context: new NoopContextProvider(),
        memory: new NoopMemoryProvider(),
        codebase: new NoopCodebaseProvider(),
        persona: new NoopPersonaProvider(),
      });
      const runner = new AgentRunner(defaultProvider, assembler, costTracker, providers);
      const memory = new SwarmMemory();
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'fallback task', undefined, defaultProvider, providers);
      const events = await collectEvents(executor.execute());

      const receivedContent: Record<string, string> = {};
      for (const event of events) {
        if (event.type === 'agent_chunk') {
          receivedContent[event.nodeId] = (receivedContent[event.nodeId] ?? '') + event.content;
        }
      }

      // Should fall back to default provider since 'nonexistent' is not in the map
      expect(receivedContent['a']).toBe('default');

      const doneEvents = eventsOfType(events, 'swarm_done');
      expect(doneEvents).toHaveLength(1);
    });
  });
});
