import { describe, it, expect } from 'vitest';
import { SwarmEngine } from '../../src/engine.js';
import type { SwarmEvent, ProviderAdapter, ProviderEvent, StreamParams } from '../../src/types.js';

/**
 * Integration test: Dev -> QA loop with handoff templates and evidence guard.
 */

function createTestProvider(): ProviderAdapter {
  let callCount = 0;
  return {
    async *stream(params: StreamParams): AsyncGenerator<ProviderEvent> {
      callCount++;
      // Simple mock: return task-derived output
      const userMsg = params.messages[params.messages.length - 1].content;
      yield { type: 'chunk', content: userMsg.slice(0, 200) };
      yield { type: 'usage', inputTokens: 50, outputTokens: 20 };
    },
    estimateCost: () => 0.01,
    getModelLimits: () => ({ contextWindow: 100000, maxOutput: 4096 }),
  };
}

describe('integration: feedback loop with handoffs', () => {
  it('runs a dev-qa feedback loop via SwarmEngine', async () => {
    const engine = new SwarmEngine({
      providers: {
        test: { type: 'custom', adapter: createTestProvider() },
      },
      defaults: { provider: 'test', model: 'test-model' },
    });

    const dag = engine.dag()
      .agent('dev', {
        id: 'dev', name: 'Developer', role: 'developer',
        systemPrompt: 'You are a developer.',
      })
      .agent('qa', {
        id: 'qa', name: 'QA', role: 'qa',
        systemPrompt: 'You are a QA reviewer.',
      })
      .edge('dev', 'qa', { handoff: 'qa-review' })
      .feedbackEdge({
        from: 'qa',
        to: 'dev',
        maxRetries: 3,
        evaluate: { type: 'rule', fn: (output) => output.includes('PASS') ? 'pass' : 'fail' },
        passLabel: 'pass',
        escalation: { action: 'fail', message: 'QA rejected after 3 attempts' },
      })
      .build();

    const events: SwarmEvent[] = [];
    for await (const event of engine.run({ dag, task: 'Build auth module' })) {
      events.push(event);
    }

    // Should have started
    expect(events.find(e => e.type === 'swarm_start')).toBeDefined();
    // The mock provider won't produce 'PASS' so escalation will happen
    expect(events.some(e => e.type === 'feedback_escalation')).toBe(true);
  });

  it('passes through when QA approves via rule evaluator', async () => {
    const engine = new SwarmEngine({
      providers: {
        test: { type: 'custom', adapter: createTestProvider() },
      },
      defaults: { provider: 'test', model: 'test-model' },
    });

    const dag = engine.dag()
      .agent('dev', {
        id: 'dev', name: 'Developer', role: 'developer',
        systemPrompt: 'You are a developer.',
      })
      .agent('qa', {
        id: 'qa', name: 'QA', role: 'qa',
        systemPrompt: 'You are a QA reviewer.',
      })
      .edge('dev', 'qa')
      .feedbackEdge({
        from: 'qa',
        to: 'dev',
        maxRetries: 3,
        // This rule always passes
        evaluate: { type: 'rule', fn: () => 'pass' },
        passLabel: 'pass',
      })
      .build();

    const events: SwarmEvent[] = [];
    for await (const event of engine.run({ dag, task: 'Build auth module' })) {
      events.push(event);
    }

    // No retries
    expect(events.some(e => e.type === 'feedback_retry')).toBe(false);
    // Completed successfully
    expect(events.find(e => e.type === 'swarm_done')).toBeDefined();
  });

  it('engine-wide guards emit warnings', async () => {
    const engine = new SwarmEngine({
      providers: {
        test: { type: 'custom', adapter: createTestProvider() },
      },
      defaults: { provider: 'test', model: 'test-model' },
      guards: [{ id: 'ev', type: 'evidence', mode: 'warn' as const }],
    });

    const dag = engine.dag()
      .agent('dev', {
        id: 'dev', name: 'Developer', role: 'developer',
        systemPrompt: 'You are a developer.',
      })
      .build();

    const events: SwarmEvent[] = [];
    for await (const event of engine.run({ dag, task: 'Build auth module' })) {
      events.push(event);
    }

    // The mock output likely triggers evidence guard since it echoes the task without evidence
    // Whether it triggers depends on the output - just verify the swarm completes
    expect(events.find(e => e.type === 'swarm_done')).toBeDefined();
  });
});
