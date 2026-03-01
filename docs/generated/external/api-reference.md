---
type: api-reference
audience: external
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# API Reference

`@swarmengine/core` v0.1.6

This is a TypeScript library. All exports are available from the package root:

```ts
import { SwarmEngine, DAGBuilder, CostTracker } from '@swarmengine/core';
```

---

## Classes

### SwarmEngine

The main entry point for the multi-agent DAG orchestration engine. You create an instance with your provider configuration, build a DAG, and iterate over the run to receive streaming events.

#### Constructor

```ts
new SwarmEngine(config: SwarmEngineConfig)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `SwarmEngineConfig` | Engine configuration including providers, adapters, defaults, and limits. |

The constructor initializes all providers, separating standard LLM providers from agentic backends automatically. Any adapter not supplied falls back to its noop default.

#### Methods

**`dag(): DAGBuilder`**

Returns a new `DAGBuilder` instance for constructing a DAG definition.

**`async *run(options: RunOptions): AsyncGenerator<SwarmEvent>`**

Validates the DAG, applies engine defaults to agent descriptors, and executes the workflow. Yields `SwarmEvent` objects throughout the lifecycle.

```ts
const dag = engine.dag()
  .agent('planner', { id: 'planner', name: 'Planner', role: 'pm', systemPrompt: 'You are a PM.' })
  .agent('coder', { id: 'coder', name: 'Coder', role: 'developer', systemPrompt: 'You are a developer.' })
  .edge('planner', 'coder')
  .build();

for await (const event of engine.run({ dag, task: 'Build a login page' })) {
  if (event.type === 'agent_chunk') {
    process.stdout.write(event.content);
  }
}
```

If DAG validation fails, the generator yields a single `swarm_error` event and returns. After execution completes, lifecycle hooks (`onSwarmComplete`) are called if configured.

---

### DAGBuilder

A fluent builder for constructing `DAGDefinition` objects. Every method returns `this` for chaining.

#### Constructor

```ts
new DAGBuilder()
```

No parameters. You typically get one from `engine.dag()`, but you can also construct it directly.

#### Methods

**`agent(nodeId: string, descriptor: AgentDescriptor): this`**

Adds an agent node to the DAG. Throws if a node with the same `nodeId` already exists.

| Parameter | Type | Description |
|-----------|------|-------------|
| `nodeId` | `string` | Unique identifier for this node within the DAG. |
| `descriptor` | `AgentDescriptor` | The agent's configuration: name, role, system prompt, model, etc. |

**`edge(from: string, to: string, options?: EdgeOptions): this`**

Adds a directed edge between two nodes. The `from` node must complete before the `to` node starts.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | `string` | Source node ID. |
| `to` | `string` | Target node ID. |
| `options` | `EdgeOptions` | Optional. Set `maxCycles` for iterative loops (back-edges). |

**`conditionalEdge(from: string, config: ConditionalEdgeConfig): this`**

Adds a conditional edge that routes execution based on the source node's output.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | `string` | Source node ID. |
| `config.evaluate` | `Evaluator` | An evaluator (rule, regex, or llm) that determines the routing target. |
| `config.targets` | `Record<string, string>` | Maps evaluator output labels to target node IDs. |

**`dynamicExpansion(nodeId: string): this`**

Marks a node as capable of emitting a sub-DAG at runtime. When the node completes, its output can be interpreted as a new DAG definition that gets inlined into the execution graph.

**`build(): DAGDefinition`**

Validates all edges and conditional edges, then produces the final `DAGDefinition`. Throws if any edge references a node that does not exist.

```ts
const dag = new DAGBuilder()
  .agent('writer', { id: 'writer', name: 'Writer', role: 'writer', systemPrompt: '...' })
  .agent('reviewer', { id: 'reviewer', name: 'Reviewer', role: 'reviewer', systemPrompt: '...' })
  .agent('editor', { id: 'editor', name: 'Editor', role: 'editor', systemPrompt: '...' })
  .edge('writer', 'reviewer')
  .conditionalEdge('reviewer', {
    evaluate: { type: 'regex', pattern: 'APPROVED', matchTarget: 'publish', elseTarget: 'revise' },
    targets: { publish: 'editor', revise: 'writer' },
  })
  .edge('reviewer', 'writer', { maxCycles: 3 })
  .build();
