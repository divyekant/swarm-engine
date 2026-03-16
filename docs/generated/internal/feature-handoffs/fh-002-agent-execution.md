---
id: fh-002
type: feature-handoff
audience: internal
topic: Agent Execution
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [src/agent/, docs/ARCHITECTURE.md]
hermes-version: 1.0.0
---

# Agent Execution

## What It Does

The agent execution system is responsible for running individual agent nodes within a DAG. It consists of two parallel runners -- AgentRunner for standard LLM-based agents and AgenticRunner for autonomous agentic backends (Claude Code, Codex) -- plus supporting components for node state management and output evaluation.

The system provides a uniform execution contract: regardless of whether a node runs against a streaming LLM or an autonomous code agent, the caller receives the same AsyncGenerator of SwarmEvent objects and the same NodeResult shape at completion. This uniformity allows the DAGExecutor to treat all nodes identically during scheduling and routing.

Four components make up the agent execution layer:

- **AgentRunner** -- Orchestrates a single LLM agent execution: context assembly, streaming, tool-use loop, and cost recording.
- **AgenticRunner** -- Orchestrates a single agentic backend execution: upstream context formatting, communication tool injection, adapter delegation, and event mapping.
- **AgentNode** -- The actor-style wrapper for an agent within a swarm, holding descriptor, status, output, inbox, outbox, and providing communication tools to the LLM.
- **Evaluator** -- A three-tier output evaluation function used for conditional routing decisions.

## How It Works

### AgentRunner (LLM Nodes)

AgentRunner handles nodes backed by standard LLM providers (Anthropic, OpenAI, Ollama, or custom). Its execution flow for a single node is:

1. **Provider resolution** -- The runner checks if the agent descriptor has a `providerId`. If so, it looks up that provider in the providers map. If not found or not specified, it falls back to the default provider.
2. **Node creation** -- An AgentNode instance is created with the node ID and agent descriptor. Its status is set to `running`.
3. **Event: agent_start** -- Emitted with the node ID, agent role, and agent name.
4. **Context assembly** -- The runner calls `ContextAssembler.assemble()` with the system prompt, task, model context window limits, upstream outputs, swarm memory reference, and agent ID. The assembler returns a Message array ready for the provider.
5. **Tool retrieval** -- The runner calls `AgentNode.getTools(memory)` to get the four communication tool definitions (send_message, scratchpad_set, scratchpad_read, scratchpad_append).
6. **Streaming with tool-use loop** -- The runner enters a `while (continueLoop)` loop. On each iteration, it calls `provider.stream()` with the current messages, temperature, max tokens, and tools. It processes the stream:
   - `chunk` events append to the output string and yield `agent_chunk` SwarmEvents.
   - `tool_use` events are handled by calling `AgentNode.handleToolCall()`, which executes the tool against SwarmMemory and returns a result string. The assistant's content and tool call are appended to messages, the tool result is appended as a tool message, the output string is reset, and `continueLoop` is set to `true` to re-stream.
   - `usage` events record token counts via the CostTracker and accumulate totals.
7. **Event: agent_done** -- After the tool-use loop completes, the runner emits `agent_done` with the final output and a CostSummary retrieved from the CostTracker.
8. **Error handling** -- If any exception occurs during the stream, the runner classifies the error via `classifyError()` and emits `agent_error` with the classified error type.

### AgenticRunner (Agentic Nodes)

AgenticRunner handles nodes backed by agentic platforms like Claude Code or Codex. Unlike AgentRunner, it does not assemble context into a message array or manage a tool-use loop -- the agentic backend handles those concerns internally. Its execution flow is:

1. **Event: agent_start** -- Emitted with the node ID, agent role, and agent name.
2. **Upstream context formatting** -- The runner builds a single context string by concatenating three sections: upstream agent outputs (formatted as markdown headers with role and node ID), inbox messages from SwarmMemory channels, and the current scratchpad state. Each section is only included if it has content.
3. **Communication tool construction** -- The runner builds four AgenticTool objects: `send_message`, `scratchpad_set`, `scratchpad_read`, and `scratchpad_append`. Unlike the LLM runner's tool definitions (which are JSON schemas interpreted by the provider), these are full tool objects with an `execute` function that the agentic backend calls directly.
4. **Adapter delegation** -- The runner calls `adapter.run()` with the task, system prompt, upstream context string, agentic options from the agent descriptor, abort signal, and the communication tools.
5. **Event mapping** -- The runner iterates over the adapter's AgenticEvent stream and maps each event to a SwarmEvent:
   - `chunk` -> `agent_chunk`
   - `tool_use` -> `agent_tool_use`
   - `result` -> records cost via CostTracker (if token counts are present) and stores the final output
   - `error` -> classifies via `classifyError()` and emits `agent_error`, then returns immediately
