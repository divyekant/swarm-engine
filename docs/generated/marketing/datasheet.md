---
id: ds-001
type: datasheet
audience: marketing
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# SwarmEngine Datasheet

**Product:** SwarmEngine (`@swarmengine/core`)
**Version:** 0.1.6
**License:** MIT

## Overview

SwarmEngine is a multi-agent DAG orchestration engine for TypeScript. Define AI agents, wire them into workflows, and execute with built-in cost tracking and real-time events.

---

## Key Capabilities

### Orchestration

- **5 execution patterns** — sequential, parallel, conditional, iterative, and dynamic
- **Fluent DAG builder API** — define complex workflows in readable, chainable calls
- **Configurable concurrency limits** — control how many agents run simultaneously
- **Cancellation via AbortSignal** — stop any workflow cleanly at any time

### Agent Execution

- **Standard LLM agents** — Anthropic, OpenAI, Ollama, or any custom provider
- **Agentic backends** — Claude Code, Codex, or any custom execution platform
- **Mixed DAGs** — combine LLM and agentic nodes in the same workflow
- **3-tier conditional routing** — route by rule, regex, or LLM decision

### Cost & Safety

- **Per-agent and per-swarm cost tracking** — integer-cent precision across all providers
- **Automatic budget enforcement** — hard stops with early warning thresholds
- **Error classification** — 7 distinct error types for targeted handling
- **Configurable iteration limits** — prevent runaway loops

### Observability

- **15 streaming event types** — full visibility into every stage of execution
- **Built-in monitoring dashboard** — real-time SSE event stream
- **Structured logging** — scoped child loggers for per-component context

### Extensibility

- **7 pluggable adapter interfaces** — swap any component without changing workflow code
- **Custom provider support** — bring your own LLM backend
- **Custom agentic backends** — integrate any execution platform
- **Lifecycle hooks** — tap into workflow events for custom behavior

---

## Technical Specifications

| Spec | Value |
|------|-------|
| Language / Runtime | TypeScript / Node.js 20+ |
| Module System | ESM |
| API Style | Library (programmatic TypeScript API) |
| Package | `@swarmengine/core` |
| License | MIT |

---

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@anthropic-ai/sdk` | ^0.77.0 | Anthropic LLM provider |
| `openai` | ^6.22.0 | OpenAI LLM provider |

### Optional Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.50 | Claude Code agentic backend |
| `@openai/codex-sdk` | ^0.104.0 | Codex agentic backend |

---

## Integrations

- **LLM Providers:** Anthropic Claude, OpenAI GPT, Ollama (local models), custom providers
- **Agentic Backends:** Claude Code, Codex, custom backends
- **Extensibility:** Any LLM or execution platform via adapter interfaces

---

## System Requirements

| Requirement | Minimum |
|-------------|---------|
| Node.js | 20+ |
| TypeScript | 5.0+ |
