---
id: ts-004
type: troubleshooting
audience: internal
topic: Agentic Backend Issues
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Troubleshooting: Agentic Backend Issues

## Symptoms
- Error message "Cannot find module '@anthropic-ai/claude-agent-sdk'" or similar for Codex SDK
- Agentic node fails with "Claude Code agent failed" or similar message
- `agent_error` event from an agentic node with unclear error message

## Quick Check
1. Check that the required SDK is installed: `npm ls @anthropic-ai/claude-agent-sdk` (for Claude Code) or `npm ls @openai/codex-sdk` (for Codex). If not installed, that is the issue. Fix: `npm install @anthropic-ai/claude-agent-sdk` or `npm install @openai/codex-sdk`.
2. If installed, proceed to diagnostic steps.

## Diagnostic Steps

### Step 1: Check SDK version
- **Run:** `npm ls @anthropic-ai/claude-agent-sdk` (or codex equivalent)
- **If version mismatch:** Update to `^0.2.50` for Claude Agent SDK.
- **If correct version:** Proceed to step 2.

### Step 2: Check agentic options
- **Inspect:** Is `cwd` set and does the directory exist? Is `permissionMode` appropriate?
- **If `cwd` doesn't exist:** Create the directory or change the path.
- **If permission issues:** Adjust `permissionMode` or `allowedTools`/`disallowedTools`.

### Step 3: Check for nested session errors
- **Inspect:** Is the agentic node being spawned from within another Claude Code session?
- **If yes:** Nested sessions are not supported. Restructure the DAG to avoid nesting.

### Step 4: Check CLI path resolution
- **Inspect:** Is the SDK unable to find its own CLI executable?
- **If yes:** Set `agentic.pathToClaudeCodeExecutable` explicitly in the agent descriptor.

## Resolutions
### SDK Not Installed
- **Fix:** Install the SDK: `npm install @anthropic-ai/claude-agent-sdk` or `npm install @openai/codex-sdk`
- **Verify:** Run the DAG again; agentic node should start executing.
- **Prevent:** Add the SDK to your project's dependencies (not devDependencies).

### CLI Path Not Found
- **Fix:** Set `pathToClaudeCodeExecutable` in the agentic options to the absolute path of the CLI.
- **Verify:** Node executes without path resolution errors.

### Nested Session
- **Fix:** Restructure the DAG so agentic nodes don't spawn from within agentic sessions.
- **Verify:** Each agentic node runs in its own independent session.

## Escalation
- **Escalate to:** Engineering team
- **Include:** SDK version, agentic options configuration, full error message, environment details
- **SLA:** Medium — agentic backends are optional features

## Related
- [fh-002 Agent Execution](../feature-handoffs/fh-002-agent-execution.md)
- [fh-007 Pluggable Adapters](../feature-handoffs/fh-007-adapters.md)
