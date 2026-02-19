import { describe, it, expect } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';
import { DAGGraph } from '../../src/dag/graph.js';
import { DAGExecutor } from '../../src/dag/executor.js';
import { Scheduler } from '../../src/dag/scheduler.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { SwarmMemory } from '../../src/memory/index.js';
import type { AgentRunner, AgentRunParams } from '../../src/agent/runner.js';
import type { SwarmEvent, AgentDescriptor, CostSummary, DAGNode, DAGEdge } from '../../src/types.js';

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
 * Build a mock AgentRunner that returns per-node outputs.
 * The `outputMap` maps nodeId -> output text.
 */
function createMockRunner(
  outputMap: Record<string, string>,
  options?: {
    failNodes?: Set<string>;
    runCounts?: Map<string, number>;
  },
): AgentRunner {
  const runner = {
    async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
      const { nodeId, agent: agentDesc } = params;

      if (options?.runCounts) {
        options.runCounts.set(nodeId, (options.runCounts.get(nodeId) ?? 0) + 1);
      }

      yield {
        type: 'agent_start',
        nodeId,
        agentRole: agentDesc.role,
        agentName: agentDesc.name,
      };

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

/** Collect all events from an async generator into an array. */
async function collectEvents(gen: AsyncGenerator<SwarmEvent>): Promise<SwarmEvent[]> {
  const events: SwarmEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Filter events by type. */
function eventsOfType<T extends SwarmEvent['type']>(
  events: SwarmEvent[],
  type: T,
): Extract<SwarmEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<SwarmEvent, { type: T }>[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dynamic Planning — Coordinator Emits DAG', () => {
  describe('DAGGraph.addNode() and DAGGraph.addEdge()', () => {
    it('addNode adds a node to the graph', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);

      expect(graph.nodes).toHaveLength(1);

      const newNode: DAGNode = { id: 'b', agent: agent('b') };
      graph.addNode(newNode);

      expect(graph.nodes).toHaveLength(2);
      expect(graph.getNode('b')).toBe(newNode);
    });

    it('addEdge adds an edge to the graph', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .build();
      const graph = new DAGGraph(dag);

      expect(graph.edges).toHaveLength(0);

      const newEdge: DAGEdge = { from: 'a', to: 'b' };
      graph.addEdge(newEdge);

      expect(graph.edges).toHaveLength(1);
      expect(graph.getOutgoingEdges('a')).toHaveLength(1);
      expect(graph.getIncomingEdges('b')).toHaveLength(1);
    });

    it('addNode makes the node discoverable via getNode and getRootNodes', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);

      graph.addNode({ id: 'dynamic', agent: agent('dynamic') });

      // Both nodes are roots (no incoming edges)
      const roots = graph.getRootNodes();
      expect(roots).toHaveLength(2);
      expect(roots.map((n) => n.id).sort()).toEqual(['a', 'dynamic']);
    });

    it('addEdge affects getLeafNodes correctly', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);

      // a is initially both root and leaf
      expect(graph.getLeafNodes()).toHaveLength(1);

      graph.addNode({ id: 'b', agent: agent('b') });
      graph.addEdge({ from: 'a', to: 'b' });

      // Now only b is a leaf
      const leaves = graph.getLeafNodes();
      expect(leaves).toHaveLength(1);
      expect(leaves[0].id).toBe('b');
    });
  });

  describe('Scheduler.registerNode()', () => {
    it('registers a new node as pending', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      // Add node to graph first, then register with scheduler
      graph.addNode({ id: 'new-node', agent: agent('new-node') });
      scheduler.registerNode('new-node');

      expect(scheduler.getStatus('new-node')).toBe('pending');
    });

    it('throws if the node is already registered', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(() => scheduler.registerNode('a')).toThrow('Node "a" already registered');
    });

    it('registered node becomes ready when dependencies are met', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      // Complete node a
      scheduler.markRunning('a');
      scheduler.markCompleted('a');

      // Dynamically add node b with edge a -> b
      graph.addNode({ id: 'b', agent: agent('b') });
      graph.addEdge({ from: 'a', to: 'b' });
      scheduler.registerNode('b');

      // b should be ready because its dependency (a) is completed
      const ready = scheduler.getReadyNodes();
      expect(ready.map((n) => n.id)).toContain('b');
    });

    it('registered node is not ready if dependencies are not completed', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      // a is still pending
      graph.addNode({ id: 'b', agent: agent('b') });
      graph.addEdge({ from: 'a', to: 'b' });
      scheduler.registerNode('b');

      // b should not be ready because a is still pending
      const ready = scheduler.getReadyNodes();
      expect(ready.map((n) => n.id)).not.toContain('b');
    });

    it('isDone returns false after registering a new pending node', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markRunning('a');
      scheduler.markCompleted('a');
      expect(scheduler.isDone()).toBe(true);

      graph.addNode({ id: 'b', agent: agent('b') });
      scheduler.registerNode('b');
      expect(scheduler.isDone()).toBe(false);
    });
  });

  describe('Coordinator emits sub-DAG', () => {
    it('coordinator output is parsed and new nodes are executed', async () => {
      // The coordinator emits a JSON DAG with two sub-nodes
      const subDAG = JSON.stringify({
        nodes: [
          { id: 'sub-1', agent: agent('sub-worker-1') },
          { id: 'sub-2', agent: agent('sub-worker-2') },
        ],
        edges: [
          { from: 'coordinator', to: 'sub-1' },
          { from: 'coordinator', to: 'sub-2' },
        ],
      });

      const dag = new DAGBuilder()
        .agent('coordinator', agent('coordinator'))
        .dynamicExpansion('coordinator')
        .build();
      const graph = new DAGGraph(dag);

      const runCounts = new Map<string, number>();
      const runner = createMockRunner(
        { coordinator: subDAG, 'sub-1': 'result-1', 'sub-2': 'result-2' },
        { runCounts },
      );
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'dynamic task');
      const events = await collectEvents(executor.execute());

      // Coordinator ran once
      expect(runCounts.get('coordinator')).toBe(1);

      // Both sub-nodes should have been executed
      expect(runCounts.get('sub-1')).toBe(1);
      expect(runCounts.get('sub-2')).toBe(1);

      // All three nodes should have agent_done events
      const doneEvents = eventsOfType(events, 'agent_done');
      const doneNodeIds = doneEvents.map((e) => e.nodeId).sort();
      expect(doneNodeIds).toEqual(['coordinator', 'sub-1', 'sub-2']);

      // Swarm should complete successfully
      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
      expect(swarmDone[0].results).toHaveLength(3);
    });

    it('sub-DAG forms a pipeline: coordinator -> sub-1 -> sub-2', async () => {
      const subDAG = JSON.stringify({
        nodes: [
          { id: 'sub-1', agent: agent('sub-worker-1') },
          { id: 'sub-2', agent: agent('sub-worker-2') },
        ],
        edges: [
          { from: 'coordinator', to: 'sub-1' },
          { from: 'sub-1', to: 'sub-2' },
        ],
      });

      const dag = new DAGBuilder()
        .agent('coordinator', agent('coordinator'))
        .dynamicExpansion('coordinator')
        .build();
      const graph = new DAGGraph(dag);

      const executionOrder: string[] = [];
      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc } = params;
          executionOrder.push(nodeId);

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          const output = nodeId === 'coordinator' ? subDAG : `output-${nodeId}`;

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
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'pipeline dynamic');
      const events = await collectEvents(executor.execute());

      // Should execute in order: coordinator, sub-1, sub-2
      expect(executionOrder).toEqual(['coordinator', 'sub-1', 'sub-2']);

      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
    });
  });

  describe('Dynamic nodes connect to existing downstream', () => {
    it('existing downstream waits for dynamically added nodes', async () => {
      // coordinator -> downstream (static edge)
      // coordinator emits sub-1, and adds sub-1 -> downstream edge
      // So downstream should wait for both coordinator AND sub-1
      const subDAG = JSON.stringify({
        nodes: [
          { id: 'sub-1', agent: agent('sub-worker') },
        ],
        edges: [
          { from: 'coordinator', to: 'sub-1' },
          { from: 'sub-1', to: 'downstream' },
        ],
      });

      const dag = new DAGBuilder()
        .agent('coordinator', agent('coordinator'))
        .agent('downstream', agent('downstream'))
        .edge('coordinator', 'downstream')
        .dynamicExpansion('coordinator')
        .build();
      const graph = new DAGGraph(dag);

      const executionOrder: string[] = [];
      let downstreamUpstream: string[] = [];

      const runner = {
        async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
          const { nodeId, agent: agentDesc, upstreamOutputs } = params;
          executionOrder.push(nodeId);

          if (nodeId === 'downstream') {
            downstreamUpstream = (upstreamOutputs ?? []).map((u) => u.nodeId).sort();
          }

          yield {
            type: 'agent_start',
            nodeId,
            agentRole: agentDesc.role,
            agentName: agentDesc.name,
          };

          const output = nodeId === 'coordinator' ? subDAG : `output-${nodeId}`;

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
      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'downstream wait');
      const events = await collectEvents(executor.execute());

      // coordinator runs first, then sub-1, then downstream
      expect(executionOrder).toEqual(['coordinator', 'sub-1', 'downstream']);

      // downstream should have received outputs from both coordinator and sub-1
      expect(downstreamUpstream).toEqual(['coordinator', 'sub-1']);

      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
      expect(swarmDone[0].results).toHaveLength(3);
    });
  });

  describe('Invalid JSON output gracefully handled', () => {
    it('non-JSON output from canEmitDAG node does not crash', async () => {
      const dag = new DAGBuilder()
        .agent('coordinator', agent('coordinator'))
        .dynamicExpansion('coordinator')
        .build();
      const graph = new DAGGraph(dag);

      // Coordinator outputs plain text, not JSON
      const runner = createMockRunner({ coordinator: 'this is not json' });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'invalid json');
      const events = await collectEvents(executor.execute());

      // Should complete without errors
      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
      expect(swarmDone[0].results).toHaveLength(1);

      // No swarm_error
      const errors = eventsOfType(events, 'swarm_error');
      expect(errors).toHaveLength(0);
    });

    it('JSON without nodes/edges arrays is silently skipped', async () => {
      const dag = new DAGBuilder()
        .agent('coordinator', agent('coordinator'))
        .dynamicExpansion('coordinator')
        .build();
      const graph = new DAGGraph(dag);

      // Valid JSON but wrong shape
      const runner = createMockRunner({
        coordinator: JSON.stringify({ message: 'hello', count: 42 }),
      });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'wrong shape');
      const events = await collectEvents(executor.execute());

      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
      expect(swarmDone[0].results).toHaveLength(1);

      // No additional nodes were added to the graph
      expect(graph.nodes).toHaveLength(1);
    });

    it('JSON with nodes but no edges is silently skipped', async () => {
      const dag = new DAGBuilder()
        .agent('coordinator', agent('coordinator'))
        .dynamicExpansion('coordinator')
        .build();
      const graph = new DAGGraph(dag);

      const runner = createMockRunner({
        coordinator: JSON.stringify({ nodes: [{ id: 'x', agent: agent('x') }] }),
      });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'missing edges');
      const events = await collectEvents(executor.execute());

      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);

      // No new nodes should have been added (edges field is missing)
      expect(graph.nodes).toHaveLength(1);
    });

    it('nodes without id or agent are skipped individually', async () => {
      const subDAG = JSON.stringify({
        nodes: [
          { id: 'valid', agent: agent('valid-worker') },
          { id: 'no-agent' },          // missing agent — skipped
          { agent: agent('no-id') },    // missing id — skipped
        ],
        edges: [
          { from: 'coordinator', to: 'valid' },
        ],
      });

      const dag = new DAGBuilder()
        .agent('coordinator', agent('coordinator'))
        .dynamicExpansion('coordinator')
        .build();
      const graph = new DAGGraph(dag);

      const runner = createMockRunner({
        coordinator: subDAG,
        valid: 'valid-result',
      });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'partial nodes');
      const events = await collectEvents(executor.execute());

      // Only the valid node should have been added (coordinator + valid = 2)
      expect(graph.nodes).toHaveLength(2);

      const doneEvents = eventsOfType(events, 'agent_done');
      const doneNodeIds = doneEvents.map((e) => e.nodeId).sort();
      expect(doneNodeIds).toEqual(['coordinator', 'valid']);
    });

    it('edges without from or to are skipped individually', async () => {
      const subDAG = JSON.stringify({
        nodes: [
          { id: 'sub-1', agent: agent('sub-worker') },
        ],
        edges: [
          { from: 'coordinator', to: 'sub-1' },
          { from: 'sub-1' },                       // missing to — skipped
          { to: 'sub-1' },                          // missing from — skipped
        ],
      });

      const dag = new DAGBuilder()
        .agent('coordinator', agent('coordinator'))
        .dynamicExpansion('coordinator')
        .build();
      const graph = new DAGGraph(dag);

      const runner = createMockRunner({
        coordinator: subDAG,
        'sub-1': 'result',
      });
      const costTracker = new CostTracker();
      const memory = new SwarmMemory();

      const executor = new DAGExecutor(graph, runner, costTracker, memory, 'partial edges');
      const events = await collectEvents(executor.execute());

      // Only the valid edge should have been added
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toEqual({ from: 'coordinator', to: 'sub-1' });

      const swarmDone = eventsOfType(events, 'swarm_done');
      expect(swarmDone).toHaveLength(1);
    });
  });
});
