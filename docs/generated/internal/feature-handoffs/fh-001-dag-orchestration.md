---
id: fh-001
type: feature-handoff
audience: internal
topic: DAG Orchestration
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [src/dag/, src/engine.ts, docs/ARCHITECTURE.md]
hermes-version: 1.0.0
---

# DAG Orchestration

## What It Does

The DAG orchestration system is the execution backbone of SwarmEngine. It takes a directed acyclic graph of agent nodes and edges, validates it, then walks it to completion -- scheduling agents, managing concurrency, evaluating conditional branches, handling iterative loops, and merging dynamically emitted sub-graphs. All five execution patterns (sequential, parallel fan-out/fan-in, conditional routing, iterative loops, dynamic planning) are driven by the shape of the graph itself, not by separate code paths. A single executor handles every pattern.

The system is composed of four primary components:

- **DAGBuilder** -- a fluent API for constructing DAG definitions at configuration time.
- **DAGGraph** -- the runtime data structure that wraps a DAGDefinition and provides traversal helpers.
- **Scheduler** -- the concurrency-aware component that tracks node statuses and determines which nodes are ready to execute.
- **DAGExecutor** -- the main orchestration loop that walks the graph from root nodes to leaf nodes, coordinating validation, scheduling, execution, routing, and termination.

The orchestration layer does not know or care what kind of agent runs at each node. It delegates to the appropriate runner (AgentRunner for LLM nodes, AgenticRunner for agentic backend nodes) and consumes the same SwarmEvent stream from both.

## How It Works

### DAGBuilder

DAGBuilder provides a fluent (chainable) API for constructing a DAGDefinition. The caller adds nodes via `.agent(nodeId, descriptor)`, connects them with `.edge(from, to, options?)`, defines conditional branches with `.conditionalEdge(from, config)`, and marks nodes capable of emitting sub-DAGs at runtime with `.dynamicExpansion(nodeId)`. Calling `.build()` performs referential integrity checks (every edge endpoint must reference an existing node) and returns a frozen DAGDefinition with a generated unique ID.

Key behaviors of DAGBuilder:

- Duplicate node IDs throw immediately at `.agent()` call time, not at build time.
- Edge and conditional edge validation happens at `.build()` time. If any edge references a node that does not exist, the builder throws.
- Dynamic expansion node references are also validated at build time.
- The generated DAG ID uses a timestamp plus a random suffix for uniqueness within a process.

### DAGGraph

DAGGraph is the runtime wrapper around a DAGDefinition. It stores the nodes array, edges array, conditional edges, and dynamic node IDs, and provides traversal methods: `getNode(id)`, `getIncomingEdges(nodeId)`, `getOutgoingEdges(nodeId)`, `getConditionalEdges(nodeId)`, `getRootNodes()`, and `getLeafNodes()`. Root nodes are those with no incoming edges of any kind. Leaf nodes are those with no outgoing regular edges and no outgoing conditional edges.

DAGGraph is mutable at runtime. It supports `addNode(node)` and `addEdge(edge)` to accommodate dynamic DAG expansion -- when a coordinator node emits a JSON DAG structure that gets merged into the running graph.

### Scheduler

The Scheduler tracks the execution status of every node in the graph and determines which nodes are ready to run. The status lifecycle for a node is: `pending` -> `running` -> `completed | failed | skipped`.

A node becomes ready when:

1. Its current status is `pending`.
2. All of its upstream dependencies (nodes connected via incoming edges) have status `completed`.
3. The total number of currently running nodes plus newly ready nodes does not exceed the `maxConcurrent` limit.

Root nodes (no incoming edges) are immediately eligible on the first scheduling pass.

The Scheduler also manages cycle tracking. It maintains a count of how many times each cycle edge has been traversed, keyed by the `from->to` string. The `resetNodeForCycle(nodeId)` method sets a completed or failed node back to `pending` so it can run again in the next loop iteration. The `registerNode(nodeId)` method allows the executor to register dynamically added nodes so they become schedulable.

### DAGExecutor

The DAGExecutor is the main orchestration loop. It operates in a `while (!scheduler.isDone())` loop with the following phases per iteration:

