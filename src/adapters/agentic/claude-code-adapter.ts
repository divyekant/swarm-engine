import type { AgenticAdapter, AgenticRunParams, AgenticEvent } from './types.js';

export class ClaudeCodeAdapter implements AgenticAdapter {
  async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const { query } = sdk;

    const fullPrompt = params.upstreamContext
      ? `${params.upstreamContext}\n\n## Task\n${params.task}`
      : params.task;

    const permissionMode = params.agenticOptions?.permissionMode ?? 'bypassPermissions';

    // Build clean env without CLAUDECODE to avoid nested-session detection
    const baseEnv = params.agenticOptions?.env ?? { ...process.env };
    const cleanEnv: Record<string, string | undefined> = { ...baseEnv };
    delete cleanEnv['CLAUDECODE'];

    const options: Record<string, unknown> = {
      systemPrompt: params.systemPrompt,
      permissionMode,
      mcpServers: { ...(params.agenticOptions?.mcpServers as Record<string, unknown> ?? {}) },
      // Required when using bypassPermissions mode
      ...(permissionMode === 'bypassPermissions' && { allowDangerouslySkipPermissions: true }),
      // Prevent nested-session detection
      env: cleanEnv,
      // Capture stderr for diagnostics
      stderr: (data: string) => {
        if (process.env.SWARM_DEBUG) {
          process.stderr.write(`[cc-adapter] ${data}`);
        }
      },
    };

    // Pass through optional agentic options
    if (params.agenticOptions?.allowedTools) options.allowedTools = params.agenticOptions.allowedTools;
    if (params.agenticOptions?.disallowedTools) options.disallowedTools = params.agenticOptions.disallowedTools;
    if (params.agenticOptions?.cwd) options.cwd = params.agenticOptions.cwd;
    if (params.agenticOptions?.maxTurns !== undefined) options.maxTurns = params.agenticOptions.maxTurns;
    if (params.agenticOptions?.maxBudgetUsd !== undefined) options.maxBudgetUsd = params.agenticOptions.maxBudgetUsd;
    if (params.agenticOptions?.model) options.model = params.agenticOptions.model;
    // env is already handled above (with CLAUDECODE stripped) — don't override it

    // Inject communication tools as an in-process MCP server if SDK supports it
    if (params.tools?.length && sdk.createSdkMcpServer && sdk.tool) {
      try {
        const { z } = await import('zod');
        const mcpTools = params.tools.map((t) =>
          sdk.tool!(t.name, t.description, { input: z.string().optional() }, async (args: Record<string, unknown>) => {
            const result = await t.execute(args);
            return { content: [{ type: 'text' as const, text: result }] };
          }),
        );
        const server = sdk.createSdkMcpServer!({ name: 'swarm-comm', tools: mcpTools });
        (options.mcpServers as Record<string, unknown>)['swarm-comm'] = {
          type: 'sdk',
          instance: server.instance,
        };
      } catch {
        // MCP tool injection failed — continue without communication tools
      }
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
          // Extract detailed error info
          const errorDetail = msg.errors?.join('; ') ?? msg.error ?? 'Claude Code agent failed';
          yield { type: 'error', message: errorDetail };
        }
      }
    }
  }
}

// Default export for lazy loading via createLazyAdapter
export default ClaudeCodeAdapter;
