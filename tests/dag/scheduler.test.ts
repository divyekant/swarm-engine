import { describe, it, expect } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';
import { DAGGraph } from '../../src/dag/graph.js';
import { Scheduler } from '../../src/dag/scheduler.js';

/** Helper to create a minimal agent descriptor. */
function agent(id: string) {
  return { id, name: id, role: id, systemPrompt: '' };
}

describe('Scheduler', () => {
  describe('root nodes', () => {
    it('marks root nodes as immediately ready', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      const ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('a');
    });

    it('marks multiple root nodes as ready in a fan-out DAG', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'c')
        .edge('b', 'c')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      const ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(2);
      const ids = ready.map((n) => n.id).sort();
      expect(ids).toEqual(['a', 'b']);
    });

    it('treats a single-node DAG as immediately ready', () => {
      const dag = new DAGBuilder()
        .agent('solo', agent('solo'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      const ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('solo');
    });
  });

  describe('dependency tracking', () => {
    it('nodes become ready when all upstream dependencies complete', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'c')
        .edge('b', 'c')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      // c should not be ready yet
      let ready = scheduler.getReadyNodes();
      expect(ready.map((n) => n.id)).not.toContain('c');

      // Complete only a -- c still has b pending
      scheduler.markRunning('a');
      scheduler.markCompleted('a');
      ready = scheduler.getReadyNodes();
      expect(ready.map((n) => n.id)).not.toContain('c');

      // Complete b -- now c should be ready
      scheduler.markRunning('b');
      scheduler.markCompleted('b');
      ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('c');
    });

    it('a node is not ready if an upstream dependency failed', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markRunning('a');
      scheduler.markFailed('a');

      const ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(0);
    });

    it('a node is not ready if an upstream dependency was skipped', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markSkipped('a');

      const ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(0);
    });

    it('handles a sequential chain correctly', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .edge('a', 'b')
        .edge('b', 'c')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      // Only a is ready
      expect(scheduler.getReadyNodes().map((n) => n.id)).toEqual(['a']);

      scheduler.markRunning('a');
      scheduler.markCompleted('a');

      // Now b is ready
      expect(scheduler.getReadyNodes().map((n) => n.id)).toEqual(['b']);

      scheduler.markRunning('b');
      scheduler.markCompleted('b');

      // Now c is ready
      expect(scheduler.getReadyNodes().map((n) => n.id)).toEqual(['c']);
    });
  });

  describe('concurrency limits', () => {
    it('respects maxConcurrentAgents limit', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph, 2);

      // All three are root nodes, but only 2 should be returned
      const ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(2);
    });

    it('returns no ready nodes when at concurrency limit', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph, 2);

      scheduler.markRunning('a');
      scheduler.markRunning('b');

      const ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(0);
    });

    it('frees concurrency slots when nodes complete', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph, 1);

      // Only 1 ready node due to concurrency limit
      let ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(1);

      const firstId = ready[0].id;
      scheduler.markRunning(firstId);

      // No more slots available
      ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(0);

      // Complete the running node -- slot freed
      scheduler.markCompleted(firstId);
      ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(1);
    });

    it('defaults to unlimited concurrency', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .agent('d', agent('d'))
        .agent('e', agent('e'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      // All 5 root nodes should be ready
      const ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(5);
    });
  });

  describe('status transitions', () => {
    it('initializes all nodes as pending', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(scheduler.getStatus('a')).toBe('pending');
      expect(scheduler.getStatus('b')).toBe('pending');
    });

    it('transitions through running to completed', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(scheduler.getStatus('a')).toBe('pending');
      scheduler.markRunning('a');
      expect(scheduler.getStatus('a')).toBe('running');
      scheduler.markCompleted('a');
      expect(scheduler.getStatus('a')).toBe('completed');
    });

    it('transitions through running to failed', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markRunning('a');
      expect(scheduler.getStatus('a')).toBe('running');
      scheduler.markFailed('a');
      expect(scheduler.getStatus('a')).toBe('failed');
    });

    it('can mark a node as skipped directly', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markSkipped('a');
      expect(scheduler.getStatus('a')).toBe('skipped');
    });

    it('throws on unknown node ID for getStatus', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(() => scheduler.getStatus('nonexistent')).toThrow('Unknown node');
    });

    it('throws on unknown node ID for markRunning', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(() => scheduler.markRunning('nonexistent')).toThrow('Unknown node');
    });

    it('throws on unknown node ID for markCompleted', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(() => scheduler.markCompleted('nonexistent')).toThrow('Unknown node');
    });

    it('throws on unknown node ID for markFailed', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(() => scheduler.markFailed('nonexistent')).toThrow('Unknown node');
    });

    it('throws on unknown node ID for markSkipped', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(() => scheduler.markSkipped('nonexistent')).toThrow('Unknown node');
    });
  });

  describe('isDone', () => {
    it('returns false when nodes are still pending', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      expect(scheduler.isDone()).toBe(false);
    });

    it('returns false when nodes are running', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markRunning('a');
      expect(scheduler.isDone()).toBe(false);
    });

    it('returns true when all nodes are completed', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .edge('a', 'b')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markRunning('a');
      scheduler.markCompleted('a');
      scheduler.markRunning('b');
      scheduler.markCompleted('b');

      expect(scheduler.isDone()).toBe(true);
    });

    it('returns true when all nodes are in terminal states (mix of completed, failed, skipped)', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markRunning('a');
      scheduler.markCompleted('a');
      scheduler.markRunning('b');
      scheduler.markFailed('b');
      scheduler.markSkipped('c');

      expect(scheduler.isDone()).toBe(true);
    });
  });

  describe('getStatusCounts', () => {
    it('reports correct counts for each status', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .agent('d', agent('d'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      // All pending initially
      expect(scheduler.getStatusCounts()).toEqual({
        pending: 4,
        ready: 0,
        running: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
      });

      scheduler.markRunning('a');
      scheduler.markCompleted('b');
      scheduler.markFailed('c');

      expect(scheduler.getStatusCounts()).toEqual({
        pending: 1,
        ready: 0,
        running: 1,
        completed: 1,
        failed: 1,
        skipped: 0,
      });
    });
  });

  describe('complex DAG scenarios', () => {
    it('handles diamond dependency pattern', () => {
      // a -> b -> d
      // a -> c -> d
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
      const scheduler = new Scheduler(graph);

      // Only a is ready
      expect(scheduler.getReadyNodes().map((n) => n.id)).toEqual(['a']);

      scheduler.markRunning('a');
      scheduler.markCompleted('a');

      // b and c are both ready
      const readyAfterA = scheduler.getReadyNodes().map((n) => n.id).sort();
      expect(readyAfterA).toEqual(['b', 'c']);

      // Complete b -- d still not ready (c pending)
      scheduler.markRunning('b');
      scheduler.markCompleted('b');
      expect(scheduler.getReadyNodes().map((n) => n.id)).not.toContain('d');

      // Complete c -- d is now ready
      scheduler.markRunning('c');
      scheduler.markCompleted('c');
      expect(scheduler.getReadyNodes().map((n) => n.id)).toEqual(['d']);
    });

    it('does not return nodes already marked as running', () => {
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph);

      scheduler.markRunning('a');

      const ready = scheduler.getReadyNodes();
      const ids = ready.map((n) => n.id);
      expect(ids).not.toContain('a');
      expect(ids).toContain('b');
    });

    it('handles concurrency across dependency waves', () => {
      // Wave 1: a, b (roots)
      // Wave 2: c depends on a, d depends on b
      const dag = new DAGBuilder()
        .agent('a', agent('a'))
        .agent('b', agent('b'))
        .agent('c', agent('c'))
        .agent('d', agent('d'))
        .edge('a', 'c')
        .edge('b', 'd')
        .build();
      const graph = new DAGGraph(dag);
      const scheduler = new Scheduler(graph, 2);

      // Wave 1: a and b ready
      let ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(2);

      scheduler.markRunning('a');
      scheduler.markRunning('b');

      // At limit -- no more ready
      expect(scheduler.getReadyNodes()).toHaveLength(0);

      // Complete a -- c becomes available, 1 slot open
      scheduler.markCompleted('a');
      ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('c');

      // Complete b -- d also becomes ready (but c already returned above so depends on state)
      scheduler.markRunning('c');
      scheduler.markCompleted('b');
      ready = scheduler.getReadyNodes();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('d');
    });
  });
});
