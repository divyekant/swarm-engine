import type { SwarmEvent, NodeResult, CostSummary } from '../types.js';
import type { AgentRunner } from '../agent/runner.js';
import type { CostTracker } from '../cost/tracker.js';
import type { SwarmMemory } from '../memory/index.js';
import { DAGGraph } from './graph.js';
import { Scheduler } from './scheduler.js';

/**
 * DAGExecutor orchestrates the execution of a full DAG.
 *
 * It uses the Scheduler to determine which nodes are ready, runs them
 * via AgentRunner (in parallel when multiple nodes are ready), and
 * yields SwarmEvents throughout the process.
 *
 * Supports:
 * - Sequential pipelines (A -> B -> C)
 * - Parallel fan-out/fan-in (A -> B,C -> D)
 * - Budget tracking with warnings at 80% and hard stop at limit
 * - Cancellation via AbortSignal
 * - Failure propagation (downstream nodes are skipped)
 */
export class DAGExecutor {
  private readonly graph: DAGGraph;
  private readonly runner: AgentRunner;
  private readonly costTracker: CostTracker;
  private readonly memory: SwarmMemory;
  private readonly task: string;
  private readonly signal?: AbortSignal;

  constructor(
    graph: DAGGraph,
    runner: AgentRunner,
    costTracker: CostTracker,
    memory: SwarmMemory,
    task: string,
    signal?: AbortSignal,
  ) {
    this.graph = graph;
    this.runner = runner;
    this.costTracker = costTracker;
    this.memory = memory;
    this.task = task;
    this.signal = signal;
  }

