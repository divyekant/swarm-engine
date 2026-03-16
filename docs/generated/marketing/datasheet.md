---
id: ds-001
type: datasheet
audience: marketing
status: draft
generated: 2026-03-15
source-tier: direct
hermes-version: 1.0.1
---

# SwarmEngine Datasheet

**Product:** SwarmEngine (`@swarmengine/core`)
**Version:** 0.3.0
**License:** MIT

## Overview

SwarmEngine is a TypeScript multi-agent DAG orchestration engine for teams that need structured workflows, streaming execution, and pluggable integrations without giving up control over how agents run.

## Key Capabilities

### Orchestration

- Sequential, parallel, conditional, iterative, and dynamic execution patterns
- Fluent DAG builder API for readable workflow construction
- Configurable concurrency, duration, and budget controls

### Agent Execution

- Standard LLM providers: Anthropic, OpenAI, Ollama, and custom adapters
- Agentic backends: Claude Code, Codex, and custom agentic adapters
- Mixed DAGs that combine traditional and agentic nodes in one workflow

### Observability

- Live streaming events from `engine.run()`
- Built-in SSE monitor server with state snapshots
- Local monitor UI with root-level test, build, dev, and mock commands
- Feedback and guard activity visible in the monitor alongside node state

### Quality Controls

- Handoff templates for structured inter-node output
- Feedback loops with retries and escalation policies
- Evidence and scope-creep guards with warn or block modes

### Extensibility

- Pluggable persistence, context, memory, codebase, persona, and lifecycle interfaces
- Custom provider and agentic adapter support

## Technical Specifications

| Spec | Value |
|------|-------|
| Language / Runtime | TypeScript / Node.js 20+ |
| Module System | ESM |
| Package | `@swarmengine/core` |
| Distribution | npm package plus local monitor UI workspace |

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@anthropic-ai/sdk` | ^0.77.0 | Anthropic provider |
| `openai` | ^6.22.0 | OpenAI provider |

### Optional Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.50 | Claude Code backend |
| `@openai/codex-sdk` | ^0.104.0 | Codex backend |

## Supported Integrations

- Anthropic Claude
- OpenAI GPT
- Ollama local models
- Custom provider adapters
- Custom persistence, memory, context, codebase, and persona backends

## System Requirements

| Requirement | Minimum |
|-------------|---------|
| Node.js | 20+ |
| TypeScript | 5.0+ |
