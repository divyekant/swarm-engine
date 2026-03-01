---
id: uc-003
type: use-case
audience: internal
topic: Conditional Routing
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Use Case: Conditional Routing

## Trigger
A consumer builds a DAG with a `conditionalEdge()` where the output of one node determines which downstream node executes next. Three evaluator types available: rule (function), regex (pattern match), or LLM (model-based decision).

## Preconditions
- Source node produces output that the evaluator can analyze
- Target nodes referenced in the `targets` map exist in the DAG
- For LLM evaluator: a provider must be configured and the evaluator's expected output values must match target keys

## Flow
1. **Consumer does:** Builds DAG with `.conditionalEdge('source', { evaluate, targets })` and runs
   **System does:** Validates DAG including conditional edges
2. **System does:** Source node executes normally
   **Consumer sees:** Standard `agent_start` → `agent_chunk`* → `agent_done`
3. **System does:** Evaluator runs against source output (cheapest tier first: rule → regex → LLM)
   **Consumer sees:** `route_decision` event with fromNode, toNode, and reason
4. **System does:** Only the matched target node is marked as ready; other targets are skipped
   **Consumer sees:** `agent_start` for the chosen target node, NOT for alternatives
5. **System does:** Chosen target executes, DAG continues from there
   **Consumer sees:** Normal execution events for the selected branch

## Variations
- **Rule evaluator:** Function `(output: string) => string` called synchronously. Return value matched against targets keys. Zero cost.
- **Regex evaluator:** Pattern tested against output. If match → `matchTarget`, else → `elseTarget`. Zero cost.
- **LLM evaluator:** Separate LLM call with tight prompt asking for classification. Small cost attributed to source node.
- **If evaluator returns unrecognized value:** No target matched, node has no successors, DAG may terminate early.
- **If LLM evaluator fails:** Route decision fails, treated as node error.

## Edge Cases
- Evaluator output doesn't match any target key: execution stops at that branch (no error, just no successor)
- Multiple conditional edges from same node: each evaluated independently, multiple branches possible
- Conditional edge combined with regular edges: both types evaluated, multiple successors possible

## Data Impact
| Data | Action | Location |
|------|--------|----------|
| Route decision | Logged as event | SwarmEvent stream |
| LLM evaluator cost | Attributed to source node | CostTracker |
| Skipped nodes | Marked as skipped | DAG executor state |

## CS Notes
- Rule-based evaluators are instant and free — prefer them when the output format is predictable
- The `route_decision` event contains the reason, making it easy to debug unexpected routing
- LLM evaluator costs are attributed to the source node that triggered the evaluation
