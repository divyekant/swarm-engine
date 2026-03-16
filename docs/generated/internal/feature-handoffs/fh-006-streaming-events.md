---
id: fh-006
type: feature-handoff
audience: internal
topic: Streaming Events
status: draft
generated: 2026-03-15
source-tier: direct
context-files: [src/streaming/, src/types.ts, docs/ARCHITECTURE.md]
hermes-version: 1.0.1
---

# Streaming Events

## What It Does

The streaming event system provides a real-time, structured feed of everything happening during a swarm execution. When a consumer calls `engine.run()`, it receives an AsyncGenerator that yields SwarmEvent objects one at a time as the execution progresses. These events cover the full lifecycle: swarm start, agent execution, tool usage, routing decisions, loop iterations, budget alerts, and completion or failure.

The system is transport-agnostic. It produces typed objects that the consumer can wrap in any transport layer -- Server-Sent Events (SSE), WebSocket frames, log entries, or direct in-process consumption. The engine makes no assumptions about how events are delivered to the end user.

## How It Works

### SwarmEventEmitter

SwarmEventEmitter is the internal async iterable event bus. It implements `AsyncIterable<SwarmEvent>` and serves as the bridge between event producers (the DAGExecutor, AgentRunner, AgenticRunner) and the consumer's for-await-of loop.

The emitter operates with a simple push/pull mechanism:

- **Push side**: Producers call `emit(event)` to send an event. If a consumer is currently waiting (blocked on `next()`), the event is delivered immediately. If no consumer is waiting, the event is buffered in an internal array.
- **Pull side**: Consumers iterate using `for await (const event of emitter)`. Each iteration call checks the buffer first (returning a buffered event if available), then waits for the next `emit()` call if the buffer is empty.
- **Completion**: Calling `close()` signals that no more events will be produced. Any pending consumer `next()` call resolves with `{ done: true }`.
- **Error**: Calling `error(err)` signals a fatal error. Any pending or future consumer `next()` call rejects with the provided error.

The buffer exists only to handle timing mismatches between producers and consumers. In practice, events are typically consumed as fast as they are produced, keeping the buffer near-empty. The system does not apply backpressure or rate limiting.

### Event Flow Through the DAGExecutor

The DAGExecutor's `execute()` method is itself an AsyncGenerator that yields SwarmEvents. The flow works as follows:

1. The executor yields `swarm_start` at the beginning, including the DAG ID and total node count.
2. For each batch of ready nodes, the executor checks for cancellation (AbortSignal) and duration limits before proceeding.
3. For sequential execution (single ready node), it delegates to `runNode()` which yields events from the AgentRunner or AgenticRunner as they stream in.
4. For parallel execution (multiple ready nodes), it delegates to `runNodesParallel()` which runs all nodes concurrently and pushes branch events through a live queue as they are produced.
5. After each batch, the executor checks budget thresholds and yields `budget_warning` or `budget_exceeded` if applicable.
6. After all nodes complete (or the swarm terminates), the executor yields `swarm_done`, `swarm_error`, or `swarm_cancelled`.

### Event Types

There are 18 distinct event types organized across 6 categories. Every event type includes a `type` discriminant field. Most events also carry a `nodeId` field for correlation to a specific DAG node.

**Agent Events (5 types)**

- `agent_start` -- Emitted when a node begins execution. Carries `nodeId`, `agentRole`, and `agentName`. Emitted by both AgentRunner and AgenticRunner as the first thing they do.

- `agent_chunk` -- Emitted for each incremental piece of text output from the LLM. Carries `nodeId`, `agentRole`, and `content` (the text fragment). For LLM nodes, these arrive as the model streams tokens. For agentic nodes, they arrive as the agentic backend produces output fragments.