```

---

### CostTracker

Tracks token usage and cost across agents and nodes, with optional budget enforcement.

#### Constructor

```ts
new CostTracker(swarmBudget?: number | null, perAgentBudget?: number | null)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `swarmBudget` | `number \| null` | Maximum total cost in cents for the entire swarm. `null` disables. |
| `perAgentBudget` | `number \| null` | Maximum cost in cents per individual agent. `null` disables. |

#### Methods

**`recordUsage(agentId: string, nodeId: string, usage: TokenUsage): void`**

Records token usage for an agent invocation. Cost is calculated automatically based on built-in model pricing tables.

**`calculateCost(model: string, inputTokens: number, outputTokens: number): number`**

Returns the estimated cost in cents for the given token counts and model. Falls back to default pricing if the model is not in the pricing table.

**`getSwarmTotal(): CostSummary`**

Returns the aggregate cost summary across all agents and nodes.

**`getPerAgent(): Map<string, CostSummary>`**

Returns cost summaries keyed by agent ID.

**`getPerNode(): Map<string, CostSummary>`**

Returns cost summaries keyed by node ID.

**`checkBudget(): { ok: boolean; remaining: number; used: number }`**

Checks whether the swarm-level budget has been exceeded. Returns `ok: true` with `remaining: Infinity` if no budget is set.

**`checkAgentBudget(agentId: string): { ok: boolean; remaining: number; used: number }`**

Checks whether a specific agent has exceeded its per-agent budget.

---

### SwarmMemory

Provides shared state and inter-agent communication within a swarm execution.

#### Constructor

```ts
new SwarmMemory(limits?: { maxKeyBytes?: number; maxTotalBytes?: number })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `limits.maxKeyBytes` | `number` | Maximum size in bytes for a single scratchpad key. Default: 10,240. |
| `limits.maxTotalBytes` | `number` | Maximum total size in bytes for all scratchpad data. Default: 102,400. |

#### Properties

**`scratchpad: Scratchpad`**

A key-value and list-based shared store for inter-agent data passing.

- `set(key: string, value: unknown, agentId: string): void` -- Store a value. Throws if size limits are exceeded.
- `get<T>(key: string): T | undefined` -- Retrieve a value by key.
- `append(key: string, value: unknown, agentId: string): void` -- Append a value to a list. Throws if size limits are exceeded.
- `getList<T>(key: string): T[]` -- Retrieve a list by key.
- `keys(): string[]` -- Returns all keys (both scalar and list).
- `getHistory(key: string): ScratchpadEntry[]` -- Returns the write history for a key, including which agent wrote each entry.
- `toContext(): string` -- Serializes all scratchpad data into a string suitable for injection into agent context.

**`channels: Channels`**

A message-passing system for direct agent-to-agent or broadcast communication.

- `send(from: string, to: string, content: string, metadata?: Record<string, unknown>): void` -- Send a direct message.
- `broadcast(from: string, content: string, metadata?: Record<string, unknown>): void` -- Send a message to all agents.
- `getInbox(agentId: string): ChannelMessage[]` -- Returns all messages addressed to the agent, including broadcasts.
- `getConversation(agentA: string, agentB: string): ChannelMessage[]` -- Returns all messages exchanged between two agents.

---

### Logger

A structured logging utility with level filtering, JSON output, and child loggers for scoped context.

#### Constructor

```ts
new Logger(config?: LoggingConfig, baseContext?: Record<string, unknown>)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `LoggingConfig` | Logging level, structured mode, and optional log handler. If omitted, logging is disabled. |
| `baseContext` | `Record<string, unknown>` | Key-value pairs that are merged into every log entry. |

#### Methods

