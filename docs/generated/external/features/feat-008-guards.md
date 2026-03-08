---
id: feat-008
type: feature-doc
audience: external
topic: anti-pattern-guards
status: draft
generated: 2026-03-08
source-tier: direct
hermes-version: 1.0.0
---

# Anti-Pattern Guards

## Overview

Agents can produce output that looks good on the surface but contains subtle quality issues -- unsupported claims, hallucinated test results, or work that drifts beyond the original task scope. Anti-pattern guards run automatically after each agent completes, checking the output for these problems. You can configure guards to warn (log an event and continue) or block (halt execution for that node). Guards help you catch quality issues before they propagate to downstream agents.

## How to Use It

The most common setup is to add guards directly to the nodes that need them.

### Step 1: Add guards to a node

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
    systemPrompt: 'You are a developer. Implement the requested feature and include tests.',
    guards: [
      { id: 'evidence', type: 'evidence', mode: 'block' },
      { id: 'scope', type: 'scope-creep', mode: 'warn' },
    ],
  })
  .agent('qa', {
    id: 'qa',
    name: 'QA',
    role: 'reviewer',
    systemPrompt: 'You review code for correctness.',
  })
  .edge('dev', 'qa')
  .build();
```

### Step 2: Handle guard events

```typescript
for await (const event of engine.run({ dag, task: 'Add password reset functionality' })) {
  switch (event.type) {
    case 'agent_chunk':
      process.stdout.write(event.content);
      break;
    case 'guard_warning':
      console.warn(`\nGuard warning [${event.guardId}]: ${event.message}`);
      break;
    case 'guard_blocked':
      console.error(`\nGuard blocked [${event.guardId}]: ${event.message}`);
      break;
  }
}
```

When a guard fires:

- **`warn` mode**: The engine emits a `guard_warning` event and continues execution normally. The output is still passed to downstream nodes.
- **`block` mode**: The engine emits a `guard_blocked` event and treats the node as failed. Downstream nodes that depend on it will be skipped.

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `guards` on `AgentDescriptor` | Array of guard configurations to run on this specific node. | `[]` (no guards) |
| `guards` on `SwarmEngineConfig` | Array of guard configurations applied to all nodes as defaults. Per-node guards are additive. | `[]` (no guards) |
| `GuardConfig.id` | Unique identifier for this guard instance. Used in events. | Required. |
| `GuardConfig.type` | The guard type: `'evidence'` or `'scope-creep'`. | Required. |
| `GuardConfig.mode` | What to do when the guard triggers: `'warn'` or `'block'`. | Required. |

### Guard types

| Type | Method | Cost | What it detects |
|------|--------|------|-----------------|
| `evidence` | Pattern matching (no LLM) | Zero | Claims like "all tests pass", "works correctly", or "no issues found" that appear without supporting evidence such as code blocks, file paths, or test output. |
| `scope-creep` | LLM-based (cheap model, temperature 0, maxTokens 100) | One cheap LLM call | Output that goes beyond the original task scope -- implementing features that were not requested, refactoring unrelated code, or adding unsolicited functionality. |

## Examples

### Example: Engine-wide default guards

You can set guards at the engine level so they apply to every node. This is useful when you want a baseline quality check across your entire swarm.

```typescript
const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  },
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  guards: [
    { id: 'evidence', type: 'evidence', mode: 'warn' },
  ],
});
```

Every node in every DAG run through this engine will have the evidence guard applied in warn mode. You can still add per-node guards that are more restrictive:

```typescript
const dag = engine.dag()
  .agent('dev', {
    id: 'dev',
    name: 'Developer',
    role: 'developer',
    systemPrompt: '...',
    guards: [
      { id: 'scope', type: 'scope-creep', mode: 'block' },
    ],
  })
  .build();
