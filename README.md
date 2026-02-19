# SwarmEngine

Multi-agent DAG orchestration engine for TypeScript. Define agents as nodes, wire them into directed acyclic graphs, and execute workflows with built-in cost tracking, streaming events, and pluggable adapters.

## Features

- **5 execution patterns** — sequential pipelines, parallel fan-out/fan-in, conditional routing, iterative loops, dynamic planning
- **Actor-style agents** — each node has inbox, outbox, and shared scratchpad
- **LLM providers** — Anthropic, OpenAI, Ollama, and custom adapters
- **Cost tracking** — per-agent and per-swarm token usage with budget enforcement
- **Streaming events** — real-time `AsyncGenerator` events for UI and logging
- **Pluggable adapters** — persistence, memory, context, codebase, persona, lifecycle hooks
- **TypeScript-first** — strict mode, full type definitions, ESM

## Install

```bash
npm install @swarmengine/core
```

## Quick Start

```ts
import { SwarmEngine } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  },
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
});

const dag = engine.dag()
  .agent('planner', {
    id: 'planner', name: 'Planner', role: 'planner',
    systemPrompt: 'Break the task into implementation steps.',
  })
  .agent('developer', {
    id: 'developer', name: 'Developer', role: 'developer',
    systemPrompt: 'Implement the plan. Output working code.',
  })
  .agent('reviewer', {
    id: 'reviewer', name: 'Reviewer', role: 'reviewer',
    systemPrompt: 'Review the code for correctness and style.',
  })
  .edge('planner', 'developer')
  .edge('developer', 'reviewer')
  .build();

for await (const event of engine.run({ dag, task: 'Build a REST API for todos' })) {
  if (event.type === 'agent_done') {
    console.log(`[${event.agentRole}] done — ${event.cost.costCents}¢`);
  }
  if (event.type === 'swarm_done') {
    console.log(`Total: ${event.totalCost.totalTokens} tokens, ${event.totalCost.costCents}¢`);
  }
}
```

## Execution Patterns

### Sequential Pipeline

```
A → B → C
```

```ts
engine.dag()
  .agent('a', agentA)
  .agent('b', agentB)
  .agent('c', agentC)
  .edge('a', 'b')
  .edge('b', 'c')
  .build();
```

### Parallel Fan-Out / Fan-In

```
    ┌→ B ─┐
A ──┤     ├──→ D
    └→ C ─┘
```

```ts
engine.dag()
  .agent('a', coordinator)
  .agent('b', worker1)
  .agent('c', worker2)
  .agent('d', aggregator)
  .edge('a', 'b')
  .edge('a', 'c')
  .edge('b', 'd')
  .edge('c', 'd')
  .build();
```

Node D waits for both B and C to complete, then receives both outputs.

### Conditional Routing

```
        ┌→ approve
review ─┤
        └→ reject
```

```ts
engine.dag()
  .agent('review', reviewer)
  .agent('approve', approver)
  .agent('reject', rejector)
  .conditionalEdge('review', {
    evaluate: {
      type: 'rule',
      fn: (output) => output.includes('approve') ? 'yes' : 'no',
    },
    targets: { yes: 'approve', no: 'reject' },
  })
  .build();
```

Evaluator types: `rule` (function), `regex` (pattern match), `llm` (LLM-based decision).

### Iterative Loops

```
writer ⇄ critic (max 3 cycles)
```

```ts
engine.dag()
  .agent('writer', writer)
  .agent('critic', critic)
  .edge('writer', 'critic')
  .edge('critic', 'writer', { maxCycles: 3 })
  .build();
```

### Dynamic Planning

A coordinator agent can emit new DAG nodes at runtime:

```ts
engine.dag()
  .agent('coordinator', {
    id: 'coordinator', name: 'Coordinator', role: 'coordinator',
    systemPrompt: 'Analyze the task and output a JSON DAG of sub-agents.',
  })
  .dynamicExpansion('coordinator')
  .build();
```

## Streaming Events

Every `engine.run()` yields typed events:

| Event | Description |
|---|---|
| `agent_start` | Agent node begins execution |
| `agent_chunk` | Streaming text chunk from LLM |
| `agent_tool_use` | Agent invoked a tool |
| `agent_done` | Agent completed with output and cost |
| `agent_error` | Agent failed with classified error |
| `swarm_start` | DAG execution begins |
| `swarm_progress` | Node completion progress update |
| `swarm_done` | All nodes complete with aggregated results |
| `swarm_cancelled` | Execution cancelled via AbortSignal |
| `route_decision` | Conditional routing decision made |
| `loop_iteration` | Loop cycle started |
| `budget_warning` | Approaching token budget limit |
| `budget_exceeded` | Token budget exceeded |

## Configuration

```ts
const engine = new SwarmEngine({
  // LLM providers (at least one required)
  providers: {
    anthropic: { type: 'anthropic', apiKey: '...' },
    openai: { type: 'openai', apiKey: '...' },
    ollama: { type: 'ollama', baseUrl: 'http://localhost:11434' },
  },

  // Defaults for agents that don't specify their own
  defaults: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.7,
    maxTokens: 4096,
  },

  // Budget enforcement
  limits: {
    maxSwarmBudgetCents: 100,       // stop entire swarm at $1
    maxPerAgentBudgetCents: 25,     // stop single agent at $0.25
    maxConcurrentAgents: 5,
    maxSwarmDurationMs: 300_000,    // 5 minute timeout
    maxScratchpadSizeBytes: 1_048_576,
    maxCycleIterations: 10,
  },

  // Pluggable adapters (all optional, defaults to in-memory/noop)
  persistence: myPersistenceAdapter,
  context: myContextProvider,
  memory: myMemoryProvider,
  codebase: myCodebaseProvider,
  persona: myPersonaProvider,
  lifecycle: {
    onRunStart: (runId, agentId) => { /* ... */ },
    onRunComplete: (runId, agentId, output) => { /* ... */ },
    onSwarmComplete: (swarmId, results) => { /* ... */ },
  },
});
```

## Cancellation

Pass an `AbortSignal` to cancel a running swarm:

```ts
const controller = new AbortController();

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30_000);

for await (const event of engine.run({ dag, task: '...', signal: controller.signal })) {
  if (event.type === 'swarm_cancelled') {
    console.log('Cancelled. Completed:', event.completedNodes);
  }
}
```

## Custom Provider

Implement the `ProviderAdapter` interface to use any LLM:

```ts
import type { ProviderAdapter, StreamParams, ProviderEvent } from '@swarmengine/core';

const myProvider: ProviderAdapter = {
  async *stream(params: StreamParams): AsyncGenerator<ProviderEvent> {
    // Call your LLM API
    yield { type: 'chunk', content: 'Hello from custom provider' };
    yield { type: 'usage', inputTokens: 10, outputTokens: 6 };
  },
  estimateCost(model, inputTokens, outputTokens) {
    return inputTokens * 0.001 + outputTokens * 0.002;
  },
  getModelLimits(model) {
    return { contextWindow: 128_000, maxOutput: 4096 };
  },
};

const engine = new SwarmEngine({
  providers: {
    custom: { type: 'custom', adapter: myProvider },
  },
});
```

## Development

```bash
git clone https://github.com/divyekant/swarm-engine.git
cd swarm-engine
npm install
npm run build
npm test
npm run typecheck
```

## License

[MIT](LICENSE)
