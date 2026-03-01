---
id: feat-005
type: feature-doc
audience: external
topic: Agentic Backends
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Agentic Backends

SwarmEngine lets you mix standard LLM agents with full agentic platforms in the same DAG. Standard agents produce text completions. Agentic nodes go further -- they can read and write files, execute shell commands, install packages, and spawn sub-agents. This makes it possible to build workflows where some nodes think and others act.

## How to Use

### Step 1: Install the SDK

Agentic SDKs are optional dependencies. Install only the one you need:

```bash
# For Claude Code agentic nodes
npm install @anthropic-ai/claude-agent-sdk

# For Codex agentic nodes
npm install @openai/codex-sdk
```

You do not need both. SwarmEngine works fully without either -- they are only required if you want to use agentic nodes.

### Step 2: Add the Agentic Provider

Register an agentic provider in your engine configuration alongside your standard providers:

```ts
import { SwarmEngine } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    // Standard LLM provider for regular agents
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
    // Agentic provider for nodes that need to execute code
    coder: { type: 'claude-code' },
  },
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
});
```

Supported agentic provider types:

| Type | SDK Required | Description |
|------|-------------|-------------|
| `claude-code` | `@anthropic-ai/claude-agent-sdk` | Spawns a Claude Code agent session that can use tools, read/write files, and run commands |
| `codex` | `@openai/codex-sdk` | Spawns a Codex agent session with code execution capabilities |
| `custom-agentic` | none | Your own implementation of the `AgenticAdapter` interface |

### Step 3: Assign Agents to Providers

Set the `providerId` on an agent descriptor to route it to an agentic backend. Any node without a `providerId` uses the default standard provider:

```ts
const dag = engine.dag()
  .agent('planner', {
    id: 'planner',
    name: 'Planner',
    role: 'planner',
    systemPrompt: 'You are a technical planner. Break down the task into implementation steps.',
    // No providerId -- uses the default "anthropic" standard provider
  })
  .agent('coder', {
    id: 'coder',
    name: 'Coder',
    role: 'developer',
    systemPrompt: 'You are a developer. Implement the plan by writing code.',
    providerId: 'coder',  // Routes to the claude-code agentic provider
    agentic: {
      permissionMode: 'bypassPermissions',
      cwd: '/tmp/project',
      maxTurns: 20,
    },
  })
  .agent('reviewer', {
    id: 'reviewer',
    name: 'Reviewer',
    role: 'reviewer',
    systemPrompt: 'Review the code for correctness and best practices.',
    // No providerId -- uses the default standard provider
  })
  .edge('planner', 'coder')
  .edge('coder', 'reviewer')
  .build();
```

In this example, the planner and reviewer are standard LLM agents (fast, text-only), while the coder is an agentic node that can actually write files and run commands.

### Step 4: Run the DAG

Run it exactly like any other DAG. The engine handles routing each node to the correct backend:

```ts
for await (const event of engine.run({ dag, task: 'Build a REST API for user management' })) {
  if (event.type === 'agent_chunk') {
    process.stdout.write(event.content);
  }
  if (event.type === 'agent_tool_use') {
    console.log(`Tool used: ${event.tool}`);
  }
}
```

## Agentic Options

You can configure agentic behavior per node through the `agentic` field on the agent descriptor:

```ts
.agent('coder', {
  id: 'coder',
  name: 'Coder',
  role: 'developer',
  systemPrompt: 'Implement the feature.',
  providerId: 'coder',
  agentic: {
    permissionMode: 'bypassPermissions',
    allowedTools: ['Read', 'Write', 'Bash'],
    disallowedTools: ['WebSearch'],
    cwd: '/tmp/workspace',
    maxTurns: 30,
    maxBudgetUsd: 2.0,
    model: 'claude-sonnet-4-20250514',
    env: { NODE_ENV: 'development' },
    pathToClaudeCodeExecutable: '/path/to/claude',
  },
})
```

