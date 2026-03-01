---
id: uc-001
type: use-case
audience: internal
topic: Sequential Pipeline Execution
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Use Case: Sequential Pipeline Execution

## Trigger
A consumer calls `engine.run()` with a DAG where nodes are connected in a linear chain (A → B → C). This is the simplest execution pattern and the most common starting point.

## Preconditions
- At least one LLM provider is configured in the engine
- DAG has been validated (no orphan nodes, all referenced providers exist)
- Each node has a valid AgentDescriptor with systemPrompt

## Flow
1. **Consumer does:** Constructs a DAG using `engine.dag().agent().agent().edge().build()` and calls `engine.run({ dag, task })`
   **System does:** Validates the DAG, emits `swarm_start` event with node count
2. **System does:** Scheduler identifies the first node (no dependencies), begins execution
   **Consumer sees:** `agent_start` event with nodeId, agentRole, agentName
3. **System does:** ContextAssembler builds context, AgentRunner streams LLM response
   **Consumer sees:** `agent_chunk` events with streaming text content
4. **System does:** Node completes, output stored, cost recorded
   **Consumer sees:** `agent_done` event with output, cost, optional artifactRequest
5. **System does:** Scheduler identifies next node (dependency met), repeats steps 2-4
   **Consumer sees:** `swarm_progress` events after each node completion
6. **System does:** All nodes complete, final cost aggregated
   **Consumer sees:** `swarm_done` event with results array and totalCost

## Variations
- **If a node fails:** `agent_error` event emitted with classified error type. Downstream nodes are skipped. `swarm_error` emitted with partial results and partial cost.
- **If budget exceeded mid-pipeline:** `budget_exceeded` event emitted, remaining nodes skipped, `swarm_error` with partial results.
- **If AbortSignal fires:** Current node interrupted, `swarm_cancelled` event with completedNodes and partialCost.

## Edge Cases
- Single-node DAG: Executes normally, just one agent_start → chunks → agent_done → swarm_done
- Empty upstream context: First node receives only the task message and its system prompt
- Node output exceeds artifact threshold: artifactRequest populated in agent_done event

## Data Impact
| Data | Action | Location |
|------|--------|----------|
| Run record | Created per node | PersistenceAdapter |
| Node output | Stored in executor output map | In-memory (per-run) |
| Cost data | Accumulated in CostTracker | In-memory (per-run) |
| Artifacts | Created if output qualifies | PersistenceAdapter |

## CS Notes
- Sequential is the default pattern — if a consumer wires a linear chain of edges, they get sequential execution automatically
- Each downstream node receives all upstream outputs in its context, not just the immediate predecessor
- Pipeline progress is trackable via swarm_progress events showing completed/total counts
