---
id: op-002
type: one-pager
audience: marketing
topic: Agentic Backends
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Agentic Backends — Agents That Actually Do Things

## The Problem

Traditional AI agents generate text. They plan, analyze, and suggest. But when your workflow needs an agent to actually write code, modify files, or run commands, you hit a wall. You're stuck building custom execution layers, managing sandboxing, and bridging the gap between "the agent said to do X" and "X is done."

## The Solution

SwarmEngine's agentic backends connect workflow nodes to full execution platforms. One agent plans the implementation, another actually writes and tests the code -- all within the same orchestrated workflow.

No custom execution layer. No separate infrastructure. Just a different node type in your workflow graph.

## Key Benefits

**Real execution.**
Agents that read files, write code, run shell commands, and interact with systems. Your workflow produces working output, not just recommendations.

**Unified workflow.**
Mix planning agents (LLM) with executing agents (agentic) in one graph. The planner decides what to build. The coder builds it. The reviewer validates it. One workflow, three agent types.

**Cost visibility.**
Agentic execution costs are tracked and budget-enforced alongside standard agents. One cost model across your entire workflow.

**Modular by design.**
Install only the SDKs you need. Claude Code, Codex, or your own custom backend. SwarmEngine works fully without any agentic SDK -- add them when you're ready.

## How It Works

1. **Install** -- Add the agentic SDK you need (one npm install)
2. **Configure** -- Register the agentic provider in your engine
3. **Mix** -- Combine LLM and agentic nodes freely in your workflow graph

## Who It's For

**Code generation teams** -- Planner, Coder, Reviewer workflows where the coder actually writes code.

**Automation engineers** -- Workflows that need to interact with real file systems and APIs.

**Platform builders** -- Embed autonomous code execution in your product safely.

## Get Started

```
npm install @anthropic-ai/claude-agent-sdk
```

Then add `{ type: 'claude-code' }` to your engine providers. See the documentation for a complete walkthrough.
