---
id: fh-013
type: feature-handoff
audience: internal
topic: Anti-Pattern Guards
status: draft
generated: 2026-03-08
source-tier: direct
context-files: [CHANGELOG.md, docs/plans/2026-03-08-handoffs-feedback-guards-design.md]
hermes-version: 1.0.0
---

# FH-013: Anti-Pattern Guards

## What It Does

Anti-Pattern Guards are post-completion output quality checks that detect common LLM failure modes. After an agent node finishes producing output, guards analyze that output for problematic patterns before the result is passed downstream. Two guard types ship with the engine: the Evidence Guard (fast, no LLM call) that catches unsubstantiated claims, and the Scope Creep Guard (LLM-based, cheap) that detects when output exceeds the assigned task scope.

Guards operate in two enforcement modes: `warn` (emit a warning event, let output proceed) and `block` (emit a blocked event, treat the node as failed). Guards are configurable per-node or engine-wide, with node-level configuration overriding engine-wide defaults.

## How It Works

### Guard Interface

Every guard implements a common structure:

```typescript
interface Guard {
  id: string;                       // Unique identifier
  type: 'scope-creep' | 'evidence' | string;  // Guard type
  mode: 'warn' | 'block';          // Enforcement mode
  config?: Record<string, unknown>; // Guard-specific configuration
}
```

### Evidence Guard (`src/guards/evidence.ts`)

The Evidence Guard runs entirely locally with no LLM call. It looks for a specific pattern: the agent makes claims about verification or success, but provides no supporting evidence.

**Claim detection** scans for 9 phrases (case-insensitive):
1. "all tests pass"
2. "no issues found"
3. "works correctly"
4. "verified successfully"
5. "no errors"
6. "no bugs"
7. "fully functional"
8. "everything works"
9. "all checks pass"

**Evidence detection** scans for 6 patterns:
1. Code blocks (triple backtick fences)
2. Shell commands (lines starting with `$` or `>`)
3. File paths (patterns matching `/path/to/file` or `./relative/path`)
4. Test indicators ("test" followed by "pass", "fail", or "result" within proximity)
5. Test counts (numeric patterns like "5/5", "12 passed", "0 failed")
6. Error outputs (lines containing "error:", "warning:", "stderr:", or stack trace patterns)

**Trigger logic:** The guard triggers when at least one claim pattern is found AND zero evidence patterns are found. If claims are present but evidence is also present, the guard does not trigger (the claim is considered substantiated). If no claims are found, the guard does not trigger regardless of evidence.

### Scope Creep Guard (`src/guards/scope-creep.ts`)

The Scope Creep Guard uses an LLM call to evaluate whether the agent's output stays within the bounds of its assigned task. It is a cheap call with constrained parameters.

**LLM call parameters:**
- Temperature: 0
- Max tokens: 100
- Prompt: Evaluates the agent's output against its task description, asking for a classification of `SCOPED` or `OVERSCOPED`

The guard extracts the classification from the LLM response. If the response contains `OVERSCOPED`, the guard triggers. If the response contains `SCOPED` or is unparseable, the guard does not trigger (fail-open).

**Graceful degradation:** If no standard LLM provider is available (e.g., the DAG uses only agentic backends), the Scope Creep Guard is silently skipped. It logs a debug message and returns no findings. This ensures the guard never blocks execution due to infrastructure limitations.

### Guard Runner (`src/guards/runner.ts`)

The guard runner orchestrates guard execution for a completed node:

1. **Collect applicable guards.** Node-level guards (from `DAGNode.guards`) take priority. If the node has no guards defined, engine-wide guards (from `SwarmEngineConfig.guards`) are used. Node-level guards completely replace engine-wide guards -- they do not merge.
2. **Sort guards.** Evidence guards run first (fast, no external calls), then scope-creep guards (LLM call). This ordering ensures cheap checks run before expensive ones.
3. **Execute sequentially.** Each guard runs against the node's output. If a guard triggers in `block` mode, execution stops immediately (remaining guards are skipped). If a guard triggers in `warn` mode, a warning event is emitted and the next guard runs.
4. **Return results.** The runner returns a list of guard results indicating which guards triggered and their mode.

### New Events

Two new `SwarmEvent` types:

- **`guard_warning`**: Emitted when a guard triggers in `warn` mode. Fields: `nodeId`, `agentRole`, `guardId`, `guardType`, `message` (human-readable description of what was detected).
- **`guard_blocked`**: Emitted when a guard triggers in `block` mode. Fields: same as `guard_warning`. After this event, the node is treated as failed. Downstream nodes are skipped via the normal `skipDownstream` mechanism.

### Integration Point

Guards run in the executor after a node completes and after its output is collected, but before the output is passed to downstream nodes or used in conditional/feedback edge evaluation. The sequence is:

1. Agent completes -> output collected
2. Guard runner executes -> events emitted
3. If blocked: node marked failed, downstream skipped
4. If not blocked: output passed downstream, edges evaluated

## User-Facing Behavior

- `DAGNode` gains an optional `guards` array of `Guard` objects.
- `SwarmEngineConfig` gains an optional `guards` array of `Guard` objects (engine-wide defaults).
- `DAGBuilder.agent()` accepts `guards` in the node options.
- Two new event types (`guard_warning`, `guard_blocked`) appear in the `SwarmEvent` stream.
- Existing DAGs without guards behave identically to before.

## Configuration

