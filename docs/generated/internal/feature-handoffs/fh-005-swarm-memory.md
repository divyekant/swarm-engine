---
id: fh-005
type: feature-handoff
audience: internal
topic: Swarm Memory
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [src/memory/, docs/ARCHITECTURE.md]
hermes-version: 1.0.0
---

# Swarm Memory

## What It Does

SwarmMemory provides a shared, in-run communication and state layer that agents use to coordinate during a swarm execution. It consists of two complementary subsystems: the Scratchpad (a bounded key-value blackboard) and Channels (agent-to-agent messaging). Together, they allow agents to share intermediate results, pass structured data, and send messages to each other -- all without external persistence.

The memory is scoped to a single swarm run. When the run ends, the memory is discarded. There is no persistence between runs, and no cross-run state leakage.

## How It Works

### SwarmMemory Facade

The SwarmMemory class is a thin facade that composes Scratchpad and Channels into a single object. It accepts optional size limit configuration at construction time and passes those limits through to the Scratchpad. Channels have no configurable size limits.

The facade exposes both subsystems as public readonly properties: `scratchpad` and `channels`. All other components in the system interact with memory through this facade.

### Scratchpad (Blackboard)

The Scratchpad is a bounded key-value store with two storage mechanisms:

- **Key-value store** (`set` / `get`) -- For storing single values under a key. Setting a key that already exists replaces the previous value, and the byte accounting adjusts accordingly.
- **List store** (`append` / `getList`) -- For accumulating ordered lists of values under a key. Each `append` adds to the list without replacing existing entries.

Both mechanisms share a single byte budget. The Scratchpad tracks current total byte usage and enforces two limits:

- **Per-key limit** (default: 10,240 bytes / 10KB) -- Any single `set` operation that would store a value exceeding this size is rejected with an error.
- **Total limit** (default: 102,400 bytes / 100KB) -- Any write operation (`set` or `append`) that would push total usage beyond this limit is rejected with an error.

Byte estimation works by serializing the value to JSON and measuring the UTF-8 byte length. When a `set` replaces an existing value, the old value's bytes are subtracted before checking the limit.

**History tracking**: Every write operation (both `set` and `append`) is recorded in a per-key history log. Each entry (ScratchpadEntry) contains: `key`, `value`, `writtenBy` (the agent ID that performed the write), `timestamp` (epoch milliseconds), and `operation` (`'set'` or `'append'`). This history is available via `getHistory(key)` and is used for observability -- understanding which agent wrote what and when.

**Context serialization**: The `toContext()` method produces a plain-text representation of the entire scratchpad state. This output is injected into the context assembly pipeline for LLM nodes, appearing as the "Scratchpad snapshot" section. Both key-value entries and list entries are serialized as JSON strings, one per line.

### Channels

Channels provide agent-to-agent messaging with two delivery modes:

- **Point-to-point**: `send(from, to, content, metadata?)` creates a message directed at a specific agent ID.
- **Broadcast**: `broadcast(from, content, metadata?)` creates a message with `to` set to `'*'`, which is delivered to all agents.

Each message (ChannelMessage) contains: `from` (sender agent ID), `to` (recipient agent ID or `'*'`), `content` (string), optional `metadata` (arbitrary key-value pairs), and `timestamp` (epoch milliseconds).

Message retrieval works through two methods:

- `getInbox(agentId)` -- Returns all messages where `to` equals the given agent ID OR where `to` equals `'*'` (broadcasts). This is the primary method used during context assembly and by agentic tool implementations.
- `getConversation(agentA, agentB)` -- Returns all messages exchanged between two specific agents in both directions. Useful for debugging and observability.

Messages are append-only. There is no deletion, no read receipts, and no message ordering guarantee beyond the insertion timestamp.

### How LLM Nodes Access Memory

LLM nodes (those running through AgentRunner) interact with memory passively. During context assembly, the ContextAssembler includes two memory-derived sections in the agent's message context:

1. **Inbox messages** -- All messages from `channels.getInbox(agentId)` are formatted and included.
2. **Scratchpad snapshot** -- The output of `scratchpad.toContext()` is included as a text block.

LLM nodes can also actively write to memory through tool calls. The AgentNode class provides tool definitions for `send_message`, `scratchpad_set`, `scratchpad_read`, and `scratchpad_append` that the LLM can invoke during its tool-use loop.

### How Agentic Nodes Access Memory

Agentic nodes (those running through AgenticRunner) interact with memory through injected MCP tools. The AgenticRunner builds four tools at execution time:

- **`send_message`** -- Takes `to` and `content` parameters. Calls `channels.send()` with the agent's ID as the sender.
- **`scratchpad_set`** -- Takes `key` and `value` parameters. Calls `scratchpad.set()` with the agent's ID for attribution.
- **`scratchpad_read`** -- Takes a `key` parameter. Returns the JSON-serialized value, or a "not found" message.
- **`scratchpad_append`** -- Takes `key` and `value` parameters. Calls `scratchpad.append()` with the agent's ID for attribution.

These tools are passed to the agentic adapter's `run()` method as AgenticTool objects, each with a name, description, input schema, and an `execute` function that performs the memory operation and returns a confirmation string.

In addition to the tools, the AgenticRunner builds an upstream context string that includes inbox messages and the scratchpad snapshot, giving the agentic backend read access to the full memory state at execution start.

## User-Facing Behavior