1. **Check cancellation** -- If the AbortSignal has been triggered, the executor emits a `swarm_cancelled` event and returns.
2. **Check duration limit** -- If `maxSwarmDurationMs` has elapsed since execution started, the executor emits a `swarm_error` event and returns.
3. **Get ready nodes** -- The executor asks the Scheduler for all ready nodes, filtering out nodes that are targets of conditional edges (they must wait until their conditional edge is evaluated). It then caps the batch at `maxConcurrentAgents`.
4. **Handle deadlock** -- If no nodes are ready and the swarm is not done, the executor checks for pending nodes whose upstream dependencies include a failed or skipped node. Those nodes are marked as skipped. If no nodes can be skipped either, the executor breaks out of the loop (deadlock).
5. **Execute nodes** -- If a single node is ready, the executor runs it sequentially. If multiple nodes are ready, they run in parallel via `Promise.all`. In both cases, each node is first marked as `running` in the Scheduler.
6. **Route after completion** -- After each node completes, the executor evaluates conditional edges originating from that node, handles cycle edges (incrementing cycle counts and resetting nodes for re-execution if under the limit), and handles dynamic DAG expansion if the node has `canEmitDAG: true`.
7. **Check budget** -- After each batch, the executor checks the CostTracker. A `budget_warning` event fires at 80% utilization. A `budget_exceeded` event terminates the swarm.

The executor determines whether a node should be routed to the AgentRunner or AgenticRunner by checking if the node's `providerId` maps to an agentic adapter. If the node's provider ID exists in the agentic adapters map and an AgenticRunner instance exists, the node runs as an agentic node. Otherwise, it runs as an LLM node.

### Execution Patterns

All five patterns use the same executor and scheduler. The pattern is determined entirely by the graph topology:

**Sequential (A -> B -> C):** Each node has exactly one outgoing edge to the next. The Scheduler releases one node at a time as each predecessor completes.

**Parallel fan-out/fan-in (A -> [B, C] -> D):** Node A has outgoing edges to both B and C. Both become ready simultaneously after A completes. The Scheduler releases both (up to the concurrency cap), and they execute via `Promise.all`. Node D has incoming edges from B and C, so it waits until both are completed.

**Conditional routing (A -> evaluate -> B or C):** A conditional edge from A has an evaluator and a targets map. After A completes, the evaluator runs against A's output to determine a target label. The selected target is unblocked; all non-selected targets are marked as skipped, and their downstream graphs are recursively skipped.

**Iterative loops (A <-> B with maxCycles):** Edges with `maxCycles` set form a cycle. When a node at the target end of a cycle edge completes, the executor increments the cycle count. If the count is below `maxCycles`, the target node is reset to `pending` so it runs again. When the count reaches the limit, the node stays completed and execution proceeds downstream normally.

**Dynamic planning (coordinator emits JSON DAG):** Nodes marked with `canEmitDAG: true` have their output parsed as JSON after completion. If the output contains a valid DAG structure (with `nodes` and `edges` arrays), those nodes and edges are added to the live DAGGraph and registered with the Scheduler. They become schedulable in the next loop iteration.

### Validator

Before execution begins, SwarmEngine runs `validateDAG()` on the DAG definition. The validator performs four checks:

1. **Orphan node detection** -- Every node (except root nodes and dynamic nodes) must have at least one incoming edge. Nodes with no incoming connections that are not roots are flagged as errors.
2. **Cycle limit enforcement** -- The validator uses iterative DFS with color marking (white/grey/black) to detect all cycles. Every edge that participates in a cycle must have `maxCycles` set. If any cycle edge lacks this property, validation fails.
3. **Provider reference validation** -- If a providers map is supplied, the validator checks that every node's `providerId` (and every LLM evaluator's `providerId`) references a provider that exists in the map.
4. **Budget estimate** -- An informational estimate of cost in cents based on a heuristic of ~0.5 cents per node. This does not cause validation failure.

Validation runs synchronously and returns a `ValidationResult` with `valid: boolean` and `errors: string[]`.

### Conditional Edge Evaluation

