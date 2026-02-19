# SwarmEngine — Design Document

> **Date:** 2026-02-18
> **Status:** Approved
> **Language:** TypeScript (Node.js)
> **Package:** `@swarmengine/core`
> **Architecture:** DAG Engine + Actor-Style Agent Nodes

---

## 1. Overview

SwarmEngine is a standalone TypeScript library for multi-agent task orchestration. It takes a directed acyclic graph (DAG) of agents with personas, executes them with managed concurrency, and streams structured events back to the consumer.

**What makes it different from existing frameworks:**

- **Topology-agnostic** — Sequential, parallel, conditional, loops, and dynamic planning are all DAG configurations, not separate executors
- **Actor-style agents within a DAG** — Agents have inboxes, outboxes, and local state while the DAG controls execution order
- **First-class cost tracking** — Per-agent, per-node, per-swarm cost attribution in integer cents with budget enforcement
- **Bounded memory** — Configurable concurrency limits, size-limited scratchpad, streaming without buffering
- **Pluggable everything** — 7 adapter interfaces with sensible defaults; works standalone or embedded in larger systems

**Primary consumer:** HiveBuild (Next.js/TypeScript). Replaces `engine.ts`, `swarm.ts`, `context.ts` in `src/lib/agents/`.

---

## 2. Architecture

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

---

## 3. Module Structure

```
@swarmengine/core
├── src/
│   ├── engine.ts              — SwarmEngine class: main entry point
│   ├── dag/
│   │   ├── builder.ts         — Fluent API to construct execution graphs
│   │   ├── graph.ts           — DAG data structure (nodes, edges, conditions)
│   │   ├── executor.ts        — Walks graph, manages concurrency, branching, loops
│   │   ├── scheduler.ts       — Determines ready nodes, respects maxConcurrentAgents
│   │   └── validator.ts       — Pre-execution validation (orphans, cycle limits, budgets)
│   ├── agent/
│   │   ├── runner.ts          — Single agent execution: context → LLM → streaming
│   │   ├── node.ts            — AgentNode: actor wrapper (inbox, outbox, persona, state)
│   │   └── evaluator.ts       — Output evaluation for conditional routing
│   ├── memory/
│   │   ├── scratchpad.ts      — Shared key-value store (size-bounded)
│   │   ├── channels.ts        — Agent-to-agent message channels
│   │   └── index.ts           — SwarmMemory facade
│   ├── context/
│   │   ├── assembler.ts       — Context assembly pipeline (9 stages)
│   │   ├── budget.ts          — Token budget manager (model-aware truncation)
│   │   └── providers.ts       — ContextProvider, MemoryProvider, etc. interfaces
│   ├── streaming/
│   │   ├── events.ts          — Event type definitions
│   │   └── emitter.ts         — Async iterable event emitter
│   ├── cost/
│   │   └── tracker.ts         — Cost/token attribution + budget enforcement
│   ├── adapters/
│   │   ├── provider.ts        — ProviderAdapter interface + built-ins
│   │   ├── persistence.ts     — PersistenceAdapter interface + in-memory default
│   │   └── lifecycle.ts       — LifecycleHooks interface
│   ├── errors/
│   │   └── classification.ts  — Error types and classification logic
│   └── index.ts               — Public API exports
├── package.json
├── tsconfig.json
└── tests/
```

---

## 4. API Design

### 4.1 Engine Initialization

```typescript
import { SwarmEngine } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
    openai: { type: 'openai', apiKey: process.env.OPENAI_API_KEY },
  },
  defaults: {
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    temperature: 0.7,
    maxTokens: 4096,
  },
  limits: {
    maxSwarmBudgetCents: 500,
    maxPerAgentBudgetCents: 100,
    maxConcurrentAgents: 3,
    maxSwarmDurationMs: 600_000,
    maxScratchpadSizeBytes: 102_400,
    maxCycleIterations: 3,
  },
  logging: { level: 'info', structured: true },
  // Optional adapters — all default to in-memory/noop
  // persistence, context, memory, codebase, persona, lifecycle
});
```

### 4.2 DAG Construction (Fluent API)

**Sequential pipeline:**

```typescript
const dag = engine.dag()
  .agent('pm', { role: 'pm', persona: pmPersona })
  .agent('architect', { role: 'architect', persona: archPersona })
  .agent('qa', { role: 'qa', persona: qaPersona })
  .edge('pm', 'architect')
  .edge('architect', 'qa');
```

**Parallel fan-out / fan-in:**

