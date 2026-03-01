---
id: fb-004
type: feature-brief
audience: marketing
topic: Pluggable Adapters
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [README.md, docs/ARCHITECTURE.md]
hermes-version: 1.0.0
---

# Pluggable Adapters

## One-Liner

Bring your own everything — LLM providers, storage, memory, and more — through seven pluggable interfaces.

## What It Is

SwarmEngine works out of the box with sensible defaults, but every integration point is replaceable. Swap LLM providers, connect your own database, add semantic memory, or plug in custom agent personalities — all without changing your workflow code.

## Who It's For

- **Primary:** Engineering teams integrating SwarmEngine into existing infrastructure
- **Secondary:** Platform teams building AI-powered products on top of SwarmEngine

## Problem

Most orchestration tools lock you into specific LLM providers or storage systems. When your requirements change, you're stuck rewriting.

## Key Benefits

- **Provider freedom** — Anthropic, OpenAI, Ollama, or your own custom LLM
- **Works standalone** — sensible defaults for every adapter (zero external dependencies)
- **Incremental adoption** — start with defaults, plug in production systems as needed
- **Clean interfaces** — each adapter has a focused, well-typed contract
- **Mix and match** — use different providers for different agents in the same workflow

## How It Works

Seven adapter interfaces cover LLM streaming, persistence, context, memory, codebase queries, personas, and lifecycle hooks. Implement what you need, pass it to the engine config.

## Competitive Context

Competitive positioning requires additional context — provide competitive analysis docs to populate this section.

## Proof Points

Proof points require usage data or customer feedback to populate.

## Suggested Messaging

- **Announcement:** SwarmEngine's pluggable architecture means zero vendor lock-in — bring your own LLM, database, memory system, or agentic platform.
- **Sales pitch:** Start with our defaults in development, plug in your production infrastructure when you're ready. No code changes to your workflows.
- **One-liner:** Your infrastructure, our orchestration.
