# SwarmEngine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone TypeScript library for multi-agent DAG-based task orchestration with actor-style agents, cost tracking, and pluggable adapters.

**Architecture:** DAG engine where all execution patterns (sequential, parallel, conditional, loops, dynamic) are graph configurations. Agent nodes have actor-like capabilities (inbox, outbox, scratchpad). 7 pluggable adapter interfaces with in-memory defaults.

**Tech Stack:** TypeScript, Node.js, Vitest (testing), tsup (bundling), no external dependencies beyond LLM SDKs (anthropic, openai, @google/generative-ai)

---

## Build Order

Tasks build bottom-up. Each task is independently testable and committable.

```
Task 1:  Project scaffold + types
Task 2:  Event system (streaming)
Task 3:  Error classification
Task 4:  Cost tracker
Task 5:  SwarmMemory (scratchpad + channels)
Task 6:  Adapter interfaces + in-memory defaults
Task 7:  Provider adapters (Anthropic + OpenAI built-ins)
Task 8:  Context assembler + token budget
Task 9:  AgentNode + AgentRunner (single agent execution)
Task 10: DAG data structure + builder (fluent API)
Task 11: DAG validator
Task 12: Scheduler
Task 13: DAG executor (sequential + parallel)
Task 14: Conditional routing + evaluators
Task 15: Cycle/loop support
Task 16: Dynamic planning (coordinator emits DAG)
Task 17: SwarmEngine class (main entry point)
Task 18: Integration tests (all 5 patterns end-to-end)
Task 19: Public API exports + package config
```

---

### Task 1: Project Scaffold + Types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`
- Create: `src/index.ts` (empty, placeholder)

**Step 1: Initialize project**

```bash
cd /Users/dk/projects/SwarmEngine
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install typescript vitest tsup @types/node --save-dev
```

**Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

**Step 5: Create `src/types.ts`** with all shared types

This is the foundational types file. All interfaces from the design doc go here:

```typescript
// --- Agent Types ---

export interface AgentDescriptor {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  providerId?: string;
  persona?: PersonaConfig;
}

export interface PersonaConfig {
  name: string;
  role: string;
  traits: string[];
  constraints: string[];
  communicationStyle?: string;
  expertise?: string[];
}

// --- Message Types ---

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// --- Cost Types ---

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  calls: number;
}

// --- Event Types ---

export type SwarmEvent =
  | { type: 'agent_start'; nodeId: string; agentRole: string; agentName: string }
  | { type: 'agent_chunk'; nodeId: string; agentRole: string; content: string }
  | { type: 'agent_tool_use'; nodeId: string; tool: string; input: Record<string, unknown> }
  | { type: 'agent_done'; nodeId: string; agentRole: string; output: string; artifactRequest?: ArtifactRequest; cost: CostSummary }
  | { type: 'agent_error'; nodeId: string; agentRole: string; message: string; errorType: AgentErrorType }
  | { type: 'swarm_start'; dagId: string; nodeCount: number; estimatedCost?: number }
  | { type: 'swarm_progress'; completed: number; total: number; runningNodes: string[] }
  | { type: 'swarm_done'; results: NodeResult[]; totalCost: CostSummary }
  | { type: 'swarm_error'; message: string; completedNodes: string[]; partialCost: CostSummary }
  | { type: 'swarm_cancelled'; completedNodes: string[]; partialCost: CostSummary }
  | { type: 'route_decision'; fromNode: string; toNode: string; reason: string }
  | { type: 'loop_iteration'; nodeId: string; iteration: number; maxIterations: number }
  | { type: 'budget_warning'; used: number; limit: number; percentUsed: number }
  | { type: 'budget_exceeded'; used: number; limit: number };

export type AgentErrorType =
  | 'timeout'
  | 'rate_limit'
  | 'auth_error'
  | 'network_error'
  | 'content_filter'
  | 'budget_exceeded'
  | 'unknown';

// --- Node/Result Types ---

export interface NodeResult {
  nodeId: string;
  agentRole: string;
  output: string;
  artifactRequest?: ArtifactRequest;
  cost: CostSummary;
  durationMs: number;
}

export type NodeStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';

// --- Artifact Types ---

export interface ArtifactRequest {
  type: string;
  title: string;
  content: string;
  entityType?: string;
  entityId?: string;
  parentArtifactId?: string;
  metadata?: Record<string, unknown>;
}

// --- DAG Types ---

export interface DAGNode {
  id: string;
  agent: AgentDescriptor;
  task?: string;
  canEmitDAG?: boolean;
}

export interface DAGEdge {
  from: string;
  to: string;
  maxCycles?: number;
}

export interface ConditionalEdge {
  from: string;
  evaluate: Evaluator;
  targets: Record<string, string>;
}

export type Evaluator =
  | { type: 'rule'; fn: (output: string) => string }
  | { type: 'regex'; pattern: string; matchTarget: string; elseTarget: string }
  | { type: 'llm'; prompt: string; model?: string; providerId?: string };

// --- Provider Types ---

export type ProviderEvent =
  | { type: 'chunk'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result_needed'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

export interface StreamParams {
  model: string;
  messages: Message[];
  temperature: number;
  maxTokens: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

// --- Config Types ---

export interface SwarmEngineConfig {
  providers: Record<string, ProviderConfig>;
  persistence?: PersistenceAdapter;
  context?: ContextProvider;
  memory?: MemoryProvider;
  codebase?: CodebaseProvider;
  persona?: PersonaProvider;
  lifecycle?: LifecycleHooks;
  defaults?: EngineDefaults;
  limits?: EngineLimits;
  logging?: LoggingConfig;
}

export interface EngineDefaults {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  provider?: string;
}

export interface EngineLimits {
  maxSwarmBudgetCents?: number;
  maxPerAgentBudgetCents?: number;
  maxConcurrentAgents?: number;
  maxSwarmDurationMs?: number;
  maxScratchpadSizeBytes?: number;
  maxCycleIterations?: number;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  structured?: boolean;
}

export interface ProviderConfig {
  type: 'anthropic' | 'openai' | 'google' | 'ollama' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  adapter?: ProviderAdapter;
}

// --- Adapter Interfaces ---

export interface ProviderAdapter {
  stream(params: StreamParams): AsyncGenerator<ProviderEvent>;
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
  getModelLimits(model: string): { contextWindow: number; maxOutput: number };
}

export interface PersistenceAdapter {
  createRun(params: CreateRunParams): Promise<string>;
  updateRun(runId: string, updates: Record<string, unknown>): Promise<void>;
  createArtifact(params: ArtifactRequest): Promise<string>;
  loadThreadHistory(threadId: string): Promise<Message[]>;
  logActivity(params: ActivityParams): Promise<void>;
}

export interface ContextProvider {
  getContext(entityType: string, entityId: string): Promise<string>;
}

export interface MemoryProvider {
  search(query: string, k?: number): Promise<MemoryResult[]>;
  store(text: string, metadata?: Record<string, unknown>): Promise<void>;
}

export interface CodebaseProvider {
  query(repoId: string, query: string, tier: 'mini' | 'standard' | 'full'): Promise<string>;
}

export interface PersonaProvider {
  getPersona(role: string): Promise<PersonaConfig | null>;
}

export interface LifecycleHooks {
  onRunStart?(runId: string, agentId: string): void | Promise<void>;
  onRunComplete?(runId: string, agentId: string, output: string, artifact?: ArtifactRequest): void | Promise<void>;
  onRunFailed?(runId: string, agentId: string, error: string, errorType: AgentErrorType): void | Promise<void>;
  onSwarmComplete?(swarmId: string, results: NodeResult[]): void | Promise<void>;
}

// --- Supporting Types ---

export interface CreateRunParams {
  agentId: string;
  agentRole: string;
  swarmId?: string;
  nodeId?: string;
  task: string;
}

export interface ActivityParams {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryResult {
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// --- Execution Types ---

export interface RunOptions {
  dag: DAGDefinition;
  task: string;
  signal?: AbortSignal;
  threadId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface DAGDefinition {
  id: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
  conditionalEdges: ConditionalEdge[];
  dynamicNodes: string[];
}

// --- Scratchpad Types ---

export interface ScratchpadEntry {
  key: string;
  value: unknown;
  writtenBy: string;
  timestamp: number;
  operation: 'set' | 'append';
}

export interface ChannelMessage {
  from: string;
  to: string | '*';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
```

