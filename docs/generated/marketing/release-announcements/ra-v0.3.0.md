---
id: ra-v0.3.0
type: release-announcement
audience: marketing
version: 0.3.0
status: draft
generated: 2026-03-15
source-tier: direct
hermes-version: 1.0.1
---

# SwarmEngine v0.3.0: See Every Branch of Your Swarm in Motion

## The Headline

SwarmEngine `v0.3.0` makes multi-agent runs easier to watch, trace, and trust with live parallel streaming, richer run context, and a stronger built-in monitor experience.

## What's New

### Live Parallel Streaming

Parallel workflows now emit events as each branch progresses, so dashboards and custom observers reflect real execution flow instead of waiting for the whole branch set to finish.

**Key benefit:** You can debug and demo complex workflows as they happen.

### Richer Run Context

`RunOptions` metadata like thread IDs and entity context now flows consistently through execution and persistence for standard runs.

**Key benefit:** The runs you inspect later carry more of the business context that made them matter.

### Better Mixed Agentic Workflows

Agentic nodes now receive handoff instructions and retry feedback more consistently, especially in review and QA-style loops.

**Key benefit:** Mixed LLM and agentic DAGs behave more like one coherent system.

### First-Class Monitor Workflows

The monitor UI is easier to run from the main repo, with root-level build, test, dev, and mock commands plus support for feedback and guard activity in the UI.

**Key benefit:** Teams get faster local observability with less setup friction.

## Improvements

- The misleading built-in `google` provider label was removed from the public contract.
- Generated docs and runtime behavior are now better aligned.
- Engine defaults no longer mutate caller-owned DAG definitions during execution.

## Getting Started

- **Existing users:** upgrade to `@swarmengine/core@0.3.0`
- **New users:** start with the getting-started guide, then attach the built-in monitor for live visibility

## What's Next

We're continuing to tighten the observability and execution story around multi-agent workflows, especially where production teams need clearer traces and safer iteration loops.
