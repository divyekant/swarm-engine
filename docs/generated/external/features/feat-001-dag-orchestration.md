---
id: feat-001
type: feature-doc
audience: external
topic: DAG Orchestration
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# DAG Orchestration

SwarmEngine lets you wire AI agents into directed acyclic graphs (DAGs) and execute multi-agent workflows. You define agents and the connections between them, and the engine handles scheduling, parallelism, conditional routing, loops, and dynamic expansion -- five execution patterns from one API.

## How to Use

Build a DAG with the fluent builder API, then run it through the engine:

```ts
import { SwarmEngine } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  },
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
});

// 1. Create a DAG with the builder
const dag = engine.dag()
  .agent('planner', {
    id: 'planner',
    name: 'Planner',
    role: 'planner',
    systemPrompt: 'You are a project planner.',
  })
  .agent('developer', {
    id: 'developer',
    name: 'Developer',
    role: 'developer',
    systemPrompt: 'You are a software developer.',
  })
  .edge('planner', 'developer')
  .build();

// 2. Execute and consume events
for await (const event of engine.run({ dag, task: 'Build a login page' })) {
  console.log(event.type, event);
}
```

The builder uses three core methods:

- **`.agent(nodeId, descriptor)`** -- Add an agent node. Each agent needs an `id`, `name`, `role`, and `systemPrompt`.
- **`.edge(from, to, options?)`** -- Connect two nodes with a directed edge. Optionally pass `{ maxCycles }` for loop edges.
- **`.build()`** -- Validate all edges and produce the final `DAGDefinition`.

The builder also supports `.conditionalEdge()` for branching and `.dynamicExpansion()` for runtime DAG growth.

## Execution Patterns

### 1. Sequential Pipeline

Agents run one after another. Each agent receives the upstream agent's output as context.

```ts
const dag = engine.dag()
  .agent('planner', { id: 'planner', name: 'Planner', role: 'planner', systemPrompt: 'Plan the feature.' })
  .agent('developer', { id: 'developer', name: 'Developer', role: 'developer', systemPrompt: 'Implement the plan.' })
  .agent('reviewer', { id: 'reviewer', name: 'Reviewer', role: 'reviewer', systemPrompt: 'Review the code.' })
  .edge('planner', 'developer')
  .edge('developer', 'reviewer')
  .build();
```

Execution order: `planner` -> `developer` -> `reviewer`. Each node waits for its predecessor to complete before starting.

### 2. Parallel Fan-Out / Fan-In

Multiple agents run concurrently when they share a common dependency, then converge on a downstream node.

```ts
const dag = engine.dag()
  .agent('coordinator', { id: 'coordinator', name: 'Coordinator', role: 'coordinator', systemPrompt: 'Break the task into parts.' })
  .agent('worker1', { id: 'worker1', name: 'Frontend Dev', role: 'frontend', systemPrompt: 'Build the UI.' })
  .agent('worker2', { id: 'worker2', name: 'Backend Dev', role: 'backend', systemPrompt: 'Build the API.' })
  .agent('aggregator', { id: 'aggregator', name: 'Integrator', role: 'integrator', systemPrompt: 'Combine the work.' })
  .edge('coordinator', 'worker1')
  .edge('coordinator', 'worker2')
  .edge('worker1', 'aggregator')
  .edge('worker2', 'aggregator')
  .build();
```

After `coordinator` finishes, `worker1` and `worker2` run in parallel. The `aggregator` waits until both workers finish, then receives both outputs.

### 3. Conditional Routing

Route to different branches based on an agent's output. You provide an evaluator (rule function, regex, or LLM-based) and a map of target nodes.

```ts
const dag = engine.dag()
  .agent('classifier', { id: 'classifier', name: 'Classifier', role: 'classifier', systemPrompt: 'Classify the request as "bug" or "feature".' })
  .agent('bugHandler', { id: 'bugHandler', name: 'Bug Handler', role: 'bug-fixer', systemPrompt: 'Investigate and fix the bug.' })
  .agent('featureHandler', { id: 'featureHandler', name: 'Feature Builder', role: 'builder', systemPrompt: 'Design and build the feature.' })
  .conditionalEdge('classifier', {
    evaluate: { type: 'regex', pattern: 'bug', matchTarget: 'bug', elseTarget: 'feature' },
    targets: { bug: 'bugHandler', feature: 'featureHandler' },
  })
  .build();
```

