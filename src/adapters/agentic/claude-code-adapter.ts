import type { AgenticAdapter, AgenticRunParams, AgenticEvent } from './types.js';

export class ClaudeCodeAdapter implements AgenticAdapter {
  async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
    const { query, createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');

    const fullPrompt = params.upstreamContext
      ? `${params.upstreamContext}\n\n## Task\n${params.task}`
      : params.task;

    const options: Record<string, unknown> = {
      systemPrompt: params.systemPrompt,
      permissionMode: params.agenticOptions?.permissionMode ?? 'bypassPermissions',
      mcpServers: { ...(params.agenticOptions?.mcpServers as Record<string, unknown> ?? {}) },
    };

    // Pass through optional agentic options
    if (params.agenticOptions?.allowedTools) options.allowedTools = params.agenticOptions.allowedTools;
    if (params.agenticOptions?.disallowedTools) options.disallowedTools = params.agenticOptions.disallowedTools;
    if (params.agenticOptions?.cwd) options.cwd = params.agenticOptions.cwd;
    if (params.agenticOptions?.maxTurns !== undefined) options.maxTurns = params.agenticOptions.maxTurns;
    if (params.agenticOptions?.maxBudgetUsd !== undefined) options.maxBudgetUsd = params.agenticOptions.maxBudgetUsd;
    if (params.agenticOptions?.model) options.model = params.agenticOptions.model;
    if (params.agenticOptions?.env) options.env = params.agenticOptions.env;

    // Inject communication tools as an in-process MCP server
    if (params.tools?.length) {
      const mcpTools = params.tools.map((t) =>
        tool(t.name, t.description, t.inputSchema, async (args: Record<string, unknown>) => {
          const result = await t.execute(args);
          return { content: [{ type: 'text' as const, text: result }] };
        }),
      );
      const server = createSdkMcpServer({ name: 'swarm-comm', tools: mcpTools });
      (options.mcpServers as Record<string, unknown>)['swarm-comm'] = {
        type: 'sdk',
        instance: server.instance,
      };
    }

    for await (const message of query({ prompt: fullPrompt, options })) {
      if (message.type === 'assistant') {
        for (const block of (message as any).message?.content ?? []) {
          if ('text' in block) {
            yield { type: 'chunk', content: block.text };
          }
        }
      } else if (message.type === 'result') {
        const msg = message as any;
        if (msg.subtype === 'success') {
          yield {
            type: 'result',
            output: msg.result ?? '',
            costUsd: msg.total_cost_usd,
            inputTokens: msg.usage?.input_tokens,
            outputTokens: msg.usage?.output_tokens,
          };
        } else {
          yield { type: 'error', message: msg.error ?? 'Agent failed' };
        }
      }
    }
  }
}

// Default export for lazy loading via createLazyAdapter
export default ClaudeCodeAdapter;
