---
id: ts-002
type: troubleshooting
audience: internal
topic: Budget Exceeded
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Troubleshooting: Budget Exceeded

## Symptoms
- `budget_exceeded` event emitted during swarm execution
- Swarm terminates before all nodes complete
- `swarm_error` event with partial results and partial cost

## Quick Check
1. Check the `budget_exceeded` event's `used` and `limit` fields. If `used` is close to `limit`, the budget was genuinely exhausted. Fix: increase the budget via `limits.maxSwarmBudgetCents` or `limits.maxPerAgentBudgetCents`.
2. If the budget was exceeded very early (e.g., first node), the model or task may be too expensive. Consider a cheaper model or shorter max_tokens.

## Diagnostic Steps

### Step 1: Identify which node caused the overspend
- **Inspect:** Check `agent_done` events for per-node cost data. Which node had the highest `cost.costCents`?
- **If a single node dominates:** That node's model, prompt, or max_tokens may be too expensive.
- **If costs are spread evenly:** The total budget is too low for the number of nodes.

### Step 2: Check for iterative loops
- **Inspect:** Are there `loop_iteration` events? Loops multiply cost per iteration.
- **If yes:** Reduce `maxCycles` on loop edges or set a lower `maxCycleIterations` limit.
- **If no:** Proceed to step 3.

### Step 3: Check for dynamic expansion
- **Inspect:** Did a coordinator emit many dynamic nodes? Dynamic planning can create unpredictable cost.
- **If yes:** Constrain the coordinator's system prompt or set tighter budget limits.
- **If no:** The budget is simply too low for the workload.

## Resolutions
### Budget too low
- **Fix:** Increase `limits.maxSwarmBudgetCents` in the engine config.
- **Verify:** `budget_warning` should appear at 80% instead of immediate `budget_exceeded`.
- **Prevent:** Estimate cost before execution by counting nodes and considering model pricing.

### Per-agent budget exceeded
- **Fix:** Increase `limits.maxPerAgentBudgetCents` or switch expensive agents to cheaper models.
- **Verify:** Agent completes without budget interruption.

### Loop-driven overspend
- **Fix:** Reduce `maxCycles` on loop edges or improve exit conditions.
- **Verify:** Fewer `loop_iteration` events and lower total cost.

## Escalation
- **Escalate to:** Engineering team (if cost tracking seems incorrect)
- **Include:** Full event stream (especially all `agent_done` and `budget_*` events), engine config limits
- **SLA:** Medium — budget issues may block production workflows

## Related
- [fh-004 Cost Tracking](../feature-handoffs/fh-004-cost-tracking.md)
- [fh-001 DAG Orchestration](../feature-handoffs/fh-001-dag-orchestration.md)
