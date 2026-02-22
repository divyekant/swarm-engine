import { describe, it, expect } from 'vitest';
import { SwarmEngine } from '../src/engine.js';
import type { SwarmEngineConfig, SwarmEvent, ProviderAdapter } from '../src/types.js';
import type { AgenticAdapter, AgenticRunParams, AgenticEvent } from '../src/adapters/agentic/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock ProviderAdapter (standard LLM) that produces a fixed response.
 */
function createMockLLMAdapter(responseText: string): ProviderAdapter {
  return {
    async *stream() {
      for (const char of responseText) {
        yield { type: 'chunk' as const, content: char };
      }
      yield { type: 'usage' as const, inputTokens: 50, outputTokens: responseText.length };
    },
    estimateCost: () => 1,
    getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
  };
}

/**
 * Create a mock AgenticAdapter that produces a fixed response.
 */
function createMockAgenticAdapter(responseText: string): AgenticAdapter {
  return {
    async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
      yield { type: 'chunk', content: responseText };
      yield {
        type: 'result',
        output: responseText,
        inputTokens: 100,
        outputTokens: responseText.length,
      };
    },
  };
}

/**
 * Collect all events from an async generator into an array.
 */
async function collectEvents(gen: AsyncGenerator<SwarmEvent>): Promise<SwarmEvent[]> {
  const events: SwarmEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/**
 * Filter events by type.
 */
function eventsOfType<T extends SwarmEvent['type']>(
  events: SwarmEvent[],
  type: T,
): Extract<SwarmEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<SwarmEvent, { type: T }>[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SwarmEngine — agentic adapters', () => {
  it('supports mixed LLM and agentic providers in a DAG', async () => {
    const config: SwarmEngineConfig = {
      providers: {
        llm: {
          type: 'custom',
          adapter: createMockLLMAdapter('llm output'),
        },
        agent: {
          type: 'custom-agentic',
          agenticAdapter: createMockAgenticAdapter('agentic output'),
        },
      },
      defaults: { provider: 'llm' },
    };

    const engine = new SwarmEngine(config);

    const dag = engine
      .dag()
      .agent('planner', {
        id: 'planner',
        name: 'Planner',
        role: 'planner',
        systemPrompt: 'You plan.',
        providerId: 'llm',
      })
      .agent('coder', {
        id: 'coder',
        name: 'Coder',
        role: 'coder',
        systemPrompt: 'You code.',
        providerId: 'agent',
      })
      .edge('planner', 'coder')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'Plan and code' }));

    // Both should start
    const agentStarts = eventsOfType(events, 'agent_start');
    expect(agentStarts).toHaveLength(2);
    const startedRoles = agentStarts.map((e) => e.agentRole);
    expect(startedRoles).toContain('planner');
    expect(startedRoles).toContain('coder');

    // Both should complete
    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones).toHaveLength(2);

    const plannerDone = agentDones.find((e) => e.nodeId === 'planner');
    const coderDone = agentDones.find((e) => e.nodeId === 'coder');
    expect(plannerDone?.output).toBe('llm output');
    expect(coderDone?.output).toBe('agentic output');

    // Swarm should complete successfully
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(2);

    // No errors
    const errors = eventsOfType(events, 'swarm_error');
    expect(errors).toHaveLength(0);
  });

  it('agentic nodes produce correct output routed through AgenticRunner', async () => {
    const config: SwarmEngineConfig = {
      providers: {
        llm: {
          type: 'custom',
          adapter: createMockLLMAdapter('standard result'),
        },
        myAgentic: {
          type: 'custom-agentic',
          agenticAdapter: createMockAgenticAdapter('agentic result'),
        },
      },
      defaults: { provider: 'llm' },
    };

    const engine = new SwarmEngine(config);

    const dag = engine
      .dag()
      .agent('worker', {
        id: 'worker',
        name: 'Worker',
        role: 'worker',
        systemPrompt: 'You work.',
        providerId: 'myAgentic',
      })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'Do work' }));

    // The agentic node should produce chunks from the agentic adapter
    const chunks = eventsOfType(events, 'agent_chunk');
    expect(chunks.length).toBeGreaterThan(0);
    // The AgenticRunner maps agentic 'chunk' events to 'agent_chunk' SwarmEvents
    const chunkContent = chunks.map((c) => c.content).join('');
    expect(chunkContent).toBe('agentic result');

    // Should produce agent_done with the agentic output
    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones).toHaveLength(1);
    expect(agentDones[0].output).toBe('agentic result');
    expect(agentDones[0].nodeId).toBe('worker');

    // Swarm done
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results[0].output).toBe('agentic result');
  });

  it('standard nodes still work unchanged alongside agentic providers', async () => {
    const config: SwarmEngineConfig = {
      providers: {
        standard: {
          type: 'custom',
          adapter: createMockLLMAdapter('standard output'),
        },
        agentic: {
          type: 'custom-agentic',
          agenticAdapter: createMockAgenticAdapter('unused'),
        },
      },
      defaults: { provider: 'standard' },
    };

    const engine = new SwarmEngine(config);

    // Build a DAG that only uses the standard provider
    const dag = engine
      .dag()
      .agent('a', {
        id: 'a',
        name: 'Agent A',
        role: 'a',
        systemPrompt: 'You are A.',
        providerId: 'standard',
      })
      .agent('b', {
        id: 'b',
        name: 'Agent B',
        role: 'b',
        systemPrompt: 'You are B.',
        providerId: 'standard',
      })
      .edge('a', 'b')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'Standard test' }));

    // Both agents produce standard output
    const agentDones = eventsOfType(events, 'agent_done');
    expect(agentDones).toHaveLength(2);
    expect(agentDones[0].output).toBe('standard output');
    expect(agentDones[1].output).toBe('standard output');

    // Swarm completes
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
    expect(swarmDones[0].results).toHaveLength(2);
  });

  it('validates DAG with agentic provider references correctly', async () => {
    const config: SwarmEngineConfig = {
      providers: {
        llm: {
          type: 'custom',
          adapter: createMockLLMAdapter('output'),
        },
        myAgent: {
          type: 'custom-agentic',
          agenticAdapter: createMockAgenticAdapter('output'),
        },
      },
      defaults: { provider: 'llm' },
    };

    const engine = new SwarmEngine(config);

    // DAG that references both providers — should pass validation
    const dag = engine
      .dag()
      .agent('n1', {
        id: 'n1',
        name: 'N1',
        role: 'n1',
        systemPrompt: '',
        providerId: 'llm',
      })
      .agent('n2', {
        id: 'n2',
        name: 'N2',
        role: 'n2',
        systemPrompt: '',
        providerId: 'myAgent',
      })
      .edge('n1', 'n2')
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'validation test' }));

    // Should NOT have a validation error
    const errors = eventsOfType(events, 'swarm_error');
    expect(errors).toHaveLength(0);

    // Should complete successfully
    const swarmDones = eventsOfType(events, 'swarm_done');
    expect(swarmDones).toHaveLength(1);
  });

  it('rejects DAG referencing a non-existent provider alongside agentic providers', async () => {
    const config: SwarmEngineConfig = {
      providers: {
        llm: {
          type: 'custom',
          adapter: createMockLLMAdapter('output'),
        },
        myAgent: {
          type: 'custom-agentic',
          agenticAdapter: createMockAgenticAdapter('output'),
        },
      },
      defaults: { provider: 'llm' },
    };

    const engine = new SwarmEngine(config);

    const dag = engine
      .dag()
      .agent('n1', {
        id: 'n1',
        name: 'N1',
        role: 'n1',
        systemPrompt: '',
        providerId: 'nonexistent',
      })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'fail validation' }));

    const errors = eventsOfType(events, 'swarm_error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('DAG validation failed');
    expect(errors[0].message).toContain('nonexistent');
  });

  it('only-agentic config still works when default provider falls back to first standard provider', async () => {
    // A config with only an agentic provider (no standard LLM provider).
    // The engine should emit "No provider available" because defaultProvider
    // comes from this.providers (standard only).
    const config: SwarmEngineConfig = {
      providers: {
        myAgent: {
          type: 'custom-agentic',
          agenticAdapter: createMockAgenticAdapter('agentic output'),
        },
      },
    };

    const engine = new SwarmEngine(config);

    const dag = engine
      .dag()
      .agent('worker', {
        id: 'worker',
        name: 'Worker',
        role: 'worker',
        systemPrompt: 'Do work.',
        providerId: 'myAgent',
      })
      .build();

    const events = await collectEvents(engine.run({ dag, task: 'agentic only' }));

    // Should get swarm_error because no standard provider is available as default
    const errors = eventsOfType(events, 'swarm_error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('No provider available');
  });
});
