---
type: error-reference
audience: external
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Error Reference

This document covers every error type that `@swarmengine/core` can produce, what causes each one, and how to resolve it.

---

## How errors are reported

Errors surface as `SwarmEvent` objects in the event stream you consume with `for await...of`. There are two error event types:

### `agent_error` -- a single agent failed

| Field | Type | Description |
|---|---|---|
| `type` | `'agent_error'` | Event discriminator. |
| `nodeId` | `string` | The DAG node that failed. |
| `agentRole` | `string` | The role of the agent (e.g., `'planner'`, `'reviewer'`). |
| `message` | `string` | Human-readable error description. |
| `errorType` | `AgentErrorType` | One of the seven classified error types listed below. |

When an agent fails, other independent branches of the DAG may continue running. Downstream nodes that depend on the failed node will be skipped.

### `swarm_error` -- the entire swarm failed

| Field | Type | Description |
|---|---|---|
| `type` | `'swarm_error'` | Event discriminator. |
| `message` | `string` | Human-readable error description. |
| `completedNodes` | `string[]` | Node IDs that finished successfully before the failure. |
| `partialCost` | `CostSummary` | Token and cost totals accumulated before the failure. |

A `swarm_error` is emitted for failures that prevent the swarm from continuing (e.g., DAG validation failure, no provider available, or a budget exceeded event that halts execution).

---

## Error types

The engine classifies every error into one of seven types. You can use `errorType` in your event handler to decide how to respond.

### 1. `timeout`

**What happened:** The LLM request took longer than the allowed time. This can be triggered by the provider's own timeout, by `maxSwarmDurationMs` expiring, or by an `AbortSignal` you passed in `RunOptions`.

**Resolution:**
- Increase `limits.maxSwarmDurationMs` in your engine config.
- Reduce `maxTokens` on the agent so the model generates a shorter response.
- For very long tasks, consider splitting the work across multiple agents.

**Example event:**

```typescript
{
  type: 'agent_error',
  nodeId: 'analysis',
  agentRole: 'analyst',
  message: 'Request timed out after 60000ms',
  errorType: 'timeout',
}
```

---

### 2. `rate_limit`

**What happened:** The provider returned HTTP 429 -- you are sending too many requests. This typically occurs when multiple agents make concurrent calls to the same provider.

**Resolution:**
- Reduce `limits.maxConcurrentAgents` in your engine config. Start with `2` or `3` and increase gradually.
- If you are on a low-tier API plan, check your provider's rate limit documentation.
- Implement a backoff strategy in your event consumer -- pause and retry the swarm after a short delay.

**Example event:**

```typescript
{
  type: 'agent_error',
  nodeId: 'writer',
  agentRole: 'content_writer',
  message: 'Rate limit exceeded (429)',
  errorType: 'rate_limit',
}
```

---

### 3. `auth_error`

**What happened:** The provider returned HTTP 401 or 403. Your API key is missing, invalid, expired, or does not have the required permissions.

**Resolution:**
- Verify that the `apiKey` value in your provider config is correct.
- Check that the key has not been revoked or rotated.
- Ensure the key has access to the model you specified. Some models require specific plan tiers.

**Example event:**

```typescript
{
  type: 'agent_error',
  nodeId: 'planner',
  agentRole: 'planner',
  message: 'Authentication failed: invalid API key',
  errorType: 'auth_error',
}
```

---

### 4. `network_error`

**What happened:** The engine could not reach the provider. The connection was refused, the hostname could not be resolved, or a fetch call failed.

**Resolution:**
- Check your internet connection.
- If you are using Ollama or a custom provider, verify that `baseUrl` is correct and the server is running.
- If you are behind a corporate proxy or firewall, ensure the provider's API endpoint is allowed.
- For Ollama specifically, confirm the server is started (`ollama serve`) and the port matches your `baseUrl`.

**Example event:**

```typescript
{
  type: 'agent_error',
  nodeId: 'local_coder',
  agentRole: 'developer',
  message: 'fetch failed: ECONNREFUSED 127.0.0.1:11434',
  errorType: 'network_error',
}
```

---

### 5. `content_filter`

**What happened:** The provider's safety or moderation system blocked the request or the generated response. The model refused to produce output because the prompt or task triggered a content policy.

**Resolution:**
- Review your agent's `systemPrompt` and the `task` string for content that may trigger moderation.
- Rephrase the task to avoid topics the model flags.
- If the issue is in upstream agent output being passed as context, consider adding a filtering or sanitization step.

**Example event:**

```typescript
{
  type: 'agent_error',
  nodeId: 'creative',
  agentRole: 'writer',
  message: 'Content policy violation: output blocked by moderation',
  errorType: 'content_filter',
}
```

---

### 6. `budget_exceeded`

**What happened:** The cumulative cost of the swarm (or a single agent) exceeded the budget you configured. The engine stops execution to prevent runaway spending.

Before this error, you will typically see a `budget_warning` event that tells you the current usage percentage. If you are consuming events, you can use this warning to take proactive action.

**Resolution:**
- Increase `limits.maxSwarmBudgetCents` or `limits.maxPerAgentBudgetCents` in your engine config.
- Reduce the number of agents or the `maxTokens` per agent.
- Use a cheaper model for agents that do not need the most capable one.

**Related events:**

```typescript
// Warning fires first (not an error)
{
  type: 'budget_warning',
  used: 450,
  limit: 500,
  percentUsed: 90,
}

// Then the hard stop
{
  type: 'budget_exceeded',
  used: 510,
  limit: 500,
}
```

---

### 7. `unknown`

