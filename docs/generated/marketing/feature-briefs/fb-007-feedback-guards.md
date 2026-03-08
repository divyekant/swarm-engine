---
id: fb-007
type: feature-brief
audience: marketing
topic: Feedback Loops & Anti-Pattern Guards
status: draft
generated: 2026-03-08
source-tier: direct
context-files: [CHANGELOG.md]
hermes-version: 1.0.0
---

# Feature Brief: Feedback Loops & Anti-Pattern Guards

## One-Liner

Automatic quality control for AI workflows — catch bad output, give agents specific feedback, and retry until it's right.

## What It Is

Two complementary features that close the quality gap in multi-agent workflows. Feedback Loops let a reviewing agent evaluate output, provide specific critique, and send work back for revision — automatically, with no manual intervention. Anti-Pattern Guards run instant quality checks on every agent's output, catching common failure modes like unsupported claims and scope creep before they propagate downstream. Together, they ensure your workflows produce reliable, high-quality results.

## Who It's For

- **Primary:** Engineering teams running production AI workflows where output quality directly impacts business outcomes
- **Secondary:** Quality-conscious teams adopting AI automation who need confidence that agent output meets minimum standards

## The Problem It Solves

AI agents make mistakes. They claim "all tests pass" without running any tests. They do extra work nobody asked for. They produce mediocre output on the first try. Today, the options are: accept whatever comes out, build custom validation code for every workflow, or have a human review every result. None of these scale. Teams need automated quality control that catches problems and fixes them — without slowing down execution or requiring custom code.

## Key Benefits

- **Self-correcting workflows:** Agents get specific, actionable feedback and automatically revise their work — not blind retries, targeted fixes
- **Catch common AI failures:** Built-in guards detect unsupported claims and scope creep without writing custom rules
- **No extra AI cost for basic checks:** The evidence guard uses fast pattern matching, so you get quality checks without burning tokens
- **Graceful escalation:** After a configurable number of retries, the engine escalates — skip, fail, or reroute to a different agent — so workflows never get stuck in infinite loops
- **Warn or block, your choice:** Configure guards to log warnings for monitoring or hard-block bad output from moving forward

## How It Works (Simplified)

When an agent finishes its work, two things happen. First, any configured guards scan the output for known problems — if the evidence guard finds claims without supporting proof, or the scope creep guard detects unrequested work, the engine flags or blocks the output. Second, if the workflow includes a feedback loop, a reviewing agent evaluates the result and provides specific improvement notes. The engine injects that feedback back to the original agent, which revises and resubmits. This continues until the reviewer approves or the retry limit is reached, at which point the engine follows the escalation policy.

## Competitive Context

Competitive positioning requires additional context — provide competitive analysis docs to populate this section.

## Proof Points

Proof points require usage data or customer feedback to populate.

## Suggested Messaging

- **Announcement:** SwarmEngine now includes built-in quality guardrails — Feedback Loops for automatic revision cycles and Anti-Pattern Guards that catch unreliable output before it reaches production.
- **Sales pitch:** Every AI workflow has a quality problem. Agents hallucinate, cut corners, and go off-script. SwarmEngine's guardrails catch those failures automatically — no custom validation code, no human review bottleneck. Your workflows self-correct.
- **One-liner:** AI workflows that catch their own mistakes.
