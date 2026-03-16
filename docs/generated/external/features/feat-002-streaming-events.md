---
id: feat-002
type: feature-doc
audience: external
topic: Streaming Events
status: draft
generated: 2026-03-15
source-tier: direct
hermes-version: 1.0.1
---

# Streaming Events

`engine.run()` returns an `AsyncGenerator` of typed events. You can track every agent's progress, cost, routing decisions, and budget status in real time as the DAG executes.

## How to Use

Use a `for await...of` loop over the generator and switch on `event.type`:

```ts
for await (const event of engine.run({ dag, task: 'Build a dashboard' })) {
  switch (event.type) {
    case 'agent_start':
      console.log(`[${event.nodeId}] Agent "${event.agentName}" started`);
      break;
    case 'agent_chunk':
      process.stdout.write(event.content);
      break;
    case 'agent_done':
      console.log(`[${event.nodeId}] Done -- ${event.cost.totalTokens} tokens`);
      break;
    case 'swarm_done':
      console.log(`Swarm complete -- total cost: ${event.totalCost.costCents} cents`);
      break;
  }
}
```

## Event Reference

SwarmEngine emits 18 event types organized into six categories.

### Agent Events

These events track individual agent execution within a node.

| Event | Key Fields | Description |
|-------|------------|-------------|
| `agent_start` | `nodeId`, `agentRole`, `agentName` | An agent has begun executing. Emitted once per node execution. |
| `agent_chunk` | `nodeId`, `agentRole`, `content` | A streaming text chunk from the agent's response. Emitted many times as the LLM produces tokens. |
| `agent_tool_use` | `nodeId`, `tool`, `input` | The agent invoked a tool. The `tool` field contains the tool name and `input` contains the arguments. |
| `agent_done` | `nodeId`, `agentRole`, `output`, `cost`, `artifactRequest?` | The agent finished successfully. The `output` field contains the full response, and `cost` provides a `CostSummary` with token counts and cost in cents. |
| `agent_error` | `nodeId`, `agentRole`, `message`, `errorType` | The agent failed. The `errorType` field classifies the failure (e.g., `timeout`, `rate_limit`, `auth_error`, `network_error`, `content_filter`, `budget_exceeded`, `unknown`). |

### Swarm Events

These events track the overall DAG execution lifecycle.

| Event | Key Fields | Description |
|-------|------------|-------------|
| `swarm_start` | `dagId`, `nodeCount`, `estimatedCost?` | The DAG has been validated and execution is beginning. |
| `swarm_progress` | `completed`, `total`, `runningNodes` | Emitted after each node completes or each parallel batch finishes. Shows how many nodes are done and which are currently running. |
| `swarm_done` | `results`, `totalCost` | The DAG completed successfully. The `results` array contains a `NodeResult` for every completed node with its output, cost, and duration. |
| `swarm_error` | `message`, `completedNodes`, `partialCost` | The DAG failed due to an unrecoverable error. Includes which nodes completed and cost so far. |
| `swarm_cancelled` | `completedNodes`, `partialCost` | The DAG was cancelled via an `AbortSignal`. |

### Routing Events

These events report on conditional routing and loop decisions.

| Event | Key Fields | Description |
|-------|------------|-------------|
| `route_decision` | `fromNode`, `toNode`, `reason` | A conditional edge was evaluated. Shows which branch was selected and why. |
| `loop_iteration` | `nodeId`, `iteration`, `maxIterations` | A loop cycle completed. The `iteration` field is the current count (1-based) and `maxIterations` is the configured cap. |

### Budget Events

These events fire when cost thresholds are reached.

| Event | Key Fields | Description |
|-------|------------|-------------|
| `budget_warning` | `used`, `limit`, `percentUsed` | The swarm has consumed 80% or more of its budget. This is a warning -- execution continues. |
| `budget_exceeded` | `used`, `limit` | The swarm has exceeded its budget. Execution halts and a `swarm_error` follows. |

### Feedback Events

| Event | Key Fields | Description |
|-------|------------|-------------|
| `feedback_retry` | `fromNode`, `toNode`, `iteration`, `maxRetries` | A feedback loop triggered a retry of the producer node. |
| `feedback_escalation` | `fromNode`, `toNode`, `policy`, `iteration` | A feedback loop exhausted retries and applied its escalation policy. |

### Guard Events

| Event | Key Fields | Description |
|-------|------------|-------------|
| `guard_warning` | `nodeId`, `guardId`, `guardType`, `message` | A guard detected a quality issue but execution continued. |
| `guard_blocked` | `nodeId`, `guardId`, `guardType`, `message` | A guard blocked the node output and caused the node to fail. |

## Examples

### Progress Logger

Track overall completion progress across all nodes:

```ts
for await (const event of engine.run({ dag, task })) {
  if (event.type === 'swarm_progress') {
    const pct = Math.round((event.completed / event.total) * 100);
    console.log(`Progress: ${pct}% (${event.completed}/${event.total})`);
    if (event.runningNodes.length > 0) {
      console.log(`  Running: ${event.runningNodes.join(', ')}`);
    }
  }
}
```

### Cost Tracker

Accumulate and display cost information as the swarm runs:

```ts
let totalCostCents = 0;

for await (const event of engine.run({ dag, task })) {
  if (event.type === 'agent_done') {
    totalCostCents += event.cost.costCents;
    console.log(
      `[${event.nodeId}] ${event.cost.totalTokens} tokens, ` +
      `$${(event.cost.costCents / 100).toFixed(4)} -- ` +
      `running total: $${(totalCostCents / 100).toFixed(4)}`
    );
  }

  if (event.type === 'budget_warning') {
    console.warn(`Budget warning: ${event.percentUsed}% used ($${(event.used / 100).toFixed(2)} of $${(event.limit / 100).toFixed(2)})`);
  }
}
```

### SSE Bridge (Server-Sent Events)

Forward events to an HTTP client using the built-in SSE bridge:

```ts
import { SwarmEngine, SSEBridge } from '@swarmengine/core';

// Inside an HTTP handler:
const bridge = new SSEBridge();
const stream = bridge.createReadableStream(engine.run({ dag, task }));

return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  },
});
```

## The `CostSummary` Shape

Several events include a `CostSummary` object. Here is what each field means:

| Field | Type | Description |
|-------|------|-------------|
| `inputTokens` | `number` | Total input (prompt) tokens consumed |
| `outputTokens` | `number` | Total output (completion) tokens consumed |
| `totalTokens` | `number` | Sum of input and output tokens |
| `costCents` | `number` | Estimated cost in US cents |
| `calls` | `number` | Number of LLM API calls made |

## Limitations

- **Events stream through, they are not buffered.** If your consumer processes events slower than the engine produces them, you are responsible for handling backpressure. In practice this is rarely an issue because LLM calls are much slower than event handling.
- **Parallel ordering is live, not grouped.** In `v0.3.0`, sibling branches emit events as they happen. Preserve `nodeId` if your UI or consumer needs to group per-branch output.
- **No replay.** Once an event is yielded, it is not stored internally. If you need to replay events, collect them yourself in an array as they stream through.
