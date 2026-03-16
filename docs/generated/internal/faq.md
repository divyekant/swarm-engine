---
type: faq
audience: internal
status: draft
generated: 2026-03-15
source-tier: direct
hermes-version: 1.0.1
---

# Internal FAQ

## DAG Orchestration

**Q: How does the engine determine which nodes to run next?**

The `Scheduler` tracks the status of every node (pending, ready, running, completed, failed, skipped). On each iteration of the executor loop, it calls `getReadyNodes()` which returns all nodes whose upstream dependencies are `completed`. Root nodes (no incoming edges) are immediately eligible. If `maxConcurrentAgents` is set in `EngineLimits`, the ready set is capped to that number. When multiple nodes are ready simultaneously, the executor launches them in parallel via `runNodesParallel()`.

See: `src/dag/scheduler.ts`, `src/dag/executor.ts`

**Q: What happens when a node fails? Do downstream nodes still execute?**

No. When a node fails, the executor calls `skipDownstream()` which recursively marks all downstream nodes (both regular and conditional edge targets) as `skipped`. The skipped nodes never execute. The swarm still runs to completion for any remaining branches that are not downstream of the failed node. The final `swarm_done` event includes results only from nodes that completed successfully.

See: `src/dag/executor.ts` (skipDownstream method)

**Q: Can I create cycles in a DAG?**

Yes, but every edge in the cycle must have `maxCycles` set. The DAG validator checks for this and rejects DAGs with unguarded cycles. During execution, the scheduler tracks cycle counts per edge. After each iteration, a `loop_iteration` event is emitted. When the count reaches `maxCycles`, the node stays completed and execution proceeds to downstream nodes. Use `DAGBuilder.edge(from, to, { maxCycles: 3 })` to configure.

See: `src/dag/validator.ts`, `src/dag/executor.ts` (handleCycleEdges method)

**Q: How does conditional routing work?**

Define a `ConditionalEdge` with an `Evaluator` and a `targets` map (label -> nodeId). When the source node completes, the evaluator runs against its output. Three evaluator types are available: `rule` (synchronous function), `regex` (pattern match), and `llm` (calls a cheap LLM with tight max_tokens). The selected target is unblocked; all other targets and their downstream are skipped. A `route_decision` event is emitted with the reason.

See: `src/agent/evaluator.ts`, `src/dag/executor.ts` (evaluateConditionalEdges method)

**Q: What is dynamic DAG expansion?**

A node marked with `canEmitDAG: true` (via `DAGBuilder.dynamicExpansion(nodeId)`) can output a JSON object containing `nodes` and `edges` arrays. When the executor detects this, it parses the JSON, adds the new nodes/edges to the running graph, and registers them with the scheduler. The new nodes become schedulable in subsequent loop iterations. If the output is not valid JSON or lacks the expected shape, it is silently ignored.

See: `src/dag/executor.ts` (handleDynamicExpansion method), `src/dag/builder.ts` (dynamicExpansion method)

---

## Agent Execution

**Q: What is the difference between AgentRunner and AgenticRunner?**

`AgentRunner` handles standard LLM provider nodes. It assembles context into a message array via `ContextAssembler`, manages a tool-use loop (streaming -> tool call -> re-stream), tracks costs via `CostTracker`, and yields `SwarmEvent` objects throughout. `AgenticRunner` handles agentic backend nodes (Claude Code, Codex). It does NOT assemble context into messages or manage a tool-use loop -- the agentic backend handles those internally. Instead, it formats upstream outputs, scratchpad, and inbox into a plain context string, builds communication tools as `AgenticTool[]`, and delegates execution to the `AgenticAdapter.run()` method.

See: `src/agent/runner.ts`, `src/agent/agentic-runner.ts`

**Q: How are upstream outputs passed to downstream nodes?**

The executor collects the output of each completed node in an `outputs` map (nodeId -> agentRole + output). When running a downstream node, `getUpstreamOutputs()` looks at all incoming regular edges and resolved conditional edges to gather outputs from all upstream nodes. These are passed to the runner, which either injects them into the context assembly (for standard nodes) or formats them into a context string (for agentic nodes).