| Option | Type | Description |
|--------|------|-------------|
| `permissionMode` | `string` | Controls tool approval. For Claude Code: `'bypassPermissions'` runs without asking, others may require approval. |
| `allowedTools` | `string[]` | Restrict which tools the agent can use (e.g., `['Read', 'Write', 'Bash']`). |
| `disallowedTools` | `string[]` | Block specific tools (e.g., `['WebSearch']`). Takes precedence over `allowedTools`. |
| `cwd` | `string` | Working directory for the agentic session. File operations happen relative to this path. |
| `maxTurns` | `number` | Maximum number of conversation turns the agent can take before stopping. |
| `maxBudgetUsd` | `number` | Maximum cost in USD for this specific agentic session. |
| `model` | `string` | Override the model used by the agentic backend. |
| `env` | `Record<string, string>` | Environment variables passed to the agentic session. |
| `pathToClaudeCodeExecutable` | `string` | Explicit path to the Claude Code CLI binary. If not set, the adapter auto-detects it from the SDK package. |

## Custom Agentic Backend

To use your own agentic platform, implement the `AgenticAdapter` interface and register it as `type: 'custom-agentic'`:

```ts
import type { AgenticAdapter, AgenticRunParams, AgenticEvent } from '@swarmengine/core';

class MyAgenticPlatform implements AgenticAdapter {
  async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
    // params.task -- the task to accomplish
    // params.systemPrompt -- the agent's system prompt
    // params.upstreamContext -- output from upstream nodes
    // params.agenticOptions -- configuration from the agent descriptor
    // params.signal -- AbortSignal for cancellation

    const session = await myPlatform.createSession({
      prompt: params.task,
      context: params.upstreamContext,
    });

    for await (const event of session.stream()) {
      if (event.type === 'text') {
        yield { type: 'chunk', content: event.text };
      }
      if (event.type === 'tool') {
        yield { type: 'tool_use', tool: event.name, input: event.args };
      }
    }

    yield {
      type: 'result',
      output: session.finalOutput,
      costUsd: session.cost,
      inputTokens: session.usage.input,
      outputTokens: session.usage.output,
    };
  }
}

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
    myPlatform: {
      type: 'custom-agentic',
      agenticAdapter: new MyAgenticPlatform(),
    },
  },
});
```

The `AgenticAdapter` interface has one required method:

- **`run(params)`** -- An async generator that yields `AgenticEvent` objects: `chunk` (streaming text), `tool_use` (tool invocations), `result` (final output with optional cost and token counts), or `error` (failure).

And one optional method:

- **`estimateCost?(model, inputTokens, outputTokens)`** -- Returns estimated cost in cents. Used by the cost tracker for budget enforcement.

## Mixing Standard and Agentic Nodes

You can freely mix standard and agentic nodes in the same DAG. The engine determines which backend to use based on each node's `providerId`:

- If the `providerId` maps to a standard provider (Anthropic, OpenAI, Ollama, custom), the node runs through the standard `AgentRunner`.
- If the `providerId` maps to an agentic provider (claude-code, codex, custom-agentic), the node runs through the `AgenticRunner`.
- If no `providerId` is set, the node uses the default provider from `defaults.provider`.

Upstream output chaining works identically across both types. An agentic node receives upstream outputs as context, and its output is forwarded to downstream nodes regardless of their type.

## Limitations

- **SDKs are optional dependencies.** You must install `@anthropic-ai/claude-agent-sdk` or `@openai/codex-sdk` separately. SwarmEngine does not bundle them. If you try to use an agentic provider without the corresponding SDK installed, the node will fail at runtime.
- **Agentic nodes are typically more expensive.** Agentic sessions often involve many internal LLM calls, tool usage, and retries. A single agentic node can consume significantly more tokens than a standard completion. Use `maxBudgetUsd` on the agentic options and `maxPerAgentBudgetCents` on the engine to keep costs predictable.
- **Agentic sessions are isolated.** Each agentic node runs in its own session. There is no shared filesystem or state between agentic nodes unless you explicitly configure the same `cwd` and manage coordination yourself.
- **SDK compatibility.** The built-in adapters target specific SDK versions (`@anthropic-ai/claude-agent-sdk@^0.2.50` and `@openai/codex-sdk@^0.104.0`). Breaking changes in the SDK may require adapter updates.
