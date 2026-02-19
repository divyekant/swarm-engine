// tests/agent/runner.test.ts
import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../../src/agent/runner.js';
import { SwarmMemory } from '../../src/memory/index.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { ContextAssembler } from '../../src/context/assembler.js';
import { NoopContextProvider, NoopMemoryProvider, NoopCodebaseProvider, NoopPersonaProvider } from '../../src/adapters/defaults.js';
import type { ProviderAdapter, SwarmEvent } from '../../src/types.js';

function createMockProvider(responseText: string): ProviderAdapter {
  return {
    async *stream() {
      for (const char of responseText) {
        yield { type: 'chunk' as const, content: char };
      }
      yield { type: 'usage' as const, inputTokens: 100, outputTokens: responseText.length };
    },
    estimateCost: () => 1,
    getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
  };
}

describe('AgentRunner', () => {
  it('runs a single agent and streams events', async () => {
    const provider = createMockProvider('Hello from PM agent');
    const memory = new SwarmMemory();
    const costTracker = new CostTracker();
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    });

    const runner = new AgentRunner(provider, assembler, costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'pm-node',
      agent: { id: 'pm', name: 'PM Agent', role: 'pm', systemPrompt: 'You are a PM.' },
      task: 'Write a PRD',
      memory,
    })) {
      events.push(event);
    }

    const starts = events.filter(e => e.type === 'agent_start');
    const chunks = events.filter(e => e.type === 'agent_chunk');
    const dones = events.filter(e => e.type === 'agent_done');

    expect(starts).toHaveLength(1);
    expect(chunks.length).toBeGreaterThan(0);
    expect(dones).toHaveLength(1);

    // Cost should be recorded
    expect(costTracker.getSwarmTotal().calls).toBe(1);
  });

  it('executes tool calls from provider tool_use events', async () => {
    let callCount = 0;
    const provider: ProviderAdapter = {
      async *stream() {
        callCount++;
        if (callCount === 1) {
          yield { type: 'tool_use' as const, id: 'call-1', name: 'send_message', input: { to: '*', content: 'hello' } };
        } else {
          yield { type: 'chunk' as const, content: 'done' };
        }
        yield { type: 'usage' as const, inputTokens: 50, outputTokens: 20 };
      },
      estimateCost: () => 1,
      getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
    };

    const memory = new SwarmMemory();
    const costTracker = new CostTracker();
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    });

    const runner = new AgentRunner(provider, assembler, costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'tool-node',
      agent: { id: 'tool-agent', name: 'Tool Agent', role: 'tool', systemPrompt: 'You use tools.' },
      task: 'Send a message',
      memory,
    })) {
      events.push(event);
    }

    const toolEvents = events.filter(e => e.type === 'agent_tool_use');
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]).toMatchObject({ tool: 'send_message' });
  });
});
