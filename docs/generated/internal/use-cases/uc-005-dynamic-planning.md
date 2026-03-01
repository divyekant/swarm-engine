---
id: uc-005
type: use-case
audience: internal
topic: Dynamic Planning
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Use Case: Dynamic Planning

## Trigger
A consumer builds a DAG with a coordinator node marked via `.dynamicExpansion('coordinator')`. At runtime, the coordinator analyzes the task and emits a JSON DAG definition that gets merged into the execution graph.

## Preconditions
- Coordinator node exists in the DAG with `canEmitDAG` enabled (set by `.dynamicExpansion()`)
- Coordinator's system prompt instructs it to output a JSON DAG structure
- The JSON format must include `nodes` (array of agent descriptors with tasks) and `edges` (array of from/to pairs)

## Flow
1. **Consumer does:** Builds DAG with coordinator + `.dynamicExpansion('coordinator')`, calls `engine.run()`
   **System does:** Validates DAG, notes coordinator as a dynamic node
2. **System does:** Coordinator executes, analyzes the task
   **Consumer sees:** `agent_start` → `agent_chunk`* → `agent_done` for coordinator
3. **System does:** Executor parses coordinator output as JSON DAG, validates it, merges new nodes/edges into execution graph
   **Consumer sees:** New nodes appear in subsequent `agent_start` events
4. **System does:** Scheduler treats new nodes like any other — respects dependencies, concurrency, budgets
   **Consumer sees:** Standard execution events for dynamically-created nodes
5. **System does:** All dynamic nodes complete, swarm finishes
   **Consumer sees:** `swarm_done` with results from both the coordinator and all dynamic nodes

## Variations
- **If coordinator output is not valid JSON:** Treated as a regular agent output, no expansion occurs, DAG continues with existing edges
- **If expanded DAG has validation errors:** Expansion fails, error logged, DAG continues without expansion
- **If expanded nodes reference providers not in the engine:** Validation catches this, expansion rejected

## Edge Cases
- Coordinator emits no JSON: No expansion, functions as a normal agent node
- Coordinator emits very large DAG: All nodes subject to budget limits and concurrency caps
- Dynamic nodes themselves marked as dynamic: Nested expansion is possible but risky (cost amplification)

## Data Impact
| Data | Action | Location |
|------|--------|----------|
| Coordinator output | Parsed as JSON DAG | DAG executor |
| Dynamic nodes | Added to execution graph | DAGGraph |
| Dynamic node results | Included in swarm_done results | In-memory output map |

## CS Notes
- Dynamic planning is the most powerful but least predictable pattern — cost depends entirely on what the coordinator decides
- The coordinator's system prompt is critical — it must clearly specify the JSON output format
- Budget limits are the primary safeguard against cost explosion from dynamic expansion