See: `src/dag/executor.ts` (getUpstreamOutputs method)

**Q: How does the tool-use loop work in AgentRunner?**

The runner streams the LLM response and watches for `tool_use` events. When a tool call arrives, `AgentNode.handleToolCall()` executes it against `SwarmMemory` (send_message, scratchpad_set, scratchpad_read, scratchpad_append). The tool call and result are appended to the message array, the output buffer is reset, and the runner re-streams the LLM with the updated messages. This loop continues until the LLM produces a response without tool calls.

See: `src/agent/runner.ts` (run method), `src/agent/node.ts` (handleToolCall method)

**Q: What tools are available to agents during execution?**

Four communication tools: `send_message` (send to another agent), `scratchpad_set` (write key-value to shared state), `scratchpad_read` (read key from shared state), `scratchpad_append` (append to a list in shared state). For standard LLM nodes, these are provided as `ToolDefinition[]` via `AgentNode.getTools()`. For agentic nodes, they are provided as `AgenticTool[]` with `execute` functions.

See: `src/agent/node.ts`, `src/agent/agentic-runner.ts` (buildCommunicationTools method)

---

## Context & Memory

**Q: What is the priority order for context assembly?**

The `ContextAssembler` uses a `TokenBudget` with priority-based truncation. Priority 1 sections are never truncated. The full order is:

1. Persona (priority 1) -- full PersonaSmith Markdown or structured metadata block
2. System prompt (priority 1)
3. Task (priority 1)
4. Upstream outputs (priority 2)
5. Inbox/channels (priority 3)
6. Scratchpad (priority 3)
7. Entity context (priority 4)
8. Memory search results (priority 5)
9. Codebase context (priority 6)

When total tokens exceed the budget (75% of the context window), segments are truncated starting from the lowest priority. See: `src/context/assembler.ts`

**Q: How does the Scratchpad enforce size limits?**

The `Scratchpad` has two configurable limits: `maxKeyBytes` (default 10 KB per key) and `maxTotalBytes` (default 100 KB total). Size is estimated via `Buffer.byteLength(JSON.stringify(value))`. Both `set` and `append` operations check these limits before writing. If a write would exceed either limit, a synchronous error is thrown. Configure limits via `SwarmEngineConfig.limits.maxScratchpadSizeBytes` (maps to `maxTotalBytes`).

See: `src/memory/scratchpad.ts`

**Q: How do Channels work for inter-agent communication?**

`Channels` maintains a flat array of `ChannelMessage` objects. `send(from, to, content)` targets a specific agent; `broadcast(from, content)` targets all agents (using `*` as the `to` field). `getInbox(agentId)` returns all messages where the agent is the recipient or the message was a broadcast. Messages are accumulated for the lifetime of the swarm execution. There is no acknowledgment or delivery guarantee -- messages are read on a best-effort basis during context assembly.

See: `src/memory/channels.ts`

**Q: What is SwarmMemory?**

`SwarmMemory` is a container that bundles `Scratchpad` and `Channels` into a single object. It is created per swarm execution in `SwarmEngine.run()` and passed to both `AgentRunner` and `AgenticRunner`. It provides the shared state layer that agents use to communicate and coordinate during a swarm run.

See: `src/memory/index.ts`

---

## Cost & Budget

**Q: How does cost tracking work?**

`CostTracker` records token usage at three levels: per-agent, per-node, and swarm total. Each call to `recordUsage()` calculates cost in cents using a built-in `MODEL_PRICING` table (per-million-token rates). If the model is not in the table, a prefix match is attempted; if still not found, a default rate equivalent to Claude Sonnet is used. Cost is expressed in cents throughout the system.

See: `src/cost/tracker.ts`

**Q: What happens when the budget is exceeded?**

