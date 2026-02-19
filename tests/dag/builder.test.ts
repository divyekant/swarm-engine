import { describe, it, expect } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';

describe('DAGBuilder', () => {
  it('builds a sequential DAG', () => {
    const dag = new DAGBuilder()
      .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: 'You are a PM' })
      .agent('arch', { id: 'arch', name: 'Architect', role: 'architect', systemPrompt: 'You are an architect' })
      .edge('pm', 'arch')
      .build();

    expect(dag.nodes).toHaveLength(2);
    expect(dag.edges).toHaveLength(1);
    expect(dag.edges[0].from).toBe('pm');
    expect(dag.edges[0].to).toBe('arch');
  });

  it('builds a parallel fan-out/fan-in DAG', () => {
    const dag = new DAGBuilder()
      .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: '' })
      .agent('arch', { id: 'arch', name: 'Arch', role: 'architect', systemPrompt: '' })
      .agent('qa', { id: 'qa', name: 'QA', role: 'qa', systemPrompt: '' })
      .agent('mgr', { id: 'mgr', name: 'Mgr', role: 'manager', systemPrompt: '' })
      .edge('pm', 'arch')
      .edge('pm', 'qa')
      .edge('arch', 'mgr')
      .edge('qa', 'mgr')
      .build();

    expect(dag.nodes).toHaveLength(4);
    expect(dag.edges).toHaveLength(4);
  });

  it('builds a conditional routing DAG', () => {
    const dag = new DAGBuilder()
      .agent('reviewer', { id: 'r', name: 'Reviewer', role: 'qa', systemPrompt: '' })
      .agent('next', { id: 'n', name: 'Next', role: 'pm', systemPrompt: '' })
      .agent('fixer', { id: 'f', name: 'Fixer', role: 'architect', systemPrompt: '' })
      .conditionalEdge('reviewer', {
        evaluate: { type: 'rule', fn: (out) => out.includes('APPROVED') ? 'next' : 'fixer' },
        targets: { next: 'next', fixer: 'fixer' },
      })
      .build();

    expect(dag.conditionalEdges).toHaveLength(1);
  });

  it('throws on duplicate node IDs', () => {
    expect(() => {
      new DAGBuilder()
        .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: '' })
        .agent('pm', { id: 'pm', name: 'PM2', role: 'pm', systemPrompt: '' });
    }).toThrow();
  });

  it('throws on edge to non-existent node', () => {
    expect(() => {
      new DAGBuilder()
        .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: '' })
        .edge('pm', 'nonexistent')
        .build();
    }).toThrow();
  });

  it('marks dynamic expansion nodes', () => {
    const dag = new DAGBuilder()
      .agent('coordinator', { id: 'c', name: 'Coordinator', role: 'coordinator', systemPrompt: '' })
      .dynamicExpansion('coordinator')
      .build();

    expect(dag.dynamicNodes).toContain('coordinator');
  });
});
