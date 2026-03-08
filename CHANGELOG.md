# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-03-08

### Added
- **Handoff Templates**: Structured output formatting between nodes via edge configuration. Built-in presets: `standard`, `qa-review`, `qa-feedback`, `escalation`. Custom templates supported inline or by name.
- **Feedback Edges**: Engine-managed Dev-QA retry loops with automatic feedback injection. Configurable `maxRetries` and escalation policies (`skip`, `fail`, `reroute`). New events: `feedback_retry`, `feedback_escalation`.
- **Anti-Pattern Guards**: Post-completion output quality checks with configurable `warn`/`block` modes.
  - Evidence guard: Pattern-based detection of unsupported claims (e.g., "all tests pass" without test output)
  - Scope creep guard: LLM-based detection of unrequested work beyond the task scope
  - Guards configurable per-node or engine-wide. New events: `guard_warning`, `guard_blocked`.