6. **Event: agent_done** -- After the stream completes, the runner emits `agent_done` with the final output and a CostSummary.

### AgentNode (Actor Wrapper)

AgentNode is the actor-style wrapper for an individual agent. It holds:

- The agent's AgentDescriptor (id, name, role, systemPrompt, model, temperature, etc.)
- The node ID within the DAG
- Execution status (pending, running, completed, failed)
- Accumulated output text
- An inbox (messages received) and outbox (messages sent)

AgentNode provides `getTools(memory)`, which returns four ToolDefinition objects for the LLM to invoke. These tool definitions follow the standard JSON Schema format expected by provider adapters.

AgentNode also provides `handleToolCall(call, memory)`, which executes a tool call and returns a result string. The four supported tools operate on SwarmMemory:

- `send_message` -- Sends a point-to-point message to another agent via `memory.channels.send()`. The message is also recorded in the node's outbox.
- `scratchpad_set` -- Writes a key-value pair to the shared scratchpad via `memory.scratchpad.set()`.
- `scratchpad_read` -- Reads a value from the scratchpad by key via `memory.scratchpad.get()`. Returns JSON-serialized value or a "not found" message.
- `scratchpad_append` -- Appends a value to a list in the scratchpad via `memory.scratchpad.append()`.

Unknown tool names return an error string rather than throwing.

### Evaluator

The evaluate function determines routing for conditional edges. It takes an Evaluator definition, the completed agent's output, and an optional provider adapter (needed only for LLM evaluators). It returns a string -- either a target label from the conditional edge's targets map or a direct node ID.

Three evaluator tiers exist, ordered from cheapest to most expensive:

1. **Rule** -- A synchronous function `(output: string) => string` provided by the consumer. It runs instantly with zero cost. The function receives the raw output and returns a target label.
2. **Regex** -- A RegExp pattern tested against the output. If the pattern matches, it returns `matchTarget`; otherwise, it returns `elseTarget`. Also instant and free.
3. **LLM** -- Sends the output to a provider with a tight prompt ("Return ONLY the target label, nothing else.") and `maxTokens: 50`, `temperature: 0`. The evaluator's prompt and the agent output are combined in the user message. The model and provider can be overridden per evaluator. This costs a small LLM call (~50 output tokens).

The design intent is that consumers use the cheapest sufficient evaluator. Rule functions handle deterministic routing. Regex handles pattern-based routing. LLM evaluators handle cases where the routing decision requires semantic understanding of the output.

### Runner Selection in DAGExecutor

The DAGExecutor determines which runner to use via the `isAgenticNode(nodeId)` method. This method checks whether the node's `providerId` exists as a key in the `agenticAdapters` map. If it does, the method returns `{ isAgentic: true, adapter }`. If not (or if the node has no `providerId`), it returns `{ isAgentic: false }`.

The executor only routes to AgenticRunner if both conditions are met: the node is identified as agentic AND an AgenticRunner instance was created (which only happens if at least one agentic adapter exists in the engine configuration). This means a node with a `providerId` pointing to an agentic provider type but with the SDK not installed will fail at execution time with a descriptive error, not at engine construction time.

## User-Facing Behavior

From the consumer's perspective, agent execution is transparent. The consumer defines agent descriptors with the appropriate `providerId` and optional `agentic` options, adds them to the DAG, and iterates over the event stream. The events are identical regardless of runner type:

- `agent_start` fires when the node begins execution.
- `agent_chunk` fires for each text chunk (streaming output).
- `agent_tool_use` fires when the agent invokes a tool (communication tools or, for LLM agents, any provider-side tools).
- `agent_done` fires with the complete output and cost summary.
- `agent_error` fires if the execution fails, with a classified error type.

All events carry `nodeId` for correlation. Cost is attributed uniformly -- both LLM token costs and agentic backend costs roll up into the same CostTracker and appear in the same CostSummary format.

