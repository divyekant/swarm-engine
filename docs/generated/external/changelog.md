---
type: changelog
audience: external
generated: 2026-03-15
hermes-version: 1.0.0
---

# Changelog

All notable changes to `@swarmengine/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added


## [0.3.0] - 2026-03-15

### Added

- Real-time parallel event streaming for executor consumers, allowing fast branches to emit events before slower siblings finish.
- First-class monitor workflows from the repo root, including dedicated monitor tests, build commands, and CI coverage.
- Monitor support for feedback-loop and guard events, with reducer and event-summary unit tests.

### Changed

- `RunOptions` thread, entity, and metadata fields now propagate through execution, context assembly, and persistence for standard runs.
- Engine defaults now apply to an effective per-run DAG instead of mutating caller-owned DAG definitions.
- Agentic runs now receive handoff instructions and retry feedback through the existing prompt/context channel.

### Removed

- The unimplemented built-in `google` provider type from `ProviderConfig`; use a custom provider for Google integrations until a real adapter exists.

### Fixed

- External docs now match actual runtime provider and context behavior.

## [0.1.6] - 2026-02-28

### Fixed

- Claude Code adapter now correctly locates its CLI executable in bundled environments.

## [0.1.5] - 2026-02-28

### Fixed

- Agentic adapter loading works reliably in all bundler configurations.

## [0.1.4] - 2026-02-27

### Fixed

- Agentic SDK detection works in bundled environments.

## [0.1.3] - 2026-02-27

### Fixed

- Agentic adapter files are correctly included in the published package.

## [0.1.2] - 2026-02-26

### Added

- Structured logging system with configurable levels (debug, info, warn, error), structured JSON output, and child loggers for scoped context.
- Logging integrated across all engine components: engine initialization, DAG execution, agent runs, and context assembly.
- Context assembly now reports section count in logs for easier debugging.

### Fixed

- Persistence adapter is now properly connected during DAG execution, so run tracking, artifact creation, and activity logging work end-to-end.

## [0.1.1] - 2026-02-25

### Added

- Agentic backend support for Claude Code and Codex. You can now run DAG nodes as autonomous agentic sessions instead of standard LLM calls.
- Mixed DAGs with both LLM and agentic nodes. Route some nodes through traditional providers and others through agentic backends in the same workflow.
- Custom agentic backend support via the `AgenticAdapter` interface. Bring your own agentic runtime.
- Real-time swarm monitoring dashboard with a built-in web UI.
- Server-Sent Events bridge for browser-based monitoring of running swarms.
- Visual cluster layout for parallel node visualization in the monitor.

### Fixed

- Claude Code sessions no longer conflict with parent sessions when running nested agentic nodes.

## [0.1.0] - 2026-02-24

### Added

- Core DAG orchestration engine supporting five execution patterns: sequential, parallel fan-out/fan-in, conditional routing, iterative loops, and dynamic sub-DAG expansion.
- Fluent `DAGBuilder` API for constructing agent graphs with `.agent()`, `.edge()`, `.conditionalEdge()`, and `.dynamicExpansion()`.
- Built-in provider adapters for Anthropic, OpenAI, and Ollama. Custom providers supported via the `ProviderAdapter` interface.
- Anthropic OAuth provider for token-based authentication.
- Cost tracking with per-agent and per-swarm budget enforcement. Budgets are checked continuously and emit warnings before hard limits.
- Swarm memory system with a shared scratchpad (key-value and list storage) and agent-to-agent message channels.
- Context assembly pipeline with priority-based token budgeting. Gathers persona, system prompt, upstream outputs, messages, scratchpad state, entity context, semantic memory, and codebase context -- all fitted within the model's context window.
- Streaming event system with 15 event types covering agent lifecycle, swarm progress, routing decisions, loop iterations, and budget alerts.
- Error classification that categorizes failures into actionable types: timeout, rate limit, auth error, network error, content filter, budget exceeded, and unknown.
- Persona support via PersonaSmith integration and a standalone Markdown parser.
- Pluggable adapter architecture for persistence, context, memory, codebase, and persona providers.
- Noop default implementations for all adapter interfaces, so you can start with zero configuration and add integrations incrementally.
