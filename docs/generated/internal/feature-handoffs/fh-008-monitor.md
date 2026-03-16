---
id: fh-008
type: feature-handoff
audience: internal
topic: Monitor
status: draft
generated: 2026-03-15
source-tier: direct
context-files: [src/monitor/, packages/monitor-ui/, README.md]
hermes-version: 1.0.1
---

# Feature Handoff: Monitor

## What It Does

The monitor provides a real-time operational view of swarm execution. It converts `SwarmEvent` output into two browser-friendly surfaces: a live Server-Sent Events stream and a current-state snapshot that powers the local monitor UI.

In `v0.3.0`, the monitor became materially more useful for real workflows. Parallel branches now stream live instead of being batch-flushed at the end of a parallel block, and feedback-loop plus guard events are reduced into the state snapshot and UI.

## How It Works

The monitor stack has three pieces:

1. `SSEBridge` receives `SwarmEvent` objects, updates a serializable monitor state, and broadcasts each event to connected clients.
2. `createMonitorServer()` / `startMonitor()` expose `/events`, `/state`, and `/health` over a minimal Node HTTP server.
3. `packages/monitor-ui` consumes the snapshot and event stream, then renders node cards, event logs, status summaries, and route/feedback context.

### State Model

The bridge now tracks:

- Overall swarm status and progress
- Per-node status, output, error, and cost
- Route decisions and loop counts
- Feedback activity via `feedback_retry` and `feedback_escalation`
- Guard outcomes via `guard_warning` and `guard_blocked`
- Node warning collections for UI summaries

### Delivery Semantics

`v0.3.0` changed parallel event delivery. Branch events are now queued and emitted as they happen rather than being buffered until all sibling branches finish. The event contract did not change, but the monitor now reflects the true pace of concurrent execution.

### Workspace Integration

The monitor UI remains a separate package, but the repo root now treats it as a first-class workflow:

| Command | Purpose |
|--------|---------|
| `npm run test:monitor` | Run monitor reducer and summary tests |
| `npm run monitor:build` | Build the UI from the repo root |
| `npm run monitor:dev` | Start the UI dev server |
| `npm run monitor:mock` | Run a mock event source for UI work |

CI now installs, tests, and builds the monitor UI alongside the core package.

## User-Facing Behavior

Consumers integrate the monitor by starting it, forwarding every event from `engine.run()`, and connecting a browser to the monitor endpoints. Late-joining clients still use `/state` for catch-up, but that snapshot now includes feedback and guard context that previously required live event inspection.

The UI now gives internal users a clearer answer to three questions:

- What is running right now?
- Which branch or review loop is responsible for the current state?
- Did a guard warn, block, or escalate anything?

## Configuration

| Option | Type | Default | Effect |
|--------|------|---------|--------|
| `port` | `number` | `4820` | Port used by the monitor HTTP server. Use `0` for an OS-assigned port. |

There is still no built-in auth, TLS, or rate limiting.

## Edge Cases & Limitations

- The monitor is observational only. It cannot pause or alter swarm execution.
- `/events` does not replay past event frames.
- The state snapshot represents one active swarm at a time.
- The UI package is separate from `@swarmengine/core` and is not served by the monitor server itself.
- Custom or malformed event producers can still create confusing UI state if they do not follow the engine event contract.

## Common Questions

**Q: How do I run the monitor locally now?**
A: Start the swarm with `startMonitor()`, then use `npm run monitor:dev` from the repo root for the UI or `npm run monitor:mock` if you want to exercise the UI without a live swarm.

**Q: Does the monitor show feedback and guard activity without custom code?**
A: Yes. Those events are part of the reduced monitor state in `v0.3.0`.

**Q: Did live parallel streaming change event shapes?**
A: No. It changed timing, not schema.

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| UI connects but branch activity appears late | Old bridge behavior or stale build | Rebuild the core package and UI from the current repo state |
| Feedback or guard activity does not appear | Old monitor reducer or missing event forwarding | Verify the running bundle includes the updated reducer and that every swarm event is passed to `broadcast()` |
| Server does not shut down cleanly | Open SSE connections are still alive | Use `MonitorHandle.close()` so tracked sockets are destroyed before server shutdown |

## Related

- `src/monitor/sse-bridge.ts`
- `src/monitor/http-server.ts`
- `packages/monitor-ui/src/lib/state-reducer.ts`
- `packages/monitor-ui/src/lib/event-summary.ts`
- `docs/generated/external/features/feat-009-monitor.md`
