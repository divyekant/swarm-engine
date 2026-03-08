---
id: fh-012
type: feature-handoff
audience: internal
topic: Feedback Loops
status: draft
generated: 2026-03-08
source-tier: direct
context-files: [CHANGELOG.md, docs/plans/2026-03-08-handoffs-feedback-guards-design.md]
hermes-version: 1.0.0
---

# FH-012: Feedback Loops

## What It Does

Feedback Loops add engine-managed retry cycles between producer and reviewer nodes. When a QA or review node rejects output, the engine automatically resets the producing node, injects the feedback into its context, and re-executes it. This continues until the reviewer approves the output or a configurable retry limit is reached. On exhaustion, an escalation policy determines whether to skip the node, fail the swarm, or reroute to an alternative node.

This replaces the need for consumers to manually implement dev-QA retry patterns outside the engine. The feature builds on the existing `Evaluator` types (rule, regex, llm) used by conditional edges, so no new evaluation abstractions are introduced.

## How It Works

### FeedbackEdge

A `FeedbackEdge` connects a reviewer node back to a producer node. It defines the retry boundary:

```typescript
interface FeedbackEdge {
  from: string;         // QA/reviewer node ID
  to: string;           // Producer/dev node ID (the one that gets retried)
  maxRetries: number;   // Maximum retry attempts before escalation
  evaluate: Evaluator;  // Same evaluator types as ConditionalEdge
  passLabel: string;    // Evaluator result label that means "approved"
  escalation?: EscalationPolicy;
}
```

The `from` node is the reviewer. The `to` node is the producer that will be reset and re-executed on rejection. The `evaluate` field uses the same `Evaluator` union type as conditional edges (rule, regex, or llm). The `passLabel` is the evaluator result that signals approval.

### EscalationPolicy

When `maxRetries` is exhausted without a pass, the escalation policy fires:

```typescript
interface EscalationPolicy {
  action: 'skip' | 'fail' | 'reroute';
  reroute?: string;    // Target node ID (required when action is 'reroute')
  message?: string;    // Optional message included in the escalation event
}
```

- **skip**: Mark the producer node as completed with its last output. Downstream proceeds.
- **fail**: Mark the producer node as failed. Downstream is skipped.
- **reroute**: Redirect execution to the specified node instead. The reroute target receives the accumulated feedback history as context.

If no escalation policy is provided, the default is `{ action: 'fail' }`.

### FeedbackContext

On each retry iteration, the engine injects a `FeedbackContext` into the producer node's context:

```typescript
interface FeedbackContext {
  iteration: number;        // Current attempt (1-indexed)
  maxRetries: number;       // Maximum attempts allowed
  previousFeedback: string; // The latest QA output (most recent rejection)
  feedbackHistory: string[];// All prior QA outputs in chronological order
}
```

This is assembled into the context at **priority 1** (same level as system prompt and task -- never truncated) by the `ContextAssembler`. The injection appears after the system prompt and before upstream outputs:

```
## Retry Feedback
Attempt 2 of 3. Your previous output was rejected.

### Latest Feedback
{QA node's most recent output}

### Feedback History
1. {first QA output}
```

### Execution Flow

1. **Producer node completes.** Output flows to the reviewer node via the normal edge.
2. **Reviewer node completes.** The executor checks for any `FeedbackEdge` where `from` matches the reviewer node ID.
3. **Evaluator runs.** The evaluator processes the reviewer's output and returns a label.
4. **If label matches `passLabel`:** The feedback loop ends. Execution proceeds to downstream nodes of the producer (past the reviewer). The reviewer's output is not passed downstream -- the producer's latest output is the one that continues.
5. **If label does not match `passLabel` and iteration < maxRetries:**
   - The producer node's status is reset to `pending` in the Scheduler.
   - A `FeedbackContext` is constructed with the current iteration count and all accumulated feedback.
   - A `feedback_retry` event is emitted with `{ nodeId, iteration, maxRetries, feedback }`.
   - The producer re-executes with the `FeedbackContext` injected.
   - The reviewer then re-executes on the new producer output.
6. **If label does not match `passLabel` and iteration >= maxRetries:**
   - A `feedback_escalation` event is emitted with `{ nodeId, iteration, policy, feedback }`.
   - The escalation policy is executed (skip, fail, or reroute).

### New Events

Two new `SwarmEvent` types:

