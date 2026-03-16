---
type: glossary
audience: internal
status: draft
generated: 2026-03-15
source-tier: direct
hermes-version: 1.0.1
---

# Glossary

All terms are specific to the swarm-engine project (`@swarmengine/core`). Ordered alphabetically.

---

### AgentDescriptor

**Definition:** A configuration object that fully describes an agent's identity, behavior, and execution parameters. Contains the agent's ID, name, role, system prompt, model, temperature, max tokens, provider reference, optional persona, and optional agentic options.

**Context:** Passed into `DAGBuilder.agent()` when constructing a DAG. Each `DAGNode` holds one `AgentDescriptor`. Defined in `src/types.ts`.

**Not to be confused with:** `AgentNode`, which is the runtime wrapper that holds an `AgentDescriptor` plus execution state.

---

### AgenticAdapter

**Definition:** An interface for autonomous agentic backends that manage their own execution loop (context assembly, tool use, multi-turn conversation). Implementations expose a single `run()` method that returns an `AsyncGenerator<AgenticEvent>`.

**Context:** Used by `AgenticRunner` to delegate execution to backends like Claude Code or Codex. Three provider types map to this interface: `claude-code`, `codex`, and `custom-agentic`. Defined in `src/adapters/agentic/types.ts`.

**Not to be confused with:** `ProviderAdapter`, which handles standard LLM streaming where the engine manages the tool-use loop.

---

### AgenticRunner

**Definition:** The execution orchestrator for agentic backend nodes. Formats upstream context into a plain string, builds communication tools as `AgenticTool[]`, delegates execution to an `AgenticAdapter`, maps `AgenticEvent` objects to `SwarmEvent` objects, and records costs via `CostTracker`.

**Context:** Created in `SwarmEngine.run()` when agentic adapters exist. Called by `DAGExecutor` when a node's provider is identified as agentic. Defined in `src/agent/agentic-runner.ts`.

**Not to be confused with:** `AgentRunner`, which handles standard LLM provider nodes with full context assembly and tool-use loop management.

---

### AgentNode

**Definition:** The runtime actor wrapper for a single agent within a swarm. Holds an `AgentDescriptor`, tracks execution status (`NodeStatus`), accumulates output text, and provides communication tool definitions and tool call handling logic.

**Context:** Instantiated by `AgentRunner` at the start of each node execution. Handles tool calls against `SwarmMemory`. Defined in `src/agent/node.ts`.

**Not to be confused with:** `DAGNode`, which is the static graph definition of a node (ID + agent descriptor + task).

---

### AgentRunner

**Definition:** The execution orchestrator for standard LLM provider nodes. Assembles context via `ContextAssembler`, streams the LLM response via `ProviderAdapter`, manages the tool-use loop (stream -> tool call -> re-stream), tracks costs via `CostTracker`, and yields `SwarmEvent` objects.

**Context:** Created in `SwarmEngine.run()`. Called by `DAGExecutor` for nodes whose provider is a standard (non-agentic) provider. Defined in `src/agent/runner.ts`.

**Not to be confused with:** `AgenticRunner`, which handles agentic backend nodes.

---

### ArtifactRequest

**Definition:** A structured request to create a persistent artifact from an agent's output. Contains the artifact type, title, content, and optional entity association and metadata.

**Context:** Optionally included in `agent_done` events and `NodeResult` objects. When present, the executor persists it via `PersistenceAdapter.createArtifact()`. Defined in `src/types.ts`.

---

### Channels

**Definition:** A message-passing subsystem that enables directed and broadcast communication between agents during a swarm run. Maintains a flat array of `ChannelMessage` objects with sender, recipient (or `*` for broadcast), content, and timestamp.

**Context:** Accessed via `SwarmMemory.channels`. Messages are injected into agent context at priority 3 during assembly. Agents can send messages using the `send_message` tool. Defined in `src/memory/channels.ts`.

**Also known as:** Inter-agent messaging.

**Not to be confused with:** `Scratchpad`, which is key-value shared state rather than directed messages.

---

### ConditionalEdge

