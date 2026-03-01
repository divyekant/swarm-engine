---
id: fh-008
type: feature-handoff
audience: internal
topic: Monitor
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [src/monitor/, docs/ARCHITECTURE.md]
hermes-version: 1.0.0
---

# FH-008: Monitor

## What It Does

The monitor provides a real-time web interface for observing swarm execution. It bridges the engine's internal SwarmEvent stream to browser clients over Server-Sent Events (SSE). A lightweight HTTP server exposes three endpoints: an SSE stream for live events, a JSON state snapshot for catch-up, and a health check. The monitor is purely observational -- it cannot influence, pause, or alter swarm execution in any way.

## How It Works

The monitor system has three components: SSEBridge, the HTTP server, and MonitorState.

### SSEBridge

SSEBridge is the core translation layer. It accepts ServerResponse objects from HTTP connections and manages them as a set of SSE clients. When a client connects, SSEBridge writes the standard SSE headers (Content-Type: text/event-stream, Cache-Control: no-cache, Connection: keep-alive, Access-Control-Allow-Origin: *) and sends an initial SSE comment (": connected") to flush the headers and confirm the connection.

Each call to broadcast() does two things: it reduces the incoming SwarmEvent into the internal MonitorState snapshot, then serializes the event as JSON and writes it to every connected client in the standard SSE data format ("data: {json}\n\n"). Client disconnects are detected via the response close event, which removes the client from the set automatically.

### MonitorState

MonitorState is a reducer-style snapshot that tracks the current swarm execution. It holds:

- **dagId**: The ID of the currently executing DAG.
- **status**: One of idle, running, completed, failed, or cancelled.
- **nodes**: A Map of node IDs to NodeState objects, each tracking agent role, agent name, execution status, output, error, and cost.
- **routeDecisions**: An array of routing decisions with from, to, and reason fields.
- **totalCost**: Aggregated CostSummary across all nodes.
- **progress**: Completed and total node counts.
- **startTime**: Timestamp when the swarm started.

The state reduces the following events: swarm_start resets the entire state for a new run; agent_start adds a node entry with running status; agent_done marks a node completed and records output and cost; agent_error marks a node failed and records the error message; swarm_progress updates completion counts; swarm_done sets status to completed with final cost; swarm_error sets status to failed with partial cost; swarm_cancelled sets status to cancelled with partial cost; route_decision appends to the routing decision log.

Events not listed above (agent_chunk, agent_tool_use, loop_iteration, budget_warning, budget_exceeded) are broadcast to clients but do not alter MonitorState.

### HTTP Server

The HTTP server is a standard Node.js http.createServer instance. It handles three routes:

- **GET /events**: Registers the connection as an SSE client via SSEBridge.addClient(). The connection stays open indefinitely until the client disconnects.
- **GET /state**: Returns the current MonitorState as JSON. This allows late-joining clients to catch up on the current execution state without replaying all events.
- **GET /health**: Returns {"status": "ok"} as a simple liveness check.

All other paths return a 404 with {"error": "Not found"}. CORS headers (Access-Control-Allow-Origin: *, Access-Control-Allow-Methods: GET, OPTIONS) are set on every response. OPTIONS requests return 204 for preflight handling.

### Server Lifecycle

Two factory functions are provided:

**createMonitorServer()** returns the raw server and bridge objects without starting the server. This is useful when the consumer wants to attach the server to an existing HTTP infrastructure or control the listen call themselves.

**startMonitor()** (exported as startMonitorServer internally) creates the server, starts listening on the configured port, and returns a MonitorHandle. The handle provides: port (the actual port, useful when configured with port 0 for random assignment), broadcast() (forwards events to the bridge), getState() (returns the JSON-serializable state), and close() (shuts down the server).

The close() method on MonitorHandle tracks all open sockets and destroys them before closing the server. This is necessary because SSE connections are long-lived and would otherwise prevent the server from shutting down cleanly.

## User-Facing Behavior

The monitor is an opt-in feature. The consumer creates a monitor, wires its broadcast function into the swarm event stream, and points a browser at the monitor URL. The browser receives a continuous stream of SwarmEvent objects formatted as SSE data frames.

A typical integration pattern is: start the monitor server, run a swarm, and pipe each event to the monitor's broadcast method. The browser client connects to /events and renders the DAG topology with real-time node status updates, streaming output, and cost accumulation.

If a browser connects after execution has started, it can hit the /state endpoint to get the current snapshot, then connect to /events for subsequent updates. The state endpoint shows which nodes have completed, which are running, what routing decisions were made, and the accumulated cost.

