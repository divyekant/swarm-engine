---
id: ts-001
type: troubleshooting
audience: internal
topic: DAG Validation Failures
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Troubleshooting: DAG Validation Failures

## Symptoms
- `swarm_error` event with message starting with "DAG validation failed:"
- Swarm terminates immediately without executing any nodes
- Error messages referencing orphan nodes, missing providers, or invalid edges

## Quick Check
1. Check that all node IDs referenced in edges actually exist as `.agent()` calls in the DAG builder. If a node ID is misspelled in an edge, that is the issue. Fix: correct the node ID string.
2. If not, proceed to diagnostic steps.

## Diagnostic Steps

### Step 1: Check for orphan nodes
- **Inspect:** Are there nodes with no incoming or outgoing edges?
- **If yes:** Either connect them with edges or remove them from the DAG.
- **If no:** Proceed to step 2.

### Step 2: Check provider references
- **Inspect:** Do any nodes have `providerId` values that don't match keys in the engine's `providers` config?
- **If yes:** Either add the missing provider to the engine config or correct the `providerId` on the node.
- **If no:** Proceed to step 3.

### Step 3: Check conditional edge targets
- **Inspect:** Do all target node IDs in `conditionalEdge().targets` exist as nodes in the DAG?
- **If yes:** The issue may be with cycle detection or edge structure. Review the DAG topology.
- **If no:** Add the missing target nodes or correct the target IDs.

## Resolutions
### Missing Provider
- **Fix:** Add the provider to `SwarmEngineConfig.providers` with the correct type and credentials.
- **Verify:** Run again; `swarm_start` event should appear instead of `swarm_error`.
- **Prevent:** Validate provider keys against node providerId values before calling `engine.run()`.

### Orphan Nodes
- **Fix:** Connect the orphan node with at least one edge, or remove it from the DAG.
- **Verify:** Run again; all nodes should appear in execution.
- **Prevent:** Review DAG topology visually or programmatically before execution.

### Invalid Edge References
- **Fix:** Ensure all `from` and `to` values in edges match existing node IDs exactly (case-sensitive).
- **Verify:** Run again; validation should pass.

## Escalation
- **Escalate to:** Engineering team
- **Include:** Full DAG definition (nodes, edges, conditional edges), engine config (providers list), complete error message
- **SLA:** Non-critical — DAG construction is a consumer-side concern

## Related
- [fh-001 DAG Orchestration](../feature-handoffs/fh-001-dag-orchestration.md)
- [fh-007 Pluggable Adapters](../feature-handoffs/fh-007-adapters.md)
