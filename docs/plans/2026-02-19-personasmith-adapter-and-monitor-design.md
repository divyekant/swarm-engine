# PersonaSmith Adapter + Real-Time DAG Monitor — Design Document

> **Date:** 2026-02-19
> **Status:** Draft
> **Package:** `@swarmengine/core` (adapter) + `@swarmengine/monitor` (optional web app)
> **Depends on:** PersonaSmith library at `/Users/dk/projects/personaTemplates/`

---

## 1. Overview

Two features that make SwarmEngine more useful in production:

1. **PersonaSmith Adapter** — A `PersonaProvider` implementation that loads rich persona Markdown files from the PersonaSmith library and injects them into agent system prompts. Provides both full-prompt injection (for maximum persona fidelity) and parsed `PersonaConfig` metadata (for programmatic access).

2. **Real-Time DAG Monitor** — An optional, read-only web application that visualizes SwarmEngine DAG execution in real time. Uses Server-Sent Events (SSE) to stream `SwarmEvent`s from the engine to a React Flow-based DAG visualization. Actions (cancel, pause) are performed through the existing engine API/CLI, not through the monitor.

---

## 2. PersonaSmith Adapter

### 2.1 Problem

SwarmEngine's current `PersonaConfig` is a slim metadata object:

```ts
interface PersonaConfig {
  name: string;
  role: string;
  traits: string[];
  constraints: string[];
  communicationStyle?: string;
  expertise?: string[];
}
```

PersonaSmith personas are rich, research-backed Markdown documents (~300-400 lines) with 10 XML-tagged sections covering identity, objectives, decision frameworks, collaboration maps, tools, constraints, metrics, and example scenarios. The slim `PersonaConfig` cannot represent this depth.

### 2.2 Approach: Both Full Prompt + Structured Metadata

Extend `PersonaConfig` with an optional `fullPrompt` field. The adapter reads the full Markdown file and:

1. **Injects the entire Markdown content** as `fullPrompt` for system prompt injection (maximum persona fidelity)
2. **Parses key XML sections** to populate the structured `PersonaConfig` fields (for programmatic access, logging, UI display)

### 2.3 Type Changes

```ts
// src/types.ts — extend PersonaConfig
export interface PersonaConfig {
  name: string;
  role: string;
  traits: string[];
  constraints: string[];
  communicationStyle?: string;
  expertise?: string[];
  fullPrompt?: string;              // NEW: raw Markdown content for system prompt injection
  department?: string;              // NEW: parsed from <identity> section
  seniority?: string;               // NEW: parsed from <identity> section
  collaborationMap?: string;        // NEW: raw content of <collaboration_map> section
}
```

### 2.4 ContextAssembler Changes

The `ContextAssembler` currently builds a persona block from individual `PersonaConfig` fields (lines 71-82 of `assembler.ts`). When `fullPrompt` is present, it should inject the full Markdown instead:

```ts
// Priority 1: Persona
const persona = await this.deps.persona.getPersona(agentId ?? 'default');
if (persona) {
  if (persona.fullPrompt) {
    // Full PersonaSmith Markdown — inject as-is
    budget.add('persona', persona.fullPrompt, 1);
  } else {
    // Slim metadata — build from fields (existing behavior)
    const personaBlock = [
      `## Persona: ${persona.name}`,
      `Role: ${persona.role}`,
      // ... existing code
    ].filter(Boolean).join('\n');
    budget.add('persona', personaBlock, 1);
  }
}
```

### 2.5 PersonaSmith Provider Implementation

```
src/adapters/personas/
├── personasmith.ts       # PersonaSmithProvider class
└── parser.ts             # Markdown → PersonaConfig parser
```

**PersonaSmithProvider:**

```ts
export class PersonaSmithProvider implements PersonaProvider {
  private personasDir: string;
  private cache: Map<string, PersonaConfig>;

  constructor(options: {
    personasDir: string;        // e.g. '/path/to/personaTemplates/personas'
    cacheEnabled?: boolean;     // default: true
  });

  async getPersona(role: string): Promise<PersonaConfig | null>;
}
```

**Role resolution strategy:**

The `role` parameter maps to a persona file using a simple lookup:

1. Exact match: `role` = `"software-engineer"` → looks for `*/software-engineer.md` in any department folder
2. Department-qualified: `role` = `"engineering/software-engineer"` → looks for `engineering/software-engineer.md`
3. Fuzzy fallback: normalize role to kebab-case (`"Software Engineer"` → `"software-engineer"`)

**Parser extracts from XML sections:**

| PersonaConfig field | Source |
|---|---|
| `name` | `<identity>` → Title |
| `role` | `<identity>` → Role description |
| `traits` | `<communication_style>` → Tone, vocabulary |
| `constraints` | `<constraints_and_rules>` → Hard rules |
| `communicationStyle` | `<communication_style>` → Formality levels |
| `expertise` | `<identity>` → Expertise domain |
| `department` | `<identity>` → Department |
| `seniority` | `<identity>` → Seniority |
| `collaborationMap` | `<collaboration_map>` → Raw content |
| `fullPrompt` | Entire Markdown file content |

### 2.6 Industry Overlay Support

PersonaSmith supports composing personas with industry overlays:

```
System Prompt = [Software Engineer persona] + [industries/fintech.md]
```

The provider should support an optional `industryOverlay` parameter:

```ts
constructor(options: {
  personasDir: string;
  industriesDir?: string;       // e.g. '/path/to/personaTemplates/industries'
  defaultIndustry?: string;     // e.g. 'fintech'
});
```

When an industry overlay is configured, the `fullPrompt` is the concatenation of the persona file + the industry overlay file.

### 2.7 Usage Example

```ts
import { SwarmEngine } from '@swarmengine/core';
import { PersonaSmithProvider } from '@swarmengine/core/adapters/personas/personasmith';