**Definition:** A directed edge with an evaluator that determines which of several target nodes to activate based on the source node's output. Contains a source node ID, an `Evaluator`, and a `targets` map (label -> nodeId).

**Context:** Added via `DAGBuilder.conditionalEdge()`. During execution, the `DAGExecutor` evaluates conditional edges after the source node completes, unblocks the selected target, and skips all non-selected targets. Defined in `src/types.ts`.

**Not to be confused with:** `DAGEdge`, which is an unconditional directed edge.

---

### ContextAssembler

**Definition:** Builds the message array for a standard LLM agent call by gathering context from all adapter sources (persona, system prompt, task, upstream outputs, channels, scratchpad, entity context, memory, codebase) and fitting them within a token budget using priority-based truncation.

**Context:** Used by `AgentRunner` before each LLM call. Not used by `AgenticRunner`, which formats context as a plain string instead. Defined in `src/context/assembler.ts`.

---

### ContextProvider

**Definition:** An interface for fetching entity-specific context (e.g., from a database). Has a single method `getContext(entityType, entityId)` that returns a context string.

**Context:** Injected into `ContextAssembler` via `SwarmEngineConfig.context`. Default is `NoopContextProvider` (returns empty string). Context is injected at priority 4 in the assembly budget. Defined in `src/types.ts`.

---

### CostSummary

**Definition:** An aggregate cost record containing input tokens, output tokens, total tokens, cost in cents, and number of LLM calls. Used at three levels: per-node, per-agent, and swarm total.

**Context:** Returned by `CostTracker.getSwarmTotal()`, included in `agent_done`, `swarm_done`, and `swarm_error` events. Defined in `src/types.ts`.

**Not to be confused with:** `TokenUsage`, which is a single usage record from one LLM call.

---

### CostTracker

**Definition:** Tracks cumulative token usage and cost across the entire swarm execution. Records usage at per-agent, per-node, and swarm-total levels. Calculates cost in cents using a built-in model pricing table. Provides budget checking methods for both swarm-level and per-agent-level limits.

**Context:** Created in `SwarmEngine.run()` with budget limits from `EngineLimits`. Used by both `AgentRunner` and `AgenticRunner` to record usage. Defined in `src/cost/tracker.ts`.

---

### DAG

**Definition:** Directed Acyclic Graph. The core execution model of swarm-engine. A DAG defines the structure of a multi-agent workflow: nodes represent agent tasks, edges represent dependencies. Despite the "acyclic" name, swarm-engine supports guarded cycles via `maxCycles` on edges.

**Context:** Constructed via `DAGBuilder`, validated by `validateDAG()`, wrapped in `DAGGraph` for runtime traversal, and executed by `DAGExecutor`.

**Also known as:** Workflow graph.

---

### DAGBuilder

**Definition:** A fluent builder for constructing `DAGDefinition` objects. Provides methods to add agent nodes, edges, conditional edges, and dynamic expansion markers. Validates all references on `build()` and generates a unique DAG ID.

**Context:** Accessed via `SwarmEngine.dag()`. Defined in `src/dag/builder.ts`.

---

### DAGDefinition

**Definition:** The static, serializable definition of a DAG. Contains the DAG ID, an array of `DAGNode` objects, an array of `DAGEdge` objects, an array of `ConditionalEdge` objects, and an array of dynamic node IDs.

**Context:** Produced by `DAGBuilder.build()`. Passed to `SwarmEngine.run()` via `RunOptions.dag`. Consumed by `DAGGraph` constructor and `validateDAG()`. Defined in `src/types.ts`.

---

### DAGEdge

**Definition:** A directed dependency edge between two nodes in a DAG. Contains `from` (source node ID), `to` (target node ID), and an optional `maxCycles` field for cycle support.

**Context:** Added via `DAGBuilder.edge()`. Used by `Scheduler` to determine node readiness and by `DAGExecutor` for upstream output wiring. Defined in `src/types.ts`.

**Not to be confused with:** `ConditionalEdge`, which includes an evaluator and multiple potential targets.

---

### DAGExecutor