The monitor has no effect on the swarm itself. If no browser is connected, events are still reduced into the state snapshot but the broadcast writes go nowhere. If the monitor server fails or is never started, the swarm runs identically.

## Configuration

Configuration is minimal, handled through MonitorOptions:

- **port** (optional, number): The TCP port for the HTTP server. Defaults to 4820. Set to 0 to let the OS assign a random available port -- the actual port is available on the returned MonitorHandle.

No authentication, TLS, or rate limiting is built in. The monitor is intended for development and internal use. Production deployments should front the monitor with a reverse proxy if access control is needed.

## Edge Cases & Limitations

- **Browser disconnect does not affect swarm execution.** The monitor is purely observational. All SSE clients can disconnect and the swarm continues uninterrupted.
- **No event replay.** The /events endpoint streams events from the point of connection forward. There is no event history buffer. Late-joining clients should use /state to catch up on current status, but they will miss the detailed event stream (individual chunks, tool uses, etc.) from before they connected.
- **No authentication.** The monitor server has no auth layer. Anyone who can reach the port can observe the event stream. The CORS headers are fully permissive (Access-Control-Allow-Origin: *).
- **agent_chunk events are broadcast but not stored.** The MonitorState tracks final outputs per node, not the streaming chunks. The full streaming text is only visible to clients connected at the time the chunks are emitted.
- **Single swarm at a time.** The MonitorState is reset on each swarm_start event. If multiple swarms broadcast to the same monitor concurrently, the state will be overwritten by whichever swarm emitted the most recent swarm_start.
- **Socket tracking for clean shutdown.** The startMonitor function tracks all open TCP sockets and destroys them on close(). This is necessary because SSE connections are persistent and would otherwise block server.close() indefinitely.
- **Port conflicts.** If the default port 4820 is in use, the server emits an error event. Use port 0 for automatic assignment if port conflicts are possible.

## Common Questions

**Is the monitor required?**
No. The monitor is fully optional. The engine runs identically whether or not a monitor is started. It is a pure consumer of the event stream with no side effects on execution.

**Does the monitor affect performance?**
Minimal impact. The broadcast method serializes each event to JSON and writes it to connected clients. If no clients are connected, the only overhead is the state reduction (a few Map operations per event). The HTTP server uses Node.js built-in http module with no framework overhead.

**What port does it use?**
Port 4820 by default. Configurable via MonitorOptions. Use port 0 for OS-assigned random port.

**Can I run the monitor in production?**
The monitor has no authentication or TLS. For production use, place it behind a reverse proxy that provides access control and encryption. The monitor itself is stateless (aside from the current-run snapshot) and lightweight.

**Can multiple browsers connect simultaneously?**
Yes. SSEBridge maintains a Set of connected clients. All clients receive the same events. There is no limit on concurrent connections beyond system resource constraints.

**How do I integrate the monitor with my swarm?**
Start the monitor server, then pass its broadcast function as the event callback when running the swarm. Alternatively, use createMonitorServer() to get the bridge object directly and call bridge.broadcast() from your event handling code.

## Troubleshooting

- **Browser shows no events**: Verify the browser is connecting to the correct port. Check that the swarm is actually running and events are being broadcast. Use the /health endpoint to confirm the server is reachable.
- **State endpoint shows stale data**: The state only updates when broadcast() is called with new events. If the swarm finished but the consumer stopped forwarding events, the state reflects the last event received.
- **Server won't shut down**: SSE connections keep sockets alive. Use the MonitorHandle.close() method, which destroys all tracked sockets before closing the server. Do not call server.close() directly on the underlying server object.
- **Port already in use**: Another process is using port 4820. Either stop that process or configure a different port in MonitorOptions. Use port 0 for automatic assignment.
- **CORS errors in browser**: The monitor sets Access-Control-Allow-Origin: * on all responses. If CORS errors persist, verify no reverse proxy is stripping or overriding the headers.

## Related

- `src/monitor/sse-bridge.ts` -- SSEBridge class and MonitorState type
- `src/monitor/http-server.ts` -- HTTP server, MonitorHandle, MonitorOptions, startMonitor, createMonitorServer
- `src/monitor/index.ts` -- Re-exports for public API
- `src/types.ts` -- SwarmEvent, CostSummary, NodeStatus definitions
- `docs/ARCHITECTURE.md` -- System-level streaming events overview
- FH-007 (Adapters) -- Adapters produce the SwarmEvent stream that the monitor consumes
- FH-009 (Logging) -- Logging is a separate concern from monitoring; logs go to stderr, monitor events go to SSE
