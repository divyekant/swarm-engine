// Core
export { SwarmEngine } from './engine.js';

// DAG
export { DAGBuilder } from './dag/builder.js';

// Memory
export { SwarmMemory } from './memory/index.js';

// Streaming
export { SwarmEventEmitter } from './streaming/emitter.js';

// Cost
export { CostTracker } from './cost/tracker.js';

// Errors
export { SwarmError, classifyError } from './errors/classification.js';

// Adapters (defaults)
export {
  InMemoryPersistence,
  NoopContextProvider,
  NoopMemoryProvider,
  NoopCodebaseProvider,
  NoopPersonaProvider,
  NoopLifecycleHooks,
} from './adapters/defaults.js';

// Provider factory + providers
export { createProvider, AnthropicOAuthProvider } from './adapters/providers/index.js';

// Persona adapters
export { PersonaSmithProvider } from './adapters/personas/personasmith.js';
export { parsePersonaMarkdown } from './adapters/personas/parser.js';

// Monitor
export { SSEBridge, startMonitor, createMonitorServer } from './monitor/index.js';
export type { MonitorState, MonitorHandle, MonitorOptions } from './monitor/index.js';

// Agentic adapters
export { isAgenticProvider, createAgenticAdapter } from './adapters/agentic/index.js';
export { AgenticRunner } from './agent/agentic-runner.js';
export type {
  AgenticAdapter,
  AgenticEvent,
  AgenticRunParams,
  AgenticOptions,
  AgenticTool,
} from './adapters/agentic/types.js';

// Types
export type * from './types.js';
