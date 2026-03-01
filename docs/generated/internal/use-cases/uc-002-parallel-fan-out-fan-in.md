---
id: uc-002
type: use-case
audience: internal
topic: Parallel Fan-Out / Fan-In
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Use Case: Parallel Fan-Out / Fan-In

## Trigger
A consumer constructs a DAG where one node fans out to multiple downstream nodes, which then converge on an aggregator node. For example: coordinator → [backend, frontend, devops] → integrator.

## Preconditions
- Engine configured with at least one LLM provider
- `limits.maxConcurrentAgents` is set appropriately (default allows multiple parallel nodes)
- DAG is valid with fan-out edges from one node and fan-in edges to a convergence node

## Flow
1. **Consumer does:** Builds DAG with fan-out edges and calls `engine.run()`
   **System does:** Validates DAG, emits `swarm_start`
2. **System does:** Scheduler runs the coordinator node (no dependencies)
   **Consumer sees:** `agent_start` → `agent_chunk`* → `agent_done` for coordinator
3. **System does:** Scheduler identifies all three parallel nodes as ready (coordinator complete), starts them concurrently up to `maxConcurrentAgents`
   **Consumer sees:** Multiple `agent_start` events in rapid succession
4. **System does:** Parallel nodes stream independently, completing in any order
   **Consumer sees:** Interleaved `agent_chunk` events from different nodes (each tagged with nodeId)
5. **System does:** As each parallel node completes, `swarm_progress` emitted
   **Consumer sees:** Progress updates: "2/5 complete", "3/5 complete"
6. **System does:** Once ALL parallel nodes complete, scheduler marks integrator as ready
   **Consumer sees:** `agent_start` for integrator — it receives all upstream outputs in its context
7. **System does:** Integrator completes, swarm finishes
   **Consumer sees:** `swarm_done` with all results

## Variations
- **If one parallel node fails:** Other parallel nodes continue executing. Integrator may still run if it has outputs from completed nodes (depends on DAG structure). `agent_error` emitted for the failed node.
- **If maxConcurrentAgents = 1:** Parallel nodes execute sequentially (scheduler picks one at a time). Behavior is correct but slower.
- **If budget exceeded during parallel phase:** All running nodes are stopped, remaining skipped.

## Edge Cases
- All parallel nodes fail: Integrator node receives no upstream context, may produce poor output or fail
- Uneven completion times: Faster nodes wait in output store while slowest node runs
- Very high fan-out (10+ nodes): Bounded by maxConcurrentAgents setting

## Data Impact
| Data | Action | Location |
|------|--------|----------|
| Run records | Created per node (including parallel) | PersistenceAdapter |
| Node outputs | All stored, all available to fan-in node | In-memory (per-run) |
| Cost data | Accumulated from all parallel nodes | CostTracker |

## CS Notes
- Fan-out/fan-in is automatic — any DAG shape with multiple downstream edges creates parallelism
- The integrator node sees ALL upstream outputs, not just one — useful for synthesis tasks
- If parallel execution seems slow, check `limits.maxConcurrentAgents` (might be set to 1)