**`debug(message: string, context?: Record<string, unknown>): void`**
**`info(message: string, context?: Record<string, unknown>): void`**
**`warn(message: string, context?: Record<string, unknown>): void`**
**`error(message: string, context?: Record<string, unknown>): void`**

Emit a log entry at the specified level. Entries below the configured threshold are dropped. Output goes to `stderr` in either plain-text or structured JSON format.

**`child(context: Record<string, unknown>): Logger`**

Creates a new `Logger` that inherits the parent's configuration and merges additional context into every log entry. Useful for tagging logs by node, agent, or phase.

```ts
const logger = new Logger({ level: 'info', structured: true });
const nodeLogger = logger.child({ nodeId: 'planner' });
nodeLogger.info('Starting agent run'); // includes { nodeId: 'planner' }
```

---

### SwarmError

A typed error class with structured error classification.

#### Constructor

```ts
new SwarmError(message: string, errorType: AgentErrorType, cause?: Error)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Human-readable error description. |
| `errorType` | `AgentErrorType` | Classified error type (see `AgentErrorType` below). |
| `cause` | `Error` | Optional underlying error. |

#### Properties

- `errorType: AgentErrorType` -- The classified error category.
- `cause: Error | undefined` -- The original error, if any.
- `name` -- Always `'SwarmError'`.

---

### SSEBridge

Bridges `SwarmEvent` broadcasts to Server-Sent Events for real-time browser-based monitoring. Maintains an internal state snapshot so late-connecting clients can catch up.

#### Properties

**`clientCount: number`** (read-only)

Number of currently connected SSE clients.

#### Methods

**`addClient(res: ServerResponse): void`**

Registers an HTTP response as an SSE client. Sets the appropriate headers and begins streaming events. Automatically removes the client when the connection closes.

**`broadcast(event: SwarmEvent): void`**

Sends an event to all connected SSE clients and updates the internal state snapshot.

**`getState(): MonitorState`**

Returns the current state snapshot with node statuses, costs, and progress.

**`getStateJSON(): Record<string, unknown>`**

Returns a JSON-serializable version of the state, suitable for REST endpoints.

---

### SwarmEventEmitter

An async-iterable event emitter for producing and consuming `SwarmEvent` streams.

#### Methods

**`emit(event: SwarmEvent): void`**

Pushes an event to the stream. If a consumer is awaiting, the event is delivered immediately; otherwise it is buffered.

**`close(): void`**

Signals end-of-stream. Subsequent calls to `emit()` are ignored. Waiting consumers receive a `done` iterator result.

**`error(err: Error): void`**

Signals an error. Waiting consumers receive a rejection.

#### Usage

```ts
const emitter = new SwarmEventEmitter();

// Producer
emitter.emit({ type: 'agent_start', nodeId: 'a', agentRole: 'pm', agentName: 'PM' });
emitter.close();

