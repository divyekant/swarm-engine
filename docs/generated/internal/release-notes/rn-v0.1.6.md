---
id: rn-v0.1.6
type: release-notes
audience: internal
version: 0.1.6
status: draft
generated: 2026-02-28
commit-range: initial..5c5bdfa
source-tier: direct
hermes-version: 1.0.0
---

# Release Notes: v0.1.6

## Summary

v0.1.6 introduces three major capabilities: **agentic backends** (Claude Code Agent SDK and OpenAI Codex SDK integration), a **real-time monitor** with SSE streaming and web UI, and **structured logging** threaded through the entire execution pipeline. Several bug fixes stabilize adapter loading, persistence wiring, and nested-session handling for agentic backends. The package remains MIT-licensed under `@swarmengine/core`.

This release spans 30 commits from the initial commit through `5c5bdfa`.

---

## New Features

### Agentic Backends

Nodes in a DAG can now execute via autonomous agentic backends instead of standard LLM provider calls. The engine supports three agentic provider types: `claude-code`, `codex`, and `custom-agentic`.

**What changed:**

- `AgenticAdapter` interface and `AgenticRunner` class handle the execution lifecycle for agentic nodes. Unlike `AgentRunner`, `AgenticRunner` does not assemble context into message arrays or manage a tool-use loop -- the agentic backend handles those internally.
- `ClaudeCodeAdapter` wraps `@anthropic-ai/claude-agent-sdk`. It strips the `CLAUDECODE` environment variable to avoid nested-session detection, auto-resolves the CLI path from the SDK package, and injects swarm communication tools as an in-process MCP server when the SDK supports it.
- `CodexAdapter` wraps `@openai/codex-sdk` using its `startThread` / `runStreamed` interface.
- `createAgenticAdapter` factory in `src/adapters/agentic/index.ts` uses static imports with lazy instantiation -- the underlying SDK is only loaded inside `run()`, so consumers pay no import cost until a node actually executes.
- `isAgenticProvider` guard function identifies agentic provider types (`claude-code`, `codex`, `custom-agentic`).
- `SwarmEngine` constructor separates providers into two maps: `providers` (standard `ProviderAdapter`) and `agenticAdapters` (agentic `AgenticAdapter`). Both maps are merged for DAG validation so provider reference checks pass for agentic nodes.
- `DAGExecutor` routes nodes to `AgenticRunner` when the node's `providerId` matches an agentic adapter.
- Both SDK packages are declared as `optionalDependencies` in `package.json`. The engine works fully without them installed.

**Commits:** `8c3d79a`, `77f7554`, `47286fd`, `d2cd4b7`, `a4c6fdf`, `eee2ed1`, `ca8e582`, `129a53a`, `4251ba6`, `9bf7a4b`

**CS Notes:**
- Agentic backends require their respective SDK packages to be installed (`@anthropic-ai/claude-agent-sdk` for Claude Code, `@openai/codex-sdk` for Codex). If a DAG references an agentic provider but the SDK is not installed, the node will fail at runtime with an import error.
- The `custom-agentic` type requires the consumer to pass a fully implemented `AgenticAdapter` object in `ProviderConfig.agenticAdapter`.
- Communication tools (send_message, scratchpad_set, scratchpad_read, scratchpad_append) are injected into agentic sessions. For Claude Code, these are exposed as an in-process MCP server if the SDK version supports `createSdkMcpServer`.
- The `AgenticOptions.pathToClaudeCodeExecutable` field allows explicit CLI path resolution when the auto-detect logic does not work in a given environment.

---

### Structured Logging

A `Logger` class with level filtering, structured JSON output, and child logger support is now threaded through the engine, executor, runner, and assembler.

**What changed:**

- `Logger` class in `src/logger.ts` supports four levels: `debug`, `info`, `warn`, `error`. Output goes to `stderr`.
- Two output modes: human-readable (`[INFO] message {context}`) and structured JSON (`{"level":"info","message":"...","timestamp":...,"context":{...}}`). Controlled via `LoggingConfig.structured`.
- `Logger.child(context)` creates a child logger that merges base context into every log entry. Used by subsystems to tag logs with component-specific metadata.
- Custom log sink via `LoggingConfig.onLog` callback receives every `LogEntry` that passes the level threshold.
- Logging is disabled by default. It activates only when `SwarmEngineConfig.logging` is provided. When disabled, all log calls are no-ops (zero overhead).
- Logging is wired into: `SwarmEngine` (initialization, DAG validation), `DAGExecutor` (swarm start, node start/complete/fail, parallel batch launch, route decisions, cycle iterations, budget warnings, persistence errors), `AgentRunner` (provider selection, tool calls, cost recording), `ContextAssembler` (section additions, final assembly stats).
- `TokenBudget.getSectionCount()` method added to support assembly logging.

**Commits:** `93a8771`, `431579a`, `6ddc45a`, `6ecb0f8`