Memory is invisible to the end consumer in terms of direct interaction. Its effects are observed indirectly through agent outputs: when one agent writes a key to the scratchpad, downstream agents can reference that data in their responses. When agents send messages to each other, those messages appear in the receiving agent's context.

The consumer does not need to configure memory unless they want to override the default size limits. The default limits (10KB per key, 100KB total) are sufficient for most swarms.

## Configuration

- **`limits.maxScratchpadSizeBytes`** -- Controls the total byte limit for the scratchpad. Maps to the `maxTotalBytes` parameter in the Scratchpad constructor. When not set, the default of 102,400 bytes (100KB) applies.
- The per-key limit (10,240 bytes / 10KB) is a default set within the Scratchpad class. It can be overridden by passing custom limits to the SwarmMemory constructor, but there is no top-level engine config key for it.

## Edge Cases & Limitations

- **Size limit exceeded**: When a `set` or `append` operation would push the scratchpad beyond its configured limits, the operation throws an error with a descriptive message. The calling code (either the tool-use handler in AgentNode or the MCP tool execute function in AgenticRunner) should handle this gracefully. In practice, the error message is returned to the LLM as the tool result, allowing it to adapt.

- **Broadcast delivery**: Broadcast messages (sent to `'*'`) are included in every agent's inbox, including agents that have already completed. Since already-completed agents will not run again, the broadcast is effectively only useful for agents that have not yet executed. This is a natural consequence of DAG-ordered execution.

- **No persistence across runs**: Memory is instantiated fresh for each swarm run. There is no mechanism to carry scratchpad state or channel messages from one run to another. If cross-run state is needed, consumers should use the persistence adapter or an external memory provider.

- **Key-value vs. list separation**: The `set`/`get` store and the `append`/`getList` store are separate internal maps. Setting a key and appending to the same key creates two independent entries. The `keys()` method returns the union of both stores' keys. The `toContext()` method serializes both stores.

- **Byte estimation accuracy**: Byte size is estimated by JSON-serializing the value and measuring UTF-8 byte length. For values that do not serialize cleanly to JSON (e.g., objects with circular references), this will throw. For values with large string content that contains multi-byte characters, the byte count may differ significantly from the character count.

- **No concurrency control**: When multiple agents run in parallel and access the scratchpad simultaneously, there is no locking or transactional isolation. In the current implementation, parallel node execution collects events per-node using Promise.all, so concurrent scratchpad writes are possible and follow last-write-wins semantics.

## Common Questions

**Is memory shared across swarm runs?**
No. SwarmMemory is instantiated once per run and discarded when the run completes. Each run starts with an empty scratchpad and empty channels.

**Can agents communicate with each other?**
Yes, via the Channels subsystem. Agents can send point-to-point messages to a specific agent ID, or broadcast to all agents. Receiving agents see these messages in their inbox, which is included in their execution context.

**What is the scratchpad size limit?**
The default total limit is 102,400 bytes (100KB) across all keys and lists. The default per-key limit is 10,240 bytes (10KB). These can be overridden through the SwarmMemory constructor's `limits` parameter.

**What happens if a scratchpad write exceeds the limit?**
The write is rejected with an error. For tool-use scenarios (both LLM and agentic), the error message is returned as the tool result, so the agent can adjust its approach.

**Do agentic nodes and LLM nodes use the same memory?**
Yes. Both node types read from and write to the same SwarmMemory instance. Agentic nodes use injected MCP tools; LLM nodes use tool definitions provided by AgentNode. Both ultimately call the same Scratchpad and Channels methods.

**Can I see who wrote to the scratchpad?**
Yes. Every write operation is logged in the scratchpad history with the writing agent's ID, timestamp, and operation type. Call `scratchpad.getHistory(key)` to retrieve the full write history for a key.

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Agent output does not reference data from earlier agents | Scratchpad or channel data not being read | Verify upstream agents are writing to the scratchpad or sending messages; check that the downstream agent's context assembly includes the scratchpad snapshot |
| Scratchpad write fails with size error | Per-key or total size limit exceeded | Increase `limits.maxScratchpadSizeBytes` in the engine config, or reduce the size of values being written |
| Broadcast message not received by an agent | Agent already completed before broadcast was sent | DAG ordering means earlier nodes cannot receive messages from later nodes; restructure the DAG so the broadcasting agent runs before the receiving agent |
| Agentic node cannot access scratchpad | MCP tools not injected | Verify the agentic adapter supports tool injection; check that the AgenticRunner is building communication tools for the node |
| Messages from wrong agent appearing in inbox | Broadcast messages (`to: '*'`) included in all inboxes | This is expected behavior; filter by `from` field if specific sender filtering is needed |
| Scratchpad state carries over between runs | Memory instance reused | Verify the engine creates a new SwarmMemory instance per `run()` call |

## Related

- `/docs/ARCHITECTURE.md` -- SwarmMemory section for architectural overview
- `/src/memory/index.ts` -- SwarmMemory facade
- `/src/memory/scratchpad.ts` -- Scratchpad (blackboard) implementation
- `/src/memory/channels.ts` -- Channels (messaging) implementation
- `/src/agent/agentic-runner.ts` -- MCP tool injection for agentic nodes (`buildCommunicationTools`)
- `/src/agent/runner.ts` -- LLM agent context assembly with memory integration
- `/src/agent/node.ts` -- AgentNode tool definitions for LLM agents
- `/src/context/assembler.ts` -- Context assembly pipeline (inbox and scratchpad injection)
- `/src/types.ts` -- ScratchpadEntry, ChannelMessage type definitions
