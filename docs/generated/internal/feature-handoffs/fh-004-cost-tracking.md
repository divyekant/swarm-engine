---
id: fh-004
type: feature-handoff
audience: internal
topic: Cost Tracking
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [src/cost/tracker.ts, docs/ARCHITECTURE.md]
hermes-version: 1.0.0
---

# Cost Tracking

## What It Does

The cost tracking subsystem provides real-time financial attribution and budget enforcement across an entire swarm run. Every LLM call made during execution -- whether from a standard agent, an agentic backend (Claude Code, Codex), or a conditional routing evaluator -- is recorded and attributed to the originating agent and node. The system uses integer arithmetic exclusively (all values stored as cents, not dollars) to eliminate floating-point precision errors that would otherwise accumulate across many small token charges.

Budget enforcement operates as a circuit breaker: before each batch of node executions completes, the executor checks whether spending has crossed configurable thresholds. At 80% of the configured budget, a warning event is emitted. At 100%, the swarm stops gracefully and returns partial results.

## How It Works

### CostTracker

CostTracker is the central accounting class. It maintains three views of cost data:

- **Per-agent costs** -- keyed by `agentId`. When the same agent definition is used across multiple nodes, costs from all those nodes aggregate under one agent entry.
- **Per-node costs** -- keyed by `nodeId`. Each node in the DAG gets its own independent cost record.
- **Total swarm cost** -- a single running total across all nodes and agents.

Each view stores a CostSummary record with five fields: `inputTokens`, `outputTokens`, `totalTokens`, `costCents`, and `calls`.

### Cost Calculation

When a usage event arrives (from either the LLM provider stream or an agentic backend result), `recordUsage` is called with the agent ID, node ID, and a TokenUsage object containing `inputTokens`, `outputTokens`, and `model`.

The tracker looks up pricing from an internal pricing table keyed by model name. If no exact match is found, it tries prefix matching (so a model string like `claude-sonnet-4-20250514-v2` would match the `claude-sonnet-4-20250514` entry). If no match is found at all, it falls back to a default pricing tier.

Cost for each call is computed as: `ceil(inputTokens * inputPricePerMillion / 1,000,000) + ceil(outputTokens * outputPricePerMillion / 1,000,000)`. The ceiling operation on each component ensures sub-cent amounts always round up, preventing cost underestimation.

### Budget Enforcement

Budget checks happen at two levels:

1. **Swarm-level** -- After each batch of nodes completes, the DAGExecutor calls `checkBudgetThresholds()`. This method reads the total swarm cost and compares it against the configured `maxSwarmBudgetCents`. If usage is at or above 80%, a `budget_warning` event is emitted with the current `used`, `limit`, and `percentUsed` values. If usage exceeds 100%, a `budget_exceeded` event is emitted, followed by a `swarm_error` event, and the executor returns -- ending the swarm with whatever results have been collected so far.

2. **Per-agent** -- After each node completes, the executor calls `checkAgentBudget(agentId)`. If a per-agent budget is set and the agent has exceeded it, a `budget_exceeded` event is emitted. This prevents a single expensive agent from consuming the entire swarm budget.

Both checks return an object with `ok` (boolean), `remaining` (cents), and `used` (cents).

### Agentic Backend Cost Attribution

Agentic backends (Claude Code, Codex) report their own cost data. When an agentic result event includes `inputTokens` and `outputTokens`, the AgenticRunner records that usage through the same CostTracker, attributing it to the originating agent and node. This means budget enforcement works uniformly regardless of whether a node is an LLM agent or an agentic backend.

### Evaluator Cost Attribution

When conditional routing uses an LLM evaluator, that evaluator call goes through a provider's `stream` method. The usage event from the evaluator stream is recorded by the provider and feeds into the CostTracker. Because the evaluator runs within the context of the DAGExecutor's conditional edge evaluation (which occurs after a node completes), the evaluator's cost is attributed to the swarm total. The evaluator uses a tight `maxTokens` cap of 50 and temperature 0 to minimize cost.

## User-Facing Behavior

From the consumer's perspective, cost tracking is transparent. The `swarm_done` event includes a `totalCost` field (CostSummary) that summarizes the full financial picture of the run. Each individual `agent_done` event also carries a `cost` field showing that specific node's expenditure.

When a budget warning fires, consumers receive a `budget_warning` event they can use to surface a notification. When a budget is exceeded, the swarm terminates cleanly -- consumers receive a `budget_exceeded` event followed by a `swarm_error` event containing `completedNodes` and `partialCost`, allowing them to display partial results with cost context.

## Configuration