**Definition:** The central orchestration engine that executes a complete DAG. Uses the `Scheduler` to determine ready nodes, runs them via `AgentRunner` or `AgenticRunner` (in parallel when possible), evaluates conditional edges, handles cycle iterations, manages dynamic expansion, enforces budget and duration limits, wires persistence, calls lifecycle hooks, and yields `SwarmEvent` objects throughout.

**Context:** Created and invoked internally by `SwarmEngine.run()`. Defined in `src/dag/executor.ts`.

---

### DAGGraph

**Definition:** A runtime wrapper around a `DAGDefinition` that provides traversal helper methods: `getNode()`, `getIncomingEdges()`, `getOutgoingEdges()`, `getConditionalEdges()`, `getRootNodes()`, `getLeafNodes()`, `addNode()`, `addEdge()`.

**Context:** Created from a `DAGDefinition` in `SwarmEngine.run()`. Passed to `DAGExecutor` and `Scheduler`. Supports mutation for dynamic expansion. Defined in `src/dag/graph.ts`.

---

### DAGNode

**Definition:** The static definition of a single node in a DAG. Contains the node ID, an `AgentDescriptor`, an optional task string (overrides the swarm-level task), and an optional `canEmitDAG` flag for dynamic expansion.

**Context:** Part of a `DAGDefinition`. Created via `DAGBuilder.agent()`. Defined in `src/types.ts`.

**Not to be confused with:** `AgentNode`, which is the runtime actor wrapper with execution state.

---

### DynamicExpansion

**Definition:** The ability for a coordinator node to emit new DAG structure (nodes and edges) at runtime. When a node with `canEmitDAG: true` completes, its output is parsed as JSON. If it contains valid `nodes` and `edges` arrays, the new structure is merged into the running graph.

**Context:** Enabled via `DAGBuilder.dynamicExpansion(nodeId)`. Handled by `DAGExecutor.handleDynamicExpansion()`. Listed in `DAGDefinition.dynamicNodes`. Defined in `src/dag/executor.ts`.

**Also known as:** Dynamic DAG, sub-DAG emission.

---

### EscalationPolicy

**Definition:** A configuration object that determines what happens when a feedback loop exhausts its `maxRetries` without the reviewer approving the producer's output. Three actions are available: `skip` (accept the producer's last output and proceed downstream), `fail` (mark the producer node as failed, triggering `skipDownstream` for dependents), or `reroute` (redirect execution to an alternative node specified by the `reroute` field). An optional `message` field is included in the `feedback_escalation` event.

**Context:** Part of the `FeedbackEdge` definition. If omitted, the default policy is `{ action: 'fail' }`. The `reroute` target must reference a valid node in the DAG (validated at build time). Defined in `src/types.ts`.

**Not to be confused with:** Error handling escalation, which is a consumer-side concern. `EscalationPolicy` is engine-managed and operates within the feedback loop.

---

### Evidence Guard

**Definition:** A fast, LLM-free output quality guard that detects unsubstantiated claims in agent output. It scans for 9 claim patterns (e.g., "all tests pass", "no issues found", "works correctly") and 6 evidence patterns (code blocks, shell commands, file paths, test indicators, test counts, error outputs). The guard triggers when claims are found but no evidence is present. Runs locally with no external calls.

**Context:** One of two built-in guard types. Configured via `Guard` with `type: 'evidence'`. Always runs before Scope Creep Guard in the guard runner's execution order. Defined in `src/guards/evidence.ts`.

**Not to be confused with:** Scope Creep Guard, which uses an LLM call for semantic analysis.

---

### Evaluator

**Definition:** A discriminated union type that determines how conditional routing decisions are made. Three variants: `rule` (a synchronous function mapping output to a target label), `regex` (a pattern test returning `matchTarget` or `elseTarget`), and `llm` (sends output to a cheap LLM to determine the target label).

**Context:** Used within `ConditionalEdge` and `FeedbackEdge` definitions. Executed by the `evaluate()` function in `src/agent/evaluator.ts`. Defined in `src/types.ts`.

---

### FanIn

**Definition:** A DAG pattern where multiple parallel branches converge into a single downstream node. The downstream node waits for all upstream nodes to complete before executing, receiving all their outputs as context.