Two budget levels exist: `maxSwarmBudgetCents` (total swarm) and `maxPerAgentBudgetCents` (per agent). After each batch of nodes completes, the executor checks `checkBudgetThresholds()`. At 80% utilization, a `budget_warning` event is emitted. At 100%, a `budget_exceeded` event is emitted followed by a `swarm_error`, and execution stops. Per-agent budget checks happen after each individual node completes.

See: `src/dag/executor.ts` (checkBudgetThresholds method), `src/cost/tracker.ts`

**Q: How do I set cost budgets?**

Set `limits.maxSwarmBudgetCents` and/or `limits.maxPerAgentBudgetCents` in `SwarmEngineConfig`. Both values are in cents. For example, `{ limits: { maxSwarmBudgetCents: 500 } }` caps the total swarm at $5.00. If neither is set, no budget enforcement occurs. Agentic backends can also have their own budget via `AgenticOptions.maxBudgetUsd` (in USD, not cents), which is enforced by the agentic backend itself, not by the engine.

See: `src/types.ts` (EngineLimits), `src/engine.ts`

---

## Streaming & Monitoring

**Q: What SwarmEvent types are emitted during execution?**

The system emits 18 event types. Agent-level: `agent_start`, `agent_chunk`, `agent_tool_use`, `agent_done`, `agent_error`. Swarm-level: `swarm_start`, `swarm_progress`, `swarm_done`, `swarm_error`, `swarm_cancelled`. Routing: `route_decision`, `loop_iteration`. Budget: `budget_warning`, `budget_exceeded`. Feedback: `feedback_retry`, `feedback_escalation`. Guards: `guard_warning`, `guard_blocked`. All events are yielded from the `engine.run()` async generator.

See: `src/types.ts` (SwarmEvent type), `src/streaming/events.ts`

**Q: How do I set up the real-time monitor?**

Call `startMonitor()` (or `startMonitor({ port: 0 })` for a random port) to start the HTTP server. In your `engine.run()` loop, call `handle.broadcast(event)` for each yielded event. Connect the monitor web UI or any SSE client to `http://localhost:{port}/events`. Use `GET /state` for a JSON snapshot of the current swarm state. If you are working from the source repo, `npm run monitor:dev`, `npm run test:monitor`, and `npm run monitor:build` are now available at the root. Call `handle.close()` when done.

See: `src/monitor/http-server.ts`, `src/monitor/sse-bridge.ts`

**Q: Can multiple clients connect to the monitor simultaneously?**

Yes. The `SSEBridge` tracks all connected clients in a `Set<ServerResponse>`. Each `broadcast()` call writes the event to all clients. When a client disconnects, it is automatically removed from the set via the `close` event. Late-joining clients can catch up by calling `GET /state` for the accumulated state snapshot.

See: `src/monitor/sse-bridge.ts`

---

## Adapters & Providers

**Q: What LLM providers are supported out of the box?**

Standard providers: `anthropic` (API key auth), `anthropic-oauth` (OAuth token auth), `openai`, `ollama`, and `custom` (bring your own `ProviderAdapter`). Agentic providers: `claude-code`, `codex`, and `custom-agentic` (bring your own `AgenticAdapter`).

See: `src/adapters/providers/index.ts`, `src/adapters/agentic/index.ts`

**Q: How do I add a custom provider?**

For standard LLM providers, set `type: 'custom'` and provide an `adapter` field implementing the `ProviderAdapter` interface (three methods: `stream()`, `estimateCost()`, `getModelLimits()`). For agentic providers, set `type: 'custom-agentic'` and provide an `agenticAdapter` field implementing the `AgenticAdapter` interface (one method: `run()` returning `AsyncGenerator<AgenticEvent>`).

See: `src/types.ts` (ProviderAdapter, AgenticAdapter interfaces)

**Q: Can I mix standard and agentic providers in the same DAG?**

