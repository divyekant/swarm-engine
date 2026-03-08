---
id: uc-008
type: use-case
audience: internal
topic: Output Quality Guards
status: draft
generated: 2026-03-08
source-tier: direct
hermes-version: 1.0.0
---

# Use Case: Guard-Based Output Quality Enforcement

## Trigger

A consumer configures guards on DAG nodes (or engine-wide) to automatically detect common LLM output quality issues. Guards run after each node completes, before the output is passed downstream. The two built-in guard types are the Evidence Guard (detects unsubstantiated claims) and the Scope Creep Guard (detects output that exceeds the assigned task scope).

## Preconditions

- At least one guard is configured, either per-node (`DAGNode.guards`) or engine-wide (`SwarmEngineConfig.guards`).
- For the Scope Creep Guard: at least one standard LLM provider is configured (agentic-only setups silently skip this guard).
- The node's task description is specific enough for scope evaluation (vague tasks produce unreliable scope creep detection).

## Flow

1. **Consumer does:** Configures guards on the engine or individual nodes.
   ```typescript
   const engine = new SwarmEngine({
     providers: { anthropic: { type: 'anthropic', apiKey: '...' } },
     guards: [
       { id: 'evidence-check', type: 'evidence', mode: 'warn' },
       { id: 'scope-check', type: 'scope-creep', mode: 'block' }
     ]
   });
   ```
   **System does:** Stores guards in engine configuration.

2. **System does:** DAG execution proceeds. A node completes, producing output.
   **Consumer sees:** `agent_done` event for the node.

3. **System does:** Guard runner collects applicable guards. Sorts: evidence guards first, scope-creep guards second.

4. **System does:** Evidence Guard runs. Scans output for claim patterns and evidence patterns.
   - **Claims found, no evidence:** Guard triggers.
     - **warn mode:** `guard_warning` event emitted. Execution continues.
     - **block mode:** `guard_blocked` event emitted. Node marked failed. Remaining guards skipped.
   - **Claims found with evidence, or no claims:** Guard does not trigger. Next guard runs.

5. **System does:** Scope Creep Guard runs (if not already blocked). Sends node task + output to LLM for scope classification.
   - **LLM returns OVERSCOPED:** Guard triggers.
     - **warn mode:** `guard_warning` event emitted. Output proceeds downstream.
     - **block mode:** `guard_blocked` event emitted. Node marked failed. Downstream skipped.
   - **LLM returns SCOPED or unparseable response:** Guard does not trigger. Output proceeds downstream.
   - **LLM call fails:** Guard is skipped (fail-open). Debug log entry written.

6. **System does:** If no guards blocked, output is passed to downstream nodes and edge evaluation proceeds normally.
   **Consumer sees:** Downstream `agent_start` events (or `guard_warning`/`guard_blocked` events if guards triggered).

## Variations

- **Warn-only deployment:** Set all guards to `mode: 'warn'`. Guards emit `guard_warning` events but never block output. Useful for initial rollout to observe false positive rates before enabling blocking.
- **Evidence Guard only:** Configure only the Evidence Guard (no LLM dependency). Fast, deterministic, zero additional cost.
- **Per-node override:** A critical node uses `mode: 'block'`; non-critical nodes use `mode: 'warn'`. Set `guards` on individual nodes to override the engine-wide defaults.
- **Disable guards for a specific node:** Set `guards: []` on the node to opt out of engine-wide guards entirely.
- **Guards with feedback loops:** When a guard blocks a node that is part of a feedback loop, the feedback loop's escalation policy handles the failure. The guard blocking is treated as a node failure, not a retry-eligible rejection.

## Edge Cases

- **Output has claims and evidence but evidence is unrelated to claims:** The Evidence Guard does not evaluate semantic relevance between claims and evidence. It only checks for the presence of both. A claim of "all tests pass" paired with an unrelated code block passes the guard.
- **Scope Creep Guard on a node with no task string:** The guard sends an empty task to the LLM. The LLM classification is unreliable without a task baseline. The guard may produce false positives or false negatives.
- **Multiple guards trigger on the same output:** In `warn` mode, multiple `guard_warning` events are emitted (one per guard). In `block` mode, execution stops at the first blocking guard -- subsequent guards are not evaluated.
- **Very long output:** Both guards process the full output text. The Evidence Guard uses string matching (fast regardless of length). The Scope Creep Guard sends the full output to the LLM, which may hit token limits. The LLM call uses constrained max_tokens (100) for the response but the input can be large.
- **Agentic-only engine with Scope Creep Guard configured:** The Scope Creep Guard is silently skipped. No warning event is emitted. The Evidence Guard still runs. Only the Scope Creep Guard requires a standard LLM provider.

## Data Impact

| Data | Action | Location |
|------|--------|----------|
| Guard results | Not persisted by the engine | Emitted as `SwarmEvent` only |
| `guard_warning` events | Emitted per triggered guard in warn mode | `SwarmEvent` stream |
| `guard_blocked` events | Emitted when a guard blocks in block mode | `SwarmEvent` stream |
| Node status | Changed to `failed` if a guard blocks | `Scheduler` status map |
| Downstream nodes | Skipped via `skipDownstream` if guard blocks | `Scheduler` status map |
| LLM cost for Scope Creep Guard | Recorded in `CostTracker` | Per-node cost tracking |

## CS Notes

- The Evidence Guard catches a common LLM failure mode where agents claim "all tests pass" without showing actual test output. In `warn` mode, this surfaces the issue in the event stream without disrupting the workflow.
- The Scope Creep Guard adds one LLM call per node (typically $0.001-0.005). For large DAGs, this can add up. Recommend using it selectively on high-stakes nodes rather than engine-wide for cost-sensitive consumers.
- If a consumer reports excessive false positives from the Evidence Guard, review the agent's output format. Agents that use indented code blocks (4 spaces) instead of backtick fences will not match the evidence pattern for code blocks. Advise using Markdown fences.
- Guard events (`guard_warning`, `guard_blocked`) include a `message` field with a human-readable description. This message is suitable for display in consumer UIs.
- Guards do not retry. If a consumer wants automatic retry after a guard blocks, they should combine guards with feedback loops. The guard blocking triggers the feedback loop's escalation policy.
