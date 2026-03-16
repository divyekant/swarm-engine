---
id: feat-009
type: feature-doc
audience: external
topic: Monitor
status: draft
generated: 2026-03-15
source-tier: direct
hermes-version: 1.0.1
---

# Monitor

## Overview

The built-in monitor gives you a live view of swarm execution. It streams events over Server-Sent Events, keeps a current state snapshot for late-joining clients, and works with the local `packages/monitor-ui` app for browser-based visualization.

In `v0.3.0`, the monitor gained better visibility into real workflows: parallel branches stream live as they happen, and feedback-loop plus guard events are available in the monitor state and UI.

## How to Use It

1. Start the monitor server with `startMonitor()`.
2. Forward every event from `engine.run()` to `monitor.broadcast(event)`.
3. Connect a browser or client to `/events` for live updates and `/state` for the latest snapshot.

```ts
import { startMonitor } from '@swarmengine/core';

const monitor = await startMonitor({ port: 4820 });

for await (const event of engine.run({ dag, task: 'Review a pull request' })) {
  monitor.broadcast(event);
}

await monitor.close();
```

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `port` | Port used by the monitor HTTP server. Use `0` for a random available port. | `4820` |

## Examples

### Example: Browser UI from the repo

If you are running from the source checkout, start the monitor UI from the repo root:

```bash
npm run monitor:dev
```

You can also exercise the UI without a live swarm:

```bash
npm run monitor:mock
```

### Example: Catch up after connecting late

Use `GET /state` to fetch the latest known swarm state, then subscribe to `GET /events` for new activity.

## Limitations

- The monitor is observational only and does not control execution.
- `/events` does not replay historical event frames.
- The state snapshot represents one active swarm at a time.
- Authentication and TLS are not built in.

## Related

- [Streaming Events](./feat-002-streaming-events.md)
- [API Reference](../api-reference.md)
- [Getting Started](../getting-started.md)