**Step 6: Create empty `src/index.ts`**

```typescript
export * from './types.js';
```

**Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/types.ts src/index.ts
git commit -m "feat: project scaffold with foundational types"
```

---

### Task 2: Event System (Streaming)

**Files:**
- Create: `src/streaming/events.ts`
- Create: `src/streaming/emitter.ts`
- Create: `tests/streaming/emitter.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/streaming/emitter.test.ts
import { describe, it, expect } from 'vitest';
import { SwarmEventEmitter } from '../../src/streaming/emitter.js';
import type { SwarmEvent } from '../../src/types.js';

describe('SwarmEventEmitter', () => {
  it('emits events and allows async iteration', async () => {
    const emitter = new SwarmEventEmitter();
    const collected: SwarmEvent[] = [];

    const consumePromise = (async () => {
      for await (const event of emitter) {
        collected.push(event);
      }
    })();

    emitter.emit({ type: 'swarm_start', dagId: 'test', nodeCount: 2 });
    emitter.emit({ type: 'agent_start', nodeId: 'a', agentRole: 'pm', agentName: 'PM' });
    emitter.close();

    await consumePromise;
    expect(collected).toHaveLength(2);
    expect(collected[0].type).toBe('swarm_start');
    expect(collected[1].type).toBe('agent_start');
  });

  it('handles backpressure by buffering events', async () => {
    const emitter = new SwarmEventEmitter();

    // Emit before consuming
    emitter.emit({ type: 'swarm_start', dagId: 'test', nodeCount: 1 });
    emitter.emit({ type: 'swarm_done', results: [], totalCost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 } });
    emitter.close();

    const collected: SwarmEvent[] = [];
    for await (const event of emitter) {
      collected.push(event);
    }
    expect(collected).toHaveLength(2);
  });

  it('propagates errors', async () => {
    const emitter = new SwarmEventEmitter();

    emitter.error(new Error('test error'));

    await expect(async () => {
      for await (const _event of emitter) {
        // Should throw
      }
    }).rejects.toThrow('test error');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/streaming/emitter.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `src/streaming/events.ts`**

```typescript
// Re-export event types from types.ts for convenience
export type { SwarmEvent, AgentErrorType } from '../types.js';
```

**Step 4: Implement `src/streaming/emitter.ts`**

```typescript
import type { SwarmEvent } from '../types.js';

export class SwarmEventEmitter implements AsyncIterable<SwarmEvent> {
  private buffer: SwarmEvent[] = [];
  private resolve: ((value: IteratorResult<SwarmEvent>) => void) | null = null;
  private done = false;
  private err: Error | null = null;

  emit(event: SwarmEvent): void {
    if (this.done) return;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  close(): void {
    this.done = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined as unknown as SwarmEvent, done: true });
    }
  }

  error(err: Error): void {
    this.err = err;
    this.done = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      // We need to reject, so we store and throw in next()
      r({ value: undefined as unknown as SwarmEvent, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SwarmEvent> {
    return {
      next: (): Promise<IteratorResult<SwarmEvent>> => {
        if (this.err) {
          return Promise.reject(this.err);
        }
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as unknown as SwarmEvent, done: true });
        }
        return new Promise((resolve) => {
          this.resolve = resolve;
        });
      },
    };
  }
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/streaming/emitter.test.ts`
Expected: PASS (3 tests)

**Step 6: Commit**

```bash
git add src/streaming/ tests/streaming/
git commit -m "feat: async iterable event emitter for swarm streaming"
```

---

### Task 3: Error Classification

**Files:**
- Create: `src/errors/classification.ts`
- Create: `tests/errors/classification.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/errors/classification.test.ts
import { describe, it, expect } from 'vitest';
import { classifyError, SwarmError } from '../../src/errors/classification.js';

describe('classifyError', () => {
  it('classifies rate limit errors', () => {
    const err = new Error('429 Too Many Requests');
    expect(classifyError(err)).toBe('rate_limit');
  });

  it('classifies auth errors', () => {
    const err = new Error('401 Unauthorized');
    expect(classifyError(err)).toBe('auth_error');
  });

  it('classifies timeout errors', () => {
    const err = new Error('Request timed out');
    err.name = 'AbortError';
    expect(classifyError(err)).toBe('timeout');
  });

  it('classifies network errors', () => {
    const err = new Error('fetch failed');
    err.name = 'TypeError';
    expect(classifyError(err)).toBe('network_error');
  });

  it('classifies content filter errors', () => {
    const err = new Error('content_policy_violation');
    expect(classifyError(err)).toBe('content_filter');
  });

  it('returns unknown for unrecognized errors', () => {
    const err = new Error('something weird');
    expect(classifyError(err)).toBe('unknown');
  });
});

describe('SwarmError', () => {
  it('carries error type and original error', () => {
    const original = new Error('429');
    const swarmErr = new SwarmError('Rate limited', 'rate_limit', original);
    expect(swarmErr.errorType).toBe('rate_limit');
    expect(swarmErr.cause).toBe(original);
    expect(swarmErr.message).toBe('Rate limited');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors/classification.test.ts`
Expected: FAIL

**Step 3: Implement `src/errors/classification.ts`**

```typescript
import type { AgentErrorType } from '../types.js';

export class SwarmError extends Error {
  constructor(
    message: string,
    public readonly errorType: AgentErrorType,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'SwarmError';
  }
}

export function classifyError(err: unknown): AgentErrorType {
  if (!(err instanceof Error)) return 'unknown';

  const msg = err.message.toLowerCase();
  const name = err.name;

  // Rate limiting
  if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('rate limit')) {
    return 'rate_limit';
  }

  // Auth
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid api key') || msg.includes('authentication')) {
    return 'auth_error';
  }

  // Timeout
  if (name === 'AbortError' || msg.includes('timed out') || msg.includes('timeout') || msg.includes('deadline')) {
    return 'timeout';
  }

  // Content filter
  if (msg.includes('content_policy') || msg.includes('content_filter') || msg.includes('safety') || msg.includes('moderation')) {
    return 'content_filter';
  }

  // Network
  if (name === 'TypeError' || msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network')) {
    return 'network_error';
  }

  return 'unknown';
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors/classification.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/errors/ tests/errors/
git commit -m "feat: error classification for LLM provider errors"
```

---

### Task 4: Cost Tracker

**Files:**
- Create: `src/cost/tracker.ts`
- Create: `tests/cost/tracker.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/cost/tracker.test.ts
import { describe, it, expect } from 'vitest';
import { CostTracker } from '../../src/cost/tracker.js';

describe('CostTracker', () => {
  it('records usage and computes totals', () => {
    const tracker = new CostTracker();
    tracker.recordUsage('agent-1', 'node-a', {
      inputTokens: 1000,
      outputTokens: 500,
      model: 'claude-sonnet-4-20250514',
    });

    const total = tracker.getSwarmTotal();
    expect(total.inputTokens).toBe(1000);
    expect(total.outputTokens).toBe(500);
    expect(total.totalTokens).toBe(1500);
    expect(total.calls).toBe(1);
    expect(total.costCents).toBeGreaterThan(0);
  });

  it('tracks per-agent costs', () => {
    const tracker = new CostTracker();
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-20250514' });
    tracker.recordUsage('agent-2', 'node-b', { inputTokens: 200, outputTokens: 100, model: 'claude-sonnet-4-20250514' });

    const perAgent = tracker.getPerAgent();
    expect(perAgent.get('agent-1')!.inputTokens).toBe(100);
    expect(perAgent.get('agent-2')!.inputTokens).toBe(200);
  });

  it('tracks per-node costs', () => {
    const tracker = new CostTracker();
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-20250514' });
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-20250514' });

    const perNode = tracker.getPerNode();
    expect(perNode.get('node-a')!.calls).toBe(2);
    expect(perNode.get('node-a')!.inputTokens).toBe(200);
  });

  it('enforces swarm budget', () => {
    const tracker = new CostTracker(10); // 10 cents max
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100000, outputTokens: 50000, model: 'claude-sonnet-4-20250514' });

    const budget = tracker.checkBudget();
    expect(budget.ok).toBe(false);
  });

  it('returns ok when within budget', () => {
    const tracker = new CostTracker(10000); // $100 max
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-20250514' });

    const budget = tracker.checkBudget();
    expect(budget.ok).toBe(true);
  });

  it('returns ok when no budget set', () => {
    const tracker = new CostTracker();
    tracker.recordUsage('agent-1', 'node-a', { inputTokens: 100000, outputTokens: 50000, model: 'claude-sonnet-4-20250514' });

    const budget = tracker.checkBudget();
    expect(budget.ok).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cost/tracker.test.ts`
Expected: FAIL

**Step 3: Implement `src/cost/tracker.ts`**

```typescript
import type { CostSummary, TokenUsage } from '../types.js';

// Pricing in cents per 1M tokens — kept conservative, updatable
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic (cents per 1M tokens)
  'claude-sonnet-4-20250514': { input: 300, output: 1500 },
  'claude-opus-4-20250514': { input: 1500, output: 7500 },
  'claude-haiku-3-5-20241022': { input: 80, output: 400 },
  // OpenAI
  'gpt-4o': { input: 250, output: 1000 },
  'gpt-4o-mini': { input: 15, output: 60 },
  'gpt-4.1': { input: 200, output: 800 },
  'gpt-4.1-mini': { input: 40, output: 160 },
  'gpt-4.1-nano': { input: 10, output: 40 },
  // Google
  'gemini-2.0-flash': { input: 10, output: 40 },
  'gemini-2.5-pro': { input: 125, output: 1000 },
  // Ollama (local — free)
  'ollama': { input: 0, output: 0 },
};

function getDefaultPricing(): { input: number; output: number } {
  return { input: 300, output: 1500 }; // Default to Sonnet pricing
}

export class CostTracker {
  private agentCosts = new Map<string, CostSummary>();
  private nodeCosts = new Map<string, CostSummary>();
  private totalCost: CostSummary = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };

  constructor(
    public readonly swarmBudget: number | null = null,
    public readonly perAgentBudget: number | null = null,
  ) {}

  recordUsage(agentId: string, nodeId: string, usage: TokenUsage): void {
    const cost = this.calculateCost(usage.model, usage.inputTokens, usage.outputTokens);

    // Update total
    this.totalCost.inputTokens += usage.inputTokens;
    this.totalCost.outputTokens += usage.outputTokens;
    this.totalCost.totalTokens += usage.inputTokens + usage.outputTokens;
    this.totalCost.costCents += cost;
    this.totalCost.calls++;

    // Update per-agent
    const agentEntry = this.agentCosts.get(agentId) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
    agentEntry.inputTokens += usage.inputTokens;
    agentEntry.outputTokens += usage.outputTokens;
    agentEntry.totalTokens += usage.inputTokens + usage.outputTokens;
    agentEntry.costCents += cost;
    agentEntry.calls++;
    this.agentCosts.set(agentId, agentEntry);

    // Update per-node
    const nodeEntry = this.nodeCosts.get(nodeId) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
    nodeEntry.inputTokens += usage.inputTokens;
    nodeEntry.outputTokens += usage.outputTokens;
    nodeEntry.totalTokens += usage.inputTokens + usage.outputTokens;
    nodeEntry.costCents += cost;
    nodeEntry.calls++;
    this.nodeCosts.set(nodeId, nodeEntry);
  }

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Find pricing — check exact match, then prefix match for ollama models
    let pricing = MODEL_PRICING[model];
    if (!pricing) {
      // Check if it's an ollama model (any unknown model defaults to free if running locally)
      for (const [key, value] of Object.entries(MODEL_PRICING)) {
        if (model.startsWith(key)) {
          pricing = value;
          break;
        }
      }
    }
    if (!pricing) pricing = getDefaultPricing();

    // Calculate in integer cents: (tokens * centsPerMillionTokens) / 1_000_000
    const inputCost = Math.ceil((inputTokens * pricing.input) / 1_000_000);
    const outputCost = Math.ceil((outputTokens * pricing.output) / 1_000_000);
    return inputCost + outputCost;
  }

  getSwarmTotal(): CostSummary {
    return { ...this.totalCost };
  }

  getPerAgent(): Map<string, CostSummary> {
    return new Map(this.agentCosts);
  }

  getPerNode(): Map<string, CostSummary> {
    return new Map(this.nodeCosts);
  }

  checkBudget(): { ok: boolean; remaining: number; used: number } {
    if (this.swarmBudget === null) {
      return { ok: true, remaining: Infinity, used: this.totalCost.costCents };
    }
    return {
      ok: this.totalCost.costCents <= this.swarmBudget,
      remaining: Math.max(0, this.swarmBudget - this.totalCost.costCents),
      used: this.totalCost.costCents,
    };
  }

  checkAgentBudget(agentId: string): { ok: boolean; remaining: number; used: number } {
    if (this.perAgentBudget === null) {
      return { ok: true, remaining: Infinity, used: 0 };
    }
    const agentCost = this.agentCosts.get(agentId);
    const used = agentCost?.costCents ?? 0;
    return {
      ok: used <= this.perAgentBudget,
      remaining: Math.max(0, this.perAgentBudget - used),
      used,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cost/tracker.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cost/ tests/cost/
git commit -m "feat: cost tracker with per-agent, per-node attribution and budget enforcement"
```

---

### Task 5: SwarmMemory (Scratchpad + Channels)

**Files:**
- Create: `src/memory/scratchpad.ts`
- Create: `src/memory/channels.ts`
- Create: `src/memory/index.ts`
- Create: `tests/memory/scratchpad.test.ts`
- Create: `tests/memory/channels.test.ts`

**Step 1: Write scratchpad test**

```typescript
// tests/memory/scratchpad.test.ts
import { describe, it, expect } from 'vitest';
import { Scratchpad } from '../../src/memory/scratchpad.js';

describe('Scratchpad', () => {
  it('sets and gets values', () => {
    const pad = new Scratchpad();
    pad.set('stage', 'mvp', 'pm-agent');
    expect(pad.get('stage')).toBe('mvp');
  });

  it('appends to lists', () => {
    const pad = new Scratchpad();
    pad.append('issues', 'no auth spec', 'qa-agent');
    pad.append('issues', 'no rate limits', 'qa-agent');
    expect(pad.getList('issues')).toEqual(['no auth spec', 'no rate limits']);
  });

  it('tracks history', () => {
    const pad = new Scratchpad();
    pad.set('key', 'v1', 'agent-a');
    pad.set('key', 'v2', 'agent-b');
    const history = pad.getHistory('key');
    expect(history).toHaveLength(2);
    expect(history[0].writtenBy).toBe('agent-a');
    expect(history[1].writtenBy).toBe('agent-b');
  });

  it('lists keys', () => {
    const pad = new Scratchpad();
    pad.set('a', 1, 'agent');
    pad.set('b', 2, 'agent');
    expect(pad.keys()).toEqual(['a', 'b']);
  });

  it('generates context string', () => {
    const pad = new Scratchpad();
    pad.set('stage', 'mvp', 'pm');
    pad.append('issues', 'no auth', 'qa');
    const ctx = pad.toContext();
    expect(ctx).toContain('stage');
    expect(ctx).toContain('mvp');
    expect(ctx).toContain('issues');
    expect(ctx).toContain('no auth');
  });

  it('enforces size limits', () => {
    const pad = new Scratchpad({ maxKeyBytes: 50, maxTotalBytes: 100 });
    const bigValue = 'x'.repeat(60);
    expect(() => pad.set('key', bigValue, 'agent')).toThrow();
  });
});
```

**Step 2: Write channels test**

```typescript
// tests/memory/channels.test.ts
import { describe, it, expect } from 'vitest';
import { Channels } from '../../src/memory/channels.js';

describe('Channels', () => {
  it('sends and receives messages', () => {
    const ch = new Channels();
    ch.send('pm', 'architect', 'Focus on API-first');
    const inbox = ch.getInbox('architect');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].content).toBe('Focus on API-first');
    expect(inbox[0].from).toBe('pm');
  });

  it('broadcasts to all agents', () => {
    const ch = new Channels();
    ch.broadcast('coordinator', 'Scope is MVP only');
    const inbox = ch.getInbox('any-agent');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].to).toBe('*');
  });

  it('gets conversation between two agents', () => {
    const ch = new Channels();
    ch.send('pm', 'architect', 'msg 1');
    ch.send('architect', 'pm', 'msg 2');
    ch.send('pm', 'qa', 'msg 3'); // different conversation
    const convo = ch.getConversation('pm', 'architect');
    expect(convo).toHaveLength(2);
  });

  it('returns empty inbox for unknown agent', () => {
    const ch = new Channels();
    expect(ch.getInbox('unknown')).toEqual([]);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/memory/`
Expected: FAIL

**Step 4: Implement scratchpad**

```typescript
// src/memory/scratchpad.ts
import type { ScratchpadEntry } from '../types.js';

interface ScratchpadLimits {
  maxKeyBytes: number;
  maxTotalBytes: number;
}

const DEFAULT_LIMITS: ScratchpadLimits = {
  maxKeyBytes: 10_240,     // 10KB per key
  maxTotalBytes: 102_400,  // 100KB total
};

export class Scratchpad {
  private store = new Map<string, unknown>();
  private lists = new Map<string, unknown[]>();
  private history = new Map<string, ScratchpadEntry[]>();
  private currentBytes = 0;
  private limits: ScratchpadLimits;

  constructor(limits?: Partial<ScratchpadLimits>) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  set(key: string, value: unknown, agentId: string): void {
    const valueBytes = this.estimateBytes(value);
    const oldBytes = this.estimateBytes(this.store.get(key));

    if (valueBytes > this.limits.maxKeyBytes) {
      throw new Error(`Scratchpad key "${key}" exceeds max size (${valueBytes} > ${this.limits.maxKeyBytes} bytes)`);
    }
    if (this.currentBytes - oldBytes + valueBytes > this.limits.maxTotalBytes) {
      throw new Error(`Scratchpad total size would exceed limit (${this.limits.maxTotalBytes} bytes)`);
    }

    this.currentBytes = this.currentBytes - oldBytes + valueBytes;
    this.store.set(key, value);

    const entries = this.history.get(key) ?? [];
    entries.push({ key, value, writtenBy: agentId, timestamp: Date.now(), operation: 'set' });
    this.history.set(key, entries);
  }

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  append(key: string, value: unknown, agentId: string): void {
    const list = this.lists.get(key) ?? [];
    const valueBytes = this.estimateBytes(value);

    if (this.currentBytes + valueBytes > this.limits.maxTotalBytes) {
      throw new Error(`Scratchpad total size would exceed limit (${this.limits.maxTotalBytes} bytes)`);
    }

    list.push(value);
    this.currentBytes += valueBytes;
    this.lists.set(key, list);

    const entries = this.history.get(key) ?? [];
    entries.push({ key, value, writtenBy: agentId, timestamp: Date.now(), operation: 'append' });
    this.history.set(key, entries);
  }

  getList<T>(key: string): T[] {
    return (this.lists.get(key) ?? []) as T[];
  }

  keys(): string[] {
    const allKeys = new Set([...this.store.keys(), ...this.lists.keys()]);
    return [...allKeys];
  }

  getHistory(key: string): ScratchpadEntry[] {
    return this.history.get(key) ?? [];
  }

  toContext(): string {
    const lines: string[] = [];

    for (const [key, value] of this.store) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
    for (const [key, list] of this.lists) {
      lines.push(`${key}: ${JSON.stringify(list)}`);
    }

    return lines.join('\n');
  }

  private estimateBytes(value: unknown): number {
    if (value === undefined || value === null) return 0;
    return Buffer.byteLength(JSON.stringify(value), 'utf-8');
  }
}
```

**Step 5: Implement channels**

```typescript
// src/memory/channels.ts
import type { ChannelMessage } from '../types.js';

export class Channels {
  private messages: ChannelMessage[] = [];

  send(from: string, to: string, content: string, metadata?: Record<string, unknown>): void {
    this.messages.push({ from, to, content, metadata, timestamp: Date.now() });
  }

  broadcast(from: string, content: string, metadata?: Record<string, unknown>): void {
    this.messages.push({ from, to: '*', content, metadata, timestamp: Date.now() });
  }

  getInbox(agentId: string): ChannelMessage[] {
    return this.messages.filter(m => m.to === agentId || m.to === '*');
  }

  getConversation(agentA: string, agentB: string): ChannelMessage[] {
    return this.messages.filter(
      m => (m.from === agentA && m.to === agentB) || (m.from === agentB && m.to === agentA),
    );
  }
}
```

**Step 6: Implement SwarmMemory facade**

```typescript
// src/memory/index.ts
import { Scratchpad } from './scratchpad.js';
import { Channels } from './channels.js';

export class SwarmMemory {
  public readonly scratchpad: Scratchpad;
  public readonly channels: Channels;

  constructor(limits?: { maxKeyBytes?: number; maxTotalBytes?: number }) {
    this.scratchpad = new Scratchpad(limits);
    this.channels = new Channels();
  }
}

export { Scratchpad } from './scratchpad.js';
export { Channels } from './channels.js';
```

**Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/memory/`
Expected: PASS

**Step 8: Commit**

```bash
git add src/memory/ tests/memory/
git commit -m "feat: SwarmMemory with bounded scratchpad and message channels"
```

---

### Task 6: Adapter Interfaces + In-Memory Defaults

**Files:**
- Create: `src/adapters/persistence.ts`
- Create: `src/adapters/lifecycle.ts`
- Create: `src/adapters/defaults.ts`
- Create: `tests/adapters/persistence.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/adapters/persistence.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryPersistence } from '../../src/adapters/defaults.js';

describe('InMemoryPersistence', () => {
  it('creates and retrieves runs', async () => {
    const persistence = new InMemoryPersistence();
    const id = await persistence.createRun({ agentId: 'a1', agentRole: 'pm', task: 'do stuff' });
    expect(id).toBeTruthy();
  });

  it('updates runs', async () => {
    const persistence = new InMemoryPersistence();
    const id = await persistence.createRun({ agentId: 'a1', agentRole: 'pm', task: 'do stuff' });
    await persistence.updateRun(id, { status: 'completed' });
    // No throw = success
  });

  it('creates artifacts', async () => {
    const persistence = new InMemoryPersistence();
    const id = await persistence.createArtifact({ type: 'prd', title: 'Test', content: 'content' });
    expect(id).toBeTruthy();
  });

  it('stores and loads thread history', async () => {
    const persistence = new InMemoryPersistence();
    await persistence.saveMessage('thread-1', 'user', 'hello');
    await persistence.saveMessage('thread-1', 'assistant', 'hi');
    const history = await persistence.loadThreadHistory('thread-1');
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
  });

  it('evicts oldest runs when capacity exceeded', async () => {
    const persistence = new InMemoryPersistence(3); // Cap at 3
    await persistence.createRun({ agentId: 'a1', agentRole: 'pm', task: 'run 1' });
    await persistence.createRun({ agentId: 'a2', agentRole: 'pm', task: 'run 2' });
    await persistence.createRun({ agentId: 'a3', agentRole: 'pm', task: 'run 3' });
    await persistence.createRun({ agentId: 'a4', agentRole: 'pm', task: 'run 4' });
    expect(persistence.runCount).toBe(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/persistence.test.ts`
Expected: FAIL

**Step 3: Implement `src/adapters/defaults.ts`**

```typescript
import type {
  PersistenceAdapter, ContextProvider, MemoryProvider,
  CodebaseProvider, PersonaProvider, LifecycleHooks,
  ArtifactRequest, CreateRunParams, ActivityParams,
  Message, MemoryResult, PersonaConfig,
} from '../types.js';
import { randomUUID } from 'crypto';

export class InMemoryPersistence implements PersistenceAdapter {
  private runs = new Map<string, Record<string, unknown>>();
  private artifacts = new Map<string, ArtifactRequest>();
  private threads = new Map<string, Message[]>();
  private activities: ActivityParams[] = [];
  private insertionOrder: string[] = [];

  constructor(private maxRuns = 100) {}

  get runCount(): number { return this.runs.size; }

  async createRun(params: CreateRunParams): Promise<string> {
    const id = randomUUID();
    this.runs.set(id, { ...params, id, status: 'running', createdAt: Date.now() });
    this.insertionOrder.push(id);

    // LRU eviction
    while (this.runs.size > this.maxRuns) {
      const oldest = this.insertionOrder.shift()!;
      this.runs.delete(oldest);
    }

    return id;
  }

  async updateRun(runId: string, updates: Record<string, unknown>): Promise<void> {
    const run = this.runs.get(runId);
    if (run) Object.assign(run, updates);
  }

  async createArtifact(params: ArtifactRequest): Promise<string> {
    const id = randomUUID();
    this.artifacts.set(id, params);
    return id;
  }

  async saveMessage(threadId: string, role: string, content: string): Promise<void> {
    const thread = this.threads.get(threadId) ?? [];
    thread.push({ role: role as Message['role'], content });
    this.threads.set(threadId, thread);
  }

  async loadThreadHistory(threadId: string): Promise<Message[]> {
    return this.threads.get(threadId) ?? [];
  }

  async logActivity(params: ActivityParams): Promise<void> {
    this.activities.push(params);
  }
}

export class NoopContextProvider implements ContextProvider {
  async getContext(_entityType: string, _entityId: string): Promise<string> { return ''; }
}

export class NoopMemoryProvider implements MemoryProvider {
  async search(_query: string, _k?: number): Promise<MemoryResult[]> { return []; }
  async store(_text: string, _metadata?: Record<string, unknown>): Promise<void> {}
}

export class NoopCodebaseProvider implements CodebaseProvider {
  async query(_repoId: string, _query: string, _tier: 'mini' | 'standard' | 'full'): Promise<string> { return ''; }
}

export class NoopPersonaProvider implements PersonaProvider {
  async getPersona(_role: string): Promise<PersonaConfig | null> { return null; }
}

export class NoopLifecycleHooks implements LifecycleHooks {}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/persistence.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/adapters/ tests/adapters/
git commit -m "feat: adapter interfaces with in-memory and noop defaults"
```

---

### Task 7: Provider Adapters (Anthropic + OpenAI Built-Ins)

**Files:**
- Create: `src/adapters/providers/anthropic.ts`
- Create: `src/adapters/providers/openai.ts`
- Create: `src/adapters/providers/ollama.ts`
- Create: `src/adapters/providers/index.ts`
- Create: `tests/adapters/providers/mock-provider.test.ts`

**Note:** Actual provider tests require API keys, so we test the provider factory and a mock provider. Real integration tests are manual.

**Step 1: Install LLM SDKs**

```bash
cd /Users/dk/projects/SwarmEngine
npm install @anthropic-ai/sdk openai
```

**Step 2: Write test for provider factory**

```typescript
// tests/adapters/providers/mock-provider.test.ts
import { describe, it, expect } from 'vitest';
import { createProvider } from '../../../src/adapters/providers/index.js';
import type { ProviderAdapter, ProviderEvent } from '../../../src/types.js';

describe('createProvider', () => {
  it('creates a custom provider from adapter', () => {
    const mockAdapter: ProviderAdapter = {
      async *stream() { yield { type: 'chunk' as const, content: 'hello' }; yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 }; },
      estimateCost: () => 1,
      getModelLimits: () => ({ contextWindow: 128000, maxOutput: 4096 }),
    };

    const provider = createProvider({ type: 'custom', adapter: mockAdapter });
    expect(provider).toBe(mockAdapter);
  });

  it('throws for missing api key on anthropic', () => {
    expect(() => createProvider({ type: 'anthropic' })).toThrow();
  });

  it('throws for missing api key on openai', () => {
    expect(() => createProvider({ type: 'openai' })).toThrow();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/adapters/providers/`
Expected: FAIL

**Step 4: Implement provider files**

The Anthropic and OpenAI implementations wrap their respective SDKs. The full code for each provider adapter should:
- Implement `stream()` using the SDK's streaming API
- Map SDK events to `ProviderEvent` types (chunk, tool_use, usage)
- Implement `estimateCost()` using the pricing table from CostTracker
- Implement `getModelLimits()` with known context windows
- Pass through AbortSignal for cancellation

**`src/adapters/providers/anthropic.ts`** — wraps `@anthropic-ai/sdk` streaming, maps `content_block_delta` to chunk events, `tool_use` blocks to tool_use events, and `message_delta.usage` to usage events.

**`src/adapters/providers/openai.ts`** — wraps `openai` streaming, maps `chunk.choices[0].delta.content` to chunk events, tool calls to tool_use events, and completion usage to usage events.

**`src/adapters/providers/ollama.ts`** — simple fetch-based streaming against `http://localhost:11434/api/chat`, maps response chunks to events. Zero cost (local model).

**`src/adapters/providers/index.ts`** — factory function:

```typescript
import type { ProviderAdapter, ProviderConfig } from '../../types.js';

export function createProvider(config: ProviderConfig): ProviderAdapter {
  if (config.type === 'custom') {
    if (!config.adapter) throw new Error('Custom provider requires adapter');
    return config.adapter;
  }

  if (config.type === 'anthropic') {
    if (!config.apiKey) throw new Error('Anthropic provider requires apiKey');
    // Lazy import to avoid requiring SDK if not used
    const { AnthropicProvider } = require('./anthropic.js');
    return new AnthropicProvider(config.apiKey, config.baseUrl);
  }

  if (config.type === 'openai') {
    if (!config.apiKey) throw new Error('OpenAI provider requires apiKey');
    const { OpenAIProvider } = require('./openai.js');
    return new OpenAIProvider(config.apiKey, config.baseUrl);
  }

  if (config.type === 'ollama') {
    const { OllamaProvider } = require('./ollama.js');
    return new OllamaProvider(config.baseUrl ?? 'http://localhost:11434');
  }

  throw new Error(`Unknown provider type: ${config.type}`);
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/adapters/providers/`
Expected: PASS

**Step 6: Commit**

```bash
git add src/adapters/providers/ tests/adapters/providers/
git commit -m "feat: LLM provider adapters with Anthropic, OpenAI, Ollama built-ins"
```

---

### Task 8: Context Assembler + Token Budget

**Files:**
- Create: `src/context/assembler.ts`
- Create: `src/context/budget.ts`
- Create: `tests/context/assembler.test.ts`
- Create: `tests/context/budget.test.ts`

**Step 1: Write budget test**

```typescript
// tests/context/budget.test.ts
import { describe, it, expect } from 'vitest';
import { TokenBudget } from '../../src/context/budget.js';

describe('TokenBudget', () => {
  it('allocates budget to segments by priority', () => {
    const budget = new TokenBudget(1000); // 1000 token budget

    budget.add('system', 'You are a PM agent.', 1);        // Priority 1 = never truncate
    budget.add('task', 'Write a PRD for auth.', 1);         // Priority 1
    budget.add('entity', 'Product: MyApp. Desc: A cool app...', 3); // Priority 3
    budget.add('knowledge', 'Past decision: use JWT...'.repeat(100), 5); // Priority 5 = truncate first

    const result = budget.build();
    expect(result).toContain('You are a PM agent.');
    expect(result).toContain('Write a PRD for auth.');
    // Knowledge should be truncated if total exceeds budget
  });

  it('never truncates priority 1 segments', () => {
    const budget = new TokenBudget(50);
    budget.add('system', 'Important system prompt that is long', 1);
    budget.add('filler', 'x'.repeat(1000), 5);

    const result = budget.build();
    expect(result).toContain('Important system prompt that is long');
  });
});
```

**Step 2: Write assembler test**

```typescript
// tests/context/assembler.test.ts
import { describe, it, expect } from 'vitest';
import { ContextAssembler } from '../../src/context/assembler.js';
import { NoopContextProvider, NoopMemoryProvider, NoopCodebaseProvider, NoopPersonaProvider } from '../../src/adapters/defaults.js';
import { SwarmMemory } from '../../src/memory/index.js';

describe('ContextAssembler', () => {
  it('assembles context in priority order', async () => {
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    });

    const messages = await assembler.assemble({
      systemPrompt: 'You are a PM.',
      task: 'Write a PRD',
      contextWindow: 128_000,
    });

    expect(messages.length).toBeGreaterThanOrEqual(2); // system + user
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('You are a PM.');
    expect(messages[messages.length - 1].role).toBe('user');
    expect(messages[messages.length - 1].content).toContain('Write a PRD');
  });

  it('includes upstream outputs when provided', async () => {
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    });

    const messages = await assembler.assemble({
      systemPrompt: 'You are an architect.',
      task: 'Create tech spec',
      upstreamOutputs: [{ nodeId: 'pm', agentRole: 'pm', output: 'PRD content here...' }],
      contextWindow: 128_000,
    });

    const systemContent = messages[0].content;
    expect(systemContent).toContain('PRD content here');
  });

  it('includes scratchpad and inbox when provided', async () => {
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    });

    const swarmMemory = new SwarmMemory();
    swarmMemory.scratchpad.set('stage', 'mvp', 'pm');
    swarmMemory.channels.send('pm', 'architect', 'Focus on APIs');

    const messages = await assembler.assemble({
      systemPrompt: 'You are an architect.',
      task: 'Create tech spec',
      swarmMemory,
      agentId: 'architect',
      contextWindow: 128_000,
    });

    const systemContent = messages[0].content;
    expect(systemContent).toContain('mvp');
    expect(systemContent).toContain('Focus on APIs');
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/context/`
Expected: FAIL

**Step 4: Implement budget and assembler**

The `TokenBudget` class manages context window allocation. The `ContextAssembler` builds the message array from all context sources in priority order (persona → org → entity → knowledge → codebase → artifacts → upstream outputs → inbox → scratchpad → thread → task).

Rough token estimation: 1 token ≈ 4 characters (conservative). Full implementation includes priority-based truncation where low-priority segments are trimmed first.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/context/`
Expected: PASS

**Step 6: Commit**

```bash
git add src/context/ tests/context/
git commit -m "feat: context assembler with token budget and priority-based truncation"
```

---

### Task 9: AgentNode + AgentRunner

**Files:**
- Create: `src/agent/node.ts`
- Create: `src/agent/runner.ts`
- Create: `tests/agent/runner.test.ts`

**Step 1: Write the failing test**

Test uses a mock provider that yields fake chunks:

```typescript
// tests/agent/runner.test.ts
import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../../src/agent/runner.js';
import { SwarmMemory } from '../../src/memory/index.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { ContextAssembler } from '../../src/context/assembler.js';
import { NoopContextProvider, NoopMemoryProvider, NoopCodebaseProvider, NoopPersonaProvider } from '../../src/adapters/defaults.js';
import type { ProviderAdapter, SwarmEvent } from '../../src/types.js';

function createMockProvider(responseText: string): ProviderAdapter {
  return {
    async *stream() {
      for (const char of responseText) {
        yield { type: 'chunk' as const, content: char };
      }
      yield { type: 'usage' as const, inputTokens: 100, outputTokens: responseText.length };
    },
    estimateCost: () => 1,
    getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
  };
}

describe('AgentRunner', () => {
  it('runs a single agent and streams events', async () => {
    const provider = createMockProvider('Hello from PM agent');
    const memory = new SwarmMemory();
    const costTracker = new CostTracker();
    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: new NoopPersonaProvider(),
    });

    const runner = new AgentRunner(provider, assembler, costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'pm-node',
      agent: { id: 'pm', name: 'PM Agent', role: 'pm', systemPrompt: 'You are a PM.' },
      task: 'Write a PRD',
      memory,
    })) {
      events.push(event);
    }

    const starts = events.filter(e => e.type === 'agent_start');
    const chunks = events.filter(e => e.type === 'agent_chunk');
    const dones = events.filter(e => e.type === 'agent_done');

    expect(starts).toHaveLength(1);
    expect(chunks.length).toBeGreaterThan(0);
    expect(dones).toHaveLength(1);

    // Cost should be recorded
    expect(costTracker.getSwarmTotal().calls).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/runner.test.ts`
Expected: FAIL

**Step 3: Implement AgentNode and AgentRunner**

`AgentNode` is the actor wrapper (inbox, outbox, localState). `AgentRunner` orchestrates: assemble context → call provider.stream() → yield events → handle tool calls → record costs.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/runner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/ tests/agent/
git commit -m "feat: AgentNode actor wrapper and AgentRunner for single agent execution"
```

---

### Task 10: DAG Data Structure + Builder (Fluent API)

**Files:**
- Create: `src/dag/graph.ts`
- Create: `src/dag/builder.ts`
- Create: `tests/dag/builder.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/dag/builder.test.ts
import { describe, it, expect } from 'vitest';
import { DAGBuilder } from '../../src/dag/builder.js';

describe('DAGBuilder', () => {
  it('builds a sequential DAG', () => {
    const dag = new DAGBuilder()
      .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: 'You are a PM' })
      .agent('arch', { id: 'arch', name: 'Architect', role: 'architect', systemPrompt: 'You are an architect' })
      .edge('pm', 'arch')
      .build();

    expect(dag.nodes).toHaveLength(2);
    expect(dag.edges).toHaveLength(1);
    expect(dag.edges[0].from).toBe('pm');
    expect(dag.edges[0].to).toBe('arch');
  });

  it('builds a parallel fan-out/fan-in DAG', () => {
    const dag = new DAGBuilder()
      .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: '' })
      .agent('arch', { id: 'arch', name: 'Arch', role: 'architect', systemPrompt: '' })
      .agent('qa', { id: 'qa', name: 'QA', role: 'qa', systemPrompt: '' })
      .agent('mgr', { id: 'mgr', name: 'Mgr', role: 'manager', systemPrompt: '' })
      .edge('pm', 'arch')
      .edge('pm', 'qa')
      .edge('arch', 'mgr')
      .edge('qa', 'mgr')
      .build();

    expect(dag.nodes).toHaveLength(4);
    expect(dag.edges).toHaveLength(4);
  });

  it('builds a conditional routing DAG', () => {
    const dag = new DAGBuilder()
      .agent('reviewer', { id: 'r', name: 'Reviewer', role: 'qa', systemPrompt: '' })
      .agent('next', { id: 'n', name: 'Next', role: 'pm', systemPrompt: '' })
      .agent('fixer', { id: 'f', name: 'Fixer', role: 'architect', systemPrompt: '' })
      .conditionalEdge('reviewer', {
        evaluate: { type: 'rule', fn: (out) => out.includes('APPROVED') ? 'next' : 'fixer' },
        targets: { next: 'next', fixer: 'fixer' },
      })
      .build();

    expect(dag.conditionalEdges).toHaveLength(1);
  });

  it('throws on duplicate node IDs', () => {
    expect(() => {
      new DAGBuilder()
        .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: '' })
        .agent('pm', { id: 'pm', name: 'PM2', role: 'pm', systemPrompt: '' });
    }).toThrow();
  });

  it('throws on edge to non-existent node', () => {
    expect(() => {
      new DAGBuilder()
        .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: '' })
        .edge('pm', 'nonexistent')
        .build();
    }).toThrow();
  });

  it('marks dynamic expansion nodes', () => {
    const dag = new DAGBuilder()
      .agent('coordinator', { id: 'c', name: 'Coordinator', role: 'coordinator', systemPrompt: '' })
      .dynamicExpansion('coordinator')
      .build();

    expect(dag.dynamicNodes).toContain('coordinator');
  });
});
```

**Step 2: Run test, implement, verify, commit**

Run: `npx vitest run tests/dag/builder.test.ts`

Implementation: `DAGBuilder` with fluent `.agent()`, `.edge()`, `.conditionalEdge()`, `.dynamicExpansion()`, `.build()`. The `build()` method validates references and returns a `DAGDefinition`.

```bash
git add src/dag/ tests/dag/
git commit -m "feat: DAG data structure and fluent builder API"
```

---

### Task 11: DAG Validator

**Files:**
- Create: `src/dag/validator.ts`
- Create: `tests/dag/validator.test.ts`

Validates: no orphan nodes, cycles have maxCycles, referenced providers exist, budget estimate. Returns `{ valid: boolean; errors: string[] }`.

```bash
git commit -m "feat: DAG pre-execution validator"
```

---

### Task 12: Scheduler

**Files:**
- Create: `src/dag/scheduler.ts`
- Create: `tests/dag/scheduler.test.ts`

The scheduler tracks node statuses and determines which nodes are ready to run (all upstream dependencies completed). Respects `maxConcurrentAgents`.

```bash
git commit -m "feat: DAG scheduler with concurrency limits"
```

---

### Task 13: DAG Executor (Sequential + Parallel)

**Files:**
- Create: `src/dag/executor.ts`
- Create: `tests/dag/executor.test.ts`

The core execution loop. Uses Scheduler to find ready nodes, runs them via AgentRunner, yields events via SwarmEventEmitter. Handles both sequential (single path) and parallel (fan-out/fan-in) patterns.

```bash
git commit -m "feat: DAG executor with sequential and parallel execution"
```

---

### Task 14: Conditional Routing + Evaluators

**Files:**
- Create: `src/agent/evaluator.ts`
- Create: `tests/agent/evaluator.test.ts`
- Modify: `src/dag/executor.ts` — add conditional edge handling

Three evaluator tiers: rule function (free), regex (free), LLM (cheap model, tight max_tokens).

```bash
git commit -m "feat: conditional routing with rule, regex, and LLM evaluators"
```

---

### Task 15: Cycle/Loop Support

**Files:**
- Modify: `src/dag/scheduler.ts` — track iteration counts per cycle edge
- Modify: `src/dag/executor.ts` — handle cycle edges, emit loop_iteration events
- Create: `tests/dag/loops.test.ts`

Cycle edges reset the target node to 'ready' if iteration < maxCycles. When limit reached, force-proceed to next non-cycle edge.

```bash
git commit -m "feat: iterative refinement loops with configurable max cycles"
```

---

### Task 16: Dynamic Planning (Coordinator Emits DAG)

**Files:**
- Modify: `src/dag/executor.ts` — handle dynamicExpansion nodes
- Create: `tests/dag/dynamic.test.ts`

When a node with `canEmitDAG: true` completes, its output is parsed as a JSON DAG definition. The executor validates it and merges the new nodes/edges into the remaining graph.

```bash
git commit -m "feat: dynamic planning — coordinator agent emits execution DAGs"
```

---

### Task 17: SwarmEngine Class (Main Entry Point)

**Files:**
- Create: `src/engine.ts`
- Create: `tests/engine.test.ts`

The `SwarmEngine` class ties everything together:
- Constructor takes `SwarmEngineConfig`, initializes providers, sets defaults
- `.dag()` returns a new `DAGBuilder`
- `.run(options)` validates, creates executor, returns async iterable of events

```bash
git commit -m "feat: SwarmEngine main entry point with config, dag builder, and run"
```

---

### Task 18: Integration Tests (All 5 Patterns)

**Files:**
- Create: `tests/integration/sequential.test.ts`
- Create: `tests/integration/parallel.test.ts`
- Create: `tests/integration/conditional.test.ts`
- Create: `tests/integration/loops.test.ts`
- Create: `tests/integration/dynamic.test.ts`

Each test uses mock providers to verify end-to-end behavior of each execution pattern. Tests verify:
- Correct event sequence
- Output chaining between nodes
- Parallel execution (timing-based verification)
- Conditional routing (evaluator selects correct path)
- Loop iteration (correct number of cycles)
- Dynamic DAG expansion
- Cost tracking across full swarm
- Cancellation mid-swarm
- Budget enforcement

```bash
git commit -m "test: integration tests for all 5 execution patterns"
```

---

### Task 19: Public API Exports + Package Config

**Files:**
- Modify: `src/index.ts` — export all public types and classes
- Modify: `package.json` — add build scripts, exports field, npm metadata
- Create: `tsup.config.ts` — build configuration

**Step 1: Update `src/index.ts`**

```typescript
// Core
export { SwarmEngine } from './engine.js';

// DAG
export { DAGBuilder } from './dag/builder.js';

// Memory
export { SwarmMemory } from './memory/index.js';

// Streaming
export { SwarmEventEmitter } from './streaming/emitter.js';

// Cost
export { CostTracker } from './cost/tracker.js';

// Errors
export { SwarmError, classifyError } from './errors/classification.js';

// Adapters (defaults)
export { InMemoryPersistence, NoopContextProvider, NoopMemoryProvider, NoopCodebaseProvider, NoopPersonaProvider, NoopLifecycleHooks } from './adapters/defaults.js';

// Provider factory
export { createProvider } from './adapters/providers/index.js';

// Types
export type * from './types.js';
```

**Step 2: Update `package.json`**

```json
{
  "name": "@swarmengine/core",
  "version": "0.1.0",
  "description": "Multi-agent DAG orchestration engine with actor-style agents",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 3: Verify full build and test suite**

```bash
npm run typecheck
npm test
npm run build
```

Expected: All pass, dist/ generated

**Step 4: Commit**

```bash
git add src/index.ts package.json tsup.config.ts
git commit -m "feat: public API exports and package configuration"
```

---

## Dependency Graph

```
Task 1 (scaffold + types)
  ├→ Task 2 (events)
  ├→ Task 3 (errors)
  ├→ Task 4 (cost tracker)
  ├→ Task 5 (swarm memory)
  └→ Task 6 (adapter defaults)
       └→ Task 7 (provider adapters)
            └→ Task 8 (context assembler)
                 └→ Task 9 (agent runner)
                      └→ Task 10 (DAG builder)
                           ├→ Task 11 (validator)
                           └→ Task 12 (scheduler)
                                └→ Task 13 (executor: seq + parallel)
                                     ├→ Task 14 (conditional routing)
                                     ├→ Task 15 (loops)
                                     └→ Task 16 (dynamic planning)
                                          └→ Task 17 (SwarmEngine class)
                                               └→ Task 18 (integration tests)
                                                    └→ Task 19 (exports + package)
```

**Parallelizable tasks:** Tasks 2, 3, 4, 5, 6 can all run in parallel after Task 1.

**Estimated total:** ~19 commits, each independently testable and buildable.
