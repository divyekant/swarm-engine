---
type: config-reference
audience: external
status: draft
generated: 2026-03-15
source-tier: direct
hermes-version: 1.0.1
---

# Configuration Reference

This document covers every configuration option for `@swarmengine/core` v0.3.0. Options are grouped by category: Engine, Providers, Defaults, Limits, Adapters, Agent, and Logging.

---

## Engine configuration -- `SwarmEngineConfig`

The top-level object you pass to `new SwarmEngine(config)`.

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `providers` | `Record<string, ProviderConfig>` | Yes | -- | Named map of LLM providers. At least one entry is required. |
| `defaults` | `EngineDefaults` | No | `undefined` | Fallback provider, model, temperature, and token limit for agents that do not specify their own. |
| `limits` | `EngineLimits` | No | `undefined` | Budget caps, concurrency limits, and duration constraints. |
| `persistence` | `PersistenceAdapter` | No | `InMemoryPersistence` (100-run LRU) | Where runs, artifacts, threads, and activity logs are stored. |
| `context` | `ContextProvider` | No | `NoopContextProvider` | Supplies domain context to agents by entity type and ID. |
| `memory` | `MemoryProvider` | No | `NoopMemoryProvider` | Semantic search and storage for long-term memory. |
| `codebase` | `CodebaseProvider` | No | `NoopCodebaseProvider` | Queries a codebase index for relevant source context. |
| `persona` | `PersonaProvider` | No | `NoopPersonaProvider` | Resolves agent personas by role. |
| `lifecycle` | `LifecycleHooks` | No | Noop (no hooks) | Callbacks fired on run start, completion, failure, and swarm completion. |
| `logging` | `LoggingConfig` | No | Disabled | Configures log output level, format, and custom handler. |

### Example

```typescript
import { SwarmEngine } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  },
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  limits: { maxConcurrentAgents: 3, maxSwarmBudgetCents: 500 },
  logging: { level: 'info' },
});
```

---

## Providers -- `ProviderConfig`

Each entry in the `providers` map configures one LLM backend.

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `type` | `'anthropic'` \| `'anthropic-oauth'` \| `'openai'` \| `'ollama'` \| `'custom'` \| `'claude-code'` \| `'codex'` \| `'custom-agentic'` | Yes | -- | Which provider SDK or adapter to use. |
| `apiKey` | `string` | No | -- | API key for the provider. Required for `anthropic`, `anthropic-oauth`, and `openai`. |
| `baseUrl` | `string` | No | Provider default | Custom base URL. Useful for `ollama` (e.g., `http://localhost:11434`) or proxy setups with `custom`. |
| `adapter` | `ProviderAdapter` | No | -- | Your own streaming adapter. Required when `type` is `'custom'`. |
| `agenticAdapter` | `AgenticAdapter` | No | -- | Your own agentic adapter. Required when `type` is `'custom-agentic'`. |

### Standard providers

Standard providers (`anthropic`, `anthropic-oauth`, `openai`, `ollama`, `custom`) stream LLM completions. The engine manages message history, tool calls, and token counting.

```typescript
providers: {
  anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  openai: { type: 'openai', apiKey: process.env.OPENAI_API_KEY },
  local: { type: 'ollama', baseUrl: 'http://localhost:11434' },
}
```

### Agentic providers

Agentic providers (`claude-code`, `codex`, `custom-agentic`) spawn autonomous agent sessions. Each node using an agentic provider runs as an isolated agent process capable of executing code, using tools, and managing its own conversation loop.

The `claude-code` and `codex` SDKs are **optional dependencies**. Install only what you need:

```bash
# For Claude Code agentic nodes
npm install @anthropic-ai/claude-agent-sdk

# For Codex agentic nodes
npm install @openai/codex-sdk
```

```typescript
providers: {
  anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  coder: { type: 'claude-code' },
}
```

You can mix standard and agentic providers in the same DAG. Assign an agentic provider to a specific agent using `providerId` on the agent descriptor.

---

## Defaults -- `EngineDefaults`

Fallback values applied to any agent that does not set its own.

| Option | Type | Default | Description |
|---|---|---|---|
| `provider` | `string` | First provider in the map | Key from the `providers` map to use when an agent omits `providerId`. |
| `model` | `string` | -- | Model identifier (e.g., `'claude-sonnet-4-20250514'`, `'gpt-4o'`). |
| `temperature` | `number` | `0.7` | Sampling temperature. |
| `maxTokens` | `number` | `4096` | Maximum tokens per LLM response. |

### Example

```typescript
defaults: {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.5,
  maxTokens: 8192,
}
```

---

## Limits -- `EngineLimits`

Safety guardrails for cost, concurrency, duration, memory, and iteration count.