**Context:** Created naturally when multiple edges point to the same target node. The `Scheduler` ensures the target only becomes ready when all upstream dependencies are completed. No special API is needed -- just wire multiple edges to the same target.

**Not to be confused with:** `FanOut`, which is the inverse pattern.

---

### FanOut

**Definition:** A DAG pattern where a single node's completion triggers multiple downstream nodes to execute in parallel. All downstream nodes receive the same upstream output.

**Context:** Created naturally when a single source node has multiple outgoing edges. The `DAGExecutor` launches all ready nodes simultaneously via `runNodesParallel()`. No special API is needed.

**Not to be confused with:** `FanIn`, which is the inverse pattern.

---

### FeedbackContext

**Definition:** A structured object injected into a producer node's context during a feedback loop retry. Contains the current `iteration` number (1-indexed), `maxRetries` limit, `previousFeedback` (the latest reviewer output), and `feedbackHistory` (all prior reviewer outputs in chronological order). Rendered as a `## Retry Feedback` section in the agent's context.

**Context:** Injected by the `ContextAssembler` at priority 1 (same level as system prompt and task -- never truncated). Placed after the system prompt and before upstream outputs. Only present when a node is being retried within a feedback loop. Defined in `src/types.ts`.

**Not to be confused with:** Upstream outputs, which are injected at priority 2. `FeedbackContext` has higher priority to ensure the agent always sees the retry feedback.

---

### FeedbackEdge

**Definition:** A directed edge that creates an engine-managed retry loop between a reviewer node and a producer node. When the reviewer's output does not match the `passLabel` according to the configured `Evaluator`, the producer node is reset and re-executed with feedback injected. Contains `from` (reviewer node ID), `to` (producer node ID), `maxRetries`, `evaluate` (an `Evaluator`), `passLabel`, and an optional `EscalationPolicy`.

**Context:** Added via `DAGBuilder.feedbackEdge()`. Stored in `DAGDefinition.feedbackEdges`. Evaluated by `DAGExecutor` after the reviewer node completes. Uses the same `Evaluator` types as `ConditionalEdge`. Defined in `src/types.ts`.

**Not to be confused with:** Cycle edges (regular `DAGEdge` with `maxCycles`), which implement simple loops without structured feedback injection.

---

### Guard

**Definition:** A post-completion output quality check that analyzes agent output for problematic patterns before passing results downstream. Each guard has an `id`, a `type` (e.g., `'evidence'` or `'scope-creep'`), a `mode` (`'warn'` emits an event and continues, `'block'` emits an event and fails the node), and an optional `config` object for guard-specific settings.

**Context:** Configured per-node via `DAGNode.guards` or engine-wide via `SwarmEngineConfig.guards`. Node-level guards completely replace engine-wide guards (no merging). Executed by the guard runner after node completion. Defined in `src/types.ts`.

**Not to be confused with:** `Evaluator`, which routes based on output content. Guards assess output quality and either warn or block.

---

### HandoffSection