const engine = new SwarmEngine({
  providers: { anthropic: { type: 'anthropic', apiKey: '...' } },
  persona: new PersonaSmithProvider({
    personasDir: './personaTemplates/personas',
    industriesDir: './personaTemplates/industries',
    defaultIndustry: 'fintech',
  }),
});

// Agent descriptor references a PersonaSmith role
const dag = engine.dag()
  .agent('pm', {
    id: 'pm',
    name: 'Product Manager',
    role: 'product/product-manager',  // maps to personas/product/product-manager.md
    systemPrompt: '',                  // empty — persona provides the full prompt
  })
  .agent('dev', {
    id: 'dev',
    name: 'Software Engineer',
    role: 'engineering/software-engineer',
    systemPrompt: '',
  })
  .edge('pm', 'dev')
  .build();
```

---

## 3. Real-Time DAG Monitor

### 3.1 Problem

SwarmEngine emits rich `SwarmEvent` streams, but there's no visual way to observe:
- Which nodes are pending/running/completed/failed
- How data flows through the DAG
- Cost accumulation across the swarm
- Agent outputs and error states

### 3.2 Architecture

```
┌─────────────────┐     SwarmEvent      ┌──────────────────┐
│  SwarmEngine     │ ──── stream ──────→ │  SSE Endpoint     │
│  (core library)  │   (async iterable)  │  (thin HTTP layer) │
└─────────────────┘                      └────────┬─────────┘
                                                  │ SSE
                                                  ▼
                                         ┌──────────────────┐
                                         │  Monitor Web App  │
                                         │  (React + React   │
                                         │   Flow)           │
                                         └──────────────────┘
```

**Key principle: The monitor is read-only.** It observes events, it doesn't control execution. Any actions (cancel, rerun, pause) go through the engine's existing API or CLI.

### 3.3 SSE Event Bridge

A thin adapter that sits between the `SwarmEngine.run()` async generator and an HTTP SSE endpoint.

```
src/monitor/
├── sse-bridge.ts          # Converts SwarmEvent stream → SSE
├── http-server.ts         # Minimal HTTP server with SSE endpoint
└── index.ts               # Public exports
```

**SSE Bridge:**

```ts
export class SSEBridge {
  private clients: Set<ServerResponse>;

  // Attach to an engine run and broadcast events
  async attachToRun(events: AsyncGenerator<SwarmEvent>): Promise<void>;

  // SSE endpoint handler
  handleSSE(req: IncomingMessage, res: ServerResponse): void;
}
```

**Why SSE over WebSocket:**
- Read-only data flow (server → client only) — SSE is designed for this
- Built into browsers natively (`EventSource` API) — no library needed
- Simpler server implementation — no upgrade handshake, no ping/pong
- Automatic reconnection built into the protocol
- Lower overhead than maintaining bidirectional WebSocket connection

**HTTP Server:**

Minimal `node:http` server (no Express dependency). Exposes:

```
GET /events         → SSE stream of SwarmEvents
GET /state          → Current snapshot (node statuses, cost, progress)
GET /health         → Health check
```

The `/state` endpoint provides a point-in-time snapshot so new clients don't need to replay the entire event history. The bridge maintains the latest state by reducing incoming events.

### 3.4 Monitor State Model

The SSE bridge maintains a reduced state from events:

```ts
interface MonitorState {
  dagId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  nodes: Map<string, {
    id: string;
    agentRole: string;
    agentName: string;
    status: NodeStatus;          // pending | ready | running | completed | failed | skipped
    output?: string;
    error?: string;
    cost?: CostSummary;
    durationMs?: number;
  }>;
  edges: DAGEdge[];
  conditionalEdges: ConditionalEdge[];
  routeDecisions: { from: string; to: string; reason: string }[];
  totalCost: CostSummary;
  progress: { completed: number; total: number };
  startTime: number;
}
```

### 3.5 Web App (Separate Package)

```
packages/monitor/
├── package.json            # @swarmengine/monitor
├── src/
│   ├── App.tsx
│   ├── hooks/
│   │   └── useSwarmEvents.ts    # EventSource hook
│   ├── components/
│   │   ├── DAGView.tsx          # React Flow canvas
│   │   ├── NodeCard.tsx         # Custom node rendering
│   │   ├── EdgeLabel.tsx        # Edge annotations
│   │   ├── CostBar.tsx          # Budget/cost display
│   │   ├── EventLog.tsx         # Scrolling event log
│   │   └── StatusBar.tsx        # Overall swarm status
│   └── lib/
│       └── state-reducer.ts     # SwarmEvent → UI state
├── index.html
└── vite.config.ts
```

**Tech choices:**
- **React Flow** — Purpose-built for DAG/graph visualization with zoom, pan, custom nodes
- **Vite** — Fast dev server, zero-config for React + TypeScript
- **No state management library** — `useReducer` + Context is sufficient for event-driven state
- **TailwindCSS** — Consistent with HiveBuild, quick to style

**Node rendering:**

Each DAG node renders as a card showing:
- Agent name and role
- Status indicator (color-coded: gray=pending, blue=running, green=done, red=failed, yellow=skipped)
- Cost (when completed)
- Duration (when completed)
- Truncated output preview (expandable)

**Edge rendering:**

- Regular edges: solid lines
- Conditional edges: dashed lines with route decision labels
- Cycle edges: curved with iteration count

### 3.6 Integration with SwarmEngine

The SSE bridge is optional and non-intrusive. Usage:

```ts
import { SwarmEngine } from '@swarmengine/core';
import { startMonitor } from '@swarmengine/monitor';