Conditional edges use an Evaluator to determine routing. The evaluator result can be either a label key in the targets map or a direct node ID. The executor tries both resolution strategies: first checking if the result is a label key, then checking if it is a direct node ID that appears in the target values.

If no valid target is found, all conditional targets are skipped along with their downstream subgraphs.

### Failure Propagation

When a node fails, the executor marks it as failed and recursively skips all downstream nodes reachable via both regular edges and conditional edge targets. This prevents orphaned execution paths where agents would run without their expected upstream context.

## User-Facing Behavior

The consumer interacts with DAG orchestration through two methods on the SwarmEngine class:

- `engine.dag()` returns a new DAGBuilder for constructing a DAG definition.
- `engine.run({ dag, task, signal? })` validates the DAG, applies engine defaults to agent descriptors, creates all internal infrastructure (CostTracker, SwarmMemory, ContextAssembler, runners), and returns an AsyncGenerator of SwarmEvents.

Events emitted during orchestration include: `swarm_start` (with DAG ID and node count), `swarm_progress` (after each node or batch completes, with completed/total counts and running node IDs), `agent_start`/`agent_chunk`/`agent_tool_use`/`agent_done`/`agent_error` (per-node agent lifecycle), `route_decision` (when conditional routing selects a target), `loop_iteration` (on each cycle iteration), `budget_warning`/`budget_exceeded`, and `swarm_done` or `swarm_error`/`swarm_cancelled` at termination.

Cancellation is supported via an AbortSignal passed in RunOptions. The signal is checked at the top of each scheduling loop iteration and forwarded to the provider stream calls.

## Configuration

The DAG orchestration system is configured through `SwarmEngineConfig.limits`:

- `maxConcurrentAgents` (number, optional) -- Maximum number of agent nodes that can execute in parallel. Defaults to unlimited. Set to 1 for strictly sequential execution regardless of graph shape.
- `maxSwarmDurationMs` (number, optional) -- Maximum wall-clock time for the entire swarm run. If exceeded, the executor emits a `swarm_error` and terminates.
- `maxCycleIterations` (number, optional) -- Declared in EngineLimits but the per-edge `maxCycles` on DAGEdge is what the executor enforces at runtime.
- `maxSwarmBudgetCents` (number, optional) -- Total cost budget for the swarm. Triggers warning at 80% and hard stop at 100%.
- `maxPerAgentBudgetCents` (number, optional) -- Cost budget per individual agent. Emits `budget_exceeded` if a single agent overshoots.

Engine defaults (`SwarmEngineConfig.defaults`) are applied to agent descriptors before execution begins. If an agent does not specify a model, temperature, maxTokens, or providerId, the engine default is used as a fallback.

## Edge Cases & Limitations

- **Deadlock detection:** If no nodes are ready and no nodes can be skipped (all remaining pending nodes have only running or pending dependencies), the executor breaks out of the loop. This produces a `swarm_done` with partial results rather than hanging indefinitely.
- **Cycle iteration limits:** Every edge in a cycle must have `maxCycles` set. The validator enforces this before execution. At runtime, the cycle count is tracked per edge (keyed by `from->to`), so two different cycle edges involving the same node maintain independent counters.
- **Provider unavailability:** If the default provider cannot be resolved (no providers registered and no default configured), the executor yields a `swarm_error` immediately. Per-node provider resolution falls back to the default if a node's `providerId` is not found in the providers map.
- **Dynamic expansion with invalid JSON:** If a `canEmitDAG` node produces output that is not valid JSON or does not have `nodes` and `edges` arrays, the expansion is silently skipped. The node's completion is still recorded normally.
- **Parallel event ordering:** When nodes run in parallel, events are collected per-node and yielded in completion order (the order that `Promise.all` resolves), not in submission order. Consumers should use `nodeId` on events for correlation, not assume ordering.
- **Persistence errors are swallowed:** All persistence adapter calls (createRun, updateRun, createArtifact) are wrapped in try/catch blocks. A failing persistence layer does not halt the swarm.
- **No hard limit on DAG size:** There is no maximum node count enforced by the system. The practical limit is bounded by budget, concurrency settings, and available memory.