```typescript
const dag = engine.dag()
  .agent('pm', pmConfig)
  .agent('architect', archConfig)
  .agent('ux', uxConfig)
  .agent('qa', qaConfig)
  .agent('manager', managerConfig)
  .edge('pm', 'architect')
  .edge('pm', 'ux')
  .edge('pm', 'qa')
  .edge('architect', 'manager')
  .edge('ux', 'manager')
  .edge('qa', 'manager');
```

**Conditional routing:**

```typescript
const dag = engine.dag()
  .agent('drafter', drafterConfig)
  .agent('reviewer', reviewerConfig)
  .agent('fixer', fixerConfig)
  .agent('next', nextConfig)
  .edge('drafter', 'reviewer')
  .conditionalEdge('reviewer', {
    evaluate: (output) => output.includes('APPROVED') ? 'next' : 'fixer',
    targets: { next: 'next', fixer: 'fixer' },
  })
  .edge('fixer', 'reviewer', { maxCycles: 3 });
```

**Dynamic planning:**

```typescript
const dag = engine.dag()
  .agent('coordinator', { ...coordinatorConfig, canEmitDAG: true })
  .dynamicExpansion('coordinator');
```

### 4.3 Execution

```typescript
const result = engine.run({
  dag,
  task: 'Design a user authentication system',
  signal: abortController.signal,  // Optional cancellation
  threadId: 'thread-123',          // Optional conversation context
  entityType: 'product',           // Optional entity context
  entityId: 'prod-456',
});

// Stream events (async iterable)
for await (const event of result) {
  // { type: 'agent_start', nodeId: 'pm', agentRole: 'pm', ... }
  // { type: 'agent_chunk', nodeId: 'pm', content: 'The PRD for...' }
  // { type: 'agent_done', nodeId: 'pm', cost: { costCents: 12, ... } }
  // { type: 'swarm_done', totalCost: { costCents: 47, ... } }
}
```

---

## 5. Execution Patterns

All five patterns are DAG configurations executed by the same DAGExecutor.

### 5.1 Sequential Pipeline

```
A → B → C → Done
```

Output from A is available to B via the DAG's output store. Typed outputs, not truncated strings.

### 5.2 Parallel Fan-Out / Fan-In

```
        ┌→ B ─┐
A (plan)┤     ├→ D (synthesize)
        └→ C ─┘
```

Scheduler runs B and C concurrently (up to `maxConcurrentAgents`). D waits for all upstream dependencies. All outputs available to D.

### 5.3 Conditional Routing

```
A (review) → pass? → B (next stage)
                │
                └→ fail? → C (fix) → back to A
```

Evaluator determines next node. Three evaluator tiers, cheapest first:
1. **Rule function** — `(output) => string` — ~0ms, $0
2. **Regex match** — pattern → target mapping — ~0ms, $0
3. **LLM evaluator** — cheapest available model, tight max_tokens (100) — ~1s, ~$0.01

### 5.4 Iterative Refinement Loop

```
A (draft) → B (review) → issues? → A (revise) → B (re-review) → ...
```

Cycle edges with `maxCycles` limit. When limit reached, force-proceed to next non-cycle edge. Loop iteration count exposed in events.

### 5.5 Dynamic Planning

```
Coordinator → analyzes task → emits DAG definition → engine executes it
```

Coordinator agent has `canEmitDAG: true`. Its output is parsed as a DAG definition (JSON schema) and merged into the execution graph. The engine validates the emitted DAG before executing.

---

## 6. AgentNode — Actor-Style Agent Wrapper

Each agent in the DAG is wrapped in an AgentNode with actor-like capabilities.

```typescript
interface AgentNode {
  // Identity
  id: string;
  name: string;
  role: string;
  persona: PersonaConfig | null;

  // Actor primitives
  inbox: Message[];
  outbox: Message[];
  localState: Map<string, unknown>;

  // Swarm-level access
  memory: SwarmMemory;

  // Execution config
  model: string;
  providerId: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}
```

### 6.1 Context Assembly Order

When an agent runs, the ContextAssembler builds its full context in priority order:

```
1. Persona identity        → from PersonaProvider (or raw systemPrompt fallback)
2. Org context              → from ContextProvider
3. Entity context           → from ContextProvider
4. Knowledge context        → from MemoryProvider (hybrid search)
5. Codebase context         → from CodebaseProvider (tiered: mini/standard/full)
6. Existing artifacts       → from ContextProvider
7. Previous step outputs    → from DAG output store (upstream nodes)
8. Inbox messages           → from SwarmMemory channels
9. Scratchpad snapshot      → from SwarmMemory scratchpad (relevant keys)
10. Thread history          → from PersistenceAdapter
11. Task message            → the specific instruction for this step
```

