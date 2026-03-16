---
id: feat-004
type: feature-doc
audience: external
topic: Pluggable Adapters
status: draft
generated: 2026-03-15
source-tier: direct
hermes-version: 1.0.1
---

# Pluggable Adapters

Everything in SwarmEngine is pluggable. You can bring your own LLM provider, persistence layer, memory system, persona engine, or agentic backend. All adapters are optional -- the engine ships with sensible defaults so you can get started without implementing any of them. In `v0.3.0`, the built-in provider contract was tightened so `google` is no longer listed as a built-in type; use `type: 'custom'` for Google integrations.

## How to Use

Pass adapter implementations into the engine configuration. Any adapter you omit falls back to a built-in no-op or in-memory default:

```ts
import { SwarmEngine } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  },
  // All of these are optional:
  persistence: myDatabaseAdapter,
  context: myContextProvider,
  memory: myVectorStore,
  codebase: myCodeSearchEngine,
  persona: myPersonaService,
  lifecycle: myLifecycleHooks,
});
```

## Adapter Interfaces

### 1. ProviderAdapter

The core interface for LLM providers. A provider adapter streams completions from a language model.

```ts
interface ProviderAdapter {
  stream(params: StreamParams): AsyncGenerator<ProviderEvent>;
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
  getModelLimits(model: string): { contextWindow: number; maxOutput: number };
}
```

**`stream`** is the main method. It receives the model name, messages, temperature, max tokens, and optional tool definitions, then yields `ProviderEvent` objects: `chunk` (text tokens), `tool_use` (tool calls), and `usage` (token counts).

**`estimateCost`** returns the estimated cost in cents for a given number of tokens.

**`getModelLimits`** returns the context window and max output size for a given model.

**Built-in providers:** Anthropic, Anthropic OAuth, OpenAI, Ollama. You configure them by type:

```ts
providers: {
  anthropic: { type: 'anthropic', apiKey: '...' },
  openai: { type: 'openai', apiKey: '...' },
  ollama: { type: 'ollama', baseUrl: 'http://localhost:11434' },
}
```

### 2. AgenticAdapter

For autonomous agent backends that go beyond simple LLM completions (e.g., Claude Code, Codex). See [Agentic Backends](./feat-005-agentic-backends.md) for details.

```ts
interface AgenticAdapter {
  run(params: AgenticRunParams): AsyncGenerator<AgenticEvent>;
  estimateCost?(model: string, inputTokens: number, outputTokens: number): number;
}
```

### 3. PersistenceAdapter

Store and retrieve run records, artifacts, thread history, and activity logs.

```ts
interface PersistenceAdapter {
  createRun(params: CreateRunParams): Promise<string>;
  updateRun(runId: string, updates: Record<string, unknown>): Promise<void>;
  createArtifact(params: ArtifactRequest): Promise<string>;
  saveMessage(threadId: string, role: string, content: string): Promise<void>;
  loadThreadHistory(threadId: string): Promise<Message[]>;
  logActivity(params: ActivityParams): Promise<void>;
}
```

**Built-in default:** `InMemoryPersistence` -- stores everything in memory with an LRU cap of 100 runs. Good for development and testing. For production, implement this interface with your database of choice (Postgres, MongoDB, etc.).

**Example: Custom Postgres adapter**

```ts
import type { PersistenceAdapter, CreateRunParams } from '@swarmengine/core';

class PostgresPersistence implements PersistenceAdapter {
  constructor(private pool: Pool) {}

  async createRun(params: CreateRunParams): Promise<string> {
    const result = await this.pool.query(
      'INSERT INTO agent_runs (agent_id, role, swarm_id, task, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [params.agentId, params.agentRole, params.swarmId, params.task, 'running']
    );
    return result.rows[0].id;
  }

  async updateRun(runId: string, updates: Record<string, unknown>): Promise<void> {
    // Update the run record with status, cost, duration, etc.
  }

  // ... implement remaining methods
}
```

### 4. ContextProvider

Inject external context (database records, API responses, etc.) into agent prompts.

```ts
interface ContextProvider {
  getContext(entityType: string, entityId: string): Promise<string>;
}
```

The engine calls this before each standard agent runs, passing the `entityType` and `entityId` from `RunOptions`. The returned string is included in the assembled system context.

**Built-in default:** `NoopContextProvider` -- returns an empty string.

