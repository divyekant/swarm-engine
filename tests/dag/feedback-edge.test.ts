import { describe, it, expect } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';
import { DAGGraph } from '../../src/dag/graph.js';
import type { FeedbackEdge } from '../../src/types.js';

function agent(id: string) {
  return { id, name: id, role: id, systemPrompt: '' };
}

describe('DAGBuilder feedbackEdge', () => {
  it('adds a feedback edge to the DAG definition', () => {
    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .agent('qa', agent('qa'))
      .edge('dev', 'qa')
      .feedbackEdge({
        from: 'qa',
        to: 'dev',
        maxRetries: 3,
        evaluate: { type: 'regex', pattern: 'PASS', matchTarget: 'pass', elseTarget: 'fail' },
        passLabel: 'pass',
      })
      .build();

    expect(dag.feedbackEdges).toHaveLength(1);
    expect(dag.feedbackEdges[0].from).toBe('qa');
    expect(dag.feedbackEdges[0].to).toBe('dev');
    expect(dag.feedbackEdges[0].maxRetries).toBe(3);
    expect(dag.feedbackEdges[0].passLabel).toBe('pass');
  });

  it('supports escalation policy', () => {
    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .agent('qa', agent('qa'))
      .agent('senior', agent('senior'))
      .edge('dev', 'qa')
      .feedbackEdge({
        from: 'qa',
        to: 'dev',
        maxRetries: 3,
        evaluate: { type: 'regex', pattern: 'PASS', matchTarget: 'pass', elseTarget: 'fail' },
        passLabel: 'pass',
        escalation: { action: 'reroute', reroute: 'senior', message: 'Dev failed 3 times' },
      })
      .build();

    expect(dag.feedbackEdges[0].escalation).toEqual({
      action: 'reroute',
      reroute: 'senior',
      message: 'Dev failed 3 times',
    });
  });

  it('validates feedback edge source node exists', () => {
    expect(() => {
      new DAGBuilder()
        .agent('dev', agent('dev'))
        .feedbackEdge({
          from: 'nonexistent',
          to: 'dev',
          maxRetries: 3,
          evaluate: { type: 'regex', pattern: 'PASS', matchTarget: 'pass', elseTarget: 'fail' },
          passLabel: 'pass',
        })
        .build();
    }).toThrow('non-existent source');
  });

  it('validates feedback edge target node exists', () => {
    expect(() => {
      new DAGBuilder()
        .agent('qa', agent('qa'))
        .feedbackEdge({
          from: 'qa',
          to: 'nonexistent',
          maxRetries: 3,
          evaluate: { type: 'regex', pattern: 'PASS', matchTarget: 'pass', elseTarget: 'fail' },
          passLabel: 'pass',
        })
        .build();
    }).toThrow('non-existent target');
  });

  it('validates escalation reroute node exists', () => {
    expect(() => {
      new DAGBuilder()
        .agent('dev', agent('dev'))
        .agent('qa', agent('qa'))
        .feedbackEdge({
          from: 'qa',
          to: 'dev',
          maxRetries: 3,
          evaluate: { type: 'regex', pattern: 'PASS', matchTarget: 'pass', elseTarget: 'fail' },
          passLabel: 'pass',
          escalation: { action: 'reroute', reroute: 'nonexistent' },
        })
        .build();
    }).toThrow('non-existent');
  });

  it('DAG without feedback edges has empty array', () => {
    const dag = new DAGBuilder()
      .agent('a', agent('a'))
      .build();

    expect(dag.feedbackEdges).toEqual([]);
  });
});

describe('DAGGraph feedbackEdges', () => {
  it('exposes feedback edges from definition', () => {
    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .agent('qa', agent('qa'))
      .edge('dev', 'qa')
      .feedbackEdge({
        from: 'qa',
        to: 'dev',
        maxRetries: 3,
        evaluate: { type: 'regex', pattern: 'PASS', matchTarget: 'pass', elseTarget: 'fail' },
        passLabel: 'pass',
      })
      .build();

    const graph = new DAGGraph(dag);
    expect(graph.feedbackEdges).toHaveLength(1);
    expect(graph.feedbackEdges[0].from).toBe('qa');
  });

  it('getFeedbackEdges filters by source node', () => {
    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .agent('qa', agent('qa'))
      .agent('reviewer', agent('reviewer'))
      .edge('dev', 'qa')
      .edge('dev', 'reviewer')
      .feedbackEdge({
        from: 'qa',
        to: 'dev',
        maxRetries: 3,
        evaluate: { type: 'regex', pattern: 'PASS', matchTarget: 'pass', elseTarget: 'fail' },
        passLabel: 'pass',
      })
      .feedbackEdge({
        from: 'reviewer',
        to: 'dev',
        maxRetries: 2,
        evaluate: { type: 'regex', pattern: 'OK', matchTarget: 'pass', elseTarget: 'fail' },
        passLabel: 'pass',
      })
      .build();

    const graph = new DAGGraph(dag);

    expect(graph.getFeedbackEdges('qa')).toHaveLength(1);
    expect(graph.getFeedbackEdges('qa')[0].from).toBe('qa');

    expect(graph.getFeedbackEdges('reviewer')).toHaveLength(1);
    expect(graph.getFeedbackEdges('reviewer')[0].from).toBe('reviewer');

    expect(graph.getFeedbackEdges('dev')).toHaveLength(0);
  });

  it('defaults to empty array when feedbackEdges not in definition', () => {
    // Simulate a definition without feedbackEdges (backward compatibility)
    const graph = new DAGGraph({
      id: 'test',
      nodes: [{ id: 'a', agent: agent('a') }],
      edges: [],
      conditionalEdges: [],
      dynamicNodes: [],
    } as any);

    expect(graph.feedbackEdges).toEqual([]);
  });
});
