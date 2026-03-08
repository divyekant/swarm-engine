---
id: feat-007
type: feature-doc
audience: external
topic: feedback-loops
status: draft
generated: 2026-03-08
source-tier: direct
hermes-version: 1.0.0
---

# Feedback Loops

## Overview

Many real-world workflows need a review cycle: a developer writes code, a reviewer checks it, and if the work does not pass review, it goes back to the developer for another attempt. Feedback loops let you define these retry cycles directly in your DAG with configurable evaluation criteria, retry limits, and escalation policies. The engine manages the loop automatically -- injecting feedback from the reviewer into the developer's next attempt and stopping when the work is approved or the retry limit is reached.

## How to Use It

The most common scenario is a Dev-QA loop where a QA agent reviews work and either approves it or sends it back with feedback.

### Step 1: Define the nodes and add a feedback edge

```typescript
import { SwarmEngine, DAGBuilder } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  },
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
});

const dag = engine.dag()
  .agent('dev', {
    id: 'dev',
    name: 'Developer',
    role: 'developer',
    systemPrompt: 'You are a developer. Implement features and fix issues based on feedback.',
  })
  .agent('qa', {
    id: 'qa',
    name: 'QA Reviewer',
    role: 'reviewer',
    systemPrompt: 'You review code. Respond with "approved" if the work meets quality standards, or describe the issues that need fixing.',
  })
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

### Step 2: Run and observe the loop

```typescript
for await (const event of engine.run({ dag, task: 'Implement a rate limiter' })) {
  switch (event.type) {
    case 'agent_chunk':
      process.stdout.write(event.content);
      break;
    case 'feedback_retry':
      console.log(`\nRetry ${event.iteration}/${event.maxRetries}: ${event.fromNode} -> ${event.toNode}`);
      break;
    case 'feedback_escalation':
      console.log(`\nEscalation triggered: ${event.policy}`);
      break;
  }
}
```

Here is what happens at runtime:

1. The `dev` node runs and produces output.
2. The `qa` node reviews the output.
3. The engine evaluates the QA output. If it contains the label `"approved"`, the loop ends and execution continues to any downstream nodes.
4. If the QA output does not match, the engine sends the QA feedback back to the `dev` node and reruns it. The developer receives the original task plus the reviewer's feedback as context.
5. This repeats up to `maxRetries` times. If the limit is reached without approval, the escalation policy kicks in.

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `from` | Node ID of the reviewing agent (the one producing feedback). | Required. |
| `to` | Node ID of the agent that should retry (the one receiving feedback). | Required. |
| `maxRetries` | Maximum number of retry iterations before escalation. | Required. |
| `evaluate` | How to determine if the output passes. An `Evaluator` object. | Required. |
| `passLabel` | The label that the evaluator must return for the loop to end successfully. | Required. |
| `escalation.action` | What to do when retries are exhausted: `'fail'` (emit error and stop) or `'continue'` (proceed with last output). | Required. |
| `escalation.message` | Human-readable message included in the escalation event. | Optional. |

### Evaluator options

The `evaluate` field accepts the same `Evaluator` types used in conditional edges:

| Type | Description | Cost |
|------|-------------|------|
| `{ type: 'rule', label: string }` | Checks if the output contains the given label string (case-insensitive). | Zero |
| `{ type: 'regex', pattern: string, matchTarget: string, elseTarget: string }` | Tests a regex against the output. | Zero |
| `{ type: 'llm', prompt: string, model?: string }` | Sends the output to an LLM to determine the verdict. | One LLM call per evaluation |

## Examples

### Example: Regex-based evaluation

Instead of looking for a simple string match, you can use a regex for more precise evaluation.

```typescript
.feedbackEdge({
  from: 'qa',
  to: 'dev',
  maxRetries: 2,
  evaluate: {
    type: 'regex',
    pattern: '\\b(APPROVED|LGTM)\\b',
    matchTarget: 'approved',
    elseTarget: 'rejected',
  },
  passLabel: 'approved',
  escalation: { action: 'continue', message: 'Proceeding with best-effort output' },
})
```

### Example: LLM-based evaluation

For nuanced reviews where a simple string match is not sufficient, you can use an LLM evaluator.

```typescript
.feedbackEdge({
  from: 'qa',
  to: 'dev',
  maxRetries: 3,
  evaluate: {
    type: 'llm',
    prompt: 'Based on the review output, is the code approved or rejected? Reply with only "approved" or "rejected".',
    model: 'claude-haiku-4-20250514',
  },
  passLabel: 'approved',
  escalation: { action: 'fail', message: 'Code did not pass review after 3 attempts' },
})
```

### Example: Graceful escalation with `continue`

If you want the workflow to proceed even when retries are exhausted (using the best output produced so far), set the escalation action to `'continue'`.

```typescript
.feedbackEdge({
  from: 'reviewer',
  to: 'writer',
  maxRetries: 2,
  evaluate: { type: 'rule', label: 'approved' },
  passLabel: 'approved',
  escalation: {
    action: 'continue',
    message: 'Review cycle exhausted, using last draft',
  },
})
```

### Example: Combining feedback loops with handoff templates

You can use handoff templates on the edges within a feedback loop for more structured communication between the agents.

```typescript
const dag = engine.dag()
  .agent('dev', { id: 'dev', name: 'Dev', role: 'developer', systemPrompt: '...' })
  .agent('qa', { id: 'qa', name: 'QA', role: 'reviewer', systemPrompt: '...' })
  .edge('dev', 'qa', { handoff: 'qa-review' })
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

## Streaming Events

Feedback loops emit two additional event types:

### `feedback_retry`

Emitted each time the loop sends work back for another attempt.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'feedback_retry'` | Event discriminator. |
| `fromNode` | `string` | The reviewing node that triggered the retry. |
| `toNode` | `string` | The node that will retry. |
| `iteration` | `number` | Current retry number (1-based). |
| `maxRetries` | `number` | Maximum retries configured. |

### `feedback_escalation`

Emitted when the retry limit is reached.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'feedback_escalation'` | Event discriminator. |
| `fromNode` | `string` | The reviewing node. |
| `toNode` | `string` | The node that was retrying. |
| `policy` | `string` | The escalation action taken (`'fail'` or `'continue'`). |
| `iteration` | `number` | The final iteration count. |

## Limitations

- Feedback loops are between exactly two nodes. You cannot create a loop that involves three or more agents in a cycle.
- The `maxRetries` value is required and must be at least 1. There is no "infinite retry" mode to prevent runaway loops.
- Each retry re-runs the target node from scratch with the accumulated feedback context. Partial work from previous iterations is not preserved at the engine level, though agents can reference it through the injected feedback.
- Feedback edges cannot be combined with conditional edges on the same node pair. Use one or the other.

## Related

- [DAG Orchestration](feat-001-dag-orchestration.md) -- How nodes and edges work in the engine.
- [Handoff Templates](feat-006-handoff-templates.md) -- Structure the output format between nodes in a feedback loop.
- [Streaming Events](feat-002-streaming-events.md) -- Full list of event types including `feedback_retry` and `feedback_escalation`.
