---
id: op-001
type: one-pager
audience: marketing
topic: SwarmEngine
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# SwarmEngine — Multi-Agent Orchestration for TypeScript

## The Problem

Building multi-agent AI workflows is hard. Teams spend weeks writing custom orchestration code -- managing dependencies, handling failures, tracking costs, coordinating parallel execution. Every new workflow requires new plumbing.

The result: slow delivery, fragile systems, and runaway AI spend with no visibility.

## The Solution

SwarmEngine handles the orchestration so your team focuses on the agents. Define your agents, wire them into a graph, and let the engine manage execution, cost tracking, and real-time events -- all from a clean TypeScript API.

No framework lock-in. No infrastructure to manage. Just a library that does the hard part.

## Key Benefits

**Five patterns, zero custom code.**
Sequential, parallel, conditional, iterative, and dynamic workflows from one API. Build once, compose freely.

**Built-in cost control.**
Track every token, enforce budgets automatically, get early warnings before overspend. Per-agent and per-workflow precision.

**Real tools, not just text.**
Agentic backends let agents read files, write code, and execute commands. Your workflow doesn't stop at suggestions -- it delivers results.

**Provider freedom.**
Anthropic, OpenAI, Ollama, or bring your own. Switch providers without changing workflow code.

## How It Works

1. **Configure** -- Set up your LLM providers and budget limits
2. **Build** -- Wire agents into a workflow graph using the fluent API
3. **Run** -- Execute and consume real-time events for monitoring and integration

## Who It's For

**Engineering teams** -- Build sophisticated AI automation without orchestration boilerplate.

**Platform teams** -- Embed multi-agent workflows into your product with a clean, typed API.

**DevOps teams** -- Automate infrastructure tasks with agents that can actually execute commands.

## Get Started

```
npm install @swarmengine/core
```

See the Getting Started guide for a working example in under 5 minutes.