- **`limits.maxSwarmBudgetCents`** -- Total budget for the entire swarm run, in cents. When not set, spending is unlimited.
- **`limits.maxPerAgentBudgetCents`** -- Maximum spending allowed per agent (across all nodes that use that agent), in cents. When not set, per-agent spending is unlimited.

Both values are integers. Setting `maxSwarmBudgetCents: 500` means a $5.00 budget for the whole swarm.

## Edge Cases & Limitations

- **No budget set**: When neither `maxSwarmBudgetCents` nor `maxPerAgentBudgetCents` is configured, the system still tracks all costs but never emits budget events and never halts for financial reasons. The `checkBudget()` method returns `remaining: Infinity`.

- **Unknown models**: If a model string does not match any entry in the pricing table (including prefix matching), the system falls back to default pricing. The default is set to match the pricing of `claude-sonnet-4-20250514` (300 cents/M input, 1500 cents/M output). This avoids blocking execution but may produce inaccurate cost estimates for novel or custom models.

- **Agentic cost conversion**: Agentic backends may report cost in USD rather than cents. The AgenticRunner handles conversion by recording the token counts through the standard CostTracker, which computes cost in cents using its internal pricing table. The agentic backend's self-reported dollar amount is not used directly for budget enforcement.

- **Ceiling arithmetic**: The ceiling operation means that a single call using 1 input token at 300 cents/M will be recorded as 1 cent, not 0.0003 cents. For swarms with many small calls, this can result in total tracked cost slightly exceeding the mathematically precise cost. This is by design -- cost should never be underestimated for budget enforcement purposes.

- **Partial results on budget exceeded**: When the swarm stops due to budget, nodes that were already running may complete (the budget check happens after batch completion, not mid-stream). The `swarm_error` event includes all results collected up to that point.

- **Evaluator calls are not attributed to a specific node**: LLM evaluator calls contribute to the swarm total cost but are not attributed to a specific node in the per-node cost map, because the evaluator runs in the executor's routing phase after the originating node has already completed.

## Common Questions

**How are costs calculated?**
The CostTracker uses an internal pricing table with per-million-token rates for input and output. It multiplies token counts by the model's rates, divides by 1,000,000, and applies a ceiling function to each component. If a model is not found in the table, prefix matching is tried, then a default rate is used.

**Are evaluator LLM calls tracked?**
Yes. When a conditional edge uses an LLM evaluator, the tokens consumed by that evaluator call are recorded by the provider stream and contribute to the swarm's total cost. They show up in the swarm-level CostSummary.

**What happens when the budget is exceeded?**
The swarm stops gracefully. A `budget_exceeded` event is emitted, followed by a `swarm_error` event. The error event includes `completedNodes` (list of node IDs that finished) and `partialCost` (CostSummary of spending so far). Consumers receive all results from nodes that completed before the budget was hit.

**Can I get per-node cost breakdowns?**
Yes. The CostTracker provides `getPerNode()` which returns a Map of nodeId to CostSummary. Each `agent_done` event also carries the cost for that specific node.

**Why integer cents instead of floating-point dollars?**
Floating-point arithmetic introduces rounding errors that compound across hundreds of small operations. Using integer cents with ceiling rounding guarantees that budget enforcement is conservative (never underestimates cost) and that cost comparisons are exact.

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Cost shows 0 for a completed node | Provider adapter is not emitting `usage` events | Check that the provider adapter yields a `{ type: 'usage', inputTokens, outputTokens }` event |
| Budget warning never fires | No budget configured | Set `limits.maxSwarmBudgetCents` in the engine config |
| Cost seems too high for token count | Unknown model using default pricing | Check the model string matches an entry in the pricing table; default pricing assumes Sonnet-tier rates |
| Swarm stops unexpectedly | Per-agent budget exceeded | Check `limits.maxPerAgentBudgetCents`; a single agent reused across many nodes can accumulate cost quickly |
| Agentic node shows 0 cost | Agentic backend did not report token counts | Verify the agentic adapter's result event includes `inputTokens` and `outputTokens` |

## Related

- `/docs/ARCHITECTURE.md` -- Cost Tracking section for architectural context
- `/src/cost/tracker.ts` -- CostTracker implementation
- `/src/dag/executor.ts` -- Budget check integration in `checkBudgetThresholds()` and per-agent checks
- `/src/agent/runner.ts` -- LLM agent cost recording via `recordUsage`
- `/src/agent/agentic-runner.ts` -- Agentic backend cost recording
- `/src/agent/evaluator.ts` -- LLM evaluator (cost flows through provider stream)
- `/src/types.ts` -- CostSummary, TokenUsage, budget event type definitions