Priority-based truncation: items 1 and 11 are never truncated. Items 4-6 are trimmed first when approaching the model's context window.

### 6.2 Agent Communication via Tool Use

Agents communicate using LLM tool calls (not text parsing):

```typescript
tools: [
  { name: 'send_message', params: { to: 'agent_id', content: 'string' } },
  { name: 'scratchpad_set', params: { key: 'string', value: 'any' } },
  { name: 'scratchpad_read', params: { key: 'string' } },
  { name: 'scratchpad_append', params: { key: 'string', value: 'any' } },
]
```

Tool calls are intercepted by the engine, executed against SwarmMemory, and the results returned to the agent. The LLM's text output (without tool calls) becomes the node's output and potential artifact content.

---

## 7. SwarmMemory — Scratchpad + Message Channels

Two complementary systems that live for the duration of a swarm run.

### 7.1 Scratchpad (Blackboard)

```typescript
interface Scratchpad {
  set(key: string, value: unknown, agentId: string): void;
  get<T>(key: string): T | undefined;
  append(key: string, value: unknown, agentId: string): void;
  getList<T>(key: string): T[];
  keys(): string[];
  toContext(): string;
  getHistory(key: string): ScratchpadEntry[];
}
```

**Bounds:**
- Default 10KB per key, 100KB total per swarm (configurable)
- `toContext()` is budget-aware: summarizes older entries, keeps recent verbatim
- History tracked for observability (who wrote what, when)

### 7.2 Message Channels

```typescript
interface Channels {
  send(from: string, to: string, content: string, metadata?: Record<string, unknown>): void;
  broadcast(from: string, content: string, metadata?: Record<string, unknown>): void;
  getInbox(agentId: string): ChannelMessage[];
  getConversation(agentA: string, agentB: string): ChannelMessage[];
}
```

### 7.3 Lifecycle

- Created fresh when a swarm starts
- Lives in-memory during execution
- On swarm completion: optionally persisted via PersistenceAdapter or flushed to MemoryProvider for cross-swarm learning
- Scratchpad history included in observability data

---

## 8. DAG Executor

### 8.1 Execution Loop

```
1. VALIDATE
   - No orphan nodes
   - Cycles have maxCycles limit
   - Budget estimate fits swarm budget
   - All referenced providers available

2. SCHEDULE
   - Find nodes with all dependencies satisfied
   - Respect maxConcurrentAgents limit
   - Queue excess ready nodes

3. EXECUTE (per node, concurrent where possible)
   a. Assemble context (ContextAssembler + token budget)
   b. Run agent (AgentRunner → ProviderAdapter → LLM stream)
   c. Handle tool calls (scratchpad, messages)
   d. Post-process: cost recording, message routing, artifact request, events

4. ROUTE
   - Standard edges: mark downstream as unblocked
   - Conditional edges: run evaluator (rule → regex → LLM, cheapest first)
   - Cycle edges: check iteration < maxCycles, else force-proceed
   - Dynamic expansion: parse coordinator output as DAG, merge into graph

5. TERMINATE
   - All nodes completed → swarm_done
   - Budget exceeded → budget_error, stop
   - Abort signal → cancelled, save partial state
   - No ready nodes + incomplete nodes → deadlock error
   - Duration exceeded → timeout, save partial state
```

### 8.2 Concurrency Model

Nodes with all dependencies met run via `Promise.allSettled`, capped by `maxConcurrentAgents`. Each node streams independently — events are interleaved with nodeId tags.

```
maxConcurrentAgents: 1  → sequential, minimal memory (~1 stream buffer)
maxConcurrentAgents: 3  → modest parallelism (~3 stream buffers)
maxConcurrentAgents: 10 → aggressive parallelism for powerful machines
```

### 8.3 Cancellation

Consumer passes `AbortSignal`. On abort:
1. Stop all in-flight LLM streams
2. Save partial outputs for completed nodes
3. Record partial cost
4. Yield `swarm_cancelled` event with completed nodes and partial cost

---

## 9. Streaming Events

All execution patterns emit the same event types through an async iterable.