Yes. The `SwarmEngine` constructor separates providers into two maps. During execution, the `DAGExecutor` checks each node's `providerId` against the agentic adapters map. If found there, it routes to `AgenticRunner`; otherwise it routes to `AgentRunner`. A single DAG can contain some nodes running against Anthropic's API and others running as Claude Code agent sessions.

See: `src/engine.ts` (constructor), `src/dag/executor.ts` (isAgenticNode method)

**Q: How does the PersonaSmithProvider resolve roles?**

Three resolution strategies, tried in order: (1) department-qualified (`engineering/software-engineer` resolves to `{personasDir}/engineering/software-engineer.md`), (2) direct path (`{personasDir}/{role}.md`), (3) unqualified search (scans all subdirectories of `personasDir` for `{role}.md`). Role strings are normalized to kebab-case before lookup. Results are cached in memory by default.

See: `src/adapters/personas/personasmith.ts`

---

## Logging & Errors

**Q: How do I enable logging?**

Add a `logging` field to `SwarmEngineConfig`:

- Minimum: `{ logging: { level: 'info' } }` -- logs to stderr in human-readable format.
- Structured: `{ logging: { level: 'debug', structured: true } }` -- JSON output to stderr.
- Custom sink: `{ logging: { level: 'info', onLog: (entry) => myLogger.log(entry) } }` -- receives all log entries that pass the level threshold.

When `logging` is omitted or `undefined`, all log calls are no-ops with zero overhead. See: `src/logger.ts`

**Q: How are errors classified?**

The `classifyError()` function maps error messages and names to `AgentErrorType` categories: `rate_limit` (429, rate limit keywords), `auth_error` (401, 403, unauthorized), `timeout` (AbortError, timeout keywords), `content_filter` (content policy, safety, moderation), `network_error` (fetch failed, ECONNREFUSED, ENOTFOUND), `budget_exceeded`, or `unknown`. This classification is used in `agent_error` events and persistence records.

See: `src/errors/classification.ts`

**Q: What is SwarmError?**

`SwarmError` is a typed Error subclass that carries an `errorType` field (`AgentErrorType`) and an optional `cause` (the original error). It is exported from the package for consumers to use in error handling. The engine itself uses `classifyError()` to classify raw errors into typed events rather than throwing `SwarmError` directly during execution.

See: `src/errors/classification.ts`

**Q: Are persistence errors fatal?**

No. All persistence operations (`createRun`, `updateRun`, `createArtifact`) are wrapped in try/catch blocks in the executor. If a persistence call fails, the error is logged as a warning and execution continues. Similarly, lifecycle hook failures (`onRunStart`, `onRunComplete`, `onRunFailed`, `onSwarmComplete`) are caught and swallowed. This ensures that a database outage does not crash an in-flight swarm.

See: `src/dag/executor.ts` (persistCreateRun, persistUpdateRun, persistCreateArtifact methods)

---

## Handoff Templates

**Q: What are Handoff Templates and when should I use them?**

Handoff Templates add structured output formatting between DAG nodes. When an edge has a `handoff` field (a preset name or inline `HandoffTemplate` object), the engine injects `## Output Format` instructions into the producing agent's system prompt. This results in output with clear, labeled sections (e.g., Summary, Deliverables, Context for Next Step) instead of free-form text. Use them when downstream nodes need predictably structured input.

See: `src/handoffs/templates.ts`, `src/handoffs/formatter.ts`

**Q: What are the built-in handoff presets?**

Four presets: `standard` (Summary, Deliverables, Context for Next Step), `qa-review` (Deliverables, Test Criteria, Known Limitations), `qa-feedback` (Verdict, Issues Found, Suggestions), and `escalation` (Problem Description, Attempts Made, Recommendation). Reference them by name on any `DAGEdge`: `builder.edge('coder', 'reviewer', { handoff: 'qa-review' })`.

See: `src/handoffs/templates.ts`

**Q: What happens if I use an unknown preset name for handoff?**

The engine logs a warning and falls back to raw passthrough (no output format instructions injected). Execution is not interrupted. The edge behaves as if no `handoff` was specified.

