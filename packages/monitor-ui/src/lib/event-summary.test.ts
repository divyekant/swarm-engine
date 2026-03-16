import { describe, expect, it } from 'vitest';
import { summarizeEvent } from './event-summary';

describe('summarizeEvent', () => {
  it('summarizes feedback retries', () => {
    expect(summarizeEvent({
      type: 'feedback_retry',
      fromNode: 'qa',
      toNode: 'dev',
      iteration: 2,
      maxRetries: 3,
    })).toContain('qa → dev retry 2/3');
  });

  it('summarizes feedback escalations', () => {
    expect(summarizeEvent({
      type: 'feedback_escalation',
      fromNode: 'qa',
      toNode: 'dev',
      iteration: 3,
      policy: { action: 'reroute', reroute: 'senior' },
    })).toContain('qa → dev escalated');
  });

  it('summarizes guard events', () => {
    expect(summarizeEvent({
      type: 'guard_warning',
      nodeId: 'dev',
      guardId: 'scope',
      guardType: 'scope-creep',
      message: 'Expanded beyond requested API surface.',
    })).toContain('scope-creep');

    expect(summarizeEvent({
      type: 'guard_blocked',
      nodeId: 'qa',
      guardId: 'evidence',
      guardType: 'evidence',
      message: 'Claims were not supported by evidence.',
    })).toContain('blocked');
  });
});
