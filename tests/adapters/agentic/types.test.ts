import { describe, it, expect } from 'vitest';
import type {
  AgenticAdapter,
  AgenticRunParams,
  AgenticEvent,
  AgenticOptions,
  AgenticTool,
} from '../../../src/adapters/agentic/types.js';
import type { ProviderConfig, AgentDescriptor } from '../../../src/types.js';

describe('Agentic types', () => {
  it('ProviderConfig accepts agentic types', () => {
    const config: ProviderConfig = { type: 'claude-code' };
    expect(config.type).toBe('claude-code');

    const codexConfig: ProviderConfig = { type: 'codex' };
    expect(codexConfig.type).toBe('codex');

    const customConfig: ProviderConfig = { type: 'custom-agentic' };
    expect(customConfig.type).toBe('custom-agentic');
  });

  it('AgentDescriptor accepts agentic options', () => {
    const agent: AgentDescriptor = {
      id: 'coder',
      name: 'Coder',
      role: 'coder',
      systemPrompt: 'You are a coder.',
      providerId: 'claude-code',
      agentic: {
        allowedTools: ['Read', 'Edit', 'Bash'],
        permissionMode: 'acceptEdits',
        cwd: './workspace',
        maxBudgetUsd: 1.0,
        maxTurns: 20,
      },
    };
    expect(agent.agentic?.allowedTools).toEqual(['Read', 'Edit', 'Bash']);
    expect(agent.agentic?.cwd).toBe('./workspace');
  });

  it('AgenticAdapter interface is implementable', () => {
    const adapter: AgenticAdapter = {
      async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
        yield { type: 'chunk', content: 'hello' };
        yield { type: 'result', output: 'done', inputTokens: 10, outputTokens: 5 };
      },
    };
    expect(adapter.run).toBeDefined();
  });

  it('AgenticTool interface works', () => {
    const tool: AgenticTool = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      execute: (input) => `result: ${input.key}`,
    };
    expect(tool.execute({ key: 'hello' })).toBe('result: hello');
  });
});
