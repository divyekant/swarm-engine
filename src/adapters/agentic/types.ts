export interface AgenticAdapter {
  run(params: AgenticRunParams): AsyncGenerator<AgenticEvent>;
  estimateCost?(model: string, inputTokens: number, outputTokens: number): number;
}

export interface AgenticRunParams {
  task: string;
  systemPrompt: string;
  upstreamContext: string;
  agenticOptions?: AgenticOptions;
  signal?: AbortSignal;
  tools?: AgenticTool[];
}

export interface AgenticOptions {
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  cwd?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  model?: string;
  mcpServers?: Record<string, unknown>;
  env?: Record<string, string>;
}

export type AgenticEvent =
  | { type: 'chunk'; content: string }
  | { type: 'tool_use'; tool: string; input: Record<string, unknown> }
  | { type: 'result'; output: string; costUsd?: number; inputTokens?: number; outputTokens?: number }
  | { type: 'error'; message: string };

export interface AgenticTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => string | Promise<string>;
}
