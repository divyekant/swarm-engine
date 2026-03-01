---
id: uc-004
type: use-case
audience: internal
topic: Iterative Refinement Loops
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Use Case: Iterative Refinement Loops

## Trigger
A consumer builds a DAG with a back-edge that has `maxCycles` set, creating a loop between two or more nodes. Typically used for draft → review → revise cycles where quality improves iteratively.

## Preconditions
- Back-edge has `maxCycles` set (or `limits.maxCycleIterations` provides a global cap)
- An exit condition exists (conditional edge or maxCycles limit) to break out of the loop
- Nodes involved produce output that changes meaningfully between iterations

## Flow
1. **Consumer does:** Builds DAG with `.edge('writer', 'critic')` and `.edge('critic', 'writer', { maxCycles: 3 })`
   **System does:** Validates cycle limits
2. **System does:** Writer node executes first iteration
   **Consumer sees:** `agent_start` → `agent_chunk`* → `agent_done` for writer
3. **System does:** Critic node executes, reviews writer output
   **Consumer sees:** `agent_start` → `agent_chunk`* → `agent_done` for critic
4. **System does:** Back-edge evaluation: if cycle count < maxCycles and exit condition not met, loop back
   **Consumer sees:** `loop_iteration` event with iteration number and maxIterations
5. **System does:** Writer re-executes with critic's feedback in context
   **Consumer sees:** New `agent_start` for writer (iteration 2)
6. **Repeat steps 3-5** until exit condition met or maxCycles reached
7. **System does:** Loop exits, proceeds to next node (if any)
   **Consumer sees:** Normal downstream execution

## Variations
- **Exit via conditional edge:** Combine loop with a conditional edge from the critic. If critic says "APPROVED", route to publisher. If not, loop back to writer.
- **Exit via maxCycles:** When maxCycles reached, the system force-proceeds to the next non-cycle edge.
- **If no exit condition and no maxCycles:** The global `limits.maxCycleIterations` (default 10) prevents infinite loops.

## Edge Cases
- Writer produces identical output on retry: Loop still runs (no content-based deduplication)
- Budget exceeded during loop: Loop stops, partial results returned
- Single iteration: If exit condition met on first pass, loop body runs once (no actual looping)

## Data Impact
| Data | Action | Location |
|------|--------|----------|
| Per-iteration outputs | Stored per execution (latest wins) | In-memory output map |
| Cost per iteration | Accumulated (each iteration adds cost) | CostTracker |
| loop_iteration events | Emitted per cycle | SwarmEvent stream |

## CS Notes
- Loops can be expensive — each iteration costs tokens. The maxCycles limit prevents runaway spending.
- The `loop_iteration` event is the best way to track loop progress in a UI
- Context grows with each iteration (previous outputs added), which may hit context limits on many iterations