- `agent_tool_use` -- Emitted when the agent invokes a tool. Carries `nodeId`, `tool` (tool name), and `input` (the tool's input parameters as a key-value object). Emitted for both LLM tool calls and agentic backend tool calls.

- `agent_done` -- Emitted when a node completes successfully. Carries `nodeId`, `agentRole`, `output` (the full text output), an optional `artifactRequest` (if the agent produced an artifact), and `cost` (CostSummary for this node's execution). This is the final event from a successful node execution.

- `agent_error` -- Emitted when a node fails. Carries `nodeId`, `agentRole`, `message` (error description), and `errorType` (one of seven classified error types). After an agent_error, the executor marks the node as failed and skips its downstream dependencies.

**Swarm Events (5 types)**

- `swarm_start` -- Emitted once at the beginning of execution. Carries `dagId` (the DAG's identifier), `nodeCount` (total nodes in the DAG), and an optional `estimatedCost`.

- `swarm_progress` -- Emitted after each batch of nodes completes. Carries `completed` (count of finished nodes), `total` (total node count), and `runningNodes` (array of node IDs currently executing). Useful for progress bars and status displays.

- `swarm_done` -- Emitted when the swarm completes successfully. Carries `results` (array of NodeResult objects, one per completed node) and `totalCost` (CostSummary for the entire run). Each NodeResult includes `nodeId`, `agentRole`, `output`, optional `artifactRequest`, `cost`, and `durationMs`.

- `swarm_error` -- Emitted when the swarm terminates due to an error (budget exceeded, duration limit, unhandled exception). Carries `message`, `completedNodes` (array of node IDs that finished before the error), and `partialCost` (CostSummary up to the point of failure).

- `swarm_cancelled` -- Emitted when the swarm is cancelled via AbortSignal. Carries `completedNodes` and `partialCost`, same as swarm_error.

**Routing Events (2 types)**

- `route_decision` -- Emitted when a conditional edge is evaluated and a routing decision is made. Carries `fromNode` (the node whose output was evaluated), `toNode` (the selected target node), and `reason` (the label or explanation for the routing choice). Non-selected targets are marked as skipped.

- `loop_iteration` -- Emitted during iterative refinement loops when a cycle edge fires. Carries `nodeId` (the node being re-run), `iteration` (current iteration number, starting from 1), and `maxIterations` (the configured cycle limit). When `iteration` equals `maxIterations`, the loop ends and the node proceeds to its non-cycle downstream edges.

**Budget Events (2 types)**

- `budget_warning` -- Emitted when swarm spending reaches 80% of the configured budget. Carries `used` (cents spent so far), `limit` (total budget in cents), and `percentUsed` (integer percentage). Only emitted once per threshold crossing.

- `budget_exceeded` -- Emitted when swarm spending exceeds the configured budget. Carries `used` and `limit`. This event is immediately followed by a `swarm_error` event, and the executor stops scheduling new nodes.

**Feedback Events (2 types)**

- `feedback_retry` -- Emitted when a review node causes a producer node to retry. Carries `fromNode`, `toNode`, `iteration`, and `maxRetries`.

- `feedback_escalation` -- Emitted when a feedback loop reaches its retry limit and applies an escalation policy. Carries `fromNode`, `toNode`, `policy`, and `iteration`.

**Guard Events (2 types)**

- `guard_warning` -- Emitted when a guard flags output quality but allows execution to continue.

- `guard_blocked` -- Emitted when a guard blocks the node output and forces failure.

### Error Type Classification

The `agent_error` event includes an `errorType` field with one of seven values:

- `timeout` -- The agent execution exceeded its time limit.
- `rate_limit` -- The LLM provider returned a rate limit error.
- `auth_error` -- Authentication with the LLM provider failed.
- `network_error` -- A network-level failure occurred.
- `content_filter` -- The LLM provider rejected the request due to content policy.
- `budget_exceeded` -- The agent or swarm exceeded its configured budget.
- `unknown` -- The error could not be classified into any of the above categories.

Error classification is handled by the `classifyError` function, which examines the error message and type to determine the appropriate category. Both AgentRunner and AgenticRunner use this function.

## User-Facing Behavior

Consumers interact with the event stream by iterating with for-await-of over the return value of `engine.run()`. A typical consumption pattern processes events in a switch statement on `event.type`. The consumer decides how to surface each event -- rendering agent_chunk content as streaming text, showing swarm_progress as a progress indicator, displaying route_decision for workflow visibility, or alerting on budget_warning.

The event stream terminates when one of three terminal events is yielded: `swarm_done`, `swarm_error`, or `swarm_cancelled`. After any of these, the generator completes and the for-await-of loop exits.

Agentic nodes and LLM nodes produce identical event types. A consumer does not need to know (or care) whether a given node ran through a standard LLM provider or an agentic backend. The event interface is the same in both cases, making handler code uniform.

## Configuration

There are no event-specific configuration options. The streaming behavior is intrinsic to the engine's execution model. The following related configurations affect what events are emitted:

- **`limits.maxSwarmBudgetCents`** -- Determines whether budget_warning and budget_exceeded events can be emitted.
- **`limits.maxSwarmDurationMs`** -- When set, a duration limit violation produces a swarm_error event.
- **`limits.maxConcurrentAgents`** -- Affects the parallelism of node execution, which in turn affects the timing and batching of swarm_progress events.

## Edge Cases & Limitations

- **Cancelled swarm**: When the AbortSignal fires, the executor emits `swarm_cancelled` with `completedNodes` and `partialCost`. Nodes that were mid-execution when cancellation occurred may or may not have produced partial events (agent_chunk, agent_tool_use) before the cancellation was detected.

- **Parallel event ordering**: When nodes run in parallel, sibling-branch events are now emitted live as they arrive. In-branch order is preserved, but consumers should use `nodeId` rather than assuming contiguous per-node batches.

- **Errors during streaming**: When an agent fails, the executor emits `agent_error` for that node, marks it as failed, and skips its downstream dependencies. Other nodes that are not dependent on the failed node continue executing normally. The swarm only terminates early if a budget or duration limit is hit, or if all remaining nodes are blocked by failures.

- **No event filtering at the engine level**: The engine yields all events. Consumers that want a subset (e.g., only agent_done events) must filter in their iteration loop. There is no built-in mechanism to subscribe to specific event types.

- **No buffering between batches**: Events are yielded as they are produced within a batch. Between batches (during scheduling), no events are emitted. For long-running individual nodes, the consumer may experience periods with many rapid events followed by quiet periods.

- **Dynamic DAG expansion**: When a coordinator node emits a DAG definition, new nodes are added to the graph and registered with the scheduler. These new nodes produce the same event types as any other node. The swarm_start event's `nodeCount` reflects the original DAG size, not the expanded size.

## Common Questions

**Can I filter events by type?**
Yes, but filtering happens on the consumer side. Check `event.type` in your iteration loop and process only the event types relevant to your use case.

**Are events buffered?**
The SwarmEventEmitter has a minimal internal buffer that holds events only when the consumer has not yet called `next()`. In normal operation, events flow through without accumulating. The system does not buffer entire batches or delay delivery.

**Do agentic nodes emit the same events as LLM nodes?**
Yes. Both AgentRunner and AgenticRunner produce identical SwarmEvent types: agent_start, agent_chunk, agent_tool_use, agent_done, and agent_error. Consumer code does not need to distinguish between the two runner types.

**What is the difference between swarm_error and swarm_cancelled?**
`swarm_cancelled` is emitted specifically when the AbortSignal fires (consumer-initiated cancellation). `swarm_error` is emitted for all other failure modes: budget exceeded, duration limit exceeded, or unhandled exceptions. Both carry `completedNodes` and `partialCost`.

**How do I build an SSE stream from these events?**
Iterate over the async generator and for each event, serialize it to JSON and write it as an SSE `data:` line. The event types can map to SSE event names if desired. The engine does not prescribe a specific transport format.

**Can I correlate events to specific nodes?**
Yes. Most events carry a `nodeId` field. Agent events always include `nodeId`. Swarm events are swarm-wide and do not carry a single `nodeId`. Routing events carry `fromNode` and `toNode`. Budget events are swarm-wide.

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| No events received from `engine.run()` | Not iterating the async generator | Use `for await (const event of engine.run(...))` to consume events; the generator must be iterated |
| Events stop mid-execution | Swarm hit budget or duration limit | Check for a `swarm_error` event in the stream; review `limits.maxSwarmBudgetCents` and `limits.maxSwarmDurationMs` |
| agent_chunk events missing for agentic nodes | Agentic backend not streaming chunks | Some agentic backends may produce a single result event without intermediate chunks; this is adapter-dependent |
| swarm_progress shows wrong total after dynamic expansion | nodeCount in swarm_start reflects original DAG | This is expected; dynamic nodes are added after swarm_start is emitted |
| Events from parallel nodes appear out of chronological order | Parallel events yielded in node-completion order | This is by design; events are contiguous per node, not interleaved chronologically |
| Consumer misses terminal event | Exception thrown before terminal event | Wrap the for-await-of loop in try/catch; the emitter's `error()` method causes the iterator to reject |

## Related

- `/docs/ARCHITECTURE.md` -- Streaming Events section for architectural overview
- `/src/streaming/emitter.ts` -- SwarmEventEmitter implementation (async iterable event bus)
- `/src/streaming/events.ts` -- Event type re-exports
- `/src/types.ts` -- SwarmEvent union type, AgentErrorType, NodeResult, CostSummary definitions
- `/src/dag/executor.ts` -- DAGExecutor event emission (swarm lifecycle, progress, budget, routing)
- `/src/agent/runner.ts` -- AgentRunner event emission (agent lifecycle, chunks, tool use)
- `/src/agent/agentic-runner.ts` -- AgenticRunner event emission (agent lifecycle, mapped from agentic events)
- `/src/errors/classification.ts` -- Error classification logic for agent_error errorType