## Common Questions

**How many nodes can a DAG have?**
There is no hard-coded node limit. The practical ceiling depends on the cost budget (each node incurs LLM or agentic backend costs), the concurrency cap, and available runtime memory. A DAG with hundreds of nodes is technically possible but should have an appropriate budget allocation.

**Can I mix execution patterns in the same DAG?**
Yes. All patterns are determined by graph shape, and the same executor handles all of them. A single DAG can contain sequential chains, parallel branches, conditional edges, cycle edges, and dynamic expansion nodes simultaneously.

**How does parallel execution work under the hood?**
The Scheduler identifies all nodes whose dependencies are fully met and returns them as the ready set (up to the concurrency cap). If multiple nodes are ready, the executor runs them via `Promise.all`, collecting events from each node independently. Events are yielded after all parallel nodes complete.

**What happens if a node fails in a parallel batch?**
The failed node is marked as failed. All of its downstream nodes (reachable via regular and conditional edges) are recursively marked as skipped. Other nodes in the same parallel batch continue to execute independently. The swarm does not abort on a single node failure -- it completes with partial results.

**Can conditional edges and cycle edges coexist on the same node?**
Yes. A node can have outgoing regular edges, conditional edges, and be part of cycle edges simultaneously. The executor processes them in order: first conditional edge evaluation, then cycle edge handling, then dynamic expansion.

**How is the budget enforced?**
After each batch of nodes completes, the executor checks the CostTracker. A `budget_warning` event fires when cumulative cost reaches 80% of `maxSwarmBudgetCents`. A `budget_exceeded` event fires at 100% and terminates the swarm with a `swarm_error`. Per-agent budgets are also checked after each individual node completion.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `DAG validation failed: Orphan node "X"` | Node X has no incoming edges and is not a root node or dynamic node. | Add an edge pointing to node X, or verify that it should be a root node (no edges needed for root nodes). |
| `DAG validation failed: Edge "A" -> "B" is part of a cycle but has no maxCycles set` | A cycle exists in the graph but at least one edge in the cycle lacks a `maxCycles` value. | Set `maxCycles` on all edges that form the cycle via `.edge(from, to, { maxCycles: N })`. |
| `DAG validation failed: Node "X" references provider "Y" which does not exist in config` | The agent descriptor at node X specifies a `providerId` that was not registered in `SwarmEngineConfig.providers`. | Add the missing provider to the config, or remove/correct the `providerId` on the agent descriptor. |
| Swarm appears to hang or complete with missing nodes | Deadlock -- a pending node's dependencies include a failed or skipped node, but the failure propagation did not reach it. | Check that all edges correctly represent the intended dependency graph. Verify that conditional edges have proper target coverage. |
| `Swarm duration limit exceeded` | The swarm ran longer than `maxSwarmDurationMs`. | Increase the duration limit, reduce the number of nodes, or increase concurrency to parallelize work. |
| `No provider available` | No standard (non-agentic) provider was registered and no default provider could be resolved. | Ensure at least one standard LLM provider (anthropic, openai, ollama) is configured in `SwarmEngineConfig.providers`. |
| Dynamic expansion silently does nothing | The coordinator node's output was not valid JSON or lacked `nodes`/`edges` arrays. | Ensure the coordinator agent's system prompt instructs it to output a JSON object with `nodes` and `edges` arrays matching the DAGNode and DAGEdge shapes. |

## Related

- [fh-002-agent-execution.md](./fh-002-agent-execution.md) -- Agent execution system (AgentRunner, AgenticRunner, AgentNode, Evaluator)
- [fh-003-context-assembly.md](./fh-003-context-assembly.md) -- Context assembly pipeline and token budget management
- `src/dag/builder.ts` -- DAGBuilder implementation
- `src/dag/graph.ts` -- DAGGraph implementation
- `src/dag/scheduler.ts` -- Scheduler implementation
- `src/dag/executor.ts` -- DAGExecutor implementation
- `src/dag/validator.ts` -- Validation logic
- `src/engine.ts` -- SwarmEngine entry point
- `docs/ARCHITECTURE.md` -- Full architecture overview