### AgentDescriptor

The AgentDescriptor is the consumer-facing configuration for a single agent:

- `id` (string, required) -- Unique identifier for the agent.
- `name` (string, required) -- Display name.
- `role` (string, required) -- Agent role (e.g., "pm", "architect", "developer").
- `systemPrompt` (string, required) -- The system prompt that defines the agent's behavior.
- `model` (string, optional) -- Model identifier. Falls back to the engine default if not set.
- `temperature` (number, optional) -- Sampling temperature. Falls back to the engine default or 0.7 if neither is set.
- `maxTokens` (number, optional) -- Maximum output tokens. Falls back to the engine default or the model's max output limit.
- `providerId` (string, optional) -- Which provider to use. Falls back to the engine default provider. If this references an agentic provider type, the node runs via AgenticRunner.
- `persona` (PersonaConfig, optional) -- Persona metadata for context assembly.
- `agentic` (AgenticOptions, optional) -- Configuration for agentic backends.

### AgenticOptions

When a node runs via AgenticRunner, the `agentic` field on AgentDescriptor controls the backend behavior:

- `permissionMode` (string, optional) -- Permission policy for the agentic backend (e.g., "auto" for Claude Code).
- `allowedTools` (string[], optional) -- Whitelist of tools the agentic backend can use.
- `disallowedTools` (string[], optional) -- Blacklist of tools.
- `cwd` (string, optional) -- Working directory for the agentic session.
- `maxTurns` (number, optional) -- Maximum number of conversational turns.
- `maxBudgetUsd` (number, optional) -- Per-session budget in USD for the agentic backend.
- `model` (string, optional) -- Model override for the agentic backend.
- `mcpServers` (Record, optional) -- MCP server configuration to inject into the session.
- `env` (Record, optional) -- Environment variables for the session.
- `pathToClaudeCodeExecutable` (string, optional) -- Custom path to the Claude Code CLI executable.

### NodeResult

Every completed node produces a NodeResult:

- `nodeId` (string) -- The DAG node ID.
- `agentRole` (string) -- The agent's role.
- `output` (string) -- The complete output text.
- `artifactRequest` (ArtifactRequest, optional) -- If the agent produced an artifact.
- `cost` (CostSummary) -- Token usage and cost in integer cents.
- `durationMs` (number) -- Wall-clock execution time.

## Configuration

Agent execution does not have its own dedicated configuration section. It is controlled through:

- **Agent descriptors** -- Model, temperature, maxTokens, providerId, and agentic options are per-agent.
- **Engine defaults** (`SwarmEngineConfig.defaults`) -- Fallback values for model, temperature, maxTokens, and provider when not specified per-agent.
- **Engine limits** (`SwarmEngineConfig.limits`) -- `maxPerAgentBudgetCents` controls per-agent cost budgets. `maxSwarmBudgetCents` controls the overall swarm budget.
- **Provider configuration** (`SwarmEngineConfig.providers`) -- Each entry's `type` field determines whether it is a standard provider or an agentic provider. Standard types: `anthropic`, `anthropic-oauth`, `openai`, `ollama`, `custom`. Agentic types: `claude-code`, `codex`, `custom-agentic`.

## Edge Cases & Limitations

- **SDK not installed:** Both `@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk` are optional dependencies. If a DAG contains a node with an agentic provider type but the corresponding SDK is not installed, the error surfaces at the first `run()` call with a descriptive message -- not at engine construction time and not at DAG validation time. The engine initializes normally; the adapter factory throws when it attempts to import the SDK.
- **Nested session prevention:** Agentic backends like Claude Code may detect that they are running inside another Claude Code session and refuse to create nested sessions. This manifests as an `agent_error` with an error message from the SDK.
- **Tool call loop:** The LLM runner's tool-use loop has no explicit iteration cap. In practice, the loop terminates when the LLM produces a response without tool calls. If an LLM produces an infinite sequence of tool calls, the overall swarm duration limit or budget limit will eventually terminate execution.
- **Mixed runners in the same DAG:** A DAG can contain both LLM nodes and agentic nodes. The executor routes each node independently based on its provider. Outputs from LLM nodes are available as upstream context for agentic nodes and vice versa.
- **Cost from agentic backends:** Agentic backends may or may not report token usage. If the adapter's `result` event includes `inputTokens` and `outputTokens`, they are recorded in the CostTracker. If not, the cost for that node is recorded as zero.
- **Unknown tool calls:** If the LLM invokes a tool name that is not one of the four communication tools, `AgentNode.handleToolCall()` returns an error string. This does not throw or halt execution -- the error string is sent back to the LLM as the tool result.
- **Provider fallback:** If an agent's `providerId` does not match any registered provider, the runner silently falls back to the default provider. This is intentional -- it allows agents to be portable across configurations.