See: `src/handoffs/templates.ts` (resolver function)

**Q: Can I use handoff templates on conditional edges?**

No. Handoff templates are supported only on `DAGEdge` (regular edges). `ConditionalEdge` does not have a `handoff` field. If you need structured output before a conditional routing decision, add a regular edge with a handoff template from the producer to an intermediate node before the conditional edge.

---

## Feedback Loops

**Q: How do feedback loops work?**

A `FeedbackEdge` connects a reviewer node back to a producer node. When the reviewer completes, the engine runs an evaluator on the reviewer's output. If the result matches `passLabel`, the loop ends and the producer's output proceeds downstream. If it does not match, the producer node is reset and re-executed with a `FeedbackContext` injected into its context at priority 1. This context includes the latest rejection feedback and the full feedback history from prior iterations.

See: `src/dag/executor.ts` (feedback loop handling), `src/types.ts` (FeedbackEdge, FeedbackContext)

**Q: What happens when maxRetries is exhausted in a feedback loop?**

The `EscalationPolicy` fires. Three actions are available: `skip` (accept the producer's last output and continue downstream), `fail` (mark the producer as failed and skip downstream), or `reroute` (redirect execution to an alternative node). If no escalation policy is specified, the default is `{ action: 'fail' }`. A `feedback_escalation` event is emitted in all cases.

See: `src/types.ts` (EscalationPolicy)

**Q: Does the downstream node receive the reviewer's output or the producer's output?**

The producer's latest (approved) output. The reviewer's output is consumed by the feedback loop's evaluator and injected into the producer's retry context, but it is not passed downstream as an upstream output.

See: `src/dag/executor.ts`

**Q: How expensive are feedback loops?**

Each iteration executes both the producer and the reviewer node. A loop with `maxRetries: 3` can produce up to 8 agent runs total (1 initial producer + 1 initial reviewer + 3 retried producers + 3 retried reviewers). Cost is tracked cumulatively by `CostTracker`. Budget limits (`maxSwarmBudgetCents`, `maxPerAgentBudgetCents`) apply across all iterations and are the primary safeguard against runaway cost.

See: `src/cost/tracker.ts`, `src/dag/executor.ts`

---

## Anti-Pattern Guards

**Q: What are Anti-Pattern Guards?**

Guards are post-completion output quality checks that run after a node finishes but before its output is passed downstream. Two built-in types exist: the Evidence Guard (detects claims like "all tests pass" without supporting evidence such as code blocks or test output) and the Scope Creep Guard (uses an LLM call to check whether the output stays within the assigned task scope). Guards operate in `warn` mode (emit event, continue) or `block` mode (emit event, fail the node).

See: `src/guards/evidence.ts`, `src/guards/scope-creep.ts`, `src/guards/runner.ts`

**Q: How do node-level guards interact with engine-wide guards?**

Node-level guards completely replace engine-wide guards -- they do not merge. If a node defines `guards: [{ id: 'evidence', type: 'evidence', mode: 'warn' }]`, only the Evidence Guard runs for that node, regardless of what engine-wide guards are configured. Setting `guards: []` on a node disables all guards for it, including engine-wide defaults.

See: `src/guards/runner.ts`

**Q: What happens if the Scope Creep Guard's LLM call fails?**

The guard is fail-open. If the LLM call encounters a network error, timeout, rate limit, or any other failure, the guard does not trigger and execution proceeds normally. The failure is logged at debug level. This ensures guard infrastructure issues never block swarm execution.

See: `src/guards/scope-creep.ts`

**Q: Can I combine guards with feedback loops?**

Yes, but the interaction is sequential: guards run on the producer's output first. If a guard blocks the output, the node is treated as failed. This failure triggers the feedback loop's escalation policy -- the guard blocking counts as a node failure, not a retry-eligible rejection. If guards pass (or only warn), the output proceeds to the reviewer node for the normal feedback loop evaluation.

See: `src/dag/executor.ts`, `src/guards/runner.ts`