**Definition:** A single section within a `HandoffTemplate`. Contains a `key` (machine identifier used for deduplication), a `label` (human-readable heading injected into the agent's output format instructions), and an optional `required` flag (defaults to false). When `required` is true, the section heading in the output format instructions is annotated with "(required)".

**Context:** Part of a `HandoffTemplate.sections` array. The `label` becomes a Markdown heading in the `## Output Format` block injected into the producing agent's system prompt. Defined in `src/types.ts`.

---

### HandoffTemplate

**Definition:** A structured output format specification applied to a DAG edge. Contains an `id` string and an array of `HandoffSection` objects. When assigned to a `DAGEdge.handoff` field, the engine injects corresponding `## Output Format` instructions into the producing agent's system prompt, guiding it to structure its output with labeled sections.

**Context:** Referenced on `DAGEdge.handoff` as either a preset name (string) or an inline object. Four built-in presets exist: `standard`, `qa-review`, `qa-feedback`, and `escalation`. Resolved by the template resolver in `src/handoffs/templates.ts`. Format instructions generated by `src/handoffs/formatter.ts`. Defined in `src/types.ts`.

**Not to be confused with:** Task templates (which provide task instructions), or `HandoffSection` (which is a single section within a template).

---

### LifecycleHooks

**Definition:** An interface for receiving callbacks at key points in the execution lifecycle. Four optional hooks: `onRunStart`, `onRunComplete`, `onRunFailed`, and `onSwarmComplete`.

**Context:** Provided via `SwarmEngineConfig.lifecycle`. Called by `DAGExecutor` after persistence operations. Hook failures are caught and swallowed to prevent breaking execution. Defined in `src/types.ts`.

---

### Logger

**Definition:** A leveled logging class with support for structured JSON output, level filtering, child loggers with merged context, and custom log sinks. Outputs to `stderr`. Disabled by default (all calls are no-ops when no `LoggingConfig` is provided).

**Context:** Created in the `SwarmEngine` constructor. Threaded through `DAGExecutor`, `AgentRunner`, and `ContextAssembler`. Defined in `src/logger.ts`.

---

### LogEntry

**Definition:** A structured log record containing the level (`debug`, `info`, `warn`, `error`), message string, timestamp (epoch milliseconds), and optional context object with key-value metadata.

**Context:** Produced by `Logger` and optionally forwarded to the `LoggingConfig.onLog` callback. When `structured: true`, serialized as JSON to stderr. Defined in `src/types.ts`.

---

### MemoryProvider

**Definition:** An interface for semantic memory search and storage. Two methods: `search(query, k)` returns relevant memory results ranked by score, and `store(text, metadata)` persists a new memory entry.

**Context:** Injected into `ContextAssembler` via `SwarmEngineConfig.memory`. Default is `NoopMemoryProvider` (returns empty results). Memory search results are injected at priority 5 in the assembly budget. Defined in `src/types.ts`.

---

### Monitor

**Definition:** The real-time monitoring subsystem that exposes swarm execution state over HTTP. Consists of `SSEBridge` (state management and event broadcasting), an HTTP server with `/events`, `/state`, and `/health` endpoints, and a web UI for visualization. In `v0.3.0`, the monitor snapshot also tracks feedback-loop and guard activity and benefits from live parallel event delivery.

**Context:** Opt-in. Consumers create a monitor server via `startMonitor()` and pipe events via `broadcast()`. Defined in `src/monitor/`.

---

### NodeResult

**Definition:** The outcome record for a completed DAG node. Contains the node ID, agent role, output text, optional artifact request, cost summary, and duration in milliseconds.

**Context:** Collected by `DAGExecutor` during execution and included in the final `swarm_done` event's `results` array. Also passed to `LifecycleHooks.onSwarmComplete()`. Defined in `src/types.ts`.

---

### NodeStatus

**Definition:** A string literal union representing the execution state of a DAG node: `pending` (not yet eligible), `ready` (eligible but not yet scheduled), `running` (actively executing), `completed` (finished successfully), `failed` (finished with error), or `skipped` (bypassed due to upstream failure or conditional routing).

**Context:** Tracked by `Scheduler` per node. Lifecycle: `pending` -> `running` -> `completed | failed | skipped`. Can be reset to `pending` for cycle support. Defined in `src/types.ts`.

---

### PersonaConfig

**Definition:** A structured representation of an agent persona containing name, role, traits, constraints, communication style, expertise domains, optional full Markdown prompt, department, seniority, and collaboration map.

**Context:** Returned by `PersonaProvider.getPersona()`. Parsed from PersonaSmith Markdown by `parsePersonaMarkdown()`. Injected into agent context at priority 1 by `ContextAssembler`. Defined in `src/types.ts`.

---

### PersonaProvider

**Definition:** An interface for loading persona configurations. Single method: `getPersona(role)` returns a `PersonaConfig` or `null`.

**Context:** Injected into `ContextAssembler` via `SwarmEngineConfig.persona`. Default is `NoopPersonaProvider` (returns null). The concrete implementation is `PersonaSmithProvider`. Defined in `src/types.ts`.

---

### PersistenceAdapter

**Definition:** An interface for persisting execution records, artifacts, messages, and activity logs to a backing store. Six methods: `createRun()`, `updateRun()`, `createArtifact()`, `saveMessage()`, `loadThreadHistory()`, `logActivity()`.

**Context:** Provided via `SwarmEngineConfig.persistence`. Default is `InMemoryPersistence` (in-memory map, capped at 100 runs). Used by `DAGExecutor` to record run state. All persistence calls are fire-and-forget safe. Defined in `src/types.ts`.

---

### ProviderAdapter

**Definition:** An interface for standard LLM providers that the engine manages. Three methods: `stream(params)` returns an `AsyncGenerator<ProviderEvent>` for streaming LLM responses, `estimateCost()` calculates cost for a given token usage, and `getModelLimits()` returns the context window and max output token limits for a model.

**Context:** Implementations exist for Anthropic, OpenAI, Ollama, and Anthropic OAuth. Created via `createProvider()` factory. Used by `AgentRunner` for LLM calls. Defined in `src/types.ts`.

**Not to be confused with:** `AgenticAdapter`, which is for autonomous backends that manage their own execution loop.

---

### ProviderConfig

**Definition:** Configuration for a single provider entry in `SwarmEngineConfig.providers`. Contains the provider type, optional API key, optional base URL, optional custom `ProviderAdapter`, and optional custom `AgenticAdapter`.

**Context:** Keyed by provider name in the `providers` record. The `SwarmEngine` constructor uses `isAgenticProvider()` to route each config to either `createProvider()` or `createAgenticAdapter()`. Defined in `src/types.ts`.

---

### ProviderEvent

**Definition:** A discriminated union of events yielded by `ProviderAdapter.stream()`. Three variants: `chunk` (a text fragment), `tool_use` (a tool call request with ID, name, and input), and `usage` (input and output token counts).

**Context:** Consumed by `AgentRunner` during the streaming loop. Mapped to `SwarmEvent` types. Defined in `src/types.ts`.

**Not to be confused with:** `AgenticEvent`, which is the equivalent for agentic backends.

---

### RunOptions

**Definition:** The options object passed to `SwarmEngine.run()` to start a swarm execution. Contains the `DAGDefinition`, a task string, optional `AbortSignal` for cancellation, optional thread ID, optional entity type and ID for context loading, and optional metadata. In `v0.3.0`, these contextual fields now propagate consistently through standard execution and persistence.

**Context:** The primary input to the engine's execution method. Defined in `src/types.ts`.

---

### Scheduler

**Definition:** Tracks node execution statuses within a DAG and determines which nodes are ready to run. Maintains a status map (nodeId -> `NodeStatus`) and cycle counts. Provides methods for querying ready nodes, marking status transitions, resetting nodes for cycles, and registering dynamically added nodes.

**Context:** Created by `DAGExecutor` at the start of each `execute()` call. Governs the execution loop. Also handles node status resets for feedback loop retries. Defined in `src/dag/scheduler.ts`.

---

### Scope Creep Guard

**Definition:** An LLM-based output quality guard that evaluates whether an agent's output stays within the bounds of its assigned task. Makes a cheap LLM call (temperature: 0, maxTokens: 100) that classifies the output as `SCOPED` or `OVERSCOPED`. Triggers when the classification is `OVERSCOPED`. Fail-open: silently skipped if no standard LLM provider is available or if the LLM call fails.

**Context:** One of two built-in guard types. Configured via `Guard` with `type: 'scope-creep'`. Runs after Evidence Guard in the guard runner's execution order. Requires at least one standard (non-agentic) LLM provider. Defined in `src/guards/scope-creep.ts`.

**Not to be confused with:** Evidence Guard, which is pattern-based and requires no LLM call.

---

### Scratchpad

**Definition:** A key-value store with append-list support that provides shared mutable state for agents within a swarm run. Enforces size limits (per-key and total). Tracks write history with agent attribution and timestamps. Supports `set`, `get`, `append`, `getList`, `keys`, `getHistory`, and `toContext` operations.

**Context:** Accessed via `SwarmMemory.scratchpad`. Agents interact with it via `scratchpad_set`, `scratchpad_read`, and `scratchpad_append` tools. Content is serialized into context at priority 3 during assembly. Defined in `src/memory/scratchpad.ts`.

**Not to be confused with:** `Channels`, which is for directed inter-agent messaging rather than shared state.

---

### SSEBridge

**Definition:** Converts `SwarmEvent` broadcasts into Server-Sent Events (SSE) data frames and maintains a `MonitorState` snapshot for catch-up on new client connections. Manages a set of connected HTTP response streams, broadcasting JSON-serialized events to all connected clients.

**Context:** Created by `createMonitorServer()`. Used by the monitor HTTP server to handle the `/events` endpoint. Consumers call `broadcast(event)` to push events to all connected clients. Defined in `src/monitor/sse-bridge.ts`.

---

### StreamParams

**Definition:** The parameter object for `ProviderAdapter.stream()`. Contains the model name, message array, temperature, max tokens, optional tool definitions, and optional `AbortSignal`.

**Context:** Constructed by `AgentRunner` from the assembled context and agent descriptor settings. Defined in `src/types.ts`.

---

### SwarmEngine

**Definition:** The main entry point for the multi-agent DAG orchestration engine. Manages provider initialization (separating standard and agentic adapters), creates noop defaults for unconfigured adapters, and exposes two public methods: `dag()` (returns a `DAGBuilder`) and `run(options)` (validates and executes a DAG, yielding `SwarmEvent` objects).

**Context:** The top-level class consumers instantiate. Defined in `src/engine.ts`.

---

### SwarmEngineConfig

**Definition:** The master configuration object for `SwarmEngine`. Contains the providers map, optional persistence adapter, context provider, memory provider, codebase provider, persona provider, lifecycle hooks, engine defaults (model, temperature, max tokens, default provider), engine limits (budgets, concurrency, duration, scratchpad size, cycle iterations), and logging configuration.

**Context:** Passed to the `SwarmEngine` constructor. All fields except `providers` are optional with sensible defaults. Defined in `src/types.ts`.

---

### SwarmError

**Definition:** A typed Error subclass that carries an `errorType` field (`AgentErrorType`) and an optional `cause` (the original error). Provides structured error information for consumers to handle different failure modes.

**Context:** Exported from the package for consumer use. The engine itself uses `classifyError()` internally rather than throwing `SwarmError` during execution. Defined in `src/errors/classification.ts`.

---

### SwarmEvent

**Definition:** A discriminated union of all events emitted during swarm execution. Fourteen variants spanning agent lifecycle (`agent_start`, `agent_chunk`, `agent_tool_use`, `agent_done`, `agent_error`), swarm lifecycle (`swarm_start`, `swarm_progress`, `swarm_done`, `swarm_error`, `swarm_cancelled`), routing (`route_decision`, `loop_iteration`), and budget (`budget_warning`, `budget_exceeded`).

**Context:** Yielded by the `SwarmEngine.run()` async generator. Consumed by the monitor subsystem, SSE clients, and application-level event handlers. Defined in `src/types.ts`.

---

### SwarmMemory

**Definition:** A container that bundles `Scratchpad` and `Channels` into a single shared-state object for a swarm run. Created per execution and passed to both `AgentRunner` and `AgenticRunner`.

**Context:** Created in `SwarmEngine.run()` with optional scratchpad size limits from `EngineLimits`. Provides the coordination layer that agents use to share state and send messages. Defined in `src/memory/index.ts`.

---

### TokenBudget

**Definition:** A context window management utility that accepts labeled content segments with priority numbers and produces a combined string that fits within a token limit. Priority 1 segments are never truncated. Lower-priority segments are truncated or removed from lowest priority first when the total exceeds the budget.

**Context:** Used by `ContextAssembler` to fit all context sources within 75% of the model's context window (reserving 25% for the response). Token estimation uses a 1 token = 4 characters approximation. Defined in `src/context/budget.ts`.

---

### TokenUsage

**Definition:** A single token usage record from one LLM call. Contains input token count, output token count, and model name.

**Context:** Emitted by `ProviderAdapter.stream()` as a `usage` event. Passed to `CostTracker.recordUsage()` for cost calculation and aggregation. Defined in `src/types.ts`.

**Not to be confused with:** `CostSummary`, which is an aggregate across multiple calls.