| Option | Type | Default | Description |
|---|---|---|---|
| `maxSwarmBudgetCents` | `number` | No limit | Maximum total cost in cents for the entire swarm run. The engine emits a `budget_exceeded` event and stops execution when the limit is hit. |
| `maxPerAgentBudgetCents` | `number` | No limit | Maximum cost in cents for any single agent. |
| `maxConcurrentAgents` | `number` | `5` | Maximum number of agents that can run in parallel. |
| `maxSwarmDurationMs` | `number` | No limit | Maximum wall-clock time for the swarm run in milliseconds. |
| `maxScratchpadSizeBytes` | `number` | No limit | Maximum total size of the shared scratchpad in bytes. |
| `maxCycleIterations` | `number` | `10` | Maximum number of iterations for cyclic edges (loops). |

### Example

```typescript
limits: {
  maxSwarmBudgetCents: 1000,      // $10 total cap
  maxPerAgentBudgetCents: 200,    // $2 per agent
  maxConcurrentAgents: 3,
  maxSwarmDurationMs: 300_000,    // 5 minutes
  maxCycleIterations: 5,
}
```

---

## Adapter interfaces

When the built-in providers do not cover your needs, you can implement these interfaces.

### `ProviderAdapter` (for `type: 'custom'`)

```typescript
interface ProviderAdapter {
  stream(params: StreamParams): AsyncGenerator<ProviderEvent>;
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
  getModelLimits(model: string): { contextWindow: number; maxOutput: number };
}
```

- `stream` -- Accepts model, messages, temperature, maxTokens, optional tools and abort signal. Yields `chunk`, `tool_use`, and `usage` events.
- `estimateCost` -- Returns cost in cents for the given token counts.
- `getModelLimits` -- Returns the context window and max output token count for a model.

### `AgenticAdapter` (for `type: 'custom-agentic'`)

```typescript
interface AgenticAdapter {
  run(params: AgenticRunParams): AsyncGenerator<AgenticEvent>;
  estimateCost?(model: string, inputTokens: number, outputTokens: number): number;
}
```

- `run` -- Accepts a task, system prompt, upstream context, agentic options, and optional tools. Yields `chunk`, `tool_use`, `result`, and `error` events.
- `estimateCost` -- Optional. Returns cost in cents.

### `PersistenceAdapter`

```typescript
interface PersistenceAdapter {
  createRun(params: CreateRunParams): Promise<string>;
  updateRun(runId: string, updates: Record<string, unknown>): Promise<void>;
  createArtifact(params: ArtifactRequest): Promise<string>;
  saveMessage(threadId: string, role: string, content: string): Promise<void>;
  loadThreadHistory(threadId: string): Promise<Message[]>;
  logActivity(params: ActivityParams): Promise<void>;
}
```

The built-in `InMemoryPersistence` is a 100-run LRU store. For production, implement this interface with your database of choice. In `v0.3.0`, standard runs now propagate `threadId`, `entityType`, `entityId`, and `metadata` consistently into the persistence path so adapters can store richer run context.

### `ContextProvider`

```typescript
interface ContextProvider {
  getContext(entityType: string, entityId: string): Promise<string>;
}
```

Returns domain-specific context as a string. The engine injects this into agent prompts automatically.

### `MemoryProvider`

```typescript
interface MemoryProvider {
  search(query: string, k?: number): Promise<MemoryResult[]>;
  store(text: string, metadata?: Record<string, unknown>): Promise<void>;
}
```

Provides semantic memory search and storage across runs.

### `CodebaseProvider`

```typescript
interface CodebaseProvider {
  query(repoId: string, query: string, tier: 'mini' | 'standard' | 'full'): Promise<string>;
}
```

Retrieves relevant source code context at varying levels of detail.

### `PersonaProvider`

```typescript
interface PersonaProvider {
  getPersona(role: string): Promise<PersonaConfig | null>;
}
```

Resolves a `PersonaConfig` by role name. The config includes traits, constraints, communication style, expertise, and more.

---

## Agent configuration -- `AgentDescriptor`

