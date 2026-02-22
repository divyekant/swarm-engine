import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgenticRunParams } from '../../../src/adapters/agentic/types.js';

// Mock the SDK before importing the adapter
const mockRunStreamed = vi.fn();
const mockStartThread = vi.fn(() => ({
  runStreamed: mockRunStreamed,
}));

vi.mock('@openai/codex-sdk', () => ({
  Codex: class MockCodex {
    startThread() {
      return mockStartThread();
    }
  },
}));

// Import after mocking
const { CodexAdapter } = await import('../../../src/adapters/agentic/codex-adapter.js');

describe('CodexAdapter', () => {
  let adapter: InstanceType<typeof CodexAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CodexAdapter();
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

  it('yields chunk and result events from streamed run', async () => {
    mockRunStreamed.mockReturnValue(
      (async function* () {
        yield { type: 'text', content: 'Hello ' };
        yield { type: 'text', content: 'world' };
        yield {
          type: 'done',
          output: 'Completed task',
          usage: { input_tokens: 200, output_tokens: 80 },
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toEqual([
      { type: 'chunk', content: 'Hello ' },
      { type: 'chunk', content: 'world' },
      {
        type: 'result',
        output: 'Completed task',
        inputTokens: 200,
        outputTokens: 80,
      },
    ]);
  });

  it('yields tool_use events for tool calls', async () => {
    mockRunStreamed.mockReturnValue(
      (async function* () {
        yield {
          type: 'tool_call',
          name: 'read_file',
          input: { path: '/tmp/test.ts' },
        };
        yield {
          type: 'tool_call',
          name: 'write_file',
          input: { path: '/tmp/out.ts', content: 'hello' },
        };
        yield {
          type: 'done',
          output: 'Files processed',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toEqual([
      { type: 'tool_use', tool: 'read_file', input: { path: '/tmp/test.ts' } },
      { type: 'tool_use', tool: 'write_file', input: { path: '/tmp/out.ts', content: 'hello' } },
      {
        type: 'result',
        output: 'Files processed',
        inputTokens: 100,
        outputTokens: 50,
      },
    ]);
  });

  it('yields tool_use with empty input when input is missing', async () => {
    mockRunStreamed.mockReturnValue(
      (async function* () {
        yield {
          type: 'tool_call',
          name: 'list_files',
        };
        yield {
          type: 'done',
          output: 'done',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events[0]).toEqual({
      type: 'tool_use',
      tool: 'list_files',
      input: {},
    });
  });

  it('prepends upstream context to prompt', async () => {
    mockRunStreamed.mockReturnValue(
      (async function* () {
        yield {
          type: 'done',
          output: 'ok',
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })(),
    );

    const params = makeParams({
      task: 'Build a feature',
      upstreamContext: 'Previous node said: use TypeScript',
    });

    await collectEvents(adapter.run(params));

    expect(mockRunStreamed).toHaveBeenCalledOnce();
    expect(mockRunStreamed.mock.calls[0][0]).toBe(
      'Previous node said: use TypeScript\n\n## Task\nBuild a feature',
    );
  });

  it('uses task alone as prompt when no upstream context', async () => {
    mockRunStreamed.mockReturnValue(
      (async function* () {
        yield {
          type: 'done',
          output: 'ok',
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })(),
    );

    await collectEvents(adapter.run(makeParams({ task: 'Just do it', upstreamContext: '' })));

    expect(mockRunStreamed).toHaveBeenCalledOnce();
    expect(mockRunStreamed.mock.calls[0][0]).toBe('Just do it');
  });

  it('yields error event on error', async () => {
    mockRunStreamed.mockReturnValue(
      (async function* () {
        yield {
          type: 'error',
          message: 'Something went wrong',
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

  it('yields error with default message when message field is missing', async () => {
    mockRunStreamed.mockReturnValue(
      (async function* () {
        yield {
          type: 'error',
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      message: 'Codex agent failed',
    });
  });

  it('handles done event with missing output gracefully', async () => {
    mockRunStreamed.mockReturnValue(
      (async function* () {
        yield {
          type: 'done',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'result',
      output: '',
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('handles done event with missing usage gracefully', async () => {
    mockRunStreamed.mockReturnValue(
      (async function* () {
        yield {
          type: 'done',
          output: 'finished',
        };
      })(),
    );

    const events = await collectEvents(adapter.run(makeParams()));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'result',
      output: 'finished',
      inputTokens: undefined,
      outputTokens: undefined,
    });
  });

  it('has default export for lazy loading', async () => {
    const mod = await import('../../../src/adapters/agentic/codex-adapter.js');
    expect(mod.default).toBe(CodexAdapter);
  });
});
