import { describe, it, expect } from 'vitest';
import { ContextAssembler } from '../../src/context/assembler.js';
import { NoopContextProvider, NoopMemoryProvider, NoopCodebaseProvider, NoopPersonaProvider } from '../../src/adapters/defaults.js';
import { SwarmMemory } from '../../src/memory/index.js';

describe('ContextAssembler', () => {
  it('assembles context in priority order', async () => {
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    });

    const messages = await assembler.assemble({
      systemPrompt: 'You are a PM.',
      task: 'Write a PRD',
      contextWindow: 128_000,
    });

    expect(messages.length).toBeGreaterThanOrEqual(2); // system + user
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('You are a PM.');
    expect(messages[messages.length - 1].role).toBe('user');
    expect(messages[messages.length - 1].content).toContain('Write a PRD');
  });

  it('includes upstream outputs when provided', async () => {
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    });

    const messages = await assembler.assemble({
      systemPrompt: 'You are an architect.',
      task: 'Create tech spec',
      upstreamOutputs: [{ nodeId: 'pm', agentRole: 'pm', output: 'PRD content here...' }],
      contextWindow: 128_000,
    });

    const systemContent = messages[0].content;
    expect(systemContent).toContain('PRD content here');
  });

  it('includes scratchpad and inbox when provided', async () => {
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    });

    const swarmMemory = new SwarmMemory();
    swarmMemory.scratchpad.set('stage', 'mvp', 'pm');
    swarmMemory.channels.send('pm', 'architect', 'Focus on APIs');

    const messages = await assembler.assemble({
      systemPrompt: 'You are an architect.',
      task: 'Create tech spec',
      swarmMemory,
      agentId: 'architect',
      contextWindow: 128_000,
    });

    const systemContent = messages[0].content;
    expect(systemContent).toContain('mvp');
    expect(systemContent).toContain('Focus on APIs');
  });
});
