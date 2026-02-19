# SwarmEngine Architecture

> Multi-agent DAG orchestration engine for TypeScript

## Overview

SwarmEngine orchestrates multi-agent AI workflows using directed acyclic graphs (DAGs). All five execution patterns (sequential, parallel, conditional, loops, dynamic planning) are DAG configurations executed by the same engine — not separate executors.

**Key design decisions:**

- **Topology-agnostic** — execution pattern is determined by graph shape, not code paths
- **Actor-style agents** — each node has inbox, outbox, and local state
- **First-class cost tracking** — integer cents, per-agent/per-node/per-swarm attribution
- **Bounded memory** — configurable concurrency, size-limited scratchpad, streaming without buffering
- **Pluggable adapters** — 7 interfaces with sensible defaults; works standalone or embedded

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     SwarmEngine                          │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │DAGBuilder│  │  DAGExecutor  │  │   EventStream     │  │
│  │          │→ │  + Scheduler  │→ │  (async iterable) │  │
│  └──────────┘  └──────┬───────┘  └───────────────────┘  │
│                       │                                  │
│            ┌──────────┼──────────┐                       │
│            ▼          ▼          ▼                        │
│     ┌───────────┐┌──────────┐┌──────────┐               │
│     │ AgentNode ││AgentNode ││AgentNode │  (concurrent)  │
│     │ (actor)   ││(actor)   ││(actor)   │               │
│     └─────┬─────┘└────┬─────┘└────┬─────┘               │
│           │            │           │                     │
│     ┌─────▼────────────▼───────────▼─────┐               │
│     │          SwarmMemory               │               │
│     │  ┌─────────────┐ ┌──────────────┐  │               │
│     │  │ Scratchpad   │ │  Channels    │  │               │
│     │  │ (blackboard) │ │  (messages)  │  │               │
│     │  └─────────────┘ └──────────────┘  │               │
│     └────────────────────────────────────┘               │
│                                                          │
│  ┌───────────────────────────────────────────────────┐   │
│  │                    Adapters                        │   │
│  │  Provider │ Persistence │ Context │ Memory │ ...   │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

## Module Structure

```
@swarmengine/core
├── src/
│   ├── engine.ts              — SwarmEngine class: main entry point
│   ├── index.ts               — Public API exports
│   ├── types.ts               — All TypeScript type definitions
│   ├── dag/
│   │   ├── builder.ts         — Fluent API to construct DAGs
│   │   ├── graph.ts           — DAG data structure (nodes, edges, conditions)
│   │   ├── executor.ts        — Walks graph, manages concurrency, branching, loops
│   │   ├── scheduler.ts       — Determines ready nodes, respects maxConcurrentAgents
│   │   └── validator.ts       — Pre-execution validation
│   ├── agent/
│   │   ├── runner.ts          — Single agent execution: context → LLM → streaming
│   │   ├── node.ts            — AgentNode: actor wrapper (inbox, outbox, state)
│   │   └── evaluator.ts       — Output evaluation for conditional routing
│   ├── memory/
│   │   ├── scratchpad.ts      — Shared key-value store (size-bounded)
│   │   ├── channels.ts        — Agent-to-agent message channels
│   │   └── index.ts           — SwarmMemory facade
│   ├── context/
│   │   ├── assembler.ts       — Context assembly pipeline
│   │   └── budget.ts          — Token budget manager
│   ├── streaming/
│   │   ├── events.ts          — Event type definitions
│   │   └── emitter.ts         — Async iterable event emitter
│   ├── cost/
│   │   └── tracker.ts         — Token usage & cost attribution + budget enforcement
│   ├── adapters/
│   │   ├── defaults.ts        — In-memory & noop adapter implementations
│   │   └── providers/         — LLM provider adapters (Anthropic, OpenAI, Ollama)
│   └── errors/
│       └── classification.ts  — Error types and classification logic
└── tests/                     — Unit + integration tests (vitest)
```

## Execution Patterns

All five patterns are DAG configurations executed by the same DAGExecutor.

### 1. Sequential Pipeline

```
A → B → C → Done
```

Output from A is available to B via the output store.

### 2. Parallel Fan-Out / Fan-In

```
        ┌→ B ─┐
A ──────┤     ├──→ D
        └→ C ─┘
```

Scheduler runs B and C concurrently (up to `maxConcurrentAgents`). D waits for all upstream dependencies.