**What happened:** The engine encountered an error that does not match any of the known categories above. This is a catch-all for unexpected failures.

**Resolution:**
- Inspect the `message` field for details.
- Enable logging (`logging: { level: 'debug' }`) and re-run to capture additional context.
- Check whether the error comes from a custom adapter, lifecycle hook, or context provider you implemented.
- If you believe this is a bug in the engine, open an issue at [github.com/divyekant/swarm-engine/issues](https://github.com/divyekant/swarm-engine/issues) with the error message and a minimal reproduction.

**Example event:**

```typescript
{
  type: 'agent_error',
  nodeId: 'summarizer',
  agentRole: 'summarizer',
  message: 'Unexpected error: Cannot read properties of undefined',
  errorType: 'unknown',
}
```

---

## Handoff template errors

### Unknown handoff preset

**What happened:** You passed a string to the `handoff` option on an edge, but it does not match any of the four built-in presets (`standard`, `qa-review`, `qa-feedback`, `escalation`).

**Resolution:**
- Check the preset name for typos. Preset names are case-sensitive.
- If you need a custom handoff, pass an inline `HandoffTemplate` object instead of a string.

**Example:**

```typescript
// This will throw at build time:
.edge('dev', 'qa', { handoff: 'detailedReview' })
// Error: Unknown handoff preset: "detailedReview". Available presets: standard, qa-review, qa-feedback, escalation.

// Fix: use a valid preset name or an inline template
.edge('dev', 'qa', { handoff: 'qa-review' })
```

---

## Feedback edge errors

### Missing required fields

**What happened:** A feedback edge is missing one or more required fields (`from`, `to`, `maxRetries`, `evaluate`, `passLabel`, `escalation`).

**Resolution:**
- Ensure all required fields are present in your `.feedbackEdge()` call. See the [Configuration Reference](config-reference.md) for the full list.

**Example:**

```typescript
// This will throw at build time:
.feedbackEdge({ from: 'qa', to: 'dev', maxRetries: 3 })
// Error: FeedbackEdge missing required fields: evaluate, passLabel, escalation
```

### Invalid feedback edge nodes

**What happened:** The `from` or `to` node in a feedback edge does not exist in the DAG, or the `from` node is not downstream of the `to` node (i.e., there is no forward path from `to` to `from`).

**Resolution:**
- Verify that both node IDs exist in the DAG.
- Ensure there is a forward edge path from the `to` node to the `from` node. A feedback edge creates a backward connection for retry purposes, so the forward path must already exist.

**Example:**

```typescript
// This will throw at build time:
.feedbackEdge({ from: 'reviewer', to: 'dev', ... })
// Error: Feedback edge references unknown node: "reviewer"
```

### maxRetries must be at least 1

**What happened:** You set `maxRetries` to 0 or a negative number on a feedback edge.

**Resolution:**
- Set `maxRetries` to at least 1. If you do not want retries, do not use a feedback edge.

---

## Guard errors

### Guard blocked execution

**What happened:** A guard with `mode: 'block'` detected a quality issue in a node's output. The node is treated as failed, and downstream nodes that depend on it are skipped.

This is not an engine bug -- it means the guard is working as intended. The `guard_blocked` event contains details about what triggered the guard.

**Resolution:**
- Review the `message` field in the `guard_blocked` event to understand what the guard detected.
- For the `evidence` guard: ensure the agent includes supporting evidence (code blocks, file paths, test output) alongside its claims.
- For the `scope-creep` guard: refine the agent's system prompt to stay focused on the task.
- If the guard is too aggressive for your use case, switch its mode from `'block'` to `'warn'`.

**Example event:**

```typescript
{
  type: 'guard_blocked',
  nodeId: 'dev',
  guardId: 'evidence',
  guardType: 'evidence',
  message: 'Output contains claims without evidence: "all tests pass" with no test output shown',
}
```

### Guard warning

**What happened:** A guard with `mode: 'warn'` detected a potential quality issue. Execution continues, but you should review the output.

**Example event:**

```typescript
{
  type: 'guard_warning',
  nodeId: 'dev',
  guardId: 'scope',
  guardType: 'scope-creep',
  message: 'Output may contain work beyond task scope: refactored authentication module (not requested)',
}
```

---

## Handling errors in your code

You can handle errors inline in your event loop:

```typescript
for await (const event of engine.run({ dag, task })) {
  if (event.type === 'agent_error') {
    if (event.errorType === 'rate_limit') {
      console.warn(`Rate limited on ${event.nodeId}, consider reducing concurrency`);
    } else if (event.errorType === 'auth_error') {
      console.error('API key issue -- stopping');
      break;
    }
  }

  if (event.type === 'swarm_error') {
    console.error(`Swarm failed: ${event.message}`);
    console.log(`Completed nodes: ${event.completedNodes.join(', ')}`);
    console.log(`Partial cost: ${event.partialCost.costCents} cents`);
  }
}
```

You can also use lifecycle hooks for centralized error handling:

```typescript
const engine = new SwarmEngine({
  // ...providers, defaults...
  lifecycle: {
    onRunFailed(runId, agentId, error, errorType) {
      myAlertSystem.notify({ runId, agentId, error, errorType });
    },
  },
});
```

---

## The `SwarmError` class

If you are building custom adapters or providers, you can throw `SwarmError` to produce a classified error:

```typescript
import { SwarmError } from '@swarmengine/core';

throw new SwarmError('Custom provider: connection refused', 'network_error');
```

The engine also exports `classifyError(err)` which takes any `Error` and returns an `AgentErrorType` based on the error message. This is used internally but available to you if you are wrapping third-party SDKs in a custom adapter.
