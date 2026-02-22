import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgenticRunParams, AgenticTool } from '../../../src/adapters/agentic/types.js';

// Mock the SDK before importing the adapter
const mockQuery = vi.fn();
const mockCreateSdkMcpServer = vi.fn();
const mockTool = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
  tool: mockTool,
}));

// Import after mocking
const { ClaudeCodeAdapter } = await import('../../../src/adapters/agentic/claude-code-adapter.js');

describe('ClaudeCodeAdapter', () => {
  let adapter: InstanceType<typeof ClaudeCodeAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeCodeAdapter();
  });

  function makeParams(overrides: Partial<AgenticRunParams> = {}): AgenticRunParams {
    return {
      task: 'Do something',
      systemPrompt: 'You are a helpful agent',
      upstreamContext: '',
      ...overrides,
    };
  }

  async function collectEvents(gen: AsyncGenerator<any>) {
    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }
    return events;
  }

  it('yields chunk events from assistant messages', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'text', text: 'world' },
            ],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          result: 'Done',
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toEqual([
      { type: 'chunk', content: 'Hello ' },
      { type: 'chunk', content: 'world' },
      {
        type: 'result',
        output: 'Done',
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 50,
      },
    ]);
  });

  it('yields result event with cost data on success', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'Task completed',
          total_cost_usd: 0.05,
          usage: { input_tokens: 500, output_tokens: 200 },
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'result',
      output: 'Task completed',
      costUsd: 0.05,
      inputTokens: 500,
      outputTokens: 200,
    });
  });

  it('yields error event on failure result', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'error',
          error: 'Something went wrong',
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      message: 'Something went wrong',
    });
  });

  it('yields error with default message when error field is missing', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'error',
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      message: 'Claude Code agent failed',
    });
  });

  it('passes agentic options through to query()', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })(),
    );

    const params = makeParams({
      agenticOptions: {
        permissionMode: 'default',
        allowedTools: ['Read', 'Write'],
        disallowedTools: ['Bash'],
        cwd: '/tmp/test',
        maxTurns: 10,
        maxBudgetUsd: 1.0,
        model: 'claude-opus-4-6',
        mcpServers: { existing: { type: 'stdio', command: 'node' } },
        env: { FOO: 'bar' },
      },
    });

    await collectEvents(adapter.run(params));

    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.permissionMode).toBe('default');
    expect(callArgs.options.allowedTools).toEqual(['Read', 'Write']);
    expect(callArgs.options.disallowedTools).toEqual(['Bash']);
    expect(callArgs.options.cwd).toBe('/tmp/test');
    expect(callArgs.options.maxTurns).toBe(10);
    expect(callArgs.options.maxBudgetUsd).toBe(1.0);
    expect(callArgs.options.model).toBe('claude-opus-4-6');
    expect(callArgs.options.mcpServers).toHaveProperty('existing');
    expect(callArgs.options.env).toEqual({ FOO: 'bar' });
  });

  it('defaults permissionMode to bypassPermissions', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })(),
    );

    await collectEvents(adapter.run(makeParams()));

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.permissionMode).toBe('bypassPermissions');
  });

  it('prepends upstream context to prompt', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })(),
    );

    const params = makeParams({
      task: 'Build a feature',
      upstreamContext: 'Previous node said: use TypeScript',
    });

    await collectEvents(adapter.run(params));

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toBe(
      'Previous node said: use TypeScript\n\n## Task\nBuild a feature',
    );
  });

  it('uses task alone as prompt when no upstream context', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })(),
    );

    await collectEvents(adapter.run(makeParams({ task: 'Just do it', upstreamContext: '' })));

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toBe('Just do it');
  });

  it('injects communication tools as MCP server when tools are provided', async () => {
    const mockServerInstance = { start: vi.fn() };
    mockCreateSdkMcpServer.mockReturnValue({ instance: mockServerInstance });
    mockTool.mockImplementation((name: string) => ({ name, type: 'tool' }));

    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })(),
    );

    const tools: AgenticTool[] = [
      {
        name: 'send_message',
        description: 'Send a message',
        inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
        execute: async (args: Record<string, unknown>) => `sent: ${args.msg}`,
      },
    ];

    await collectEvents(adapter.run(makeParams({ tools })));

    // Verify tool() was called to create the MCP tool
    expect(mockTool).toHaveBeenCalledOnce();
    expect(mockTool.mock.calls[0][0]).toBe('send_message');
    expect(mockTool.mock.calls[0][1]).toBe('Send a message');
    // Schema is a Zod shape object (not plain JSON Schema)
    expect(mockTool.mock.calls[0][2]).toBeDefined();

    // Verify createSdkMcpServer was called with the tools
    expect(mockCreateSdkMcpServer).toHaveBeenCalledOnce();
    expect(mockCreateSdkMcpServer.mock.calls[0][0].name).toBe('swarm-comm');
    expect(mockCreateSdkMcpServer.mock.calls[0][0].tools).toHaveLength(1);

    // Verify the MCP server was injected into options
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.mcpServers['swarm-comm']).toEqual({
      type: 'sdk',
      instance: mockServerInstance,
    });
  });

  it('wraps tool execute result in MCP content format', async () => {
    mockCreateSdkMcpServer.mockReturnValue({ instance: {} });
    mockTool.mockImplementation(
      (_name: string, _desc: string, _schema: any, handler: any) => {
        // Store the handler so we can test it
        mockTool._capturedHandler = handler;
        return { name: _name, type: 'tool' };
      },
    );

    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })(),
    );

    const tools: AgenticTool[] = [
      {
        name: 'greet',
        description: 'Greet someone',
        inputSchema: { type: 'object' },
        execute: async (args: Record<string, unknown>) => `Hello ${args.name}`,
      },
    ];

    await collectEvents(adapter.run(makeParams({ tools })));

    // Call the captured handler
    const handler = (mockTool as any)._capturedHandler;
    const result = await handler({ name: 'Alice' });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Hello Alice' }],
    });
  });

  it('handles result with missing result field gracefully', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.02,
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'result',
      output: '',
      costUsd: 0.02,
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('has a default export for lazy loading', async () => {
    const mod = await import('../../../src/adapters/agentic/claude-code-adapter.js');
    expect(mod.default).toBe(ClaudeCodeAdapter);
  });
});
