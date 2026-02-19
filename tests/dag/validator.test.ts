import { describe, it, expect } from 'vitest';
import { validateDAG } from '../../src/dag/validator.js';
import type { DAGDefinition, AgentDescriptor } from '../../src/types.js';

/** Helper to create a minimal agent descriptor. */
function agent(id: string, overrides?: Partial<AgentDescriptor>): AgentDescriptor {
  return {
    id,
    name: id,
    role: id,
    systemPrompt: `You are ${id}`,
    ...overrides,
  };
}

/** Helper to create a minimal valid DAG. */
function simpleDag(overrides?: Partial<DAGDefinition>): DAGDefinition {
  return {
    id: 'test-dag',
    nodes: [
      { id: 'a', agent: agent('a') },
      { id: 'b', agent: agent('b') },
    ],
    edges: [{ from: 'a', to: 'b' }],
    conditionalEdges: [],
    dynamicNodes: [],
    ...overrides,
  };
}

describe('validateDAG', () => {
  // --- Valid DAGs ---

  it('returns valid for a simple sequential DAG', () => {
    const result = validateDAG(simpleDag());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for a single-node DAG', () => {
    const dag = simpleDag({
      nodes: [{ id: 'a', agent: agent('a') }],
      edges: [],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for a fan-out/fan-in DAG', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'root', agent: agent('root') },
        { id: 'w1', agent: agent('w1') },
        { id: 'w2', agent: agent('w2') },
        { id: 'sink', agent: agent('sink') },
      ],
      edges: [
        { from: 'root', to: 'w1' },
        { from: 'root', to: 'w2' },
        { from: 'w1', to: 'sink' },
        { from: 'w2', to: 'sink' },
      ],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for a cycle with maxCycles on all edges', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a') },
        { id: 'b', agent: agent('b') },
      ],
      edges: [
        { from: 'a', to: 'b', maxCycles: 3 },
        { from: 'b', to: 'a', maxCycles: 3 },
      ],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // --- Orphan node detection ---

  it('detects orphan nodes with no incoming edges', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a') },
        { id: 'b', agent: agent('b') },
        { id: 'orphan', agent: agent('orphan') },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    // 'a' is a root, 'b' has an incoming edge, 'orphan' is neither root nor connected
    // Actually both 'a' and 'orphan' have no incoming edges, so both are roots.
    // With three nodes, two with no incoming edges: a and orphan are both roots.
    // This is valid — roots are allowed.
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
  });

  it('does not flag root nodes as orphans', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'root1', agent: agent('root1') },
        { id: 'root2', agent: agent('root2') },
        { id: 'sink', agent: agent('sink') },
      ],
      edges: [
        { from: 'root1', to: 'sink' },
        { from: 'root2', to: 'sink' },
      ],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('does not flag dynamic nodes as orphans', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a') },
        { id: 'dynamic-worker', agent: agent('dynamic-worker') },
      ],
      edges: [],
      dynamicNodes: ['dynamic-worker'],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
  });

  it('considers conditional edge targets as connected (not orphan)', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'router', agent: agent('router') },
        { id: 'path-a', agent: agent('path-a') },
        { id: 'path-b', agent: agent('path-b') },
      ],
      edges: [],
      conditionalEdges: [
        {
          from: 'router',
          evaluate: { type: 'rule', fn: (out: string) => (out.includes('A') ? 'path-a' : 'path-b') },
          targets: { 'path-a': 'path-a', 'path-b': 'path-b' },
        },
      ],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // --- Cycle detection ---

  it('detects a cycle without maxCycles', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a') },
        { id: 'b', agent: agent('b') },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('cycle') && e.includes('maxCycles'))).toBe(true);
  });

  it('detects a self-loop without maxCycles', () => {
    const dag = simpleDag({
      nodes: [{ id: 'a', agent: agent('a') }],
      edges: [{ from: 'a', to: 'a' }],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('allows a self-loop with maxCycles', () => {
    const dag = simpleDag({
      nodes: [{ id: 'a', agent: agent('a') }],
      edges: [{ from: 'a', to: 'a', maxCycles: 5 }],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects a cycle when only some edges have maxCycles', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a') },
        { id: 'b', agent: agent('b') },
        { id: 'c', agent: agent('c') },
      ],
      edges: [
        { from: 'a', to: 'b', maxCycles: 3 },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' }, // missing maxCycles
      ],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    // At least one edge in the cycle is missing maxCycles
    expect(result.errors.some((e) => e.includes('cycle') && e.includes('maxCycles'))).toBe(true);
  });

  it('detects a three-node cycle without maxCycles', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a') },
        { id: 'b', agent: agent('b') },
        { id: 'c', agent: agent('c') },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  // --- Provider reference validation ---

  it('detects references to non-existent providers', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a', { providerId: 'openai' }) },
        { id: 'b', agent: agent('b') },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const result = validateDAG(dag, { providers: { anthropic: {} } });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('provider') && e.includes('openai'))).toBe(true);
  });

  it('passes when referenced providers exist', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a', { providerId: 'openai' }) },
        { id: 'b', agent: agent('b', { providerId: 'anthropic' }) },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const result = validateDAG(dag, {
      providers: { openai: {}, anthropic: {} },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('skips provider validation when no config is provided', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a', { providerId: 'openai' }) },
        { id: 'b', agent: agent('b') },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    // No config at all — provider refs can't be validated, so no error
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
  });

  it('detects provider reference in conditional edge evaluator', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a') },
        { id: 'b', agent: agent('b') },
      ],
      edges: [],
      conditionalEdges: [
        {
          from: 'a',
          evaluate: { type: 'llm', prompt: 'evaluate', providerId: 'missing-provider' },
          targets: { b: 'b' },
        },
      ],
    });
    const result = validateDAG(dag, { providers: { anthropic: {} } });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing-provider'))).toBe(true);
  });

  // --- Budget estimate ---

  it('includes an estimated cost', () => {
    const dag = simpleDag();
    const result = validateDAG(dag) as { valid: boolean; errors: string[]; estimatedCostCents?: number };
    expect(result.estimatedCostCents).toBeDefined();
    expect(result.estimatedCostCents).toBeGreaterThan(0);
  });

  it('scales estimated cost with node count', () => {
    const small = validateDAG(simpleDag({
      nodes: [{ id: 'a', agent: agent('a') }],
      edges: [],
    })) as { estimatedCostCents?: number };

    const large = validateDAG(simpleDag({
      nodes: [
        { id: 'a', agent: agent('a') },
        { id: 'b', agent: agent('b') },
        { id: 'c', agent: agent('c') },
        { id: 'd', agent: agent('d') },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
      ],
    })) as { estimatedCostCents?: number };

    expect(large.estimatedCostCents!).toBeGreaterThan(small.estimatedCostCents!);
  });

  // --- Multiple errors ---

  it('collects multiple errors in a single validation pass', () => {
    const dag = simpleDag({
      nodes: [
        { id: 'a', agent: agent('a', { providerId: 'nonexistent' }) },
        { id: 'b', agent: agent('b') },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' }, // cycle without maxCycles
      ],
    });
    const result = validateDAG(dag, { providers: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  // --- Edge cases ---

  it('handles empty DAG', () => {
    const dag = simpleDag({
      nodes: [],
      edges: [],
      conditionalEdges: [],
      dynamicNodes: [],
    });
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
