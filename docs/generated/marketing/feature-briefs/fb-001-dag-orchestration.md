---
id: fb-001
type: feature-brief
audience: marketing
topic: DAG Orchestration
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [README.md, docs/ARCHITECTURE.md]
hermes-version: 1.0.0
---

# DAG Orchestration

## One-Liner

Orchestrate multi-agent AI workflows with five execution patterns from a single, unified API.

## What It Is

SwarmEngine lets teams wire multiple AI agents into intelligent workflows — sequential pipelines, parallel fan-out, conditional routing, iterative refinement, and dynamic planning — all defined as simple directed graphs.

## Who It's For

- **Primary:** Engineering teams building AI-powered automation — any team that needs multiple AI agents to collaborate
- **Secondary:** Product teams managing cross-functional workflows, DevOps teams automating deployment pipelines

## Problem

Teams today either run agents one at a time (slow, no coordination) or build custom orchestration code for each workflow (fragile, expensive to maintain). There's no standard way to compose AI agents into sophisticated workflows.

## Key Benefits

- **One engine, five patterns** — no custom orchestration code
- **Topology-driven** — the graph shape determines execution, not code paths
- **Built-in safety** — budget limits, cancellation, deadlock detection
- **Real-time visibility** — 15 event types for monitoring and debugging
- **Provider-agnostic** — works with Anthropic, OpenAI, Ollama, or custom LLMs

## How It Works (simplified)

Define agents and connect them with edges. The engine validates the graph, schedules execution (parallelizing where possible), and streams results back in real time.

## Competitive Context

Competitive positioning requires additional context — provide competitive analysis docs to populate this section.

## Proof Points

Proof points require usage data or customer feedback to populate.

## Suggested Messaging

- **Announcement:** SwarmEngine brings enterprise-grade multi-agent orchestration to TypeScript — five execution patterns, one API, zero custom wiring.
- **Sales pitch:** Your team can build sophisticated AI workflows in hours, not weeks. Sequential, parallel, conditional, iterative — SwarmEngine handles the orchestration so your engineers focus on the agents.
- **One-liner:** Multi-agent AI workflows, orchestrated.