| Option | Type | Default | Effect |
|--------|------|---------|--------|
| `SwarmEngineConfig.guards` | `Guard[]` | `undefined` | Engine-wide default guards applied to all nodes that do not define their own. |
| `DAGNode.guards` | `Guard[]` | `undefined` | Per-node guard list. Overrides engine-wide guards entirely (no merging). |
| `Guard.mode` | `'warn' \| 'block'` | (required) | `warn` emits an event and continues. `block` emits an event and fails the node. |
| `Guard.type` | `string` | (required) | `'evidence'` for Evidence Guard, `'scope-creep'` for Scope Creep Guard. Custom types reserved for future use. |
| `Guard.config` | `Record<string, unknown>` | `undefined` | Reserved for guard-specific options. Currently unused by built-in guards. |

## Edge Cases & Limitations

- **Node-level guards fully replace engine-wide guards.** Setting `guards: []` on a node disables all guards for that node, even if engine-wide guards are configured. This is intentional -- it allows opting out specific nodes.
- **Evidence Guard has fixed patterns.** The 9 claim patterns and 6 evidence patterns are hardcoded. Custom claim/evidence patterns are not supported. The `config` field is reserved for future customization.
- **Scope Creep Guard requires a standard LLM provider.** If the engine has only agentic providers configured, the Scope Creep Guard is silently skipped. No warning is emitted -- this is by design to avoid noisy logs in agentic-only deployments.
- **Scope Creep Guard is fail-open.** If the LLM call fails (network error, timeout, rate limit), the guard does not trigger. The error is logged at debug level. This prevents a guard infrastructure failure from blocking swarm execution.
- **Guard blocked + feedback loop interaction.** If a node is in a feedback loop and a guard blocks its output, the node is treated as failed. The feedback loop's escalation policy applies. The guard blocking counts as a failure, not a retry.
- **Guard execution adds latency.** The Evidence Guard is near-instant (string matching). The Scope Creep Guard adds one LLM call (typically 1-3 seconds). This latency occurs after every node completion where the guard is configured.
- **Short output.** The Evidence Guard may not trigger on very short outputs (under ~20 characters) because neither claim nor evidence patterns are likely to match. This is acceptable behavior -- very short outputs are typically not making unsubstantiated claims.
- **Agentic backend nodes.** Guards run on the final output of agentic nodes, not on intermediate steps. The guard sees only what the agentic backend produced as its final result.

## Common Questions

**Q: Can I use guards with feedback loops?**
A: Yes, but the interaction is sequential: the producer runs, guards check the output, and if passed, the output goes to the reviewer. If a guard blocks the output, the feedback loop treats it as a node failure, triggering the escalation policy. Guards do not participate in the retry cycle -- they gate the output before it reaches the reviewer.

**Q: Do guards run on the reviewer node's output too?**
A: Yes, if the reviewer node has guards configured (either directly or via engine-wide defaults). Guards run on every completed node. This means a reviewer could have an Evidence Guard that checks whether it substantiated its review claims.

**Q: How do I disable guards for a specific node when engine-wide guards are set?**
A: Set `guards: []` on the node. An empty array overrides the engine-wide default, disabling all guards for that node.

**Q: What does the guard_warning event look like?**
A: `{ type: 'guard_warning', nodeId: 'coder-1', agentRole: 'developer', guardId: 'evidence-1', guardType: 'evidence', message: 'Output contains claims ("all tests pass") without supporting evidence (no code blocks, test results, or file paths found).' }`

**Q: Can I add custom guard types?**
A: Not currently. The `Guard.type` field accepts any string, but only `'evidence'` and `'scope-creep'` have implementations. Custom guard types are reserved for a future plugin system. Unrecognized types are silently skipped with a debug log.

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Evidence Guard triggers on output that contains evidence | Evidence patterns not matching the format in the output (e.g., code blocks use indentation instead of backtick fences) | Check that evidence uses standard Markdown code fences. Indented code blocks are not detected. |
| Scope Creep Guard never triggers | No standard LLM provider configured, or LLM response is unparseable | Ensure at least one standard provider is configured. Enable debug logging to see LLM evaluation responses. |
| `guard_blocked` but the output looks fine | Guard is in `block` mode and the trigger condition was met even if the output is acceptable to humans | Switch the guard to `warn` mode to observe triggers without blocking. Adjust patterns or prompt if false positives are frequent. |
| Guards not running on a specific node | Node has `guards: []` set, or the node type is not producing text output | Check the node's `guards` field. Remove the empty array to inherit engine-wide guards. |
| Scope Creep Guard adds too much latency | LLM call for evaluation is slow | Check provider response times. The guard uses `maxTokens: 100` which should be fast. Consider switching to `warn` mode or disabling for non-critical nodes. |

## Related

- `src/guards/evidence.ts` -- Evidence Guard implementation (claim and evidence pattern detection)
- `src/guards/scope-creep.ts` -- Scope Creep Guard implementation (LLM-based scope classification)
- `src/guards/runner.ts` -- Guard runner (orchestration, sorting, event emission)
- `src/types.ts` -- `Guard` type definition
- `src/dag/executor.ts` -- Guard runner integration point (post-completion, pre-downstream)
- `src/streaming/events.ts` -- `guard_warning` and `guard_blocked` event definitions
- FH-012 (Feedback Loops) -- Interaction between guards and feedback loop escalation
- FH-010 (Error Handling) -- Node failure handling when a guard blocks