// Consumer
for await (const event of emitter) {
  console.log(event.type);
}
```

---

## Functions

### createProvider

```ts
function createProvider(config: ProviderConfig): ProviderAdapter
```

Factory function that creates a `ProviderAdapter` based on the provider configuration type. Supports `'anthropic'`, `'anthropic-oauth'`, `'openai'`, `'ollama'`, and `'custom'`. For custom providers, you must supply your own `adapter` in the config.

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `ProviderConfig` | Provider type, API key, optional base URL, and optional custom adapter. |

**Returns:** `ProviderAdapter`

---

### isAgenticProvider

```ts
function isAgenticProvider(type: string): boolean
```

Returns `true` if the given provider type is an agentic provider (`'claude-code'`, `'codex'`, or `'custom-agentic'`). Use this to check whether a provider config should be routed through `AgenticAdapter` instead of `ProviderAdapter`.

---

### createAgenticAdapter

```ts
function createAgenticAdapter(config: ProviderConfig): AgenticAdapter
```

Factory function that creates an `AgenticAdapter` for agentic provider types. The underlying SDKs are lazily loaded at execution time, so there is no import cost until a node actually runs.

| Type | Behavior |
|------|----------|
| `'claude-code'` | Creates a `ClaudeCodeAdapter` that spawns Claude Code sessions. |
| `'codex'` | Creates a `CodexAdapter` that spawns Codex sessions. |
| `'custom-agentic'` | Returns `config.agenticAdapter` directly. Throws if not provided. |

---

### classifyError

```ts
function classifyError(err: unknown): AgentErrorType
```

Inspects an error's message and name to classify it into an actionable category. Useful for deciding retry strategies, user-facing messages, or fallback behavior.

| Return Value | Matched Patterns |
|-------------|------------------|
| `'rate_limit'` | 429, rate_limit, rate limit |
| `'auth_error'` | 401, 403, unauthorized, invalid api key, authentication |
| `'timeout'` | AbortError, timed out, timeout, deadline |
| `'content_filter'` | content_policy, content_filter, safety, moderation |
| `'network_error'` | TypeError, fetch failed, econnrefused, enotfound, network |
| `'unknown'` | Anything else, or non-Error input |

---

### startMonitor

```ts
async function startMonitor(options?: MonitorOptions): Promise<MonitorHandle>
```

Starts an HTTP server with SSE support for real-time swarm monitoring. Returns a `MonitorHandle` with methods for broadcasting events and shutting down.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.port` | `number` | Port to listen on. Use `0` for a random available port. Default: `4820`. |

**Returns:** `MonitorHandle`

```ts
const monitor = await startMonitor({ port: 4820 });
console.log(`Monitor at http://localhost:${monitor.port}`);

for await (const event of engine.run({ dag, task: '...' })) {
  monitor.broadcast(event);
}

await monitor.close();
```

---

### createMonitorServer

```ts
function createMonitorServer(options?: MonitorOptions): { server: http.Server; bridge: SSEBridge }
```

Creates an HTTP server and `SSEBridge` pair without starting the server. Use this when you need more control over the server lifecycle (e.g., attaching to an existing server or custom middleware).

The server exposes three endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /events` | SSE stream of `SwarmEvent` objects. |
| `GET /state` | JSON snapshot of the current swarm state. |
| `GET /health` | Health check returning `{ "status": "ok" }`. |

---

### parsePersonaMarkdown

```ts
function parsePersonaMarkdown(markdown: string): PersonaConfig
```

Parses a PersonaSmith Markdown file into a `PersonaConfig` object. Extracts structured metadata from XML-tagged sections (`<identity>`, `<communication_style>`, `<constraints_and_rules>`, `<collaboration_map>`) while preserving the full Markdown as `fullPrompt`.

---

## Types

### Configuration

#### SwarmEngineConfig

Top-level configuration for the engine.

```ts
interface SwarmEngineConfig {
  providers: Record<string, ProviderConfig>;   // Required. At least one provider.
  persistence?: PersistenceAdapter;            // Run tracking and artifact storage.
  context?: ContextProvider;                   // Entity context retrieval.
  memory?: MemoryProvider;                     // Semantic memory search and storage.
  codebase?: CodebaseProvider;                 // Codebase querying.
  persona?: PersonaProvider;                   // Persona resolution.
  lifecycle?: LifecycleHooks;                  // Callbacks for run lifecycle events.
  defaults?: EngineDefaults;                   // Default model, temperature, provider.
  limits?: EngineLimits;                       // Budget, concurrency, and duration limits.
  logging?: LoggingConfig;                     // Logging level and output format.
}
```

#### ProviderConfig

Configuration for a single provider.

```ts
interface ProviderConfig {
  type: 'anthropic' | 'anthropic-oauth' | 'openai' | 'google' | 'ollama'
      | 'custom' | 'claude-code' | 'codex' | 'custom-agentic';
  apiKey?: string;
  baseUrl?: string;
  adapter?: ProviderAdapter;          // Required for type 'custom'.
  agenticAdapter?: AgenticAdapter;    // Required for type 'custom-agentic'.
}
```

#### EngineDefaults

Default values applied to agent descriptors that omit them.