## Common Questions

**Can I use both Claude Code and Codex in the same DAG?**
Yes. Register both as providers in the engine configuration (one with type `claude-code`, another with type `codex`). Assign different `providerId` values to the respective agent descriptors. The executor routes each node to the correct adapter independently.

**What if the agentic SDK is not installed?**
The engine constructs normally. Validation passes. The error occurs when `run()` is called and the executor attempts to create an agentic adapter for the first agentic node. The error message indicates which SDK package needs to be installed.

**How does the tool-use loop work?**
After each LLM stream, the runner checks if any `tool_use` events were emitted. If so, it executes the tool, appends the assistant's content and tool call to the message history, appends the tool result, resets the output accumulator, and re-streams. This continues until the LLM produces a response with no tool calls.

**Are the four communication tools always available?**
Yes. Every agent node -- both LLM and agentic -- gets the same four communication tools (send_message, scratchpad_set, scratchpad_read, scratchpad_append). For LLM nodes, they appear as tool definitions in the provider stream call. For agentic nodes, they are injected as executable AgenticTool objects.

**How is cost attributed?**
Every LLM call and agentic backend result is recorded in the CostTracker with the agent ID and node ID. The CostTracker computes cost in integer cents using the provider's `estimateCost()` method. Costs are available per-agent, per-node, and as a swarm total.

**What error types can agent_error have?**
The `classifyError()` function maps exceptions to one of seven types: `timeout`, `rate_limit`, `auth_error`, `network_error`, `content_filter`, `budget_exceeded`, or `unknown`. Consumers can use these types to decide on retry strategies.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `agent_error` with "Cannot find module '@anthropic-ai/claude-agent-sdk'" | The Claude Code agent SDK is not installed but a node references a `claude-code` provider. | Install the SDK: `bun add @anthropic-ai/claude-agent-sdk` (or npm/yarn equivalent). |
| `agent_error` with "Cannot find module '@openai/codex-sdk'" | The Codex SDK is not installed but a node references a `codex` provider. | Install the SDK: `bun add @openai/codex-sdk`. |
| `agent_error` with type `auth_error` | The API key for the provider is missing, invalid, or expired. | Check the `apiKey` field in the provider configuration. |
| `agent_error` with type `rate_limit` | The LLM provider returned a rate limit error. | Reduce concurrency (`maxConcurrentAgents`), add delays between runs, or switch to a provider with higher rate limits. |
| Agent produces empty output | The LLM returned an empty response, possibly due to content filtering or a very low `maxTokens` setting. | Check for `content_filter` error type. Increase `maxTokens` on the agent descriptor. |
| Tool calls not being executed | The agent may be calling tools with names that do not match the four communication tools. | Verify that the LLM is calling `send_message`, `scratchpad_set`, `scratchpad_read`, or `scratchpad_append` -- not custom or misspelled tool names. |
| Cost shows zero for agentic nodes | The agentic backend did not report token usage in its `result` event. | This is expected behavior for some backends. The cost cannot be tracked if the backend does not report it. |

## Related

- [fh-001-dag-orchestration.md](./fh-001-dag-orchestration.md) -- DAG orchestration (executor, scheduler, validator)
- [fh-003-context-assembly.md](./fh-003-context-assembly.md) -- Context assembly pipeline and token budget management
- `src/agent/runner.ts` -- AgentRunner implementation
- `src/agent/agentic-runner.ts` -- AgenticRunner implementation
- `src/agent/node.ts` -- AgentNode implementation
- `src/agent/evaluator.ts` -- Evaluator implementation
- `src/adapters/agentic/types.ts` -- AgenticAdapter, AgenticOptions, AgenticEvent, AgenticTool type definitions
- `src/types.ts` -- AgentDescriptor, NodeResult, SwarmEvent, Evaluator type definitions
- `docs/ARCHITECTURE.md` -- Full architecture overview