```typescript
type SwarmEvent =
  // Agent-level
  | { type: 'agent_start'; nodeId: string; agentRole: string; agentName: string }
  | { type: 'agent_chunk'; nodeId: string; agentRole: string; content: string }
  | { type: 'agent_tool_use'; nodeId: string; tool: string; input: Record<string, unknown> }
  | { type: 'agent_done'; nodeId: string; agentRole: string; artifactRequest?: ArtifactRequest; cost: CostSummary }
  | { type: 'agent_error'; nodeId: string; agentRole: string; message: string; errorType: AgentErrorType }

  // Swarm-level
  | { type: 'swarm_start'; dagId: string; nodeCount: number; estimatedCost?: number }
  | { type: 'swarm_progress'; completed: number; total: number; runningNodes: string[] }
  | { type: 'swarm_done'; results: NodeResult[]; totalCost: CostSummary }
  | { type: 'swarm_error'; message: string; completedNodes: string[]; partialCost: CostSummary }
  | { type: 'swarm_cancelled'; completedNodes: string[]; partialCost: CostSummary }

  // Routing
  | { type: 'route_decision'; fromNode: string; toNode: string; reason: string }
  | { type: 'loop_iteration'; nodeId: string; iteration: number; maxIterations: number }

  // Budget
  | { type: 'budget_warning'; used: number; limit: number; percentUsed: number }
  | { type: 'budget_exceeded'; used: number; limit: number };
```

Consumer wraps in SSE, WebSocket, or whatever transport they use. The engine does not handle HTTP.

---

## 10. Adapter Interfaces

Seven pluggable boundaries. All optional except ProviderAdapter (which ships with built-in implementations).

### 10.1 ProviderAdapter (required — built-ins provided)

```typescript
interface ProviderAdapter {
  stream(params: StreamParams): AsyncGenerator<ProviderEvent>;
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
  getModelLimits(model: string): { contextWindow: number; maxOutput: number };
}
```

Built-in implementations: Anthropic, OpenAI, Google AI, Ollama.

### 10.2 PersistenceAdapter (optional — in-memory default)

```typescript
interface PersistenceAdapter {
  createRun(params: CreateRunParams): Promise<string>;
  updateRun(runId: string, updates: Partial<RunRecord>): Promise<void>;
  createArtifact(params: ArtifactRequest): Promise<string>;
  loadThreadHistory(threadId: string): Promise<Message[]>;
  logActivity(params: ActivityParams): Promise<void>;
}
```

In-memory default caps at 100 stored runs (LRU eviction).

### 10.3 ContextProvider (optional — noop default)

```typescript
interface ContextProvider {
  getContext(entityType: string, entityId: string): Promise<string>;
}
```

### 10.4 MemoryProvider (optional — noop default)

```typescript
interface MemoryProvider {
  search(query: string, k?: number): Promise<MemoryResult[]>;
  store(text: string, metadata?: Record<string, unknown>): Promise<void>;
}
```

### 10.5 CodebaseProvider (optional — noop default)

```typescript
interface CodebaseProvider {
  query(repoId: string, query: string, tier: 'mini' | 'standard' | 'full'): Promise<string>;
}
```

### 10.6 PersonaProvider (optional — falls back to raw systemPrompt)

```typescript
interface PersonaProvider {
  getPersona(role: string): Promise<PersonaConfig | null>;
}
```

### 10.7 LifecycleHooks (optional — noop default)

```typescript
interface LifecycleHooks {
  onRunStart?(runId: string, agentId: string): void | Promise<void>;
  onRunComplete?(runId: string, agentId: string, output: string, artifact?: ArtifactRequest): void | Promise<void>;
  onRunFailed?(runId: string, agentId: string, error: string, errorType: AgentErrorType): void | Promise<void>;
  onSwarmComplete?(swarmId: string, results: NodeResult[]): void | Promise<void>;
}
```

---

## 11. Cost Tracking

### 11.1 CostTracker

```typescript
interface CostTracker {
  swarmBudget: number | null;
  perAgentBudget: number | null;

  recordUsage(agentId: string, nodeId: string, usage: TokenUsage): void;
  getSwarmTotal(): CostSummary;
  getPerAgent(): Map<string, CostSummary>;
  getPerNode(): Map<string, CostSummary>;
  checkBudget(): { ok: boolean; remaining: number; used: number };
}

interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;    // Integer cents — no floating point
  calls: number;
}
```

### 11.2 Cost Efficiency Decisions

- All costs stored as integer cents (avoids floating point issues)
- Every LLM call attributed to specific agent + node (including evaluator calls)
- Budget check runs before each agent execution — circuit breaker stops the swarm before overspend
- `swarm_start` event includes `estimatedCost` (pre-flight estimate based on context sizes and model pricing)
- `budget_warning` event emitted at 80% of budget

