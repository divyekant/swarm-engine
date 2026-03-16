import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './state-reducer';

describe('monitor state reducer', () => {
  it('tracks guard warnings on completed nodes', () => {
    let state = initialState();

    state = reducer(state, {
      type: 'event',
      event: { type: 'agent_start', nodeId: 'dev', agentRole: 'developer', agentName: 'Developer' },
    });
    state = reducer(state, {
      type: 'event',
      event: {
        type: 'agent_done',
        nodeId: 'dev',
        agentRole: 'developer',
        output: 'done',
        cost: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costCents: 2, calls: 1 },
      },
    });
    state = reducer(state, {
      type: 'event',
      event: {
        type: 'guard_warning',
        nodeId: 'dev',
        guardId: 'scope',
        guardType: 'scope-creep',
        message: 'Expanded beyond requested API surface.',
      },
    });

    const node = state.nodes.get('dev');
    expect(node?.status).toBe('completed');
    expect(node?.warnings).toEqual(['Expanded beyond requested API surface.']);
  });

  it('marks nodes failed when a guard blocks them', () => {
    let state = initialState();

    state = reducer(state, {
      type: 'event',
      event: { type: 'agent_start', nodeId: 'qa', agentRole: 'qa', agentName: 'QA' },
    });
    state = reducer(state, {
      type: 'event',
      event: {
        type: 'guard_blocked',
        nodeId: 'qa',
        guardId: 'evidence',
        guardType: 'evidence',
        message: 'Claims were not supported by evidence.',
      },
    });

    const node = state.nodes.get('qa');
    expect(node?.status).toBe('failed');
    expect(node?.error).toBe('Claims were not supported by evidence.');
    expect(node?.warnings).toEqual(['Claims were not supported by evidence.']);
  });

  it('records feedback loop activity for retries and escalations', () => {
    let state = initialState();

    state = reducer(state, {
      type: 'event',
      event: {
        type: 'feedback_retry',
        fromNode: 'qa',
        toNode: 'dev',
        iteration: 2,
        maxRetries: 3,
      },
    });
    state = reducer(state, {
      type: 'event',
      event: {
        type: 'feedback_escalation',
        fromNode: 'qa',
        toNode: 'dev',
        iteration: 3,
        policy: { action: 'reroute', reroute: 'senior', message: 'Escalate to senior review.' },
      },
    });

    expect(state.feedbackEvents).toEqual([
      { type: 'retry', from: 'qa', to: 'dev', iteration: 2, maxRetries: 3, action: 'retry' },
      { type: 'escalation', from: 'qa', to: 'dev', iteration: 3, action: 'reroute', detail: 'Escalate to senior review.' },
    ]);
  });
});