- **`feedback_retry`**: Emitted when a feedback loop iteration starts. Fields: `nodeId` (producer), `agentRole`, `iteration`, `maxRetries`, `feedback` (reviewer's output).
- **`feedback_escalation`**: Emitted when maxRetries is exhausted. Fields: `nodeId` (producer), `agentRole`, `iteration`, `policy` (the EscalationPolicy action), `feedback` (last reviewer output), `message` (escalation message if provided).

## User-Facing Behavior

- New `feedbackEdges` array in `DAGDefinition`, alongside `edges` and `conditionalEdges`.
- `DAGBuilder` gains a `.feedbackEdge(from, to, options)` method.
- DAG validation checks that feedback edge `from` and `to` nodes exist, that `maxRetries` is a positive integer, and that `reroute` target exists when `action` is `'reroute'`.
- The `feedback_retry` and `feedback_escalation` events appear in the `SwarmEvent` stream.
- Cost accumulates with each retry iteration. If budget limits are configured, they apply across all iterations.

## Configuration

| Option | Type | Default | Effect |
|--------|------|---------|--------|
| `FeedbackEdge.maxRetries` | `number` | (required) | Maximum number of retry attempts before escalation. |
| `FeedbackEdge.evaluate` | `Evaluator` | (required) | Determines whether reviewer output is a pass or fail. Same types as conditional edges. |
| `FeedbackEdge.passLabel` | `string` | (required) | The evaluator result label that indicates approval. |
| `FeedbackEdge.escalation` | `EscalationPolicy` | `{ action: 'fail' }` | What to do when maxRetries is exhausted. |
| `EscalationPolicy.action` | `'skip' \| 'fail' \| 'reroute'` | `'fail'` | The escalation action. |
| `EscalationPolicy.reroute` | `string` | `undefined` | Target node ID for reroute. Required when action is `'reroute'`. |
| `EscalationPolicy.message` | `string` | `undefined` | Optional message included in the `feedback_escalation` event. |

## Edge Cases & Limitations

- **Feedback loops and cycle edges are independent.** A feedback loop is not implemented via `maxCycles` on a regular edge. It uses its own iteration tracking. Combining both features on the same pair of nodes is undefined behavior and should be avoided.
- **Multiple feedback edges from the same reviewer.** If a reviewer node has multiple outgoing feedback edges (pointing to different producers), all of them are evaluated independently. Each producer gets its own retry cycle.
- **Reviewer node failure during a retry cycle.** If the reviewer node itself fails during an iteration, the feedback loop halts. The producer node retains its last completed output. The failure propagates via the normal `agent_error` + `skipDownstream` mechanism.
- **Cost accumulation.** Each retry iteration costs tokens for both the producer and reviewer re-execution. With `maxRetries: 5`, a single feedback loop can execute up to 12 agent runs (1 initial producer + 1 initial reviewer + 5 retried producers + 5 retried reviewers). Budget limits are the primary safeguard against runaway cost.
- **Context growth.** The `feedbackHistory` array grows with each iteration. All prior feedback is included at priority 1 (never truncated). On high retry counts, this can consume significant context window space. The `maxRetries` cap is the mitigation.
- **Reroute target must be a valid node.** DAG validation checks this. If the reroute target itself depends on the failed producer's output, it may not have the context it needs. Design reroute targets to be self-sufficient or to receive context via the escalation message.
- **FeedbackContext is only injected for standard LLM nodes.** For agentic backend nodes, the feedback context is formatted as a plain text block within the context string passed to the agentic adapter. The structure is the same but the injection mechanism differs.

## Common Questions

**Q: Can I use an LLM evaluator for the feedback edge?**
A: Yes. The `evaluate` field accepts the same `Evaluator` union as conditional edges. Use `{ type: 'llm', prompt: '...', targets: ['pass', 'fail'] }` with `passLabel: 'pass'`. The LLM evaluator uses a cheap call with `temperature: 0` and `maxTokens: 50`.

**Q: What happens if the reviewer output doesn't match any evaluator label?**
A: For rule evaluators, the function must return a string. If it returns a value that is not `passLabel`, the loop retries. For regex evaluators, the result is either `matchTarget` or `elseTarget`. For LLM evaluators, if the LLM returns an unrecognized label, the evaluator defaults to the first non-passLabel target (effectively a retry).

**Q: Does the downstream node receive the reviewer's output or the producer's output?**
A: The producer's latest (approved) output. The reviewer's output is consumed by the feedback loop evaluator and injected into the producer's context on retry, but it is not passed downstream as an upstream output.

**Q: Can I chain multiple feedback loops in sequence?**
A: Yes. For example: writer -> reviewer1 (feedback loop) -> editor -> reviewer2 (feedback loop). Each feedback loop operates independently. The writer must pass reviewer1 before the editor runs, and the editor must pass reviewer2 before downstream proceeds.

**Q: How do I monitor feedback loop progress in a UI?**
A: Listen for `feedback_retry` events, which include the current iteration number and maxRetries. Display these as a progress indicator. The `feedback_escalation` event signals that the loop has ended without approval.

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Producer output never improves between retries | Feedback context not being read by the agent, or system prompt does not instruct the agent to incorporate feedback | Review the producer node's system prompt. Ensure it instructs the agent to check for retry feedback and incorporate it. |
| `feedback_escalation` fires immediately (iteration 1) | `maxRetries` set to 0 or 1 | `maxRetries` must be at least 1 for one retry attempt. Set to 2+ for meaningful retry cycles. |
| Budget exceeded during feedback loop | High retry count combined with expensive models | Reduce `maxRetries`, use cheaper models for the feedback loop nodes, or increase the budget limit. |
| Reroute target fails with missing context | Reroute target depends on outputs that were never produced | Design reroute targets to be self-sufficient. Use the `EscalationPolicy.message` field to pass context. |
| `feedback_retry` events emitted but producer output identical each time | Producer agent not receiving or using the FeedbackContext | Enable debug logging to verify FeedbackContext is being injected. Check context assembly output for the `## Retry Feedback` section. |

## Related

- `src/dag/executor.ts` -- Feedback loop handling in the execution loop
- `src/types.ts` -- `FeedbackEdge`, `FeedbackContext`, `EscalationPolicy` type definitions
- `src/context/assembler.ts` -- FeedbackContext injection at priority 1
- `src/agent/evaluator.ts` -- Evaluator execution (shared with conditional edges)
- `src/streaming/events.ts` -- `feedback_retry` and `feedback_escalation` event definitions
- FH-001 (DAG Orchestration) -- Scheduler and execution loop that feedback loops extend
- FH-003 (Context Assembly) -- Priority-based context assembly where FeedbackContext is injected
- FH-010 (Error Handling) -- Error classification for reviewer node failures during retry cycles
