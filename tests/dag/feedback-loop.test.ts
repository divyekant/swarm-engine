import { describe, it, expect } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';
import { DAGGraph } from '../../src/dag/graph.js';
import { DAGExecutor } from '../../src/dag/executor.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { SwarmMemory } from '../../src/memory/index.js';
import type { SwarmEvent, CostSummary, FeedbackContext } from '../../src/types.js';

function agent(id: string) {
  return { id, name: id, role: id, systemPrompt: '' };
}
function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

describe('feedback loop execution', () => {
  it('retries dev node with feedback when QA rejects', async () => {
    let devRunCount = 0;
    let capturedFeedbackContext: FeedbackContext | undefined;

    const runner = {
      async *run(params: any): AsyncGenerator<SwarmEvent> {
        yield { type: 'agent_start', nodeId: params.nodeId, agentRole: params.agent.role, agentName: params.agent.name };

        if (params.nodeId === 'dev') {
          devRunCount++;
          capturedFeedbackContext = params.feedbackContext;
          yield { type: 'agent_done', nodeId: 'dev', agentRole: 'dev', output: `dev-output-v${devRunCount}`, cost: emptyCost() };
        } else {
          // QA: reject first time, pass second time
          const output = devRunCount <= 1 ? 'FAIL: missing tests' : 'PASS: looks good';
          yield { type: 'agent_done', nodeId: 'qa', agentRole: 'qa', output, cost: emptyCost() };
        }
      },
    };

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
    const executor = new DAGExecutor(
      graph, runner as any, new CostTracker(null, null),
      new SwarmMemory(), 'test task',
    );

    const events: SwarmEvent[] = [];
    for await (const event of executor.execute()) {
      events.push(event);
    }

    // Dev ran twice: initial + 1 retry
    expect(devRunCount).toBe(2);
    // Feedback was injected on retry
    expect(capturedFeedbackContext).toBeDefined();
    expect(capturedFeedbackContext!.iteration).toBe(1);
    expect(capturedFeedbackContext!.maxRetries).toBe(3);
    expect(capturedFeedbackContext!.previousFeedback).toBe('FAIL: missing tests');
    // Events include feedback_retry
    expect(events.some(e => e.type === 'feedback_retry')).toBe(true);
    // Swarm completed successfully
    expect(events.find(e => e.type === 'swarm_done')).toBeDefined();
  });

  it('escalates with fail policy after maxRetries exhausted', async () => {
    let devRunCount = 0;

    const runner = {
      async *run(params: any): AsyncGenerator<SwarmEvent> {
        yield { type: 'agent_start', nodeId: params.nodeId, agentRole: params.agent.role, agentName: params.agent.name };

        if (params.nodeId === 'dev') {
          devRunCount++;
          yield { type: 'agent_done', nodeId: 'dev', agentRole: 'dev', output: `bad-output-${devRunCount}`, cost: emptyCost() };
        } else {
          // QA always rejects
          yield { type: 'agent_done', nodeId: 'qa', agentRole: 'qa', output: 'FAIL: still broken', cost: emptyCost() };
        }
      },
    };

    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .agent('qa', agent('qa'))
      .edge('dev', 'qa')
      .feedbackEdge({
        from: 'qa',
        to: 'dev',
        maxRetries: 2,
        evaluate: { type: 'regex', pattern: 'PASS', matchTarget: 'pass', elseTarget: 'fail' },
        passLabel: 'pass',
        escalation: { action: 'fail', message: 'Dev failed after 2 retries' },
      })
      .build();

    const graph = new DAGGraph(dag);
    const executor = new DAGExecutor(
      graph, runner as any, new CostTracker(null, null),
      new SwarmMemory(), 'test task',
    );

    const events: SwarmEvent[] = [];
    for await (const event of executor.execute()) {
      events.push(event);
    }

    // Dev ran exactly maxRetries times
    expect(devRunCount).toBe(2);
    // Escalation event emitted
    const escalation = events.find(e => e.type === 'feedback_escalation');
    expect(escalation).toBeDefined();
    expect(escalation).toMatchObject({
      fromNode: 'qa',
      toNode: 'dev',
      iteration: 2,
    });
  });

  it('passes immediately when QA approves first time', async () => {
    let devRunCount = 0;

    const runner = {
      async *run(params: any): AsyncGenerator<SwarmEvent> {
        yield { type: 'agent_start', nodeId: params.nodeId, agentRole: params.agent.role, agentName: params.agent.name };

        if (params.nodeId === 'dev') {
          devRunCount++;
          yield { type: 'agent_done', nodeId: 'dev', agentRole: 'dev', output: 'good code', cost: emptyCost() };
        } else {
          yield { type: 'agent_done', nodeId: 'qa', agentRole: 'qa', output: 'PASS: great work', cost: emptyCost() };
        }
      },
    };

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
    const executor = new DAGExecutor(
      graph, runner as any, new CostTracker(null, null),
      new SwarmMemory(), 'test task',
    );

    const events: SwarmEvent[] = [];
    for await (const event of executor.execute()) {
      events.push(event);
    }

    // Dev only ran once
    expect(devRunCount).toBe(1);
    // No retry events
    expect(events.some(e => e.type === 'feedback_retry')).toBe(false);
    expect(events.some(e => e.type === 'feedback_escalation')).toBe(false);
    // Swarm completed
    expect(events.find(e => e.type === 'swarm_done')).toBeDefined();
  });

  it('accumulates feedback history across retries', async () => {
    let devRunCount = 0;
    const capturedFeedback: (FeedbackContext | undefined)[] = [];

    const runner = {
      async *run(params: any): AsyncGenerator<SwarmEvent> {
        yield { type: 'agent_start', nodeId: params.nodeId, agentRole: params.agent.role, agentName: params.agent.name };

        if (params.nodeId === 'dev') {
          devRunCount++;
          capturedFeedback.push(params.feedbackContext);
          yield { type: 'agent_done', nodeId: 'dev', agentRole: 'dev', output: `attempt-${devRunCount}`, cost: emptyCost() };
        } else {
          // QA rejects first 2, passes on 3rd
          const output = devRunCount <= 2 ? `FAIL: issue ${devRunCount}` : 'PASS: fixed';
          yield { type: 'agent_done', nodeId: 'qa', agentRole: 'qa', output, cost: emptyCost() };
        }
      },
    };

    const dag = new DAGBuilder()
      .agent('dev', agent('dev'))
      .agent('qa', agent('qa'))
      .edge('dev', 'qa')
      .feedbackEdge({
        from: 'qa',
        to: 'dev',
        maxRetries: 5,
        evaluate: { type: 'regex', pattern: 'PASS', matchTarget: 'pass', elseTarget: 'fail' },
        passLabel: 'pass',
      })
      .build();

    const graph = new DAGGraph(dag);
    const executor = new DAGExecutor(
      graph, runner as any, new CostTracker(null, null),
      new SwarmMemory(), 'test task',
    );

    for await (const _event of executor.execute()) {}

    expect(devRunCount).toBe(3);
    // First run: no feedback
    expect(capturedFeedback[0]).toBeUndefined();
    // Second run: one piece of feedback
    expect(capturedFeedback[1]?.iteration).toBe(1);
    expect(capturedFeedback[1]?.feedbackHistory).toHaveLength(1);
    // Third run: two pieces of feedback
    expect(capturedFeedback[2]?.iteration).toBe(2);
    expect(capturedFeedback[2]?.feedbackHistory).toHaveLength(2);
  });
});
