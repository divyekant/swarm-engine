// Type declarations for optional SDK dependencies.
// These modules are dynamically imported at runtime only when configured.
// Users must install them separately: npm install @anthropic-ai/claude-agent-sdk
// or npm install @openai/codex-sdk

declare module '@anthropic-ai/claude-agent-sdk' {
  export function query(params: {
    prompt: string;
    options?: Record<string, unknown>;
  }): AsyncGenerator<Record<string, unknown>>;

  export function createSdkMcpServer(config: {
    name: string;
    tools: unknown[];
  }): { instance: unknown };

  export function tool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): unknown;
}

declare module '@openai/codex-sdk' {
  export class Codex {
    startThread(): {
      runStreamed(prompt: string): AsyncGenerator<Record<string, unknown>>;
    };
  }
}
