import { describe, it, expect } from 'vitest';
import { SwarmEngine } from '../../src/engine.js';
import type { SwarmEngineConfig, SwarmEvent } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectEvents(gen: AsyncGenerator<SwarmEvent>): Promise<SwarmEvent[]> {
  const events: SwarmEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function eventsOfType<T extends SwarmEvent['type']>(
  events: SwarmEvent[],
  type: T,
): Extract<SwarmEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<SwarmEvent, { type: T }>[];
}

/**
 * Create a config where the provider returns different responses based on call order.
 */
function createConditionalConfig(responses: string[]): SwarmEngineConfig {
  let callCount = 0;
  return {
    providers: {
      test: {
        type: 'custom',
        adapter: {
          async *stream() {
            const response = responses[callCount++] ?? 'default';
            for (const char of response) {
              yield { type: 'chunk' as const, content: char };
            }
            yield { type: 'usage' as const, inputTokens: 100, outputTokens: response.length };
          },
          estimateCost: () => 1,
          getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
        },
      },
    },
    defaults: { provider: 'test' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: Conditional Routing', () => {
  it('routes to "approve" branch when output contains "approve" (rule evaluator)', async () => {
    // A outputs "I approve this", so B (the approve branch) should run, not C
    const engine = new SwarmEngine(
      createConditionalConfig(['I approve this request', 'approved path output']),
    );

    const dag = engine
      .dag()
      .agent('reviewer', { id: 'reviewer', name: 'Reviewer', role: 'reviewer', systemPrompt: 'Review.' })
      .agent('approver', { id: 'approver', name: 'Approver', role: 'approver', systemPrompt: 'Handle approval.' })
      .agent('rejector', { id: 'rejector', name: 'Rejector', role: 'rejector', systemPrompt: 'Handle rejection.' })
      .conditionalEdge('reviewer', {
        evaluate: {
          type: 'rule',
          fn: (output) => output.includes('approve') ? 'good' : 'bad',
        },
        targets: { good: 'approver', bad: 'rejector' },
      })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'review something' }));

    // Verify route_decision event
    const routeDecisions = eventsOfType(events, 'route_decision');
    expect(routeDecisions).toHaveLength(1);
    expect(routeDecisions[0].fromNode).toBe('reviewer');
    expect(routeDecisions[0].toNode).toBe('approver');
    expect(routeDecisions[0].reason).toBe('good');

    // Approver should have run
    const agentStarts = eventsOfType(events, 'agent_start');
    const startedNodes = agentStarts.map((e) => e.nodeId);
    expect(startedNodes).toContain('reviewer');
    expect(startedNodes).toContain('approver');
    expect(startedNodes).not.toContain('rejector');

    // swarm_done should include results for reviewer and approver only
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    const resultNodes = swarmDones[0].results.map((r) => r.nodeId);
    expect(resultNodes).toContain('reviewer');
    expect(resultNodes).toContain('approver');
    expect(resultNodes).not.toContain('rejector');
  });

  it('routes to "reject" branch when output does not contain "approve"', async () => {
    // A outputs "I reject this", so C (the reject branch) should run
    const engine = new SwarmEngine(
      createConditionalConfig(['I reject this request', 'rejected path output']),
    );

    const dag = engine
      .dag()
      .agent('reviewer', { id: 'reviewer', name: 'Reviewer', role: 'reviewer', systemPrompt: 'Review.' })
      .agent('approver', { id: 'approver', name: 'Approver', role: 'approver', systemPrompt: 'Approve.' })
      .agent('rejector', { id: 'rejector', name: 'Rejector', role: 'rejector', systemPrompt: 'Reject.' })
      .conditionalEdge('reviewer', {
        evaluate: {
          type: 'rule',
          fn: (output) => output.includes('approve') ? 'good' : 'bad',
        },
        targets: { good: 'approver', bad: 'rejector' },
      })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'review rejection' }));

    // route_decision should route to rejector
    const routeDecisions = eventsOfType(events, 'route_decision');
    expect(routeDecisions).toHaveLength(1);
    expect(routeDecisions[0].toNode).toBe('rejector');
    expect(routeDecisions[0].reason).toBe('bad');

    // Rejector should have run, not Approver
    const agentStarts = eventsOfType(events, 'agent_start');
    const startedNodes = agentStarts.map((e) => e.nodeId);
    expect(startedNodes).toContain('rejector');
    expect(startedNodes).not.toContain('approver');
  });

  it('uses regex evaluator for conditional routing', async () => {
    // A outputs "STATUS: PASS", regex matches -> routes to pass_handler
    const engine = new SwarmEngine(
      createConditionalConfig(['STATUS: PASS - all checks cleared', 'pass handled']),
    );

    const dag = engine
      .dag()
      .agent('checker', { id: 'checker', name: 'Checker', role: 'checker', systemPrompt: 'Check.' })
      .agent('pass_handler', { id: 'pass_handler', name: 'Pass', role: 'pass', systemPrompt: 'Handle pass.' })
      .agent('fail_handler', { id: 'fail_handler', name: 'Fail', role: 'fail', systemPrompt: 'Handle fail.' })
      .conditionalEdge('checker', {
        evaluate: {
          type: 'regex',
          pattern: 'STATUS:\\s*PASS',
          matchTarget: 'matched',
          elseTarget: 'unmatched',
        },
        targets: { matched: 'pass_handler', unmatched: 'fail_handler' },
      })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'regex routing' }));

    const routeDecisions = eventsOfType(events, 'route_decision');
    expect(routeDecisions).toHaveLength(1);
    expect(routeDecisions[0].toNode).toBe('pass_handler');

    const agentStarts = eventsOfType(events, 'agent_start');
    const startedNodes = agentStarts.map((e) => e.nodeId);
    expect(startedNodes).toContain('pass_handler');
    expect(startedNodes).not.toContain('fail_handler');
  });

  it('regex evaluator routes to else target when pattern does not match', async () => {
    // A outputs "STATUS: FAIL", regex does not match -> routes to fail_handler
    const engine = new SwarmEngine(
      createConditionalConfig(['STATUS: FAIL - checks failed', 'fail handled']),
    );

    const dag = engine
      .dag()
      .agent('checker', { id: 'checker', name: 'Checker', role: 'checker', systemPrompt: 'Check.' })
      .agent('pass_handler', { id: 'pass_handler', name: 'Pass', role: 'pass', systemPrompt: 'Pass.' })
      .agent('fail_handler', { id: 'fail_handler', name: 'Fail', role: 'fail', systemPrompt: 'Fail.' })
      .conditionalEdge('checker', {
        evaluate: {
          type: 'regex',
          pattern: 'STATUS:\\s*PASS',
          matchTarget: 'matched',
          elseTarget: 'unmatched',
        },
        targets: { matched: 'pass_handler', unmatched: 'fail_handler' },
      })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'regex fail path' }));

    const routeDecisions = eventsOfType(events, 'route_decision');
    expect(routeDecisions).toHaveLength(1);
    expect(routeDecisions[0].toNode).toBe('fail_handler');

    const agentStarts = eventsOfType(events, 'agent_start');
    const startedNodes = agentStarts.map((e) => e.nodeId);
    expect(startedNodes).toContain('fail_handler');
    expect(startedNodes).not.toContain('pass_handler');
  });

  it('downstream of selected branch still runs', async () => {
    // Reviewer -> conditional -> Approver -> Finaliser
    // Reviewer outputs "approve", so Approver runs, then Finaliser runs
    const engine = new SwarmEngine(
      createConditionalConfig(['I approve this', 'approved', 'finalised']),
    );

    const dag = engine
      .dag()
      .agent('reviewer', { id: 'reviewer', name: 'Reviewer', role: 'reviewer', systemPrompt: '' })
      .agent('approver', { id: 'approver', name: 'Approver', role: 'approver', systemPrompt: '' })
      .agent('rejector', { id: 'rejector', name: 'Rejector', role: 'rejector', systemPrompt: '' })
      .agent('finaliser', { id: 'finaliser', name: 'Finaliser', role: 'finaliser', systemPrompt: '' })
      .conditionalEdge('reviewer', {
        evaluate: {
          type: 'rule',
          fn: (output) => output.includes('approve') ? 'yes' : 'no',
        },
        targets: { yes: 'approver', no: 'rejector' },
      })
      .edge('approver', 'finaliser')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'downstream test' }));

    const agentStarts = eventsOfType(events, 'agent_start');
    const startedNodes = agentStarts.map((e) => e.nodeId);
    expect(startedNodes).toContain('reviewer');
    expect(startedNodes).toContain('approver');
    expect(startedNodes).toContain('finaliser');
    expect(startedNodes).not.toContain('rejector');

    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones).toHaveLength(3);

    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(3);
  });

  it('selected branch receives output from the conditional source node', async () => {
    const receivedMessages: { callIndex: number; content: string }[] = [];
    let callCount = 0;

    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream(params) {
              const idx = callCount++;
              const allContent = params.messages.map((m) => m.content).join(' | ');
              receivedMessages.push({ callIndex: idx, content: allContent });

              const responses = ['approve this task', 'approved output'];
              const response = responses[idx] ?? 'default';
              for (const char of response) {
                yield { type: 'chunk' as const, content: char };
              }
              yield { type: 'usage' as const, inputTokens: 100, outputTokens: response.length };
            },
            estimateCost: () => 1,
            getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
          },
        },
      },
      defaults: { provider: 'test' },
    };

    const engine = new SwarmEngine(config);

    const dag = engine
      .dag()
      .agent('src', { id: 'src', name: 'Source', role: 'source', systemPrompt: '' })
      .agent('target_a', { id: 'target_a', name: 'A', role: 'target-a', systemPrompt: '' })
      .agent('target_b', { id: 'target_b', name: 'B', role: 'target-b', systemPrompt: '' })
      .conditionalEdge('src', {
        evaluate: {
          type: 'rule',
          fn: (output) => output.includes('approve') ? 'a' : 'b',
        },
        targets: { a: 'target_a', b: 'target_b' },
      })
      .build();

    await collectEvents(engine.run({ dag, task: 'chaining test' }));

    // The selected branch (target_a) should have received the source output
    const targetCall = receivedMessages[1];
    expect(targetCall).toBeDefined();
    expect(targetCall.content).toContain('approve this task');
  });
});