  async *execute(): AsyncGenerator<SwarmEvent> {
    const scheduler = new Scheduler(this.graph);
    const results: NodeResult[] = [];
    const outputs = new Map<string, { agentRole: string; output: string }>();
    const completedNodeIds: string[] = [];

    yield {
      type: 'swarm_start',
      dagId: this.graph.id,
      nodeCount: this.graph.nodes.length,
    };

    try {
      while (!scheduler.isDone()) {
        // Check cancellation before scheduling next batch
        if (this.signal?.aborted) {
          yield {
            type: 'swarm_cancelled',
            completedNodes: completedNodeIds,
            partialCost: this.costTracker.getSwarmTotal(),
          };
          return;
        }

        const readyNodes = scheduler.getReadyNodes();

        if (readyNodes.length === 0) {
          // No nodes are ready and we're not done -- all remaining nodes
          // are either running (shouldn't happen in our sequential loop)
          // or blocked due to failed/skipped dependencies.
          // Mark any pending nodes whose dependencies include a failed/skipped
          // node as skipped, then continue the loop.
          let skippedAny = false;
          for (const node of this.graph.nodes) {
            if (scheduler.getStatus(node.id) !== 'pending') continue;

            const incoming = this.graph.getIncomingEdges(node.id);
            const blocked = incoming.some((edge) => {
              const status = scheduler.getStatus(edge.from);
              return status === 'failed' || status === 'skipped';
            });

            if (blocked) {
              scheduler.markSkipped(node.id);
              skippedAny = true;
            }
          }

          // If we couldn't skip anything and there are no ready nodes,
          // we have a deadlock -- break out.
          if (!skippedAny) {
            break;
          }
          continue;
        }

        // Mark all ready nodes as running
        for (const node of readyNodes) {
          scheduler.markRunning(node.id);
        }

        if (readyNodes.length === 1) {
          // Sequential execution -- single node
          const node = readyNodes[0];
          yield* this.runNode(node.id, scheduler, results, outputs, completedNodeIds);
        } else {
          // Parallel execution -- multiple nodes ready at once
          yield* this.runNodesParallel(readyNodes.map(n => n.id), scheduler, results, outputs, completedNodeIds);
        }

        // Check budget after completing a batch
        const budgetEvent = this.checkBudgetThresholds();
        if (budgetEvent) {
          yield budgetEvent;
          if (budgetEvent.type === 'budget_exceeded') {
            yield {
              type: 'swarm_error',
              message: 'Budget exceeded',
              completedNodes: completedNodeIds,
              partialCost: this.costTracker.getSwarmTotal(),
            };
            return;
          }
        }
      }

      yield {
        type: 'swarm_done',
        results,
        totalCost: this.costTracker.getSwarmTotal(),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      yield {
        type: 'swarm_error',
        message,
        completedNodes: completedNodeIds,
        partialCost: this.costTracker.getSwarmTotal(),
      };
    }
  }

  /**
   * Run a single node, yielding all events from the AgentRunner.
   * Updates scheduler status and collects results.
   */
  private async *runNode(
    nodeId: string,
    scheduler: Scheduler,
    results: NodeResult[],
    outputs: Map<string, { agentRole: string; output: string }>,
    completedNodeIds: string[],
  ): AsyncGenerator<SwarmEvent> {
    const node = this.graph.getNode(nodeId);
    if (!node) {
      scheduler.markFailed(nodeId);
      return;
    }

    // Collect upstream outputs
    const upstreamOutputs = this.getUpstreamOutputs(nodeId, outputs);

    const startTime = Date.now();

    try {
      let lastDoneEvent: Extract<SwarmEvent, { type: 'agent_done' }> | null = null;

      for await (const event of this.runner.run({
        nodeId,
        agent: node.agent,
        task: node.task ?? this.task,
        memory: this.memory,
        upstreamOutputs,
        signal: this.signal,
      })) {
        yield event;

        if (event.type === 'agent_done') {
          lastDoneEvent = event;
        }

        if (event.type === 'agent_error') {
          scheduler.markFailed(nodeId);
          this.skipDownstream(nodeId, scheduler);
          // Emit progress
          yield this.progressEvent(scheduler, completedNodeIds);
          return;
        }
      }

      if (lastDoneEvent) {
        scheduler.markCompleted(nodeId);
        completedNodeIds.push(nodeId);
        outputs.set(nodeId, {
          agentRole: lastDoneEvent.agentRole,
          output: lastDoneEvent.output,
        });
        results.push({
          nodeId,
          agentRole: lastDoneEvent.agentRole,
          output: lastDoneEvent.output,
          artifactRequest: lastDoneEvent.artifactRequest,
          cost: lastDoneEvent.cost,
          durationMs: Date.now() - startTime,
        });
      } else {
        // No agent_done event was received -- treat as failure
        scheduler.markFailed(nodeId);
        this.skipDownstream(nodeId, scheduler);
      }

      yield this.progressEvent(scheduler, completedNodeIds);
    } catch (err: unknown) {
      scheduler.markFailed(nodeId);
      this.skipDownstream(nodeId, scheduler);

      const message = err instanceof Error ? err.message : String(err);
      yield {
        type: 'agent_error' as const,
        nodeId,
        agentRole: node.agent.role,
        message,
        errorType: 'unknown' as const,
      };
      yield this.progressEvent(scheduler, completedNodeIds);
    }
  }

  /**
   * Run multiple nodes in parallel, collecting all events.
   *
   * Uses Promise.all to run all agent runners concurrently.
   * Events are collected per node and then yielded in completion order.
   */
  private async *runNodesParallel(
    nodeIds: string[],
    scheduler: Scheduler,
    results: NodeResult[],
    outputs: Map<string, { agentRole: string; output: string }>,
    completedNodeIds: string[],
  ): AsyncGenerator<SwarmEvent> {
    // Collect all events from each parallel node execution
    const nodeEventSets: Map<string, SwarmEvent[]> = new Map();

    const promises = nodeIds.map(async (nodeId) => {
      const events: SwarmEvent[] = [];
      const node = this.graph.getNode(nodeId);
      if (!node) {
        scheduler.markFailed(nodeId);
        return { nodeId, events };
      }

      const upstreamOutputs = this.getUpstreamOutputs(nodeId, outputs);
      const startTime = Date.now();

      try {
        let lastDoneEvent: Extract<SwarmEvent, { type: 'agent_done' }> | null = null;

        for await (const event of this.runner.run({
          nodeId,
          agent: node.agent,
          task: node.task ?? this.task,
          memory: this.memory,
          upstreamOutputs,
          signal: this.signal,
        })) {
          events.push(event);

          if (event.type === 'agent_done') {
            lastDoneEvent = event;
          }

          if (event.type === 'agent_error') {
            scheduler.markFailed(nodeId);
            this.skipDownstream(nodeId, scheduler);
            return { nodeId, events };
          }
        }

        if (lastDoneEvent) {
          scheduler.markCompleted(nodeId);
          completedNodeIds.push(nodeId);
          outputs.set(nodeId, {
            agentRole: lastDoneEvent.agentRole,
            output: lastDoneEvent.output,
          });
          results.push({
            nodeId,
            agentRole: lastDoneEvent.agentRole,
            output: lastDoneEvent.output,
            artifactRequest: lastDoneEvent.artifactRequest,
            cost: lastDoneEvent.cost,
            durationMs: Date.now() - startTime,
          });
        } else {
          scheduler.markFailed(nodeId);
          this.skipDownstream(nodeId, scheduler);
        }
      } catch (err: unknown) {
        scheduler.markFailed(nodeId);
        this.skipDownstream(nodeId, scheduler);

        const message = err instanceof Error ? err.message : String(err);
        events.push({
          type: 'agent_error',
          nodeId,
          agentRole: node.agent.role,
          message,
          errorType: 'unknown',
        });
      }

      return { nodeId, events };
    });

    const settled = await Promise.all(promises);

    // Yield all collected events from each node in order
    for (const { events } of settled) {
      for (const event of events) {
        yield event;
      }
    }

    // Emit a single progress event after the entire parallel batch
    yield this.progressEvent(scheduler, completedNodeIds);
  }

  /**
   * Get upstream outputs for a node by looking at its incoming edges.
   */
  private getUpstreamOutputs(
    nodeId: string,
    outputs: Map<string, { agentRole: string; output: string }>,
  ): { nodeId: string; agentRole: string; output: string }[] {
    const incoming = this.graph.getIncomingEdges(nodeId);
    const upstream: { nodeId: string; agentRole: string; output: string }[] = [];

    for (const edge of incoming) {
      const result = outputs.get(edge.from);
      if (result) {
        upstream.push({
          nodeId: edge.from,
          agentRole: result.agentRole,
          output: result.output,
        });
      }
    }

    return upstream;
  }

  /**
   * Mark all downstream nodes of a failed node as skipped.
   */
  private skipDownstream(failedNodeId: string, scheduler: Scheduler): void {
    const outgoing = this.graph.getOutgoingEdges(failedNodeId);
    for (const edge of outgoing) {
      const status = scheduler.getStatus(edge.to);
      if (status === 'pending') {
        scheduler.markSkipped(edge.to);
        // Recursively skip further downstream
        this.skipDownstream(edge.to, scheduler);
      }
    }
  }

  /**
   * Build a swarm_progress event from the current scheduler state.
   */
  private progressEvent(
    scheduler: Scheduler,
    completedNodeIds: string[],
  ): Extract<SwarmEvent, { type: 'swarm_progress' }> {
    const counts = scheduler.getStatusCounts();
    const runningNodes: string[] = [];
    for (const node of this.graph.nodes) {
      if (scheduler.getStatus(node.id) === 'running') {
        runningNodes.push(node.id);
      }
    }

    return {
      type: 'swarm_progress',
      completed: counts.completed,
      total: this.graph.nodes.length,
      runningNodes,
    };
  }

  /**
   * Check budget thresholds and return a budget event if needed.
   * Returns budget_warning at 80%, budget_exceeded at 100%.
   */
  private checkBudgetThresholds(): SwarmEvent | null {
    const budget = this.costTracker.checkBudget();

    // No budget set
    if (budget.remaining === Infinity) {
      return null;
    }

    const limit = budget.used + budget.remaining;
    const percentUsed = (budget.used / limit) * 100;

    if (!budget.ok) {
      return {
        type: 'budget_exceeded',
        used: budget.used,
        limit,
      };
    }

    if (percentUsed >= 80) {
      return {
        type: 'budget_warning',
        used: budget.used,
        limit,
        percentUsed: Math.round(percentUsed),
      };
    }

    return null;
  }
}
