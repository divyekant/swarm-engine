# Enhancement Bundle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the audited public/runtime contract real, improve live parallel observability, align agentic and standard node behavior, and bring monitor/workspace integration up to first-class status.

**Architecture:** The work is split into three independent code tracks with disjoint write scopes: execution contract propagation, executor/agentic event behavior, and monitor/workspace/documentation alignment. Each track starts with failing tests or explicit verification changes, then applies the minimal implementation needed to satisfy the new contract.

**Tech Stack:** TypeScript, Vitest, tsup, React/Vite monitor UI, GitHub Actions

---

## Chunk 1: Core Execution Contract

### Task 1: Wire `RunOptions` into standard execution

**Files:**
- Modify: `src/engine.ts`
- Modify: `src/dag/executor.ts`
- Modify: `src/agent/runner.ts`
- Modify: `src/context/assembler.ts`
- Modify: `src/types.ts`
- Test: `tests/context/assembler.test.ts`
- Test: `tests/integration/persistence.test.ts`
- Test: `tests/engine.test.ts`

- [ ] Step 1: Add failing tests proving `threadId`, `entityType`, and `entityId` are propagated into runtime behavior.
- [ ] Step 2: Run the targeted tests and verify they fail for the expected reason.
- [ ] Step 3: Add a run-context path from `SwarmEngine.run()` through `DAGExecutor` into `AgentRunner` and `ContextAssembler`.
- [ ] Step 4: Load thread history and entity/codebase context from the passed run context.
- [ ] Step 5: Re-run the targeted tests and make them pass.
- [ ] Step 6: Run the broader engine/context/persistence test group.

### Task 2: Stop mutating caller-owned DAG nodes

**Files:**
- Modify: `src/engine.ts`
- Test: `tests/engine.test.ts`

- [ ] Step 1: Add a failing test that reuses the same DAG across runs and asserts caller-owned node descriptors are unchanged.
- [ ] Step 2: Run the targeted engine test and verify it fails.
- [ ] Step 3: Refactor default application to use effective per-run descriptors instead of mutating `options.dag.nodes`.
- [ ] Step 4: Re-run the engine tests and make them pass.

### Task 3: Persist richer run metadata honestly

**Files:**
- Modify: `src/types.ts`
- Modify: `src/dag/executor.ts`
- Modify: `src/adapters/defaults.ts`
- Test: `tests/adapters/persistence.test.ts`
- Test: `tests/integration/persistence.test.ts`

- [ ] Step 1: Add failing tests for create-run metadata/thread/entity propagation where the public contract expects it.
- [ ] Step 2: Extend persistence types and calls minimally to carry the new context.
- [ ] Step 3: Re-run persistence tests and fix regressions.

## Chunk 2: Executor + Agentic Parity

### Task 4: Stream parallel branch events in real time

**Files:**
- Modify: `src/dag/executor.ts`
- Test: `tests/dag/executor.test.ts`
- Test: `tests/integration/parallel.test.ts`

- [ ] Step 1: Add a failing test that demonstrates parallel events are currently buffered until all branches settle.
- [ ] Step 2: Run the targeted executor/parallel tests and verify the failure.
- [ ] Step 3: Replace per-node event buffering with a merged async stream that yields events immediately while preserving final result correctness.
- [ ] Step 4: Re-run targeted tests, then the broader DAG/integration suite.

### Task 5: Inject handoff and feedback context into agentic nodes

**Files:**
- Modify: `src/agent/agentic-runner.ts`
- Modify: `src/adapters/agentic/types.ts`
- Modify: `src/adapters/agentic/claude-code-adapter.ts`
- Modify: `src/adapters/agentic/codex-adapter.ts`
- Test: `tests/agent/agentic-runner.test.ts`
- Test: `tests/integration/agentic-mixed.test.ts`

- [ ] Step 1: Add failing tests proving handoff instructions and feedback context reach agentic adapters.
- [ ] Step 2: Extend agentic run params and adapter prompt assembly to carry those sections.
- [ ] Step 3: Re-run targeted agentic tests and mixed integration tests.

## Chunk 3: Monitor, Workspace, and Docs

### Task 6: Align monitor event contract with core

**Files:**
- Modify: `packages/monitor-ui/src/lib/types.ts`
- Modify: `packages/monitor-ui/src/lib/state-reducer.ts`
- Modify: `packages/monitor-ui/src/components/EventLog.tsx`
- Modify: `src/monitor/sse-bridge.ts` (if needed for state parity)

- [ ] Step 1: Update monitor event/state types to cover the current core event surface.
- [ ] Step 2: Update reducer and event log summaries for feedback/guard events and any missing event handling.
- [ ] Step 3: Build the monitor app and fix any type/runtime issues.

### Task 7: Make monitor workflows first-class at repo level

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

- [ ] Step 1: Add root scripts for monitor build/typecheck or equivalent workspace commands.
- [ ] Step 2: Add monitor verification to CI.
- [ ] Step 3: Document local monitor development from the repo root.

### Task 8: Remove provider/docs contract drift

**Files:**
- Modify: `src/types.ts`
- Modify: `src/adapters/providers/index.ts`
- Modify: `README.md`
- Modify: `docs/GUIDE.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/generated/external/api-reference.md`
- Modify: `docs/generated/external/config-reference.md`
- Modify: `docs/generated/external/features/feat-004-adapters.md`
- Modify: `tests/adapters/providers/mock-provider.test.ts`

- [ ] Step 1: Decide on honest contract path for `google` provider in this bundle: remove advertised support rather than partially implement it.
- [ ] Step 2: Update types/tests/docs accordingly.
- [ ] Step 3: Re-run provider tests and spot-check docs for consistency.

## Final Verification

- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run build`
- [ ] Run: `npm test`
- [ ] Run: `npm --prefix packages/monitor-ui run build`
- [ ] Review the changed docs and public API for consistency before reporting completion.
