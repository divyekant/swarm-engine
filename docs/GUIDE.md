# SwarmEngine Setup & Usage Guide

> This guide is designed to be consumed by LLMs and humans alike. It covers setup, all execution patterns with complete code examples, and adapter implementation.

## Installation

```bash
npm install @swarmengine/core
```

**Requirements:** Node.js 20+, TypeScript 5.0+

## Project Setup

```bash
mkdir my-swarm-project && cd my-swarm-project
npm init -y
npm install @swarmengine/core
npm install -D typescript @types/node
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

**package.json** — add `"type": "module"` for ESM support.

## Core Concepts

### Engine

The `SwarmEngine` is your entry point. Configure it with at least one LLM provider:

```typescript
import { SwarmEngine } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  },
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
});
```

### Agents

Agents are defined as descriptors with an id, name, role, and system prompt:

```typescript
const planner = {
  id: 'planner',
  name: 'Planner',
  role: 'planner',
  systemPrompt: 'Break the task into concrete implementation steps.',
};
```

### DAGs

Wire agents into a directed acyclic graph using the fluent builder:

```typescript
const dag = engine.dag()
  .agent('planner', planner)
  .agent('developer', developer)
  .edge('planner', 'developer')
  .build();
```

### Events

`engine.run()` returns an `AsyncGenerator<SwarmEvent>`. Consume events to track progress:

```typescript
for await (const event of engine.run({ dag, task: 'Build a feature' })) {
  console.log(event.type, event);
}
```

## Pattern 1: Sequential Pipeline

Three agents execute one after another. Each receives the output of the previous agent.

```typescript
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
    systemPrompt: 'Break the task into numbered implementation steps.',
  })
  .agent('developer', {
    id: 'developer', name: 'Developer', role: 'developer',
    systemPrompt: 'Implement each step. Output working TypeScript code.',
  })
  .agent('reviewer', {
    id: 'reviewer', name: 'Reviewer', role: 'reviewer',
    systemPrompt: 'Review the code for bugs, security issues, and style.',
  })
  .edge('planner', 'developer')
  .edge('developer', 'reviewer')
  .build();

for await (const event of engine.run({ dag, task: 'Build a REST API for todos' })) {
  switch (event.type) {
    case 'agent_start':
      console.log(`Starting: ${event.agentName}`);
      break;
    case 'agent_done':
      console.log(`Done: ${event.agentRole} (${event.cost.costCents}¢)`);
      break;
    case 'swarm_done':
      console.log(`Total: ${event.totalCost.totalTokens} tokens`);
      for (const result of event.results) {
        console.log(`\n--- ${result.agentRole} ---\n${result.output}`);
      }
      break;
  }
}
```

## Pattern 2: Parallel Fan-Out / Fan-In

One coordinator fans out to parallel workers, then an aggregator collects all outputs.

```typescript
const dag = engine.dag()
  .agent('coordinator', {
    id: 'coordinator', name: 'Coordinator', role: 'coordinator',
    systemPrompt: 'Analyze the task and define what each specialist should do.',
  })
  .agent('backend', {
    id: 'backend', name: 'Backend Dev', role: 'backend',
    systemPrompt: 'Implement the backend: API routes, database schema, auth.',
  })
  .agent('frontend', {
    id: 'frontend', name: 'Frontend Dev', role: 'frontend',
    systemPrompt: 'Implement the frontend: components, state, routing.',
  })
  .agent('devops', {
    id: 'devops', name: 'DevOps', role: 'devops',
    systemPrompt: 'Write Dockerfile, CI pipeline, and deployment config.',
  })
  .agent('integrator', {
    id: 'integrator', name: 'Integrator', role: 'integrator',
    systemPrompt: 'Review all outputs. Identify integration issues and produce a unified plan.',
  })
  // Fan-out: coordinator → 3 parallel workers
  .edge('coordinator', 'backend')
  .edge('coordinator', 'frontend')
  .edge('coordinator', 'devops')
  // Fan-in: all workers → integrator
  .edge('backend', 'integrator')
  .edge('frontend', 'integrator')
  .edge('devops', 'integrator')
  .build();