**CS Notes:**
- To enable logging, add a `logging` key to `SwarmEngineConfig` with at minimum a `level` value. Example: `{ logging: { level: 'info' } }`.
- For structured JSON logging (suitable for log aggregation systems), set `structured: true`.
- The `onLog` callback fires synchronously. Heavy processing in the callback will block execution.
- Log output goes to `stderr`, not `stdout`. This prevents log noise from interfering with streamed SwarmEvent output.

---

### Monitor (SSE Bridge + HTTP Server + Web UI)

A real-time monitoring subsystem that exposes swarm execution state over Server-Sent Events. Includes a web UI with cluster layout visualization for parallel DAG nodes.

**What changed:**

- `SSEBridge` in `src/monitor/sse-bridge.ts` converts `SwarmEvent` broadcasts into SSE data frames and maintains a `MonitorState` snapshot. New clients receive a `: connected` comment on connection to flush headers immediately.
- `MonitorState` tracks: DAG ID, overall status (idle/running/completed/failed/cancelled), per-node state (status, output, error, cost), route decisions, total cost, progress counters, and start time.
- `createMonitorServer` creates an HTTP server with three endpoints: `GET /events` (SSE stream), `GET /state` (JSON snapshot), `GET /health` (health check). CORS headers are set for cross-origin access.
- `startMonitor` (alias for `startMonitorServer`) starts the server and returns a `MonitorHandle` with `port`, `broadcast()`, `getState()`, and `close()` methods. Default port is `4820`; pass `0` for a random available port.
- Socket tracking ensures `close()` destroys all open SSE connections so the server shuts down cleanly.
- Web UI in `packages/monitor-ui/` renders DAG nodes with cluster layout for parallel fan-out/fan-in visualization.
- All monitor exports (`SSEBridge`, `startMonitor`, `createMonitorServer`, `MonitorState`, `MonitorHandle`, `MonitorOptions`) are available from the main package entry point.

**Commits:** `7960829`, `7d69fbc`, `7960829`, `5b217fa`, `cb139f5`, `e6682ef`

**CS Notes:**
- The monitor is opt-in. Consumers create a monitor server, then pipe `SwarmEvent` objects into `broadcast()` during the `engine.run()` loop.
- The monitor HTTP server does not serve the web UI bundle directly. The web UI is a separate package (`packages/monitor-ui/`) that connects to the monitor server's `/events` endpoint.
- To shut down gracefully, always call `handle.close()`. Failing to close will leave the HTTP server and SSE connections open.
- The `/state` endpoint returns the full accumulated state snapshot, useful for late-joining clients or debugging.

---

### Persona Support (PersonaSmith Integration)

The `ContextAssembler` supports persona injection into agent system prompts via the `PersonaProvider` interface, with a concrete `PersonaSmithProvider` adapter.

**What changed:**

- `PersonaProvider` interface with a single method: `getPersona(role: string) -> PersonaConfig | null`.
- `PersonaSmithProvider` loads persona Markdown files from the PersonaSmith library with three resolution strategies: department-qualified (`engineering/software-engineer`), unqualified (searches all department folders), and fuzzy (normalizes to kebab-case).
- `parsePersonaMarkdown` parses PersonaSmith XML-tagged Markdown sections (`<identity>`, `<communication_style>`, `<constraints_and_rules>`, `<collaboration_map>`) into a `PersonaConfig` object while preserving the full Markdown as `fullPrompt`.
- Industry overlay support: `PersonaSmithProvider` can append an industry-specific Markdown file to the persona before parsing.
- In-memory caching (enabled by default) avoids repeated file reads for the same role.
- `ContextAssembler` injects persona content at priority 1 (never truncated). When `fullPrompt` is available, it is injected as-is; otherwise a structured block is built from the metadata fields.
- `PersonaConfig` added to `AgentDescriptor` as an optional `persona` field.

**CS Notes:**
- PersonaSmith integration requires the `personasDir` option pointing to a local directory containing persona Markdown files organized by department.
- If the persona directory does not exist or is not readable, `getPersona` returns `null` silently. No error is thrown.
- Persona content is injected at the highest priority level in the context budget. In token-constrained scenarios, persona content is never truncated -- other lower-priority sections (codebase, memory, entity context) are truncated first.

---

### Context Assembly Improvements

The `ContextAssembler` and `TokenBudget` received improvements for better logging observability and section management.

**What changed:**

- `TokenBudget.getSectionCount()` returns the number of segments currently added to the budget, enabling callers to log assembly statistics.
- `ContextAssembler` logs each section addition with character length at `debug` level, and logs final assembly summary (section count, total characters) after `build()`.
- Assembly priority order is documented and enforced: persona(1) -> systemPrompt(1) -> task(1) -> upstream outputs(2) -> inbox/channels(3) -> scratchpad(3) -> entity context(4) -> memory search(5) -> codebase(6).

**Commits:** `6ecb0f8`, `6ddc45a`

**CS Notes:**
- To see context assembly details in logs, set the logging level to `debug`. At `info` level, only the final node-level events are logged.

---

## Bug Fixes

### Adapter Loading: Replace Lazy Loading with Static Imports (`7ad5b64`)

