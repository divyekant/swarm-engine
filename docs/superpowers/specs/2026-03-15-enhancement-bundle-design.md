# Swarm Engine Enhancement Bundle Design

**Date:** 2026-03-15
**Status:** Approved for implementation

## Goal

Close the highest-value gaps identified in the project audit by making the public execution contract real, improving live observability, bringing agentic nodes closer to feature parity with standard nodes, and tightening packaging and docs around the monitor application.

## Scope

This bundle covers five concrete changes:

1. Propagate `RunOptions` through execution, context assembly, and persistence.
2. Stop mutating caller-owned DAG definitions during `engine.run()`.
3. Stream parallel node events in real time instead of buffering per-node batches.
4. Inject handoff and feedback context into agentic runs and align monitor event handling with core events.
5. Remove or reduce public contract drift in provider/docs/workspace surfaces.

## Non-Goals

- Implement a brand-new Google/Gemini provider in this bundle.
- Redesign the monitor UI visually.
- Restructure the repo beyond the minimum needed to make monitor development and CI first-class.

## Design Decisions

### 1. `RunOptions` becomes a real execution context

`threadId`, `entityType`, `entityId`, and `metadata` already exist in the public type surface. The engine will treat them as first-class run context and pass them through to:

- thread history loading for standard nodes
- entity and codebase context assembly
- persistence run creation/activity logging
- lifecycle hooks where useful via persisted metadata

This keeps docs and runtime aligned without inventing a second API.

### 2. Effective agent config is derived, not mutated

Engine defaults will be applied to transient per-run agent descriptors rather than mutating the DAG nodes passed in by the caller. The DAG definition should remain reusable and side-effect free across runs.

### 3. Parallel execution must preserve live event flow

Parallel branches should still execute concurrently, but emitted events should be interleaved to consumers as they occur. The current batching behavior weakens the monitor and any future SSE/WebSocket integrations. The executor will switch to a merge model that preserves node concurrency and forwards events immediately.

### 4. Agentic parity uses prompt-level context injection

Agentic backends currently receive upstream context plus communication tools, but not the newer handoff/feedback guidance. This bundle will extend agentic run parameters so adapters can receive structured handoff instructions and retry feedback. The initial implementation will inject them into the upstream/system prompt path instead of designing a larger adapter protocol.

### 5. Monitor contract should come from core, not a shadow type system

The monitor app currently mirrors `SwarmEvent` manually. That is brittle now that the core event surface has grown. The monitor package should consume a shared event contract or generated local type artifact from core semantics so new core events do not silently disappear in the UI state layer.

### 6. Provider contract cleanup favors honesty over speculative scope

The `google` provider type is declared but intentionally not implemented. Rather than taking on a new provider integration in this bundle, the public contract will be made honest: remove or clearly narrow the advertised surface and align docs/tests accordingly.

## Implementation Chunks

### Chunk 1: Execution contract alignment

- Wire run context through engine, executor, runner, and persistence.
- Add tests proving thread history and entity context are actually used.
- Remove in-place DAG mutation.

### Chunk 2: Executor + agentic parity

- Replace parallel event buffering with real-time merged streaming.
- Add tests proving branch events can interleave before batch completion.
- Pass handoff and feedback context into `AgenticRunner` and adapters.

### Chunk 3: Monitor + workspace + docs

- Align monitor event types/state reducer with core events.
- Add root scripts/CI coverage for `packages/monitor-ui`.
- Fix docs that currently promise runtime behavior the engine does not deliver.

## Risks

- Real-time parallel event merging can destabilize scheduler/result ordering if done carelessly.
- Run-context propagation touches multiple seams and can create brittle tests if over-mocked.
- Monitor typing changes can drift again unless the shared source-of-truth problem is solved now.

## Test Strategy

- Add focused failing tests at the unit/integration layer for each contract fix.
- Keep root `vitest` suite green.
- Add monitor package build/typecheck coverage at the root CI layer.
- Re-run root build/test and monitor build after integration.