```ts
interface EngineDefaults {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  provider?: string;
}
```

#### EngineLimits

Safety limits for swarm execution.

```ts
interface EngineLimits {
  maxSwarmBudgetCents?: number;          // Total cost ceiling in cents.
  maxPerAgentBudgetCents?: number;       // Per-agent cost ceiling in cents.
  maxConcurrentAgents?: number;          // Max parallel node executions.
  maxSwarmDurationMs?: number;           // Total swarm timeout in milliseconds.
  maxScratchpadSizeBytes?: number;       // Scratchpad storage limit.
  maxCycleIterations?: number;           // Max loop iterations for back-edges.
}
```

#### LoggingConfig

```ts
interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  structured?: boolean;                  // If true, emit JSON lines to stderr.
  onLog?: (entry: LogEntry) => void;     // Optional callback for each log entry.
}
```

#### LogEntry

```ts
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}
```

---

### Execution

#### RunOptions

Options passed to `engine.run()`.

```ts
interface RunOptions {
  dag: DAGDefinition;                    // The DAG to execute.
  task: string;                          // The user-facing task description.
  signal?: AbortSignal;                  // Cancellation signal.
  threadId?: string;                     // Thread ID for conversation history.
  entityType?: string;                   // Entity type for context lookup.
  entityId?: string;                     // Entity ID for context lookup.
  metadata?: Record<string, unknown>;    // Arbitrary metadata passed through.
}
```

#### DAGDefinition

The output of `DAGBuilder.build()`.

```ts
interface DAGDefinition {
  id: string;                            // Auto-generated unique ID.
  nodes: DAGNode[];
  edges: DAGEdge[];
  conditionalEdges: ConditionalEdge[];
  dynamicNodes: string[];                // Node IDs marked for dynamic expansion.
}
```

#### DAGNode

```ts
interface DAGNode {
  id: string;
  agent: AgentDescriptor;
  task?: string;                         // Optional per-node task override.
  canEmitDAG?: boolean;                  // Set by dynamicExpansion().
}
```

#### DAGEdge

```ts
interface DAGEdge {
  from: string;
  to: string;
  maxCycles?: number;                    // For iterative loops (back-edges).
}
```

#### ConditionalEdge

```ts
interface ConditionalEdge {
  from: string;
  evaluate: Evaluator;
  targets: Record<string, string>;       // Maps evaluator labels to node IDs.
}
```

#### Evaluator

A union type with three strategies for routing decisions:

```ts
type Evaluator =
  | { type: 'rule'; fn: (output: string) => string }
  | { type: 'regex'; pattern: string; matchTarget: string; elseTarget: string }
  | { type: 'llm'; prompt: string; model?: string; providerId?: string };
```

- **`rule`** -- A synchronous function that maps agent output to a target label. Zero cost.
- **`regex`** -- Tests a RegExp against the output. Returns `matchTarget` on match, `elseTarget` otherwise. Zero cost.
- **`llm`** -- Sends the output to an LLM with a tight token limit to determine the target label. Costs one LLM call.

#### NodeResult

The result of a completed node, included in the `swarm_done` event.

```ts
interface NodeResult {
  nodeId: string;
  agentRole: string;
  output: string;
  artifactRequest?: ArtifactRequest;
  cost: CostSummary;
  durationMs: number;
}
```

---

### Agent

#### AgentDescriptor

Configuration for an individual agent node.

```ts
interface AgentDescriptor {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model?: string;                        // Overrides engine default.
  temperature?: number;                  // Overrides engine default.
  maxTokens?: number;                    // Overrides engine default.
  providerId?: string;                   // Routes to a specific provider.
  persona?: PersonaConfig;               // Inline persona configuration.
  agentic?: AgenticOptions;              // Configuration for agentic backends.
}
```

#### PersonaConfig

Rich persona definition, typically parsed from PersonaSmith Markdown.

