---
id: fb-005
type: feature-brief
audience: marketing
topic: Real-Time Monitoring
status: draft
generated: 2026-03-15
source-tier: direct
context-files: [README.md, src/monitor/, packages/monitor-ui/]
hermes-version: 1.0.1
---

# Feature Brief: Real-Time Monitoring

## One-Liner

See every branch of your swarm in motion, with live status, retry visibility, and fewer debugging blind spots.

## What It Is

SwarmEngine includes a built-in monitor stack for watching workflows as they run. It combines an SSE-based runtime bridge with a browser UI so teams can see node progress, outputs, costs, routing decisions, feedback retries, and guard warnings in one place.

## Who It's For

- **Primary:** Engineering teams building, debugging, or demoing multi-agent workflows
- **Secondary:** Support and platform teams that need quick visibility into what happened during a run

## The Problem It Solves

Multi-agent workflows often feel like a black box. Teams know a swarm finished, but not which branch slowed down, where a retry loop kicked in, or why a guard blocked output. That slows debugging, support, and stakeholder confidence.

## Key Benefits

- **Live branch visibility:** Parallel DAG branches update as they happen.
- **Better quality-loop visibility:** Feedback retries, escalations, and guard outcomes show up in the same surface as node progress.
- **Faster adoption:** Root-level monitor commands make the UI easier to run, test, and demo.
- **Higher trust:** Teams get a clearer picture of what a swarm did without changing workflow behavior.

## How It Works (Simplified)

Start the monitor server, forward swarm events to it, and open the local UI. The monitor turns raw engine events into a live execution view and a current-state snapshot that browsers can consume immediately.

## Competitive Context

Competitive positioning requires additional context — provide competitive analysis docs to populate this section.

## Proof Points

Proof points require usage data or customer feedback to populate.

## Suggested Messaging

- **Announcement:** SwarmEngine now lets you watch parallel workflows unfold in real time, including feedback loops and guard activity.
- **Sales pitch:** Stop treating multi-agent workflows like a black box. SwarmEngine shows every branch, retry, and warning as it happens.
- **One-liner:** Multi-agent runs you can actually see and trust.
