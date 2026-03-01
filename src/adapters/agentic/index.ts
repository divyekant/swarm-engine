export { type AgenticAdapter, type AgenticRunParams, type AgenticEvent, type AgenticOptions, type AgenticTool } from './types.js';

import type { ProviderConfig } from '../../types.js';
import type { AgenticAdapter, AgenticRunParams, AgenticEvent } from './types.js';
import { ClaudeCodeAdapter } from './claude-code-adapter.js';
import { CodexAdapter } from './codex-adapter.js';

const AGENTIC_PROVIDERS = new Set(['claude-code', 'codex', 'custom-agentic']);

/**
 * Returns true if the given provider type is an agentic provider
 * (i.e. one that uses AgenticAdapter instead of ProviderAdapter).
 */
export function isAgenticProvider(type: string): boolean {
  return AGENTIC_PROVIDERS.has(type);
}

/**
 * Factory that creates an AgenticAdapter based on the provider config type.
 *
 * Adapter classes are statically imported but lazily instantiated — the
 * underlying SDK (e.g. @anthropic-ai/claude-agent-sdk) is only loaded
 * inside run(), so consumers pay no cost until actually executing a node.
 *
 * - 'custom-agentic': returns config.agenticAdapter (throws if not provided)
 * - 'claude-code': lazy-instantiates ClaudeCodeAdapter
 * - 'codex': lazy-instantiates CodexAdapter
 * - Unknown type: throws
 */
export function createAgenticAdapter(config: ProviderConfig): AgenticAdapter {
  switch (config.type) {
    case 'custom-agentic': {
      if (!config.agenticAdapter) {
        throw new Error(
          'Custom agentic provider requires agenticAdapter in ProviderConfig. ' +
          'Provide an object implementing the AgenticAdapter interface.',
        );
      }
      return config.agenticAdapter;
    }

    case 'claude-code': {
      let cached: ClaudeCodeAdapter | null = null;
      return {
        async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
          if (!cached) cached = new ClaudeCodeAdapter();
          yield* cached.run(params);
        },
      };
    }

    case 'codex': {
      let cached: CodexAdapter | null = null;
      return {
        async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
          if (!cached) cached = new CodexAdapter();
          yield* cached.run(params);
        },
      };
    }

    default:
      throw new Error(`Unknown agentic provider type: ${config.type}`);
  }
}