The agentic adapter factory previously used dynamic `import()` to lazily load adapter classes. This caused issues in bundled environments where dynamic imports resolve differently. Changed to static imports with lazy instantiation -- the adapter class is imported at module load time, but the underlying SDK `import()` only happens inside `run()`.

**CS Notes:** This fix resolves "module not found" errors when using agentic backends in bundled applications (e.g., Next.js server components, Vite SSR).

### Adapter Loading: Remove `import.meta.resolve` Pre-flight Check (`abcf80e`)

Removed an `import.meta.resolve` call that was used as a pre-flight check for SDK availability. `import.meta.resolve` is not universally supported across all runtimes and bundlers.

**CS Notes:** This fix resolves errors in environments where `import.meta.resolve` is not available (older Node.js versions, certain bundler configurations).

### Adapter Build: Emit Agentic Adapter Files as Separate Build Entries (`92688c4`)

The `tsup` build configuration was not emitting the agentic adapter files (`claude-code-adapter.ts`, `codex-adapter.ts`) as separate chunks. This caused tree-shaking issues where the optional SDK imports were bundled into the main entry point.

**CS Notes:** After this fix, the agentic adapter files are separate build outputs. The optional SDK `import()` calls only execute when the adapter's `run()` method is called.

### Persistence Wiring (`5f086ae`)

The `PersistenceAdapter` was not being passed from `SwarmEngine` into `DAGExecutor`. Agent run records were not being created or updated during execution even when a persistence adapter was configured.

**CS Notes:** After this fix, `PersistenceAdapter.createRun()` is called when each node starts, and `updateRun()` is called on completion or failure. Artifacts are persisted via `createArtifact()`. All persistence calls are fire-and-forget safe -- errors are swallowed and logged as warnings.

### Nested Session and Permissions Errors (`9137051`)

The `ClaudeCodeAdapter` was triggering nested-session detection in the Claude Code CLI because the `CLAUDECODE` environment variable was inherited from the parent process. Fixed by stripping `CLAUDECODE` from the environment passed to the SDK's `query()` call.

**CS Notes:** This fix resolves "nested session detected" errors when running swarm-engine from within a Claude Code session. The fix also adds `stderr` capture for diagnostics (enabled via `SWARM_DEBUG=1` environment variable).

### CLI Path Resolution (`5c5bdfa`)

The `ClaudeCodeAdapter` now passes `pathToClaudeCodeExecutable` to the Claude Agent SDK when provided via `AgenticOptions`. Previously, the option was accepted but not forwarded.

**CS Notes:** Use `AgenticOptions.pathToClaudeCodeExecutable` when the Claude Code CLI is installed in a non-standard location or when the auto-detect logic fails.

---

## Configuration Changes

### New `SwarmEngineConfig` Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `logging` | `LoggingConfig` | `undefined` (disabled) | Enables structured logging with level filtering |
| `logging.level` | `'debug' \| 'info' \| 'warn' \| 'error'` | Required when `logging` is set | Minimum log level threshold |
| `logging.structured` | `boolean` | `false` | Output logs as JSON to stderr |
| `logging.onLog` | `(entry: LogEntry) => void` | `undefined` | Custom log sink callback |

### New `ProviderConfig` Types

| Type | Description |
|------|-------------|
| `claude-code` | Agentic backend using `@anthropic-ai/claude-agent-sdk` |
| `codex` | Agentic backend using `@openai/codex-sdk` |
| `custom-agentic` | Custom agentic backend; requires `agenticAdapter` field |

### New `ProviderConfig` Fields

| Field | Type | Applies To | Description |
|-------|------|------------|-------------|
| `agenticAdapter` | `AgenticAdapter` | `custom-agentic` only | Custom adapter implementing the `AgenticAdapter` interface |

### New `AgentDescriptor` Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `persona` | `PersonaConfig` | `undefined` | Inline persona configuration |
| `agentic` | `AgenticOptions` | `undefined` | Agentic backend options (tool permissions, cwd, budget, model overrides) |

### New `AgenticOptions` Fields

| Field | Type | Description |
|-------|------|-------------|
| `allowedTools` | `string[]` | Whitelist of tools the agentic backend may use |
| `disallowedTools` | `string[]` | Blacklist of tools the agentic backend must not use |
| `permissionMode` | `string` | Permission mode for the agentic backend (default: `bypassPermissions`) |
| `cwd` | `string` | Working directory for the agentic session |
| `maxBudgetUsd` | `number` | Maximum spend in USD for this agentic session |
| `maxTurns` | `number` | Maximum conversation turns |
| `model` | `string` | Model override for the agentic backend |
| `mcpServers` | `Record<string, unknown>` | MCP server configurations to inject |
| `env` | `Record<string, string>` | Environment variables for the agentic session |
| `pathToClaudeCodeExecutable` | `string` | Explicit path to Claude Code CLI binary |

### New Optional Dependencies

| Package | Version | Provider Type |
|---------|---------|---------------|
| `@anthropic-ai/claude-agent-sdk` | `^0.2.50` | `claude-code` |
| `@openai/codex-sdk` | `^0.104.0` | `codex` |