```ts
interface PersonaConfig {
  name: string;
  role: string;
  traits: string[];
  constraints: string[];
  communicationStyle?: string;
  expertise?: string[];
  fullPrompt?: string;                   // Full Markdown for system prompt injection.
  department?: string;
  seniority?: string;
  collaborationMap?: string;
}
```

---

### Cost

#### CostSummary

Aggregate cost and usage data.

```ts
interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  calls: number;
}
```

#### TokenUsage

Per-call token usage record.

```ts
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}
```

---

### Streaming Events

#### SwarmEvent

A discriminated union of 14 event types emitted during swarm execution.

| Event Type | Key Fields | Description |
|------------|------------|-------------|
| `agent_start` | `nodeId`, `agentRole`, `agentName` | An agent node has begun execution. |
| `agent_chunk` | `nodeId`, `agentRole`, `content` | A streaming text chunk from an agent. |
| `agent_tool_use` | `nodeId`, `tool`, `input` | An agent invoked a tool. |
| `agent_done` | `nodeId`, `agentRole`, `output`, `cost` | An agent completed successfully. |
| `agent_error` | `nodeId`, `agentRole`, `message`, `errorType` | An agent failed. |
| `swarm_start` | `dagId`, `nodeCount`, `estimatedCost?` | The swarm has started executing. |
| `swarm_progress` | `completed`, `total`, `runningNodes` | Progress update during execution. |
| `swarm_done` | `results`, `totalCost` | The swarm completed successfully. |
| `swarm_error` | `message`, `completedNodes`, `partialCost` | The swarm failed. |
| `swarm_cancelled` | `completedNodes`, `partialCost` | The swarm was cancelled via `AbortSignal`. |
| `route_decision` | `fromNode`, `toNode`, `reason` | A conditional edge was evaluated. |
| `loop_iteration` | `nodeId`, `iteration`, `maxIterations` | A loop iteration started. |
| `budget_warning` | `used`, `limit`, `percentUsed` | Approaching budget limit. |
| `budget_exceeded` | `used`, `limit` | Budget limit has been exceeded. |

#### AgentErrorType

```ts
type AgentErrorType =
  | 'timeout'
  | 'rate_limit'
  | 'auth_error'
  | 'network_error'
  | 'content_filter'
  | 'budget_exceeded'
  | 'unknown';
```

---

### Provider Adapters

#### ProviderAdapter

The interface for standard LLM provider backends.

```ts
interface ProviderAdapter {
  stream(params: StreamParams): AsyncGenerator<ProviderEvent>;
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
  getModelLimits(model: string): { contextWindow: number; maxOutput: number };
}
```

#### StreamParams

Parameters for a provider streaming call.

```ts
interface StreamParams {
  model: string;
  messages: Message[];
  temperature: number;
  maxTokens: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}
```

#### ProviderEvent

Events emitted by a provider during streaming.

```ts
type ProviderEvent =
  | { type: 'chunk'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; inputTokens: number; outputTokens: number };
```

---

### Agentic Adapters

#### AgenticAdapter

The interface for agentic backends (Claude Code, Codex, or custom).

```ts
interface AgenticAdapter {
  run(params: AgenticRunParams): AsyncGenerator<AgenticEvent>;
  estimateCost?(model: string, inputTokens: number, outputTokens: number): number;
}
```

#### AgenticRunParams

Parameters passed to an agentic backend.

```ts
interface AgenticRunParams {
  task: string;
  systemPrompt: string;
  upstreamContext: string;
  agenticOptions?: AgenticOptions;
  signal?: AbortSignal;
  tools?: AgenticTool[];
}
```

#### AgenticOptions

Configuration for agentic backend sessions.

```ts
interface AgenticOptions {
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  cwd?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  model?: string;
  mcpServers?: Record<string, unknown>;
  env?: Record<string, string>;
  pathToClaudeCodeExecutable?: string;
}
```

#### AgenticEvent

Events emitted by an agentic backend during execution.

```ts
type AgenticEvent =
  | { type: 'chunk'; content: string }
  | { type: 'tool_use'; tool: string; input: Record<string, unknown> }
  | { type: 'result'; output: string; costUsd?: number; inputTokens?: number; outputTokens?: number }
  | { type: 'error'; message: string };
```

