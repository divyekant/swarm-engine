---
id: uc-007
type: use-case
audience: internal
topic: Dev-QA Feedback Loop
status: draft
generated: 2026-03-08
source-tier: direct
hermes-version: 1.0.0
---

# Use Case: Dev-QA Retry Loop with Feedback Injection

## Trigger

A consumer builds a DAG with a developer node and a QA reviewer node, connected by a `FeedbackEdge`. The QA node evaluates the developer's output and either approves it or provides rejection feedback that the engine injects back into the developer node for a retry.

## Preconditions

- A `FeedbackEdge` exists with `from` set to the QA node and `to` set to the developer node.
- `maxRetries` is set to a positive integer (e.g., 3).
- An `Evaluator` is configured on the feedback edge (rule, regex, or llm) with a `passLabel` that matches the QA node's approval signal.
- Both nodes reference valid providers with sufficient budget for multiple iterations.

## Flow

1. **Consumer does:** Builds DAG with `builder.agent('coder', ...)` and `builder.agent('reviewer', ...)`, connects them with `builder.edge('coder', 'reviewer')` and `builder.feedbackEdge('reviewer', 'coder', { maxRetries: 3, evaluate: { type: 'regex', pattern: 'APPROVED', matchTarget: 'pass', elseTarget: 'fail' }, passLabel: 'pass' })`.
   **System does:** Validates DAG including feedback edge references.

2. **System does:** Coder node executes (iteration 1). Output produced.
   **Consumer sees:** `agent_start` -> `agent_chunk`* -> `agent_done` for coder.

3. **System does:** Reviewer node executes, evaluates coder's output.
   **Consumer sees:** `agent_start` -> `agent_chunk`* -> `agent_done` for reviewer.

4. **System does:** Feedback edge evaluator runs on reviewer output. Regex checks for "APPROVED".
   - **If "APPROVED" found:** Evaluator returns `pass` (matches `passLabel`). Loop ends. Proceed to step 7.
   - **If "APPROVED" not found:** Evaluator returns `fail`. Proceed to step 5.

5. **System does:** Iteration count checked against `maxRetries`.
   - **If iteration < maxRetries:** Coder node reset to `pending`. `FeedbackContext` constructed with reviewer's output as `previousFeedback`. `feedback_retry` event emitted.
   **Consumer sees:** `feedback_retry` event with `{ nodeId: 'coder', iteration: 2, maxRetries: 3, feedback: '...' }`.
   - **If iteration >= maxRetries:** Proceed to step 6.

6. **System does:** Escalation policy executes.
   **Consumer sees:** `feedback_escalation` event.
   - **skip:** Coder's last output is accepted. Downstream proceeds.
   - **fail:** Coder marked failed. Downstream skipped.
   - **reroute:** Execution redirected to the reroute target node.

7. **System does:** Coder re-executes with `FeedbackContext` injected at priority 1. Context includes the `## Retry Feedback` section with the reviewer's rejection feedback and full feedback history.
   **Consumer sees:** New `agent_start` for coder (iteration 2). Full agent lifecycle events repeat for coder, then reviewer.

8. **Repeat steps 3-7** until approved or maxRetries exhausted.

9. **System does:** On approval, execution proceeds to nodes downstream of the coder (skipping the reviewer in the downstream chain). The coder's approved output is the one passed downstream.
   **Consumer sees:** Normal downstream execution with `agent_start` events for the next nodes.

## Variations

- **LLM evaluator instead of regex:** Use `evaluate: { type: 'llm', prompt: 'Is this code review output an approval or a rejection?', targets: ['pass', 'reject'] }` with `passLabel: 'pass'`. More flexible but adds a small LLM call per evaluation.
- **Rule evaluator with custom logic:** Use `evaluate: { type: 'rule', fn: (output) => output.includes('LGTM') ? 'pass' : 'fail' }` for programmatic evaluation.
- **Escalation with reroute:** Set `escalation: { action: 'reroute', reroute: 'senior-coder', message: 'Junior coder failed review after 3 attempts' }` to redirect to a more capable agent on exhaustion.
- **Guards combined with feedback:** Add an Evidence Guard on the coder node. If the guard blocks the output before it reaches the reviewer, the feedback loop treats this as a node failure and the escalation policy fires.

## Edge Cases

- **Reviewer approves on first pass:** No retry occurs. The feedback loop is transparent -- only one coder execution and one reviewer execution happen. No `feedback_retry` events are emitted.
- **Reviewer fails (error, not rejection):** The feedback loop halts. The reviewer's failure propagates via normal error handling. The coder retains its last output.
- **Budget exceeded mid-loop:** The swarm stops with a `budget_exceeded` event. Partial results include all completed iterations.
- **Coder produces identical output on every retry:** The loop still runs all iterations. There is no content-based deduplication. The escalation policy eventually fires.
- **maxRetries set to 1:** One retry attempt is made after the initial failure. Total possible coder executions: 2 (initial + 1 retry).

## Data Impact

| Data | Action | Location |
|------|--------|----------|
| Coder output per iteration | Overwritten on each retry (latest output retained) | In-memory output map |
| Reviewer output per iteration | Accumulated in `feedbackHistory` array | `FeedbackContext` |
| Cost per iteration | Accumulated (each iteration adds cost for both coder and reviewer) | `CostTracker` |
| `feedback_retry` events | Emitted per retry iteration | `SwarmEvent` stream |
| `feedback_escalation` event | Emitted once if maxRetries exhausted | `SwarmEvent` stream |
| Persistence records | One `agent_run` record per node execution (including retries) | `PersistenceAdapter` |

## CS Notes

- Feedback loops multiply cost. A loop with `maxRetries: 3` can produce up to 8 agent runs (1 initial coder + 1 initial reviewer + 3 retried coders + 3 retried reviewers). Advise consumers to set budget limits when using feedback loops.
- The `feedback_retry` event is the key event for UI progress tracking. It includes the current iteration number and maxRetries, suitable for a progress bar or step indicator.
- If a consumer reports that feedback is not improving output quality, check: (1) whether the coder's system prompt instructs it to incorporate feedback, and (2) whether the `FeedbackContext` is appearing in the context (enable debug logging).
- The escalation policy default is `fail`. Consumers who want graceful degradation should explicitly set `escalation: { action: 'skip' }`.