### 3. Conditional Routing

```
A (review) → pass? → B (next stage)
                │
                └→ fail? → C (fix)
```

Three evaluator tiers, cheapest first:
1. **Rule function** — `(output) => string` — instant, free
2. **Regex match** — pattern → target mapping — instant, free
3. **LLM evaluator** — cheapest model, tight max_tokens — ~1s

### 4. Iterative Refinement Loop

```
A (draft) ⇄ B (review)  — max N cycles
```

Cycle edges with `maxCycles` limit. When limit reached, force-proceed to next non-cycle edge.

### 5. Dynamic Planning

```
Coordinator → analyzes task → emits DAG definition → engine executes it
```

Coordinator agent outputs a JSON DAG structure that gets validated and merged into the execution graph at runtime.

## DAG Executor Loop

```
1. VALIDATE — orphans, cycle limits, budget estimate, provider availability
2. SCHEDULE — find nodes with all dependencies met, respect concurrency cap
3. EXECUTE  — assemble context → LLM stream → handle tool calls → record cost
4. ROUTE    — standard edges, conditional evaluators, cycle checks, dynamic expansion
5. TERMINATE — swarm_done | budget_error | cancelled | deadlock | timeout
```

## Context Assembly

When an agent runs, the ContextAssembler builds its context in priority order:

```
1.  Persona identity         (never truncated)
2.  Org context
3.  Entity context
4.  Knowledge context         (trimmed first when near budget)
5.  Codebase context          (trimmed first when near budget)
6.  Existing artifacts        (trimmed first when near budget)
7.  Previous step outputs
8.  Inbox messages
9.  Scratchpad snapshot
10. Thread history
11. Task message              (never truncated)
```

## Adapter Interfaces

Seven pluggable boundaries. All optional except ProviderAdapter (which ships with built-in implementations).

| Adapter | Purpose | Default |
|---------|---------|---------|
| `ProviderAdapter` | LLM streaming | Anthropic, OpenAI, Ollama built-in |
| `PersistenceAdapter` | Run/artifact/thread storage | In-memory (100 run LRU) |
| `ContextProvider` | Entity context retrieval | Noop |
| `MemoryProvider` | Semantic search & storage | Noop |
| `CodebaseProvider` | Code querying (tiered) | Noop |
| `PersonaProvider` | Agent persona retrieval | Falls back to systemPrompt |
| `LifecycleHooks` | Execution callbacks | Noop |

## SwarmMemory

Two complementary systems that live for the duration of a swarm run:

**Scratchpad (Blackboard):** Bounded key-value store. Default 10KB/key, 100KB/swarm. History tracked for observability.

**Channels:** Agent-to-agent messaging. Point-to-point (`send`) or broadcast. Messages available via `getInbox(agentId)`.

## Cost Tracking

- All costs stored as integer cents (no floating point)
- Every LLM call attributed to specific agent + node (including evaluator calls)
- Budget check before each agent execution — circuit breaker prevents overspend
- `budget_warning` at 80%, `budget_exceeded` stops the swarm

## Streaming Events

15 event types across 4 categories:

| Category | Events |
|----------|--------|
| Agent | `agent_start`, `agent_chunk`, `agent_tool_use`, `agent_done`, `agent_error` |
| Swarm | `swarm_start`, `swarm_progress`, `swarm_done`, `swarm_error`, `swarm_cancelled` |
| Routing | `route_decision`, `loop_iteration` |
| Budget | `budget_warning`, `budget_exceeded` |

All events carry `nodeId` for correlation. Consumer wraps in SSE, WebSocket, or whatever transport they need.

## Memory Efficiency

| Decision | Impact |
|----------|--------|
| Adapters are lazy-initialized | Zero memory until first call |
| Provider events stream through, not buffered | Only final output string stored per node |
| In-memory persistence caps at 100 runs (LRU) | Bounded memory growth |
| Scratchpad size-limited | No unbounded state accumulation |
| `maxConcurrentAgents` controls parallelism | 1 = minimal memory, 10 = aggressive |
| Context budget truncates low-priority items | Never exceeds model window |
| Evaluators try cheapest tier first | Avoids unnecessary LLM calls |

## Error Classification

```
timeout | rate_limit | auth_error | network_error | content_filter | budget_exceeded | unknown
```

Consumer uses error type to decide recovery: retry with backoff, surface to user, or stop swarm.