#### AgenticTool

A tool definition with an execute function, passed to agentic backends so they can interact with swarm memory.

```ts
interface AgenticTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => string | Promise<string>;
}
```

---

### Pluggable Adapters

#### PersistenceAdapter

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

#### ContextProvider

```ts
interface ContextProvider {
  getContext(entityType: string, entityId: string): Promise<string>;
}
```

#### MemoryProvider

```ts
interface MemoryProvider {
  search(query: string, k?: number): Promise<MemoryResult[]>;
  store(text: string, metadata?: Record<string, unknown>): Promise<void>;
}
```

#### CodebaseProvider

```ts
interface CodebaseProvider {
  query(repoId: string, query: string, tier: 'mini' | 'standard' | 'full'): Promise<string>;
}
```

#### PersonaProvider

```ts
interface PersonaProvider {
  getPersona(role: string): Promise<PersonaConfig | null>;
}
```

#### LifecycleHooks

```ts
interface LifecycleHooks {
  onRunStart?(runId: string, agentId: string): void | Promise<void>;
  onRunComplete?(runId: string, agentId: string, output: string, artifact?: ArtifactRequest): void | Promise<void>;
  onRunFailed?(runId: string, agentId: string, error: string, errorType: AgentErrorType): void | Promise<void>;
  onSwarmComplete?(swarmId: string, results: NodeResult[]): void | Promise<void>;
}
```

---

### Supporting Types

#### ArtifactRequest

```ts
interface ArtifactRequest {
  type: string;
  title: string;
  content: string;
  entityType?: string;
  entityId?: string;
  parentArtifactId?: string;
  metadata?: Record<string, unknown>;
}
```

#### Message

```ts
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
```

#### ChannelMessage

```ts
interface ChannelMessage {
  from: string;
  to: string | '*';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
```

#### ScratchpadEntry

```ts
interface ScratchpadEntry {
  key: string;
  value: unknown;
  writtenBy: string;
  timestamp: number;
  operation: 'set' | 'append';
}
```

#### MonitorState

```ts
interface MonitorState {
  dagId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  nodes: Map<string, NodeState>;
  routeDecisions: { from: string; to: string; reason: string }[];
  totalCost: CostSummary;
  progress: { completed: number; total: number };
  startTime: number;
}
```

#### MonitorHandle

```ts
interface MonitorHandle {
  port: number;
  broadcast(event: SwarmEvent): void;
  getState(): Record<string, unknown>;
  close(): Promise<void>;
}
```

#### MonitorOptions

```ts
interface MonitorOptions {
  port?: number;    // Default: 4820. Use 0 for random.
}
```

---

## Default Implementations

The following noop and in-memory implementations are exported for convenience. They allow you to get started without implementing every adapter interface. Replace them with production implementations as your needs grow.

| Class | Implements | Behavior |
|-------|-----------|----------|
| `InMemoryPersistence` | `PersistenceAdapter` | Stores runs, artifacts, threads, and activity logs in memory. Evicts oldest runs when exceeding `maxRuns` (default: 100). |
| `NoopContextProvider` | `ContextProvider` | Returns empty string for all context queries. |
| `NoopMemoryProvider` | `MemoryProvider` | Returns empty results for searches; stores are no-ops. |
| `NoopCodebaseProvider` | `CodebaseProvider` | Returns empty string for all codebase queries. |
| `NoopPersonaProvider` | `PersonaProvider` | Returns `null` for all persona lookups. |
| `NoopLifecycleHooks` | `LifecycleHooks` | All hooks are undefined (no-ops). |
| `PersonaSmithProvider` | `PersonaProvider` | Loads persona Markdown files from disk, with department-folder search, kebab-case normalization, industry overlays, and in-memory caching. |
| `AnthropicOAuthProvider` | `ProviderAdapter` | Anthropic provider using OAuth token authentication instead of API keys. |
