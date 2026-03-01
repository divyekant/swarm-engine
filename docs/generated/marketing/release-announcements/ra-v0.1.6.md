---
id: ra-v0.1.6
type: release-announcement
audience: marketing
version: 0.1.6
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# SwarmEngine v0.1.6

**Structured logging, rock-solid agentic backends, and production-ready reliability.**

---

## What's New

### Structured Logging

Full observability across every engine component. Choose human-readable or JSON output format, set log levels per component, and capture logs programmatically for integration with your existing monitoring stack.

### Agentic Backend Stability

Four consecutive fixes ensure Claude Code and Codex adapters work reliably in any bundler configuration. Static imports replace lazy loading, CLI path auto-detection handles bundled environments, and module resolution failures are eliminated.

### Persistence Integration

The persistence adapter is now properly wired into DAG execution. Run records, artifacts, and execution metadata are saved correctly throughout the workflow lifecycle.

---

## Improvements

- **Token budget reporting** now includes section count for context assembly debugging
- **Logger `child()` method** creates properly scoped loggers for per-component context
- **CLI path auto-detection** for Claude Code SDK in bundled environments

---

## Getting Started

**Existing users:**

```
npm install @swarmengine/core@0.1.6
```

**New users:** See the Getting Started guide for a working example in under 5 minutes.

---

## What's Next

We're working on expanded provider support and enhanced monitoring capabilities. Stay tuned.