for await (const event of engine.run({ dag, task: 'Build a SaaS dashboard' })) {
  if (event.type === 'swarm_progress') {
    console.log(`Progress: ${event.completed}/${event.total}`);
  }
}
```

## Pattern 3: Conditional Routing

Route to different agents based on the output of a previous agent.

### Rule-based (function)

```typescript
const dag = engine.dag()
  .agent('classifier', {
    id: 'classifier', name: 'Classifier', role: 'classifier',
    systemPrompt: 'Classify the task as "bug", "feature", or "refactor". Output only the classification.',
  })
  .agent('bug_fixer', {
    id: 'bug_fixer', name: 'Bug Fixer', role: 'bug_fixer',
    systemPrompt: 'Fix the bug described in the task.',
  })
  .agent('feature_builder', {
    id: 'feature_builder', name: 'Feature Builder', role: 'feature_builder',
    systemPrompt: 'Build the feature described in the task.',
  })
  .agent('refactorer', {
    id: 'refactorer', name: 'Refactorer', role: 'refactorer',
    systemPrompt: 'Refactor the code as described.',
  })
  .conditionalEdge('classifier', {
    evaluate: {
      type: 'rule',
      fn: (output) => {
        if (output.includes('bug')) return 'bug';
        if (output.includes('feature')) return 'feature';
        return 'refactor';
      },
    },
    targets: {
      bug: 'bug_fixer',
      feature: 'feature_builder',
      refactor: 'refactorer',
    },
  })
  .build();
```

### Regex-based

```typescript
.conditionalEdge('checker', {
  evaluate: {
    type: 'regex',
    pattern: 'STATUS:\\s*PASS',
    matchTarget: 'pass',
    elseTarget: 'fail',
  },
  targets: { pass: 'pass_handler', fail: 'fail_handler' },
})
```

### LLM-based

```typescript
.conditionalEdge('reviewer', {
  evaluate: {
    type: 'llm',
    prompt: 'Based on the review, should we approve or reject? Reply with exactly "approve" or "reject".',
  },
  targets: { approve: 'publisher', reject: 'reviser' },
})
```

## Pattern 4: Iterative Refinement Loop

Two agents loop until quality is acceptable or max iterations reached.

```typescript
const dag = engine.dag()
  .agent('writer', {
    id: 'writer', name: 'Writer', role: 'writer',
    systemPrompt: 'Write or revise the document based on feedback.',
  })
  .agent('critic', {
    id: 'critic', name: 'Critic', role: 'critic',
    systemPrompt: 'Review the document. If it needs work, provide specific feedback. If it is ready, say "APPROVED".',
  })
  .agent('publisher', {
    id: 'publisher', name: 'Publisher', role: 'publisher',
    systemPrompt: 'Format and publish the final document.',
  })
  .edge('writer', 'critic')
  .edge('critic', 'writer', { maxCycles: 3 })  // loop back up to 3 times
  .conditionalEdge('critic', {
    evaluate: {
      type: 'regex',
      pattern: 'APPROVED',
      matchTarget: 'done',
      elseTarget: 'revise',
    },
    targets: { done: 'publisher', revise: 'writer' },
  })
  .build();

for await (const event of engine.run({ dag, task: 'Write a technical blog post' })) {
  if (event.type === 'loop_iteration') {
    console.log(`Loop ${event.iteration}/${event.maxIterations}`);
  }
}
```

## Pattern 5: Dynamic Planning

A coordinator agent analyzes the task and emits a DAG of sub-agents at runtime.

```typescript
const dag = engine.dag()
  .agent('coordinator', {
    id: 'coordinator', name: 'Coordinator', role: 'coordinator',
    systemPrompt: `Analyze the task. Output a JSON DAG definition with agents and edges.
Format: { "nodes": [{ "id": "...", "role": "...", "systemPrompt": "...", "task": "..." }], "edges": [{ "from": "...", "to": "..." }] }`,
  })
  .dynamicExpansion('coordinator')
  .build();

for await (const event of engine.run({ dag, task: 'Build a full-stack app' })) {
  if (event.type === 'agent_done' && event.nodeId === 'coordinator') {
    console.log('Coordinator emitted a plan, now executing...');
  }
}
```

## Cancellation

```typescript
const controller = new AbortController();

// Cancel after 60 seconds
setTimeout(() => controller.abort(), 60_000);

for await (const event of engine.run({ dag, task: '...', signal: controller.signal })) {
  if (event.type === 'swarm_cancelled') {
    console.log('Cancelled. Completed nodes:', event.completedNodes);
    console.log('Partial cost:', event.partialCost.costCents, '¢');
  }
}
```

## Budget Enforcement

```typescript
const engine = new SwarmEngine({
  providers: { /* ... */ },
  limits: {
    maxSwarmBudgetCents: 100,     // $1 total budget
    maxPerAgentBudgetCents: 25,   // $0.25 per agent
  },
});

for await (const event of engine.run({ dag, task: '...' })) {
  if (event.type === 'budget_warning') {
    console.log(`Budget: ${event.percentUsed}% used`);
  }
  if (event.type === 'budget_exceeded') {
    console.log('Budget exceeded — swarm stopped');
  }
}
```

## Custom Provider Adapter

Implement `ProviderAdapter` to use any LLM:

```typescript
import type { ProviderAdapter, StreamParams, ProviderEvent } from '@swarmengine/core';

