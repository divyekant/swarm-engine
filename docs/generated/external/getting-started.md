---
type: getting-started
audience: external
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Getting Started with @swarmengine/core

This guide walks you through installing the Swarm Engine, configuring a provider, building a two-agent DAG, and consuming the events it produces. By the end you will have a working multi-agent pipeline running locally.

## Prerequisites

| Requirement | Minimum version |
|---|---|
| Node.js | 20+ |
| TypeScript | 5.0+ |
| An LLM API key | Anthropic or OpenAI |

## Step 1 -- Install the package

```bash
npm install @swarmengine/core
```

The package ships as ESM. Your `package.json` must include:

```json
{
  "type": "module"
}
```

Your `tsconfig.json` needs the following compiler options:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16"
  }
}
```

## Step 2 -- Set up your API key

Export the key for your chosen provider as an environment variable:

```bash
# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# or OpenAI
export OPENAI_API_KEY="sk-..."
```

You will pass this key explicitly when you configure the engine in the next step. The engine does not auto-read environment variables -- you supply the key in code so you always know which value is being used.

## Step 3 -- Create a SwarmEngine

```typescript
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

The `providers` map gives each provider a name (here `"anthropic"`). The `defaults` block tells the engine which provider and model to use when an agent does not specify its own.

## Step 4 -- Build a DAG

A DAG (Directed Acyclic Graph) defines your agents and how they connect. Use the fluent `DAGBuilder` returned by `engine.dag()`.

```typescript
const dag = engine.dag()
  .agent('planner', {
    id: 'planner',
    name: 'Planner',
    role: 'planner',
    systemPrompt: 'You are a technical planner. Break the task into clear, actionable steps.',
  })
  .agent('developer', {
    id: 'developer',
    name: 'Developer',
    role: 'developer',
    systemPrompt: 'You are a senior developer. Implement the plan you receive from the planner.',
  })
  .edge('planner', 'developer')
  .build();
```

The `.edge('planner', 'developer')` call means: run the planner first, then pass its output as context to the developer. You can add as many agents and edges as you need -- the engine handles parallelism and ordering automatically.

## Step 5 -- Run and consume events

The engine returns an `AsyncGenerator<SwarmEvent>`. Iterate over it with `for await...of`:

```typescript
for await (const event of engine.run({ dag, task: 'Build a REST API for a todo app' })) {
  switch (event.type) {
    case 'swarm_start':
      console.log(`Swarm started -- ${event.nodeCount} agents`);
      break;
    case 'agent_start':
      console.log(`[${event.agentRole}] started`);
      break;
    case 'agent_chunk':
      process.stdout.write(event.content);
      break;
    case 'agent_done':
      console.log(`\n[${event.agentRole}] done (${event.cost.totalTokens} tokens)`);
      break;
    case 'swarm_done':
      console.log(`\nSwarm complete -- total cost: ${event.totalCost.costCents} cents`);
      break;
    case 'agent_error':
      console.error(`[${event.agentRole}] error: ${event.message}`);
      break;
    case 'swarm_error':
      console.error(`Swarm error: ${event.message}`);
      break;
  }
}
```

## Event types you will see

During a typical run, the engine emits these events in order:

| Event type | When it fires | Key fields |
|---|---|---|
| `swarm_start` | Once, at the beginning | `dagId`, `nodeCount` |
| `agent_start` | When each agent begins | `nodeId`, `agentRole`, `agentName` |
| `agent_chunk` | Streaming text from the LLM | `nodeId`, `content` |
| `agent_tool_use` | Agent invokes a tool | `nodeId`, `tool`, `input` |
| `agent_done` | Agent finishes | `nodeId`, `output`, `cost` |
| `swarm_progress` | After each agent completes | `completed`, `total`, `runningNodes` |
| `swarm_done` | All agents finished | `results`, `totalCost` |
| `agent_error` | An agent failed | `nodeId`, `message`, `errorType` |
| `swarm_error` | The entire swarm failed | `message`, `completedNodes`, `partialCost` |

Additional event types (`route_decision`, `loop_iteration`, `budget_warning`, `budget_exceeded`, `swarm_cancelled`) appear when you use advanced features like conditional edges, cyclic edges, or budget limits.

## Next steps

- **[Configuration Reference](./config-reference.md)** -- Full list of engine, provider, agent, and limit options.
- **[Error Reference](./error-reference.md)** -- Every error type, what causes it, and how to fix it.
- **Features** -- Conditional routing, iterative loops, dynamic DAG expansion, scratchpad memory, and cost tracking are covered in the features documentation.