Each node in a DAG wraps an `AgentDescriptor` that defines the agent's identity and behavior.

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | `string` | Yes | -- | Unique identifier for the agent. |
| `name` | `string` | Yes | -- | Display name, used in events. |
| `role` | `string` | Yes | -- | Semantic role (e.g., `'planner'`, `'developer'`, `'reviewer'`). Used for persona resolution and logging. |
| `systemPrompt` | `string` | Yes | -- | The system prompt sent to the LLM. |
| `model` | `string` | No | Inherited from `defaults.model` | Model to use for this agent. |
| `temperature` | `number` | No | Inherited from `defaults.temperature` | Sampling temperature for this agent. |
| `maxTokens` | `number` | No | Inherited from `defaults.maxTokens` | Max tokens for this agent's responses. |
| `providerId` | `string` | No | Inherited from `defaults.provider` | Key from the `providers` map. Use this to assign a specific provider (including agentic providers) to an individual agent. |
| `persona` | `PersonaConfig` | No | `undefined` | Inline persona definition with traits, constraints, communication style, expertise, department, and seniority. |
| `agentic` | `AgenticOptions` | No | `undefined` | Options for agentic provider nodes. Only used when the agent's provider is an agentic type. |

### `AgenticOptions`

These options apply when an agent runs on an agentic provider (`claude-code`, `codex`, or `custom-agentic`).

| Option | Type | Default | Description |
|---|---|---|---|
| `permissionMode` | `string` | -- | Permission level for the agentic session (provider-specific). |
| `allowedTools` | `string[]` | -- | Whitelist of tools the agent can use. |
| `disallowedTools` | `string[]` | -- | Blacklist of tools the agent cannot use. |
| `cwd` | `string` | -- | Working directory for the agentic session. |
| `maxTurns` | `number` | -- | Maximum conversation turns within the agentic session. |
| `maxBudgetUsd` | `number` | -- | Maximum spend in USD for this agentic session. |
| `model` | `string` | -- | Model override for the agentic session. |
| `mcpServers` | `Record<string, unknown>` | -- | MCP server configurations for the agentic session. |
| `env` | `Record<string, string>` | -- | Environment variables passed to the agentic session. |
| `pathToClaudeCodeExecutable` | `string` | -- | Path to the Claude Code CLI executable (for `claude-code` type only). |

### Example

```typescript
const dag = engine.dag()
  .agent('planner', {
    id: 'planner',
    name: 'Planner',
    role: 'planner',
    systemPrompt: 'Break the task into implementation steps.',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.3,
  })
  .agent('coder', {
    id: 'coder',
    name: 'Coder',
    role: 'developer',
    systemPrompt: 'Implement the plan.',
    providerId: 'claude-code-provider',
    agentic: {
      permissionMode: 'bypassPermissions',
      cwd: '/tmp/workspace',
      maxTurns: 20,
    },
  })
  .edge('planner', 'coder')
  .build();
```

---

## Lifecycle hooks -- `LifecycleHooks`

Optional callbacks fired at key moments during execution.

| Hook | Signature | When it fires |
|---|---|---|
| `onRunStart` | `(runId: string, agentId: string) => void \| Promise<void>` | When an individual agent run begins. |
| `onRunComplete` | `(runId: string, agentId: string, output: string, artifact?: ArtifactRequest) => void \| Promise<void>` | When an agent run finishes successfully. |
| `onRunFailed` | `(runId: string, agentId: string, error: string, errorType: AgentErrorType) => void \| Promise<void>` | When an agent run fails. |
| `onSwarmComplete` | `(swarmId: string, results: NodeResult[]) => void \| Promise<void>` | When the entire swarm finishes. |

### Example

```typescript
lifecycle: {
  onRunStart(runId, agentId) {
    console.log(`Run ${runId} started for agent ${agentId}`);
  },
  onSwarmComplete(swarmId, results) {
    console.log(`Swarm ${swarmId} completed with ${results.length} results`);
  },
}
```

---

## Logging -- `LoggingConfig`

Controls what the engine writes to `stderr`.

| Option | Type | Default | Description |
|---|---|---|---|
| `level` | `'debug'` \| `'info'` \| `'warn'` \| `'error'` | -- | Minimum log level. Messages below this threshold are suppressed. |
| `structured` | `boolean` | `false` | When `true`, logs are emitted as JSON objects (one per line). When `false`, logs use a human-readable `[LEVEL] message` format. |
| `onLog` | `(entry: LogEntry) => void` | `undefined` | Custom callback invoked for every log entry that passes the level threshold. Use this to pipe logs to your own system. |

A `LogEntry` has this shape:

```typescript
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}
```

### Example

```typescript
logging: {
  level: 'info',
  structured: true,
  onLog(entry) {
    myLogger.ingest(entry);
  },
}
```

---

## Edge configuration -- `EdgeOptions`

Options you can pass to `.edge(from, to, options)` on the `DAGBuilder`.

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `maxCycles` | `number` | No | `undefined` | Maximum iterations for iterative loops (back-edges). |
| `handoff` | `string \| HandoffTemplate` | No | `undefined` | Handoff template to apply on this edge. Pass a preset name (`'standard'`, `'qa-review'`, `'qa-feedback'`, `'escalation'`) or an inline `HandoffTemplate` object. When set, the engine appends formatting instructions to the upstream agent's system prompt and structures its output before passing it to the downstream agent. |