---

## 12. Error Classification

```typescript
type AgentErrorType =
  | 'timeout'
  | 'rate_limit'
  | 'auth_error'
  | 'network_error'
  | 'content_filter'
  | 'budget_exceeded'
  | 'unknown';
```

Consumer uses error type to decide recovery strategy:
- `rate_limit` → retry with exponential backoff (engine handles internally, configurable)
- `auth_error` → surface to user
- `timeout` → configurable: retry once or fail
- `budget_exceeded` → stop swarm, emit partial results
- `content_filter` → log and skip or fail (configurable)
- `network_error` → retry with backoff

---

## 13. Memory Efficiency

Design decisions for low-memory operation:

| Decision | Impact |
|----------|--------|
| Adapters are lazy-initialized | Zero memory until first call |
| Provider events stream through, not buffered | Only final output string stored per node |
| In-memory persistence caps at 100 runs (LRU) | Bounded memory growth |
| Scratchpad size-limited (10KB/key, 100KB/swarm) | No unbounded state accumulation |
| `maxConcurrentAgents` controls parallelism | 1 = minimal memory, 10 = aggressive |
| Context budget truncates low-priority items | Never exceeds model window regardless of inputs |
| Evaluators try cheapest tier first (rule → regex → LLM) | Avoids unnecessary LLM calls for routing |

---

## 14. Engine Configuration

```typescript
interface SwarmEngineConfig {
  providers: Record<string, ProviderConfig>;

  persistence?: PersistenceAdapter;
  context?: ContextProvider;
  memory?: MemoryProvider;
  codebase?: CodebaseProvider;
  persona?: PersonaProvider;
  lifecycle?: LifecycleHooks;

  defaults?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    provider?: string;
  };

  limits?: {
    maxSwarmBudgetCents?: number;
    maxPerAgentBudgetCents?: number;
    maxConcurrentAgents?: number;         // Default: 5
    maxSwarmDurationMs?: number;          // Default: 300_000
    maxScratchpadSizeBytes?: number;      // Default: 102_400
    maxCycleIterations?: number;          // Default: 3
  };

  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
    structured?: boolean;
  };
}
```

---

## 15. Artifact System

The engine emits artifact creation requests; it does not persist artifacts directly.

```typescript
interface ArtifactRequest {
  type: string;                  // 'prd', 'tech_spec', 'custom', etc.
  title: string;
  content: string;
  entityType?: string;
  entityId?: string;
  parentArtifactId?: string;     // For refinement/versioning
  metadata?: Record<string, unknown>;
}
```

Auto-creation threshold: agent output > 500 chars triggers an artifact request. Consumers decide how to persist via PersistenceAdapter.

---

## 16. HiveBuild Integration Path

### Phase 1: Drop-In Replacement
- `executeAgent()` → `engine.run()` with single-node DAG
- `executeSwarm()` → `engine.run()` with sequential DAG + output chaining
- `executeGeneralSwarm()` → `engine.run()` with sequential DAG + typed outputs
- Zero behavior change, new internals

### Phase 2: Enhanced Orchestration
- Parallel fan-out/fan-in for pipeline stages
- Conditional routing for QA review loops
- SwarmMemory for structured context sharing between agents

### Phase 3: External Context
- Wire MemoryProvider to Memories API (:8900)
- Wire CodebaseProvider to Carto API (:8950)
- Wire PersonaProvider to PersonaSmith
- Context assembly pipeline pulls from all sources

### Phase 4: Dynamic Planning
- Coordinator agent generates execution DAGs
- User gives high-level goal → coordinator analyzes state → emits plan → engine executes

---

## 17. Success Criteria

1. **Drop-in compatible** — Can replace HiveBuild's `executeAgent()` and `executeSwarm()` with zero behavior change
2. **All 5 patterns** — Sequential, parallel, conditional, loops, dynamic planning all work
3. **Stream-native** — All execution emits async iterable events
4. **Cost-tracked** — Per-agent, per-node, per-swarm attribution with budget enforcement
5. **Memory-bounded** — Runs on constrained machines with `maxConcurrentAgents: 1`
6. **Pluggable** — All 7 adapters are swappable interfaces with working defaults
7. **Cancellable** — Graceful abort with partial output preservation
8. **Observable** — Structured events with timing, cost, and routing data per step
9. **Standalone** — Works as `npm install @swarmengine/core` with zero external dependencies beyond LLM SDKs
