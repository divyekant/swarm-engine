import { describe, it, expect } from 'vitest';
import { CostTracker } from '../../src/cost/tracker.js';

describe('CostTracker', () => {
  it('records usage and computes totals', () => {
    const tracker = new CostTracker();
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 1000, outputTokens: 500, model: 'claude-sonnet-4-20250514' });

    const total = tracker.getSwarmTotal();
    expect(total.inputTokens).toBe(1000);
    expect(total.outputTokens).toBe(500);
    expect(total.totalTokens).toBe(1500);
    expect(total.calls).toBe(1);
    expect(total.costCents).toBeGreaterThan(0);
  });

  it('tracks per-agent costs', () => {
    const tracker = new CostTracker();
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-20250514' });
    tracker.recordUsage('agent-2', 'node-b', { inputTokens: 200, outputTokens: 100, model: 'claude-sonnet-4-20250514' });

    const perAgent = tracker.getPerAgent();
    expect(perAgent.get('agent-1')!.inputTokens).toBe(100);
    expect(perAgent.get('agent-2')!.inputTokens).toBe(200);
  });

  it('tracks per-node costs', () => {
    const tracker = new CostTracker();
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-20250514' });
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-20250514' });

    const perNode = tracker.getPerNode();
    expect(perNode.get('node-a')!.calls).toBe(2);
    expect(perNode.get('node-a')!.inputTokens).toBe(200);
  });

  it('enforces swarm budget', () => {
    const tracker = new CostTracker(10);
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100000, outputTokens: 50000, model: 'claude-sonnet-4-20250514' });
    expect(tracker.checkBudget().ok).toBe(false);
  });

  it('returns ok when within budget', () => {
    const tracker = new CostTracker(10000);
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-20250514' });
    expect(tracker.checkBudget().ok).toBe(true);
  });

  it('returns ok when no budget set', () => {
    const tracker = new CostTracker();
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100000, outputTokens: 50000, model: 'claude-sonnet-4-20250514' });
    expect(tracker.checkBudget().ok).toBe(true);
  });

  it('uses integer cents (no floating point)', () => {
    const tracker = new CostTracker();
    tracker.recordUsage('a', 'n', { inputTokens: 1, outputTokens: 1, model: 'claude-sonnet-4-20250514' });
    const total = tracker.getSwarmTotal();
    expect(Number.isInteger(total.costCents)).toBe(true);
  });

  it('checks per-agent budget', () => {
    const tracker = new CostTracker(null, 5);
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100000, outputTokens: 50000, model: 'claude-sonnet-4-20250514' });
    expect(tracker.checkAgentBudget('agent-1').ok).toBe(false);
    expect(tracker.checkAgentBudget('agent-2').ok).toBe(true);
  });
});