const engine = new SwarmEngine({ ... });
const dag = engine.dag().agent(...).build();

// Start the monitor server (optional)
const monitor = await startMonitor({ port: 4820 });

// Run the DAG and pipe events to both consumer and monitor
for await (const event of engine.run({ dag, task: '...' })) {
  monitor.broadcast(event);  // Send to SSE clients
  handleEvent(event);        // Your own event handling
}

monitor.close();
```

### 3.7 Agent IDs and Traceability

Every `SwarmEvent` already carries `nodeId` and `agentRole`. The monitor maps these to visual nodes. The `/state` endpoint includes the full node/edge topology so the client can render the DAG structure on first connect, then update node statuses as events arrive.

---

## 4. Package Structure

```
@swarmengine/core                    # Existing package
├── src/adapters/personas/
│   ├── personasmith.ts              # PersonaSmithProvider
│   └── parser.ts                    # Markdown parser
├── src/monitor/
│   ├── sse-bridge.ts                # SSE event bridge
│   ├── http-server.ts               # Minimal HTTP server
│   └── index.ts                     # Public exports

@swarmengine/monitor                 # NEW optional package
├── src/                             # React web app
├── package.json
└── vite.config.ts
```

The PersonaSmith adapter lives in `@swarmengine/core` because it implements the existing `PersonaProvider` interface. The SSE bridge also lives in core (it's just a thin layer over the event stream). The React web app is a separate package since it has different dependencies (React, React Flow, Vite).

---

## 5. Implementation Order

1. **PersonaSmith Adapter** (core)
   - Extend `PersonaConfig` type with `fullPrompt`, `department`, `seniority`, `collaborationMap`
   - Write Markdown parser for PersonaSmith XML sections
   - Implement `PersonaSmithProvider`
   - Update `ContextAssembler` to use `fullPrompt` when available
   - Tests: parser unit tests, provider integration tests, assembler tests

2. **SSE Bridge** (core)
   - Implement `SSEBridge` class
   - Implement minimal HTTP server
   - Export from `@swarmengine/core/monitor`
   - Tests: SSE streaming tests, state snapshot tests

3. **Monitor Web App** (separate package)
   - Scaffold with Vite + React + TypeScript
   - Implement `useSwarmEvents` hook (EventSource)
   - Build DAG visualization with React Flow
   - Add node cards, edge labels, cost bar, event log
   - Wire up state reducer

---

## 6. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Full persona Markdown (~400 lines) consumes significant token budget | `TokenBudget` priority system already handles this — persona is priority 1 but gets truncated if context window is small. Consider a `maxPersonaTokens` option. |
| PersonaSmith persona format changes | Parser uses defensive regex extraction from XML tags — tolerant of additional content. |
| SSE connection drops | `EventSource` auto-reconnects. `/state` endpoint provides catch-up snapshot. |
| Monitor web app adds deployment complexity | It's optional — SwarmEngine works identically without it. Single `vite build` produces static files. |
| React Flow bundle size | Tree-shaking + lazy loading. The monitor is a dev/ops tool, not a user-facing app. |

---

## 7. Out of Scope

- **Bidirectional control via monitor** — Actions go through engine API/CLI
- **Multi-swarm dashboard** — V1 monitors one swarm run at a time
- **Persistent event storage** — Events are in-memory; the monitor is for live observation
- **Authentication on the SSE endpoint** — V1 assumes local/trusted network
