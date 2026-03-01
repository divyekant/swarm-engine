---
id: feat-003
type: feature-doc
audience: external
topic: Cost Tracking & Budget Enforcement
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Cost Tracking & Budget Enforcement

Every token consumed by every agent is tracked. You can set budgets at the swarm level and per agent to prevent runaway costs. The engine warns you at 80% usage and halts execution when a budget is exceeded.

## How to Use

Set budget limits in the `limits` section of your engine configuration:

```ts
import { SwarmEngine } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  },
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  limits: {
    maxSwarmBudgetCents: 500,      // $5.00 total budget for the entire DAG
    maxPerAgentBudgetCents: 100,   // $1.00 max per individual agent
  },
});
```

With these limits in place, the engine automatically:

1. **Tracks every LLM call.** Each time an agent makes a provider call, the input and output tokens are recorded and the cost is calculated using built-in pricing tables.
2. **Emits `budget_warning` at 80%.** When the swarm's cumulative cost reaches 80% of `maxSwarmBudgetCents`, a warning event is emitted. Execution continues.
3. **Emits `budget_exceeded` and stops.** When the swarm exceeds `maxSwarmBudgetCents`, a `budget_exceeded` event fires followed by a `swarm_error`. Execution halts gracefully with partial results.
4. **Checks per-agent budgets after each node.** If a single agent exceeds `maxPerAgentBudgetCents`, a `budget_exceeded` event is emitted for that agent.

## Handling Budget Events

Listen for budget events in your event loop:

```ts
for await (const event of engine.run({ dag, task })) {
  switch (event.type) {
    case 'budget_warning':
      console.warn(
        `Budget warning: ${event.percentUsed}% used ` +
        `(${event.used} of ${event.limit} cents)`
      );
      // You could notify a dashboard, send a Slack alert, etc.
      break;

    case 'budget_exceeded':
      console.error(
        `Budget exceeded: ${event.used} cents used, ` +
        `limit was ${event.limit} cents`
      );
      // The engine will stop after this event.
      break;

    case 'swarm_done':
      console.log(`Total cost: ${event.totalCost.costCents} cents`);
      console.log(`Total tokens: ${event.totalCost.totalTokens}`);
      console.log(`Total LLM calls: ${event.totalCost.calls}`);
      break;
  }
}
```

## Per-Node Cost Breakdown

Every `agent_done` event includes a `CostSummary` for that individual node. When the swarm completes, the `swarm_done` event contains a `results` array where each `NodeResult` has its own cost breakdown:

```ts
for await (const event of engine.run({ dag, task })) {
  if (event.type === 'swarm_done') {
    for (const result of event.results) {
      console.log(
        `${result.nodeId} (${result.agentRole}): ` +
        `${result.cost.totalTokens} tokens, ` +
        `${result.cost.costCents} cents, ` +
        `${result.durationMs}ms`
      );
    }
  }
}
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxSwarmBudgetCents` | `number` | unlimited | Maximum total cost in US cents for the entire DAG execution. The engine stops when this is exceeded. |
| `maxPerAgentBudgetCents` | `number` | unlimited | Maximum cost in US cents for any single agent. Emits `budget_exceeded` when an agent goes over. |

Both options are set inside `limits` in the `SwarmEngineConfig`.

## Built-In Pricing

The cost tracker includes pricing tables for common models. Costs are calculated in cents per million tokens:

| Model | Input (cents/M tokens) | Output (cents/M tokens) |
|-------|----------------------|------------------------|
| claude-sonnet-4 | 300 | 1,500 |
| claude-opus-4 | 1,500 | 7,500 |
| claude-haiku-3.5 | 80 | 400 |
| gpt-4o | 250 | 1,000 |
| gpt-4o-mini | 15 | 60 |
| gpt-4.1 | 200 | 800 |
| gpt-4.1-mini | 40 | 160 |
| gpt-4.1-nano | 10 | 40 |

For models not in the table, the engine falls back to default pricing (300/1,500 cents per million tokens). If you implement a custom `ProviderAdapter`, you can override cost estimation through the `estimateCost` method.

## Limitations

- **Cost estimates are provider-dependent.** The built-in pricing table covers major Anthropic and OpenAI models. If you use a model not in the table, costs will be estimated using default pricing, which may not be accurate.
- **Agentic backend costs are reported in USD.** When using agentic backends like Claude Code or Codex, the SDK reports cost in USD. The engine converts this to cents for consistency, but the precision depends on what the SDK provides.
- **Budgets are checked after each node completes, not mid-stream.** A single expensive node can overshoot the budget before the check fires. The budget is not enforced token-by-token within a single agent call.
- **No cost rollback.** If the engine stops due to a budget exceeded event, the tokens already consumed are not refundable. Budget limits are a safety net, not a guarantee of exact spend.
