import type { SwarmEvent, NodeResult, CostSummary, ProviderAdapter } from '../types.js';
import type { AgentRunner } from '../agent/runner.js';
import type { CostTracker } from '../cost/tracker.js';
import type { SwarmMemory } from '../memory/index.js';
import { DAGGraph } from './graph.js';
import { Scheduler } from './scheduler.js';
import { evaluate } from '../agent/evaluator.js';

export interface ExecutorLimits {
  maxConcurrentAgents?: number;
  maxSwarmDurationMs?: number;
}

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
 * - Conditional routing via evaluators (rule, regex, LLM)
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
  private readonly provider?: ProviderAdapter;
  private readonly providers: Map<string, ProviderAdapter>;
  private readonly limits: ExecutorLimits;
  private readonly startTime: number;

  /** Nodes that are targets of conditional edges and haven't been resolved yet. */
  private readonly conditionallyBlocked: Set<string> = new Set();

  constructor(
    graph: DAGGraph,
    runner: AgentRunner,
    costTracker: CostTracker,
    memory: SwarmMemory,
    task: string,
    signal?: AbortSignal,
    provider?: ProviderAdapter,
    providers?: Map<string, ProviderAdapter>,
    limits?: ExecutorLimits,
  ) {
    this.graph = graph;
    this.runner = runner;
    this.costTracker = costTracker;
    this.memory = memory;
    this.task = task;
    this.signal = signal;
    this.provider = provider;
    this.providers = providers ?? new Map();
    this.limits = limits ?? {};
    this.startTime = Date.now();

    // Pre-compute the set of nodes that are targets of conditional edges.
    // These nodes must not run until their conditional edge is evaluated.
    for (const ce of graph.conditionalEdges) {
      for (const targetNodeId of Object.values(ce.targets)) {
        this.conditionallyBlocked.add(targetNodeId);
      }
    }
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

        // Check duration limit
        if (this.limits.maxSwarmDurationMs) {
          const elapsed = Date.now() - this.startTime;
          if (elapsed >= this.limits.maxSwarmDurationMs) {
            yield {
              type: 'swarm_error',
              message: `Swarm duration limit exceeded (${elapsed}ms >= ${this.limits.maxSwarmDurationMs}ms)`,
              completedNodes: completedNodeIds,
              partialCost: this.costTracker.getSwarmTotal(),
            };
            return;
          }
        }

        // Filter out conditionally blocked nodes from the ready set
        let readyNodes = scheduler.getReadyNodes().filter(
          (n) => !this.conditionallyBlocked.has(n.id),
        );

        // Cap concurrency
        if (this.limits.maxConcurrentAgents && readyNodes.length > this.limits.maxConcurrentAgents) {
          readyNodes = readyNodes.slice(0, this.limits.maxConcurrentAgents);
        }

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

        // Check per-agent budget
        const agentBudget = this.costTracker.checkAgentBudget(node.agent.id);
        if (!agentBudget.ok) {
          yield {
            type: 'budget_exceeded',
            used: agentBudget.used,
            limit: this.costTracker.perAgentBudget!,
          };
        }

        // Evaluate conditional edges originating from this node
        yield* this.evaluateConditionalEdges(nodeId, lastDoneEvent.output, scheduler);

        // Handle cycle edges originating from this node
        yield* this.handleCycleEdges(nodeId, scheduler);

        // Handle dynamic DAG expansion
        if (node.canEmitDAG) {
          yield* this.handleDynamicExpansion(nodeId, lastDoneEvent.output, scheduler);
        }
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

          // Check per-agent budget
          const agentBudget = this.costTracker.checkAgentBudget(node.agent.id);
          if (!agentBudget.ok) {
            events.push({
              type: 'budget_exceeded',
              used: agentBudget.used,
              limit: this.costTracker.perAgentBudget!,
            });
          }

          // Evaluate conditional edges originating from this node
          for await (const routeEvent of this.evaluateConditionalEdges(
            nodeId,
            lastDoneEvent.output,
            scheduler,
          )) {
            events.push(routeEvent);
          }

          // Handle cycle edges originating from this node
          for await (const cycleEvent of this.handleCycleEdges(nodeId, scheduler)) {
            events.push(cycleEvent);
          }

          // Handle dynamic DAG expansion
          if (node.canEmitDAG) {
            for await (const dynEvent of this.handleDynamicExpansion(nodeId, lastDoneEvent.output, scheduler)) {
              events.push(dynEvent);
            }
          }
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
   * Get upstream outputs for a node by looking at its incoming regular edges
   * and any resolved conditional edges that selected this node.
   */
  private getUpstreamOutputs(
    nodeId: string,
    outputs: Map<string, { agentRole: string; output: string }>,
  ): { nodeId: string; agentRole: string; output: string }[] {
    const upstream: { nodeId: string; agentRole: string; output: string }[] = [];
    const seen = new Set<string>();

    // Regular incoming edges
    const incoming = this.graph.getIncomingEdges(nodeId);
    for (const edge of incoming) {
      const result = outputs.get(edge.from);
      if (result && !seen.has(edge.from)) {
        seen.add(edge.from);
        upstream.push({
          nodeId: edge.from,
          agentRole: result.agentRole,
          output: result.output,
        });
      }
    }

    // Conditional edges that target this node
    for (const ce of this.graph.conditionalEdges) {
      const isTarget = Object.values(ce.targets).includes(nodeId);
      if (isTarget && !seen.has(ce.from)) {
        const result = outputs.get(ce.from);
        if (result) {
          seen.add(ce.from);
          upstream.push({
            nodeId: ce.from,
            agentRole: result.agentRole,
            output: result.output,
          });
        }
      }
    }

    return upstream;
  }

  /**
   * Mark all downstream nodes of a failed node as skipped.
   * Checks both regular edges and conditional edge targets.
   */
  private skipDownstream(failedNodeId: string, scheduler: Scheduler): void {
    // Skip regular downstream nodes
    const outgoing = this.graph.getOutgoingEdges(failedNodeId);
    for (const edge of outgoing) {
      const status = scheduler.getStatus(edge.to);
      if (status === 'pending') {
        scheduler.markSkipped(edge.to);
        this.conditionallyBlocked.delete(edge.to);
        // Recursively skip further downstream
        this.skipDownstream(edge.to, scheduler);
      }
    }

    // Skip conditional downstream nodes
    const conditionalEdges = this.graph.getConditionalEdges(failedNodeId);
    for (const ce of conditionalEdges) {
      for (const targetNodeId of Object.values(ce.targets)) {
        const status = scheduler.getStatus(targetNodeId);
        if (status === 'pending') {
          scheduler.markSkipped(targetNodeId);
          this.conditionallyBlocked.delete(targetNodeId);
          this.skipDownstream(targetNodeId, scheduler);
        }
      }
    }
  }

  /**
   * Evaluate all conditional edges originating from a completed node.
   *
   * For each conditional edge:
   * 1. Run the evaluator to determine which target label was selected
   * 2. Look up the target node ID from the targets map
   * 3. Unblock the selected target so it can be scheduled
   * 4. Skip all non-selected targets (and their downstream)
   * 5. Emit a route_decision event
   */
  private async *evaluateConditionalEdges(
    nodeId: string,
    output: string,
    scheduler: Scheduler,
  ): AsyncGenerator<SwarmEvent> {
    const conditionalEdges = this.graph.getConditionalEdges(nodeId);
    if (conditionalEdges.length === 0) return;

    for (const ce of conditionalEdges) {
      // Resolve the evaluator's provider: use evaluator's providerId if available, else default
      const evalProvider = (ce.evaluate.type === 'llm' && ce.evaluate.providerId)
        ? (this.providers.get(ce.evaluate.providerId) ?? this.provider)
        : this.provider;

      // Evaluate to get either a target label (from targets map) or a direct node ID
      const evaluatorResult = await evaluate(ce.evaluate, output, evalProvider);

      // The result could be a label key in the targets map or a direct node ID
      let selectedNodeId: string | undefined;
      let reason = evaluatorResult;

      if (ce.targets[evaluatorResult] !== undefined) {
        // Result is a label key in the targets map
        selectedNodeId = ce.targets[evaluatorResult];
        reason = evaluatorResult;
      } else {
        // Result might be a direct node ID (if the evaluator returns node IDs directly)
        const targetNodeIds = Object.values(ce.targets);
        if (targetNodeIds.includes(evaluatorResult)) {
          selectedNodeId = evaluatorResult;
          // Find the label for the reason
          const entry = Object.entries(ce.targets).find(([, v]) => v === evaluatorResult);
          reason = entry ? entry[0] : evaluatorResult;
        }
      }

      if (selectedNodeId) {
        // Unblock the selected target
        this.conditionallyBlocked.delete(selectedNodeId);

        // Skip all non-selected targets
        for (const [label, targetNodeId] of Object.entries(ce.targets)) {
          if (targetNodeId !== selectedNodeId) {
            const status = scheduler.getStatus(targetNodeId);
            if (status === 'pending') {
              scheduler.markSkipped(targetNodeId);
              this.conditionallyBlocked.delete(targetNodeId);
              this.skipDownstream(targetNodeId, scheduler);
            }
          }
        }

        yield {
          type: 'route_decision',
          fromNode: nodeId,
          toNode: selectedNodeId,
          reason,
        };
      } else {
        // No valid target found -- skip all conditional targets
        for (const targetNodeId of Object.values(ce.targets)) {
          const status = scheduler.getStatus(targetNodeId);
          if (status === 'pending') {
            scheduler.markSkipped(targetNodeId);
            this.conditionallyBlocked.delete(targetNodeId);
            this.skipDownstream(targetNodeId, scheduler);
          }
        }
      }
    }
  }

  /**
   * Handle cycle edges targeting a completed node.
   *
   * When a node completes, check its incoming edges for cycle edges (maxCycles set).
   * For each cycle edge where this node is the target:
   * 1. Increment the cycle count (tracks how many times this node has completed for this edge)
   * 2. Emit a loop_iteration event for every iteration
   * 3. If iteration < maxCycles: reset this node to 'pending' so it runs again
   * 4. If iteration >= maxCycles: the node stays completed and downstream proceeds normally
   */
  private async *handleCycleEdges(
    nodeId: string,
    scheduler: Scheduler,
  ): AsyncGenerator<SwarmEvent> {
    const incoming = this.graph.getIncomingEdges(nodeId);

    for (const edge of incoming) {
      if (edge.maxCycles === undefined) continue;

      const iteration = scheduler.incrementCycleCount(edge.from, edge.to);

      yield {
        type: 'loop_iteration',
        nodeId,
        iteration,
        maxIterations: edge.maxCycles,
      };

      if (iteration < edge.maxCycles) {
        scheduler.resetNodeForCycle(nodeId);
      }
    }
  }

  /**
   * Handle dynamic DAG expansion from a coordinator node.
   *
   * When a node with `canEmitDAG: true` completes, its output is parsed as JSON.
   * If valid, the new nodes and edges are merged into the running graph and
   * registered with the scheduler so they become schedulable in the next loop iteration.
   */
  private async *handleDynamicExpansion(
    nodeId: string,
    output: string,
    scheduler: Scheduler,
  ): AsyncGenerator<SwarmEvent> {
    try {
      const parsed = JSON.parse(output);

      // Validate shape
      if (
        !parsed.nodes ||
        !Array.isArray(parsed.nodes) ||
        !parsed.edges ||
        !Array.isArray(parsed.edges)
      ) {
        return; // silently skip if not a valid DAG shape
      }

      // Add new nodes to graph and scheduler
      for (const node of parsed.nodes) {
        if (!node.id || !node.agent) continue; // skip invalid nodes
        this.graph.addNode(node);
        scheduler.registerNode(node.id);
      }

      // Add new edges to graph
      for (const edge of parsed.edges) {
        if (!edge.from || !edge.to) continue; // skip invalid edges
        this.graph.addEdge(edge);
      }
    } catch {
      // JSON parse failure — not a DAG output, skip silently
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
