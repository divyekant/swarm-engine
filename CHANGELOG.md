# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-03-15

### Added
- Real-time parallel event streaming for executor consumers, so fast branches emit events before slower siblings finish.
- First-class monitor workflows from the repo root, including monitor tests, build commands, and CI coverage.
- Monitor UI coverage for feedback-loop and guard events, plus reducer and event-summary unit tests.

### Changed
- `RunOptions` thread, entity, and metadata fields now propagate through execution, context assembly, and persistence for standard runs.
- Engine defaults are applied to an effective per-run DAG instead of mutating caller-owned DAG definitions.
- Agentic runs now receive handoff instructions and retry feedback through the existing prompt/context path.
- Monitor state snapshots and UI surfaces now include feedback-loop activity and guard warnings.

### Removed
- The unimplemented built-in `google` provider type from `ProviderConfig`; use a `custom` provider for Google integrations until a real adapter exists.

### Fixed
- Public docs and generated references now match the actual runtime provider and context behavior.

## [0.2.0] - 2026-03-08

### Added
- **Handoff Templates**: Structured output formatting between nodes via edge configuration. Built-in presets: `standard`, `qa-review`, `qa-feedback`, `escalation`. Custom templates supported inline or by name.
- **Feedback Edges**: Engine-managed Dev-QA retry loops with automatic feedback injection. Configurable `maxRetries` and escalation policies (`skip`, `fail`, `reroute`). New events: `feedback_retry`, `feedback_escalation`.
- **Anti-Pattern Guards**: Post-completion output quality checks with configurable `warn`/`block` modes.
  - Evidence guard: Pattern-based detection of unsupported claims (e.g., "all tests pass" without test output)
  - Scope creep guard: LLM-based detection of unrequested work beyond the task scope
  - Guards configurable per-node or engine-wide. New events: `guard_warning`, `guard_blocked`.