### Handoff presets

| Preset | Sections | Use case |
|---|---|---|
| `standard` | Summary, Deliverables, Context for Next Step | General-purpose handoffs. |
| `qa-review` | Deliverables, Test Criteria, Known Limitations | Passing work to a reviewer. |
| `qa-feedback` | Verdict, Issues Found, Suggestions | Reviewer sending feedback back. |
| `escalation` | Problem Description, Attempts Made, Recommendation | Escalating to a human or senior agent. |

### Inline handoff template

```typescript
edge('dev', 'qa', {
  handoff: {
    id: 'custom-handoff',
    sections: [
      { key: 'code', label: 'Code Changes', required: true },
      { key: 'tests', label: 'Test Results', required: true },
      { key: 'notes', label: 'Developer Notes', required: false },
    ],
  },
})
```

---

## Feedback edges -- `FeedbackEdge`

Options for `.feedbackEdge(config)` on the `DAGBuilder`. Feedback edges create engine-managed retry loops between two nodes.

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `from` | `string` | Yes | -- | Node ID of the reviewing agent. |
| `to` | `string` | Yes | -- | Node ID of the agent that retries. |
| `maxRetries` | `number` | Yes | -- | Maximum retry iterations before escalation. Must be at least 1. |
| `evaluate` | `Evaluator` | Yes | -- | How to determine if the reviewer's output passes. Accepts `rule`, `regex`, or `llm` evaluator types (same as conditional edges). |
| `passLabel` | `string` | Yes | -- | The label that the evaluator must return for the loop to end successfully. |
| `escalation` | `EscalationPolicy` | Yes | -- | What to do when retries are exhausted. |

### Escalation policy

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `action` | `'fail' \| 'continue'` | Yes | -- | `'fail'` emits an error event and stops the node. `'continue'` proceeds with the last output. |
| `message` | `string` | No | `undefined` | Human-readable message included in the `feedback_escalation` event. |

### Example

```typescript
const dag = engine.dag()
  .agent('dev', { id: 'dev', name: 'Dev', role: 'developer', systemPrompt: '...' })
  .agent('qa', { id: 'qa', name: 'QA', role: 'reviewer', systemPrompt: '...' })
  .edge('dev', 'qa')
  .feedbackEdge({
    from: 'qa',
    to: 'dev',
    maxRetries: 3,
    evaluate: { type: 'rule', label: 'approved' },
    passLabel: 'approved',
    escalation: { action: 'fail', message: 'QA rejected after max retries' },
  })
  .build();
```

---

## Guards -- `GuardConfig`

Anti-pattern guards check agent output for quality issues after each node completes. You can configure guards per-node or engine-wide.

### Per-node guards

Add a `guards` array to any `AgentDescriptor`:

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `guards` | `GuardConfig[]` | No | `[]` | Array of guard configurations for this node. |

### Engine-wide guards

Add a `guards` array to `SwarmEngineConfig`:

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `guards` | `GuardConfig[]` | No | `[]` | Guards applied to all nodes. Per-node guards are additive (they do not replace engine-wide guards). |

### Guard config

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | `string` | Yes | -- | Unique identifier for this guard instance. Used in events. |
| `type` | `'evidence' \| 'scope-creep'` | Yes | -- | The guard type. `evidence` uses zero-cost pattern matching. `scope-creep` uses a cheap LLM call. |
| `mode` | `'warn' \| 'block'` | Yes | -- | `warn` emits a `guard_warning` event and continues. `block` emits a `guard_blocked` event and fails the node. |

### Example

```typescript
// Engine-wide defaults
const engine = new SwarmEngine({
  providers: { /* ... */ },
  guards: [
    { id: 'evidence', type: 'evidence', mode: 'warn' },
  ],
});

// Per-node override (additive)
const dag = engine.dag()
  .agent('dev', {
    id: 'dev',
    name: 'Developer',
    role: 'developer',
    systemPrompt: '...',
    guards: [
      { id: 'scope', type: 'scope-creep', mode: 'block' },
    ],
  })
  .build();
// The 'dev' node runs both the engine-wide 'evidence' guard and its own 'scope-creep' guard.
```

---

## Environment variables

The engine does not auto-read environment variables. You pass API keys explicitly through the `providers` config. A common pattern:

```typescript
providers: {
  anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  openai: { type: 'openai', apiKey: process.env.OPENAI_API_KEY },
}
```

| Variable | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic and Anthropic OAuth providers (pass via `apiKey`) |
| `OPENAI_API_KEY` | OpenAI provider (pass via `apiKey`) |
