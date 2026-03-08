---
id: fb-006
type: feature-brief
audience: marketing
topic: Handoff Templates
status: draft
generated: 2026-03-08
source-tier: direct
context-files: [CHANGELOG.md]
hermes-version: 1.0.0
---

# Feature Brief: Handoff Templates

## One-Liner

Structured handoffs between AI agents so every piece of work arrives organized, complete, and ready to act on.

## What It Is

Handoff Templates define exactly how one agent's output should be structured before it passes to the next agent. Instead of raw text blobs, downstream agents receive organized sections — Summary, Deliverables, Next Steps, Open Questions — in a predictable format every time. SwarmEngine ships with four built-in presets for the most common workflow patterns, and teams can create custom templates to match any process.

## Who It's For

- **Primary:** Engineering teams running multi-agent workflows where output quality degrades at handoff points
- **Secondary:** Product and operations teams building cross-functional workflows that span multiple departments or agent specialties

## The Problem It Solves

When agents hand off work to each other, the receiving agent gets a wall of unstructured text. It has to guess what's important, what's actionable, and what's missing. The result: downstream agents waste tokens re-analyzing upstream output, miss critical details, and produce lower-quality work. The longer the workflow chain, the worse this gets.

## Key Benefits

- **Consistent output quality:** Every handoff follows a defined structure, so nothing gets lost between agents
- **Faster downstream execution:** Receiving agents spend less time parsing and more time producing — fewer tokens, lower cost
- **Built-in best practices:** Four presets (standard, QA review, QA feedback, escalation) cover common patterns out of the box
- **Custom templates:** Define your own sections and structure for any workflow without writing code
- **Better debugging:** Structured output makes it easy to pinpoint exactly where a workflow went off track

## How It Works (Simplified)

When you connect two agents in a workflow, you attach a handoff template to that connection. The engine automatically formats the upstream agent's output into the template's defined sections before passing it downstream. Built-in presets handle standard workflows, QA reviews, feedback loops, and escalations. If none of the presets fit, define a custom template with exactly the sections your workflow needs.

## Competitive Context

Competitive positioning requires additional context — provide competitive analysis docs to populate this section.

## Proof Points

Proof points require usage data or customer feedback to populate.

## Suggested Messaging

- **Announcement:** SwarmEngine now ships with Handoff Templates — structured, predictable output formatting between agents so multi-step workflows stay organized from start to finish.
- **Sales pitch:** Your agents are only as good as the information they receive. Handoff Templates make sure every agent in a workflow gets clean, structured input — not a wall of text. Less rework, fewer wasted tokens, higher-quality results.
- **One-liner:** Clean handoffs between AI agents, every time.
