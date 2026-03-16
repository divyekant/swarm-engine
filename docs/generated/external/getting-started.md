---
type: getting-started
audience: external
status: draft
generated: 2026-03-15
source-tier: direct
hermes-version: 1.0.1
---

# Getting Started with @swarmengine/core

This guide walks you through installing SwarmEngine, configuring a provider, running a simple DAG, and optionally attaching the built-in monitor.

## Prerequisites

| Requirement | Minimum version |
|---|---|
| Node.js | 20+ |
| TypeScript | 5.0+ |
| An LLM API key | Anthropic or OpenAI |

## Step 1: Install the package

```bash
npm install @swarmengine/core
```

The package ships as ESM, so your project should use:

```json
{
  "type": "module"
}
```

## Step 2: Configure a provider

```ts
import { SwarmEngine } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: {
      type: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  },
  defaults: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
  },
});
```

## Step 3: Build a DAG

```ts
const dag = engine.dag()
  .agent('planner', {
    id: 'planner',
    name: 'Planner',
    role: 'planner',
    systemPrompt: 'Break the task into clear implementation steps.',
  })
  .agent('builder', {
    id: 'builder',
    name: 'Builder',
    role: 'developer',
    systemPrompt: 'Implement the plan you receive.',
  })
  .edge('planner', 'builder')
  .build();
```

## Step 4: Run the swarm

```ts
for await (const event of engine.run({
  dag,
  task: 'Build a login page',
  threadId: 'thread-123',
  entityType: 'project',
  entityId: 'swarm-engine',
  metadata: { source: 'quickstart' },
})) {
  switch (event.type) {
    case 'agent_chunk':
      process.stdout.write(event.content);
      break;
    case 'swarm_done':
      console.log(`\nDone. Total cost: ${event.totalCost.costCents} cents`);
      break;
  }
}
```

In `v0.3.0`, the optional `threadId`, `entityType`, `entityId`, and `metadata` fields are forwarded consistently through standard execution, context assembly, and persistence.

## Step 5: Watch the run live

If you want browser-based visibility while the swarm runs, attach the built-in monitor:

```ts
import { startMonitor } from '@swarmengine/core';

const monitor = await startMonitor({ port: 4820 });

for await (const event of engine.run({ dag, task: 'Build a login page' })) {
  monitor.broadcast(event);
}

await monitor.close();
```

The monitor exposes:

- `GET /events` for live SSE events
- `GET /state` for the current execution snapshot
- `GET /health` for liveness checks

If you are working from the repo checkout rather than consuming the package, you can also run:

```bash
npm run monitor:dev
```

from the project root to start the local monitor UI.

## Next Steps

- [Configuration Reference](./config-reference.md)
- [API Reference](./api-reference.md)
- [Feature: Streaming Events](./features/feat-002-streaming-events.md)
- [Feature: Monitor](./features/feat-009-monitor.md)