const myProvider: ProviderAdapter = {
  async *stream(params: StreamParams): AsyncGenerator<ProviderEvent> {
    const response = await fetch('https://my-llm-api.com/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      }),
      signal: params.signal,
    });

    const data = await response.json();

    // Yield chunks
    yield { type: 'chunk', content: data.text };

    // Yield token usage (required for cost tracking)
    yield {
      type: 'usage',
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    };
  },

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Return cost in cents
    return (inputTokens * 0.003 + outputTokens * 0.015) / 10;
  },

  getModelLimits(model: string) {
    return { contextWindow: 128_000, maxOutput: 4096 };
  },
};

const engine = new SwarmEngine({
  providers: { custom: { type: 'custom', adapter: myProvider } },
  defaults: { provider: 'custom' },
});
```

## Custom Persistence Adapter

Store runs, artifacts, and thread history in your database:

```typescript
import type { PersistenceAdapter } from '@swarmengine/core';

const dbAdapter: PersistenceAdapter = {
  async createRun(params) {
    const id = await db.runs.insert(params);
    return id;
  },
  async updateRun(runId, updates) {
    await db.runs.update(runId, updates);
  },
  async createArtifact(params) {
    const id = await db.artifacts.insert(params);
    return id;
  },
  async saveMessage(threadId, role, content) {
    await db.messages.insert({ threadId, role, content });
  },
  async loadThreadHistory(threadId) {
    return db.messages.findByThread(threadId);
  },
  async logActivity(params) {
    await db.activity.insert(params);
  },
};

const engine = new SwarmEngine({
  providers: { /* ... */ },
  persistence: dbAdapter,
});
```

## Multiple Providers

Use different LLM providers for different agents:

```typescript
const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
    openai: { type: 'openai', apiKey: process.env.OPENAI_API_KEY },
    ollama: { type: 'ollama', baseUrl: 'http://localhost:11434' },
  },
  defaults: { provider: 'anthropic' },
});

const dag = engine.dag()
  .agent('planner', {
    id: 'planner', name: 'Planner', role: 'planner',
    systemPrompt: '...',
    providerId: 'anthropic',       // uses Anthropic
    model: 'claude-sonnet-4-5-20250929',
  })
  .agent('coder', {
    id: 'coder', name: 'Coder', role: 'coder',
    systemPrompt: '...',
    providerId: 'openai',          // uses OpenAI
    model: 'gpt-4o',
  })
  .agent('local_reviewer', {
    id: 'local', name: 'Local Reviewer', role: 'reviewer',
    systemPrompt: '...',
    providerId: 'ollama',          // uses local Ollama
    model: 'llama3',
  })
  .edge('planner', 'coder')
  .edge('coder', 'local_reviewer')
  .build();
```

## Exported Types

All types are exported for use in your application:

```typescript
import type {
  SwarmEngineConfig,
  AgentDescriptor,
  DAGDefinition,
  SwarmEvent,
  NodeResult,
  CostSummary,
  ProviderAdapter,
  PersistenceAdapter,
  ContextProvider,
  MemoryProvider,
  CodebaseProvider,
  PersonaProvider,
  LifecycleHooks,
  RunOptions,
  TokenUsage,
  ArtifactRequest,
  Evaluator,
} from '@swarmengine/core';
```

## Event Reference

| Event | Key Fields | When |
|-------|-----------|------|
| `agent_start` | `nodeId`, `agentRole`, `agentName` | Agent begins execution |
| `agent_chunk` | `nodeId`, `content` | Streaming text from LLM |
| `agent_tool_use` | `nodeId`, `tool`, `input` | Agent calls a tool |
| `agent_done` | `nodeId`, `output`, `cost` | Agent finished |
| `agent_error` | `nodeId`, `message`, `errorType` | Agent failed |
| `swarm_start` | `dagId`, `nodeCount` | DAG execution begins |
| `swarm_progress` | `completed`, `total`, `runningNodes` | Node completed |
| `swarm_done` | `results`, `totalCost` | All nodes complete |
| `swarm_error` | `message`, `partialCost` | Fatal error |
| `swarm_cancelled` | `completedNodes`, `partialCost` | Abort signal received |
| `route_decision` | `fromNode`, `toNode`, `reason` | Conditional route taken |
| `loop_iteration` | `nodeId`, `iteration`, `maxIterations` | Loop cycle started |
| `budget_warning` | `used`, `limit`, `percentUsed` | 80% of budget used |
| `budget_exceeded` | `used`, `limit` | Budget exceeded |
