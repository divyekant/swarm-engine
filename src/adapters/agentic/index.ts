export { type AgenticAdapter, type AgenticRunParams, type AgenticEvent, type AgenticOptions, type AgenticTool } from './types.js';

import type { ProviderConfig } from '../../types.js';
import type { AgenticAdapter, AgenticRunParams, AgenticEvent } from './types.js';

const AGENTIC_PROVIDERS = new Set(['claude-code', 'codex', 'custom-agentic']);

/**
 * Returns true if the given provider type is an agentic provider
 * (i.e. one that uses AgenticAdapter instead of ProviderAdapter).
 */
export function isAgenticProvider(type: string): boolean {
  return AGENTIC_PROVIDERS.has(type);
}

/**
 * Dynamically import a module by path. Uses a variable to prevent TypeScript
 * from statically analyzing the import path (which would fail for modules
 * that don't exist yet, e.g. ClaudeCodeAdapter and CodexAdapter).
 */
async function dynamicImport(modulePath: string): Promise<Record<string, unknown>> {
  return import(modulePath);
}

/**
 * Creates a lazy-loading AgenticAdapter that defers the actual SDK import
 * to the first call to run(). This lets createAgenticAdapter remain synchronous
 * while still doing dynamic imports for the concrete adapter classes.
 *
 * If the adapter file fails to load (e.g. the required SDK is not installed),
 * the error is caught and re-thrown with a helpful install message.
 */
function createLazyAdapter(modulePath: string, sdkPackage: string): AgenticAdapter {
  let cached: AgenticAdapter | null = null;

  async function getAdapter(): Promise<AgenticAdapter> {
    if (!cached) {
      try {
        const mod = await dynamicImport(modulePath);
        const Ctor = (mod.default ?? mod) as new () => AgenticAdapter;
        cached = new Ctor();
      } catch (err: unknown) {
        throw new Error(
          `Failed to load agentic adapter from ${modulePath}. ` +
          `Ensure ${sdkPackage} is installed: npm install ${sdkPackage}`,
          { cause: err },
        );
      }
    }
    return cached;
  }

  return {
    async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
      const adapter = await getAdapter();
      yield* adapter.run(params);
    },
  };
}

/**
 * Factory that creates an AgenticAdapter based on the provider config type.
 *
 * - 'custom-agentic': returns config.agenticAdapter (throws if not provided)
 * - 'claude-code': checks for @anthropic-ai/claude-agent-sdk, lazy-imports ClaudeCodeAdapter
 * - 'codex': checks for @openai/codex-sdk, lazy-imports CodexAdapter
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
      return createLazyAdapter('./adapters/agentic/claude-code-adapter.js', '@anthropic-ai/claude-agent-sdk');
    }

    case 'codex': {
      return createLazyAdapter('./adapters/agentic/codex-adapter.js', '@openai/codex-sdk');
    }

    default:
      throw new Error(`Unknown agentic provider type: ${config.type}`);
  }
}
