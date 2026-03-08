import { describe, it, expect, vi } from 'vitest';
import { ContextAssembler } from '../../src/context/assembler.js';
import { NoopContextProvider, NoopMemoryProvider, NoopCodebaseProvider, NoopPersonaProvider } from '../../src/adapters/defaults.js';
import { SwarmMemory } from '../../src/memory/index.js';
import { Logger } from '../../src/logger.js';
import type { PersonaProvider, PersonaConfig, LogEntry } from '../../src/types.js';

function createMockPersonaProvider(persona: PersonaConfig | null): PersonaProvider {
  return { getPersona: async () => persona };
}

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

  it('injects fullPrompt directly when present on PersonaConfig', async () => {
    const fullMarkdown = '# Software Engineer\n\nYou are a software engineer with deep expertise...';
    const provider = createMockPersonaProvider({
      name: 'Software Engineer',
      role: 'engineer',
      traits: ['Direct'],
      constraints: ['Write tests'],
      fullPrompt: fullMarkdown,
    });

    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: provider,
    });

    const messages = await assembler.assemble({
      systemPrompt: 'Base system prompt.',
      task: 'Build a feature',
      contextWindow: 100000,
    });

    const systemContent = messages[0].content;
    expect(systemContent).toContain(fullMarkdown);
    expect(systemContent).not.toContain('## Persona: Software Engineer');
  });

  it('falls back to structured format when fullPrompt is absent', async () => {
    const provider = createMockPersonaProvider({
      name: 'PM',
      role: 'product-manager',
      traits: ['Analytical'],
      constraints: ['Stay in scope'],
    });

    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: provider,
    });

    const messages = await assembler.assemble({
      systemPrompt: 'Base system prompt.',
      task: 'Plan a sprint',
      contextWindow: 100000,
    });

    const systemContent = messages[0].content;
    expect(systemContent).toContain('## Persona: PM');
    expect(systemContent).toContain('Role: product-manager');
  });

  it('logs context sections at debug level', async () => {
    const logs: LogEntry[] = [];
    const logger = new Logger({ level: 'debug', onLog: (e) => logs.push(e) });
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    }, logger);

    await assembler.assemble({
      systemPrompt: 'You are a test agent.',
      task: 'Do something.',
      contextWindow: 128_000,
    });

    const debugLogs = logs.filter(l => l.level === 'debug');
    expect(debugLogs.some(l => l.message.includes('Context section'))).toBe(true);
    expect(debugLogs.some(l => l.message.includes('Context assembled'))).toBe(true);
    // Should include section count
    const assembledLog = debugLogs.find(l => l.message.includes('Context assembled'));
    expect(assembledLog?.context?.sections).toBeGreaterThanOrEqual(2);
  });

  describe('handoff instructions', () => {
    it('injects handoff formatting instructions into system prompt', async () => {
      const assembler = new ContextAssembler({
        context: new NoopContextProvider(),
        memory: new NoopMemoryProvider(),
        codebase: new NoopCodebaseProvider(),
        persona: new NoopPersonaProvider(),
      });

      const template = {
        id: 'test',
        sections: [{ key: 'summary', label: 'Summary', required: true }],
      };

      const messages = await assembler.assemble({
        systemPrompt: 'You are a developer.',
        task: 'Build a feature',
        contextWindow: 100000,
        handoffTemplate: template,
      });

      const systemContent = messages.find(m => m.role === 'system')!.content;
      expect(systemContent).toContain('## Output Format');
      expect(systemContent).toContain('## Summary (REQUIRED)');
    });

    it('does not inject instructions when no handoff template provided', async () => {
      const assembler = new ContextAssembler({
        context: new NoopContextProvider(),
        memory: new NoopMemoryProvider(),
        codebase: new NoopCodebaseProvider(),
        persona: new NoopPersonaProvider(),
      });

      const messages = await assembler.assemble({
        systemPrompt: 'You are a developer.',
        task: 'Build a feature',
        contextWindow: 100000,
      });

      const systemContent = messages.find(m => m.role === 'system')!.content;
      expect(systemContent).not.toContain('## Output Format');
    });
  });

  describe('feedback context', () => {
    it('injects feedback context at high priority', async () => {
      const assembler = new ContextAssembler({
        context: new NoopContextProvider(),
        memory: new NoopMemoryProvider(),
        codebase: new NoopCodebaseProvider(),
        persona: new NoopPersonaProvider(),
      });

      const messages = await assembler.assemble({
        systemPrompt: 'You are a developer.',
        task: 'Build a feature',
        contextWindow: 100000,
        feedbackContext: {
          iteration: 2,
          maxRetries: 3,
          previousFeedback: 'Missing error handling in the auth module.',
          feedbackHistory: ['Incomplete implementation.', 'Missing error handling in the auth module.'],
        },
      });

      const systemContent = messages.find(m => m.role === 'system')!.content;
      expect(systemContent).toContain('## Retry Feedback');
      expect(systemContent).toContain('Attempt 2 of 3');
      expect(systemContent).toContain('Missing error handling in the auth module.');
    });

    it('does not inject feedback when not provided', async () => {
      const assembler = new ContextAssembler({
        context: new NoopContextProvider(),
        memory: new NoopMemoryProvider(),
        codebase: new NoopCodebaseProvider(),
        persona: new NoopPersonaProvider(),
      });

      const messages = await assembler.assemble({
        systemPrompt: 'You are a developer.',
        task: 'Build a feature',
        contextWindow: 100000,
      });

      const systemContent = messages.find(m => m.role === 'system')!.content;
      expect(systemContent).not.toContain('## Retry Feedback');
    });

    it('includes feedback history when multiple attempts', async () => {
      const assembler = new ContextAssembler({
        context: new NoopContextProvider(),
        memory: new NoopMemoryProvider(),
        codebase: new NoopCodebaseProvider(),
        persona: new NoopPersonaProvider(),
      });

      const messages = await assembler.assemble({
        systemPrompt: 'You are a developer.',
        task: 'Build a feature',
        contextWindow: 100000,
        feedbackContext: {
          iteration: 3,
          maxRetries: 5,
          previousFeedback: 'Still missing validation.',
          feedbackHistory: ['No tests.', 'Missing auth.', 'Still missing validation.'],
        },
      });

      const systemContent = messages.find(m => m.role === 'system')!.content;
      expect(systemContent).toContain('### Feedback History');
      expect(systemContent).toContain('1. No tests.');
      expect(systemContent).toContain('2. Missing auth.');
      expect(systemContent).toContain('3. Still missing validation.');
    });
  });
});
