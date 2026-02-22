import type { AgenticAdapter, AgenticRunParams, AgenticEvent } from './types.js';

export class CodexAdapter implements AgenticAdapter {
  async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
    const { Codex } = await import('@openai/codex-sdk');

    const codex = new Codex();
    const thread = codex.startThread();

    const fullPrompt = params.upstreamContext
      ? `${params.upstreamContext}\n\n## Task\n${params.task}`
      : params.task;

    for await (const event of thread.runStreamed(fullPrompt)) {
      const e = event as any;
      switch (e.type) {
        case 'text':
          yield { type: 'chunk', content: e.content };
          break;
        case 'tool_call':
          yield { type: 'tool_use', tool: e.name, input: e.input ?? {} };
          break;
        case 'done':
          yield {
            type: 'result',
            output: e.output ?? '',
            inputTokens: e.usage?.input_tokens,
            outputTokens: e.usage?.output_tokens,
          };
          break;
        case 'error':
          yield { type: 'error', message: e.message ?? 'Codex agent failed' };
          break;
      }
    }
  }
}

// Default export for lazy loading via createLazyAdapter
export default CodexAdapter;