Three evaluator types are available:

| Evaluator | Use When | How It Works |
|-----------|----------|--------------|
| `rule` | You have custom logic | A function `(output: string) => string` that returns a target label |
| `regex` | You need simple pattern matching | Tests the output against a regex pattern; routes to `matchTarget` or `elseTarget` |
| `llm` | You need AI-powered classification | Sends the output to an LLM with your prompt; the LLM response selects the target |

The engine emits a `route_decision` event whenever a conditional edge is evaluated, telling you which branch was chosen and why.

### 4. Iterative Loops

Two agents can iterate back and forth a fixed number of times. This is useful for refinement cycles like writer/critic or coder/reviewer patterns.

```ts
const dag = engine.dag()
  .agent('writer', { id: 'writer', name: 'Writer', role: 'writer', systemPrompt: 'Write or revise the draft.' })
  .agent('critic', { id: 'critic', name: 'Critic', role: 'critic', systemPrompt: 'Review and provide feedback.' })
  .edge('writer', 'critic')
  .edge('critic', 'writer', { maxCycles: 3 })
  .build();
```

The `writer` produces a draft, the `critic` reviews it, and the cycle repeats up to 3 times. Each iteration emits a `loop_iteration` event so you can track progress.

**Important:** You must set `maxCycles` on cycle edges. Without it, the engine treats the graph as acyclic and the edge is directional only.

### 5. Dynamic Expansion

A coordinator node can emit new sub-DAGs at runtime. Mark a node with `.dynamicExpansion()` and have the agent output a JSON structure containing `nodes` and `edges`. The engine merges these into the running graph.

```ts
const dag = engine.dag()
  .agent('coordinator', {
    id: 'coordinator',
    name: 'Coordinator',
    role: 'coordinator',
    systemPrompt: 'Analyze the task and output a JSON DAG with nodes and edges for the sub-tasks.',
  })
  .dynamicExpansion('coordinator')
  .build();
```

When the coordinator completes, the engine parses its output as JSON. If it contains a valid `{ nodes, edges }` structure, those nodes and edges are added to the live graph and scheduled for execution.

## Configuration

Control execution behavior through the `limits` section of your engine config:

```ts
const engine = new SwarmEngine({
  providers: { /* ... */ },
  limits: {
    maxConcurrentAgents: 4,      // Max agents running in parallel (default: unlimited)
    maxSwarmDurationMs: 300_000,  // 5-minute timeout for the entire swarm (default: unlimited)
    maxCycleIterations: 10,       // Global cap on loop iterations (default: unlimited)
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxConcurrentAgents` | `number` | unlimited | Maximum number of agents that can execute in parallel |
| `maxSwarmDurationMs` | `number` | unlimited | Hard timeout for the entire DAG execution in milliseconds |
| `maxCycleIterations` | `number` | unlimited | Global maximum for loop iterations across all cycle edges |

## Limitations

- **Cyclic graphs require `maxCycles`.** If you create a cycle without setting `maxCycles` on the back-edge, the DAG validator will reject it or the engine will not re-schedule the node.
- **Dynamic expansion cost is unpredictable.** When a coordinator emits a sub-DAG at runtime, the total agent count and cost depend on the LLM's output. Pair this pattern with budget limits (see [Cost Tracking](./feat-003-cost-tracking.md)) to keep costs under control.
- **Failed nodes skip their downstream.** If any node fails, all nodes that depend on it (directly or transitively) are marked as `skipped`. The swarm completes with partial results rather than retrying.
- **Conditional targets are mutually exclusive.** When a conditional edge resolves, exactly one target branch runs. All other targets and their downstream subgraphs are skipped.
