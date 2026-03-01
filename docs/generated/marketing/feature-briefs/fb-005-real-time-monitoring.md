---
id: fb-005
type: feature-brief
audience: marketing
topic: Real-Time Monitoring
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [README.md, docs/ARCHITECTURE.md]
hermes-version: 1.0.0
---

# Real-Time Monitoring

## One-Liner

Watch your AI workflows execute in real time with built-in monitoring and visualization.

## What It Is

SwarmEngine includes a built-in monitoring dashboard that visualizes workflow execution as it happens — see which agents are running, track costs accumulating, and debug routing decisions, all through a live web UI.

## Who It's For

- **Primary:** Engineering teams debugging and monitoring AI workflows during development and production
- **Secondary:** Product managers wanting visibility into AI workflow performance

## Problem

Multi-agent workflows are opaque. When something goes wrong — or even when it goes right — it's hard to understand what happened, which agents ran, and how much it cost.

## Key Benefits

- **Live visualization** — see DAG execution as it happens
- **Zero setup** — start the monitor with one function call
- **SSE-powered** — real-time updates without polling
- **Purely observational** — monitoring never affects workflow execution
- **Embeddable** — SSE bridge works with any frontend framework

## How It Works

Call startMonitor() with your event bridge, and open the dashboard in your browser. Events stream in real time as your workflow executes.

## Competitive Context

Competitive positioning requires additional context — provide competitive analysis docs to populate this section.

## Proof Points

Proof points require usage data or customer feedback to populate.

## Suggested Messaging

- **Announcement:** See your AI workflows in action — SwarmEngine's built-in monitor gives you real-time visibility into every agent, every decision, every dollar.
- **Sales pitch:** Stop guessing what your AI agents are doing. SwarmEngine's live dashboard shows you exactly what's happening, as it happens.
- **One-liner:** AI workflows you can see.