```

The developer node now has both guards: the engine-wide `evidence` guard (warn) and its own `scope-creep` guard (block).

### Example: Strict mode for critical nodes

For high-stakes nodes, you can set both guards to `block` mode to ensure no low-quality output passes through.

```typescript
.agent('architect', {
  id: 'architect',
  name: 'Architect',
  role: 'architect',
  systemPrompt: 'You design system architectures. Be specific and evidence-based.',
  guards: [
    { id: 'evidence', type: 'evidence', mode: 'block' },
    { id: 'scope', type: 'scope-creep', mode: 'block' },
  ],
})
```

### Example: Using guard functions directly

You can run guards programmatically outside of a DAG if you need to check arbitrary text.

```typescript
import { runGuards, evidenceGuard, scopeCreepGuard } from '@swarmengine/core';

// Run all configured guards against an output
const results = await runGuards(output, guards, { task, nodeId });

// Or use individual guard functions
const evidenceResult = evidenceGuard(output);
// Returns: { triggered: boolean, claims: string[], evidence: string[] }

const scopeResult = await scopeCreepGuard(output, task, providerAdapter);
// Returns: { triggered: boolean, reason: string }
```

### Example: Guards with feedback loops

Guards pair well with feedback loops. If a guard blocks a node, you can configure a feedback loop to automatically retry.

```typescript
const dag = engine.dag()
  .agent('dev', {
    id: 'dev',
    name: 'Developer',
    role: 'developer',
    systemPrompt: '...',
    guards: [
      { id: 'evidence', type: 'evidence', mode: 'block' },
    ],
  })
  .agent('qa', {
    id: 'qa',
    name: 'QA',
    role: 'reviewer',
    systemPrompt: '...',
  })
  .edge('dev', 'qa')
  .feedbackEdge({
    from: 'qa',
    to: 'dev',
    maxRetries: 3,
    evaluate: { type: 'rule', label: 'approved' },
    passLabel: 'approved',
    escalation: { action: 'fail', message: 'Quality standards not met' },
  })
  .build();
```

## Streaming Events

Guards emit two event types:

### `guard_warning`

Emitted when a guard in `warn` mode detects an issue. Execution continues.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'guard_warning'` | Event discriminator. |
| `nodeId` | `string` | The node whose output was checked. |
| `guardId` | `string` | The guard's `id` from configuration. |
| `guardType` | `string` | The guard type (`'evidence'` or `'scope-creep'`). |
| `message` | `string` | Human-readable description of the issue. |

### `guard_blocked`

Emitted when a guard in `block` mode detects an issue. The node is treated as failed.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'guard_blocked'` | Event discriminator. |
| `nodeId` | `string` | The node whose output was checked. |
| `guardId` | `string` | The guard's `id` from configuration. |
| `guardType` | `string` | The guard type (`'evidence'` or `'scope-creep'`). |
| `message` | `string` | Human-readable description of the issue. |

## Limitations

- The `evidence` guard uses pattern matching, not semantic understanding. It may produce false positives on outputs that happen to use phrases like "all tests pass" in a context where they are backed by evidence the pattern matcher does not recognize.
- The `scope-creep` guard requires an LLM call, which adds latency and a small cost to every node that uses it. It uses a cheap model with `temperature: 0` and `maxTokens: 100` to keep overhead minimal.
- Guards run after the agent completes, not during streaming. You cannot use guards to interrupt an agent mid-generation.
- There are currently two guard types. Custom guard types are not yet supported, but you can use `runGuards` and `evidenceGuard`/`scopeCreepGuard` as building blocks in your own post-processing logic.

## Related

- [Feedback Loops](feat-007-feedback-loops.md) -- Automatically retry nodes that fail guard checks.
- [Handoff Templates](feat-006-handoff-templates.md) -- Structured output formatting that complements guard checks.
- [Streaming Events](feat-002-streaming-events.md) -- Full list of event types including `guard_warning` and `guard_blocked`.
- [Cost Tracking](feat-003-cost-tracking.md) -- The `scope-creep` guard's LLM cost is tracked like any other provider call.
