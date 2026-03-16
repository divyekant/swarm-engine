---
id: rn-v0.3.0
type: release-notes
audience: internal
version: 0.3.0
status: draft
generated: 2026-03-15
commit-range: c94a194..6ccdb03
source-tier: direct
hermes-version: 1.0.1
---

# Internal Release Notes — v0.3.0

**Date:** 2026-03-15
**Commits:** 2 since the last Hermes baseline

## Summary

`v0.3.0` closes several public-runtime contract gaps and improves live observability. The main changes are full `RunOptions` propagation for standard runs, real-time parallel event delivery, stronger handoff and feedback support for agentic nodes, first-class monitor workflows from the repo root, and removal of the misleading built-in `google` provider type.

## Breaking Changes

### Built-in `google` provider type removed

- **What changed:** `ProviderConfig.type` no longer advertises a built-in `google` option.
- **Why it changed:** The type existed in the public contract but had no runtime implementation.
- **Migration:** Use `type: 'custom'` with your own `ProviderAdapter` for Google integrations until an official adapter exists.
- **Who is affected:** Consumers who depended on the published type surface rather than a working adapter path.

## New Features

### Real-time parallel event streaming

- **What:** Parallel branches now emit events as they happen rather than flushing all branch events after sibling completion.
- **How:** `DAGExecutor.runNodesParallel()` now uses a live event queue for concurrent node output.
- **Who it affects:** Monitor users, SSE consumers, and any custom tooling that expects real-time branch visibility.
- **CS Notes:** Event shapes did not change, but ordering across sibling branches is now live rather than grouped by completion.

### First-class monitor workflows

- **What:** Root scripts and CI coverage now include the monitor UI.
- **How:** Added `test:monitor`, `monitor:build`, `monitor:dev`, and `monitor:mock`, plus monitor-specific tests and reducer coverage.
- **Who it affects:** Internal developers, demos, and support/debugging workflows.
- **CS Notes:** The monitor UI is still a separate package, but it is much easier to run from the repo root.

## Improvements

- `RunOptions.threadId`, `entityType`, `entityId`, and `metadata` now propagate through standard execution, context assembly, and persistence.
- Agentic nodes now receive handoff instructions and feedback-loop retry context through the existing prompt/context path.
- Monitor state now includes `feedback_retry`, `feedback_escalation`, `guard_warning`, and `guard_blocked`.
- Engine defaults are now applied to a per-run DAG copy instead of mutating caller-owned DAG definitions.

## Configuration Changes

| Option | Change | Old Value | New Value | Notes |
|--------|--------|-----------|-----------|-------|
| `ProviderConfig.type` | removed | included `google` | no built-in `google` | Use `custom` for Google integrations |
| `RunOptions.threadId` | behavior corrected | public only | public + runtime + persistence | Standard runs now load and persist thread context |
| `RunOptions.entityType/entityId` | behavior corrected | partial | end-to-end | Standard runs now pass entity context consistently |
| `RunOptions.metadata` | behavior corrected | partial | end-to-end | Metadata now persists with run records |

## Known Issues

- The monitor UI is still a separate package versioned independently from the core package.
- Hermes-generated docs remain partial for some older feature pages that were not regenerated in this update pass.

## Internal Notes

- Apollo release config still has `publish: false`, so `v0.3.0` remains a git release unless explicitly published later.
- The release tag `v0.3.0` points to `6ccdb03` (`chore: release v0.3.0`).
