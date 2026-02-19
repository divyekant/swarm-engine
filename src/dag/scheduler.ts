import type { DAGNode, NodeStatus } from '../types.js';
import type { DAGGraph } from './graph.js';

const TERMINAL_STATUSES: ReadonlySet<NodeStatus> = new Set(['completed', 'failed', 'skipped']);

/**
 * The Scheduler tracks node execution statuses within a DAG and determines
 * which nodes are ready to run based on dependency completion and concurrency limits.
 *
 * Status lifecycle: pending -> ready -> running -> completed | failed | skipped
 */
export class Scheduler {
  private readonly graph: DAGGraph;
  private readonly maxConcurrent: number;
  private readonly statuses: Map<string, NodeStatus>;

  constructor(graph: DAGGraph, maxConcurrent: number = Infinity) {
    this.graph = graph;
    this.maxConcurrent = maxConcurrent;
    this.statuses = new Map();

    // Initialize all nodes as pending
    for (const node of graph.nodes) {
      this.statuses.set(node.id, 'pending');
    }
  }

  /**
   * Get nodes that are ready to run.
   *
   * A node is ready when:
   * 1. It is currently 'pending' (not yet scheduled)
   * 2. All of its upstream dependencies (incoming edges) are in a terminal state (completed, failed, or skipped)
   *    -- specifically, all must be 'completed' for the node to proceed
   * 3. The number of currently running nodes plus the returned ready nodes
   *    does not exceed maxConcurrentAgents
   *
   * Root nodes (no incoming edges) are immediately eligible.
   */
  getReadyNodes(): DAGNode[] {
    const runningCount = this.countByStatus('running');
    const available = this.maxConcurrent - runningCount;

    if (available <= 0) {
      return [];
    }

    const ready: DAGNode[] = [];

    for (const node of this.graph.nodes) {
      if (ready.length >= available) {
        break;
      }

      const status = this.statuses.get(node.id);
      if (status !== 'pending') {
        continue;
      }

      const incomingEdges = this.graph.getIncomingEdges(node.id);

      // A node is ready if all upstream dependencies are completed
      const allDepsCompleted = incomingEdges.every((edge) => {
        const depStatus = this.statuses.get(edge.from);
        return depStatus === 'completed';
      });

      if (allDepsCompleted) {
        ready.push(node);
      }
    }

    return ready;
  }

  /** Mark a node as running. */
  markRunning(nodeId: string): void {
    this.assertNodeExists(nodeId);
    this.statuses.set(nodeId, 'running');
  }

  /** Mark a node as completed. */
  markCompleted(nodeId: string): void {
    this.assertNodeExists(nodeId);
    this.statuses.set(nodeId, 'completed');
  }

  /** Mark a node as failed. */
  markFailed(nodeId: string): void {
    this.assertNodeExists(nodeId);
    this.statuses.set(nodeId, 'failed');
  }

  /** Mark a node as skipped. */
  markSkipped(nodeId: string): void {
    this.assertNodeExists(nodeId);
    this.statuses.set(nodeId, 'skipped');
  }

  /** Get the current status of a node. */
  getStatus(nodeId: string): NodeStatus {
    const status = this.statuses.get(nodeId);
    if (status === undefined) {
      throw new Error(`Unknown node: "${nodeId}"`);
    }
    return status;
  }

  /**
   * Check if all nodes are in a terminal state (completed, failed, or skipped).
   * Returns true when there is no more work to do.
   */
  isDone(): boolean {
    for (const status of this.statuses.values()) {
      if (!TERMINAL_STATUSES.has(status)) {
        return false;
      }
    }
    return true;
  }

  /** Get a count of nodes in each status. */
  getStatusCounts(): Record<NodeStatus, number> {
    const counts: Record<NodeStatus, number> = {
      pending: 0,
      ready: 0,
      running: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    };

    for (const status of this.statuses.values()) {
      counts[status]++;
    }

    return counts;
  }

  /** Count nodes with a specific status. */
  private countByStatus(status: NodeStatus): number {
    let count = 0;
    for (const s of this.statuses.values()) {
      if (s === status) {
        count++;
      }
    }
    return count;
  }

  /** Assert that a node exists in the graph. */
  private assertNodeExists(nodeId: string): void {
    if (!this.statuses.has(nodeId)) {
      throw new Error(`Unknown node: "${nodeId}"`);
    }
  }
}