### 5. MemoryProvider

Search and store semantic memories that agents can access across runs.

```ts
interface MemoryProvider {
  search(query: string, k?: number): Promise<MemoryResult[]>;
  store(text: string, metadata?: Record<string, unknown>): Promise<void>;
}
```

Each `MemoryResult` includes `text`, `score`, and optional `metadata`.

**Built-in default:** `NoopMemoryProvider` -- returns empty results.

### 6. CodebaseProvider

Query a codebase index for relevant code context.

```ts
interface CodebaseProvider {
  query(repoId: string, query: string, tier: 'mini' | 'standard' | 'full'): Promise<string>;
}
```

The `tier` parameter controls the depth of the search: `mini` for quick lookups, `standard` for moderate context, `full` for comprehensive results.

**Built-in default:** `NoopCodebaseProvider` -- returns an empty string.

### 7. PersonaProvider

Load persona configurations for agent roles. Personas define traits, constraints, communication style, and expertise for an agent.

```ts
interface PersonaProvider {
  getPersona(role: string): Promise<PersonaConfig | null>;
}
```

A `PersonaConfig` includes `name`, `role`, `traits`, `constraints`, `communicationStyle`, `expertise`, and more. The engine uses this to enrich the agent's system prompt.

**Built-in providers:** `PersonaSmithProvider` (connects to the PersonaSmith service) and `parsePersonaMarkdown` (parses personas from markdown files).

**Built-in default:** `NoopPersonaProvider` -- returns null.

### 8. LifecycleHooks

Hook into execution events for logging, metrics, or side effects. All hooks are optional and fire-and-forget -- if a hook throws, execution continues.

```ts
interface LifecycleHooks {
  onRunStart?(runId: string, agentId: string): void | Promise<void>;
  onRunComplete?(runId: string, agentId: string, output: string, artifact?: ArtifactRequest): void | Promise<void>;
  onRunFailed?(runId: string, agentId: string, error: string, errorType: AgentErrorType): void | Promise<void>;
  onSwarmComplete?(swarmId: string, results: NodeResult[]): void | Promise<void>;
}
```

**Example: Metrics hooks**

```ts
const engine = new SwarmEngine({
  providers: { /* ... */ },
  lifecycle: {
    onRunStart(runId, agentId) {
      metrics.increment('agent.started', { agentId });
    },
    onRunComplete(runId, agentId, output) {
      metrics.increment('agent.completed', { agentId });
    },
    onRunFailed(runId, agentId, error, errorType) {
      metrics.increment('agent.failed', { agentId, errorType });
    },
    onSwarmComplete(swarmId, results) {
      metrics.gauge('swarm.nodes_completed', results.length);
    },
  },
});
```

## Defaults Summary

| Adapter | Built-In Default | Behavior |
|---------|-----------------|----------|
| Provider | Anthropic, OpenAI, Ollama | Configured by `type` in `providers` map |
| Persistence | `InMemoryPersistence` | In-memory store, max 100 runs |
| Context | `NoopContextProvider` | Returns empty string |
| Memory | `NoopMemoryProvider` | Returns empty results |
| Codebase | `NoopCodebaseProvider` | Returns empty string |
| Persona | `NoopPersonaProvider` | Returns null |
| Lifecycle | `NoopLifecycleHooks` | No-op for all hooks |

## Custom Provider Example

To add support for a new LLM provider, implement the `ProviderAdapter` interface and register it with `type: 'custom'`:

```ts
import type { ProviderAdapter, StreamParams, ProviderEvent } from '@swarmengine/core';

class MyCustomProvider implements ProviderAdapter {
  async *stream(params: StreamParams): AsyncGenerator<ProviderEvent> {
    const response = await myLLMClient.chat({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      stream: true,
    });

    for await (const chunk of response) {
      yield { type: 'chunk', content: chunk.text };
    }

    yield {
      type: 'usage',
      inputTokens: response.usage.input,
      outputTokens: response.usage.output,
    };
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    return Math.ceil((inputTokens * 200 + outputTokens * 800) / 1_000_000);
  }

  getModelLimits(model: string) {
    return { contextWindow: 128_000, maxOutput: 4_096 };
  }
}

const engine = new SwarmEngine({
  providers: {
    myProvider: { type: 'custom', adapter: new MyCustomProvider() },
  },
  defaults: { provider: 'myProvider' },
});
```
