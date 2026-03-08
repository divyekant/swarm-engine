---
id: ts-005
type: troubleshooting
audience: internal
topic: Guards and Feedback Loop Issues
status: draft
generated: 2026-03-08
source-tier: direct
hermes-version: 1.0.0
---

# Troubleshooting: Guards and Feedback Loop Issues

## Symptoms

- `guard_warning` or `guard_blocked` events with unexpected triggers (false positives)
- `feedback_retry` events not appearing when expected
- `feedback_escalation` firing prematurely
- Agent output not improving between feedback loop iterations
- Scope Creep Guard silently not running
- Evidence Guard triggering on output that contains evidence

## Quick Check

1. **Guards not running at all:** Check that guards are configured either on the node (`DAGNode.guards`) or engine-wide (`SwarmEngineConfig.guards`). A node with `guards: []` disables all guards, including engine-wide defaults.
2. **Feedback loop not retrying:** Check that the `FeedbackEdge` exists with `from` pointing to the reviewer node and `to` pointing to the producer node. Verify `maxRetries` is >= 1.
3. **Scope Creep Guard skipped:** Verify that at least one standard (non-agentic) LLM provider is configured. The Scope Creep Guard requires a standard provider for its evaluation LLM call.

## Diagnostic Steps

### Step 1: Enable debug logging

- **Set:** `{ logging: { level: 'debug' } }` in `SwarmEngineConfig`.
- **Look for:** Guard resolution logs (which guards are being applied to which nodes), evidence pattern match results, scope creep LLM evaluation request/response, feedback edge evaluation results.
- **If no guard-related logs appear:** Guards are not configured or the node has `guards: []`.

### Step 2: Check guard configuration scope

- **Inspect:** Does the node define its own `guards` array?
- **If yes:** That array completely replaces engine-wide guards. An empty array disables guards.
- **If no:** Engine-wide guards from `SwarmEngineConfig.guards` apply.
- **Common mistake:** Setting `guards: []` on a node thinking it means "use defaults" -- it actually means "no guards."

### Step 3: Diagnose Evidence Guard false positives

- **Inspect the output text:** Which of the 9 claim patterns triggered? Search for: "all tests pass", "no issues found", "works correctly", "verified successfully", "no errors", "no bugs", "fully functional", "everything works", "all checks pass".
- **Inspect for evidence patterns:** Does the output contain code blocks with triple backtick fences (not indented blocks)? Shell commands starting with `$` or `>`? File paths? Test result counts?
- **If output has evidence in non-standard format:** The Evidence Guard only detects the 6 specific evidence patterns listed above. Indented code blocks, screenshots, or non-standard formats are not detected.
- **Resolution:** Adjust the agent's system prompt to use standard Markdown code fences. Or switch the Evidence Guard to `warn` mode.

### Step 4: Diagnose Scope Creep Guard issues

- **If guard never triggers:** Enable debug logging and check the LLM evaluation response. The guard triggers only on explicit `OVERSCOPED` in the response.
- **If guard triggers incorrectly:** The LLM evaluation depends on the task description quality. Vague tasks like "do the thing" produce unreliable scope assessment. Make the node's task string specific.
- **If guard is silently skipped:** Confirm a standard LLM provider exists. The guard uses the first available standard provider. Agentic-only configurations silently skip this guard.
- **If LLM call fails:** The guard is fail-open. Check provider connectivity and API key validity. The failure is logged at debug level.

### Step 5: Diagnose feedback loop not retrying

- **Inspect the FeedbackEdge:** Confirm `from` is the reviewer node and `to` is the producer node. These are directional -- reversing them breaks the loop.
- **Check the evaluator:** Run the evaluator logic manually against the reviewer's output. For regex evaluators, verify the pattern matches the rejection signal (not the approval signal). For rule evaluators, verify the function returns a value other than `passLabel` on rejection.
- **Check `passLabel`:** The evaluator's return value must exactly match `passLabel` for approval. Case sensitivity matters.
- **If evaluator always returns `passLabel`:** The loop approves on the first pass. No retries occur. This is correct behavior if the reviewer's output genuinely matches.

### Step 6: Diagnose feedback not improving output

- **Check context injection:** Enable debug logging and inspect the context assembly for the retried node. Look for the `## Retry Feedback` section. If absent, the `FeedbackContext` is not being injected.
- **Check the producer's system prompt:** Does it instruct the agent to review and incorporate feedback? Without this instruction, the agent may ignore the `## Retry Feedback` section.
- **Check context window usage:** The `feedbackHistory` grows with each iteration. On later iterations, it may consume significant context. Check if upstream outputs or other context segments are being truncated to make room.

## Resolutions

### Evidence Guard false positive on substantiated output
- **Fix:** Ensure the agent outputs evidence in recognized formats: Markdown code fences (not indentation), shell commands prefixed with `$` or `>`, explicit file paths.
- **Verify:** Re-run the node. The Evidence Guard should detect evidence patterns alongside claims.
- **Alternative:** Switch to `mode: 'warn'` to surface issues without blocking.

### Scope Creep Guard not available
- **Fix:** Add at least one standard LLM provider to `SwarmEngineConfig.providers`. Even a cheap provider (e.g., Ollama local model) is sufficient.
- **Verify:** Debug logs should show the Scope Creep Guard executing and returning a classification.

### Feedback loop never retries
- **Fix:** Verify the evaluator logic. For regex: the pattern should match the approval signal, and `passLabel` should match `matchTarget`. For rule: the function should return `passLabel` only on approval.
- **Verify:** `feedback_retry` events appear in the stream after the first reviewer rejection.

### Feedback loop retries but output doesn't improve
- **Fix:** Add explicit instructions to the producer node's system prompt: "If retry feedback is provided in a ## Retry Feedback section, carefully review the feedback and address all issues in your revised output."
- **Verify:** The producer's output changes meaningfully between iterations.

### Escalation fires prematurely
- **Fix:** Increase `maxRetries` on the `FeedbackEdge`. A value of 1 allows only one retry attempt (2 total producer executions). Set to 3+ for meaningful retry cycles.
- **Verify:** The expected number of `feedback_retry` events appear before `feedback_escalation`.

## Escalation

- **Escalate to:** Engineering team
- **Include:** Full event stream (especially `guard_warning`, `guard_blocked`, `feedback_retry`, `feedback_escalation` events), guard configuration, feedback edge configuration, debug logs, node output samples.
- **SLA:** Medium -- guards and feedback loops are quality-of-life features. The swarm can operate without them.

## Related

- [fh-011 Handoff Templates](../feature-handoffs/fh-011-handoff-templates.md)
- [fh-012 Feedback Loops](../feature-handoffs/fh-012-feedback-loops.md)
- [fh-013 Anti-Pattern Guards](../feature-handoffs/fh-013-anti-pattern-guards.md)
- [uc-007 Dev-QA Feedback Loop](../use-cases/uc-007-dev-qa-feedback-loop.md)
- [uc-008 Output Quality Guards](../use-cases/uc-008-output-quality-guards.md)
