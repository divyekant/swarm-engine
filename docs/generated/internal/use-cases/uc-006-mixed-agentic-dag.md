---
id: uc-006
type: use-case
audience: internal
topic: Mixed Agentic + LLM DAG
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Use Case: Mixed Agentic + LLM DAG

## Trigger
A consumer constructs a DAG mixing standard LLM nodes (thinkers) with agentic backend nodes (doers). Example: LLM planner → Claude Code coder → LLM reviewer.

## Preconditions
- Engine configured with both standard providers (e.g., anthropic) and agentic providers (e.g., claude-code)
- Agentic SDK installed as a dependency (e.g., `@anthropic-ai/claude-agent-sdk` for Claude Code nodes)
- Agentic nodes have `providerId` pointing to an agentic provider and `agentic` options set

## Flow
1. **Consumer does:** Configures engine with mixed providers, builds DAG with mixed node types
   **System does:** Constructor separates providers into standard and agentic maps
2. **System does:** Planner (LLM node) executes via AgentRunner
   **Consumer sees:** Standard `agent_start` → `agent_chunk`* → `agent_done`
3. **System does:** Executor checks coder's providerId, finds it in agentic map, routes to AgenticRunner
   **Consumer sees:** `agent_start` for coder node (same event type as LLM nodes)
4. **System does:** AgenticRunner spawns Claude Code session with planner output as upstream context
   **Consumer sees:** `agent_chunk` events (streaming from Claude Code agent)
5. **System does:** Agentic node completes, cost converted from USD to cents and recorded
   **Consumer sees:** `agent_done` with output and cost (same format as LLM nodes)
6. **System does:** Reviewer (LLM node) executes with coder output in context
   **Consumer sees:** Standard LLM execution events, then `swarm_done`

## Variations
- **If agentic SDK not installed:** Error emitted at first agentic node `run()` call with clear message suggesting `npm install`
- **If agentic node exceeds its maxBudgetUsd:** Node terminates, `agent_error` emitted, downstream nodes may be affected
- **If agentic node uses tools:** Tool calls happen internally within the agentic session; the engine sees streamed output

## Edge Cases
- Multiple agentic backends in same DAG (e.g., Claude Code + Codex): Each routed to its respective adapter
- Agentic node communicating with LLM node: Uses scratchpad/channels via injected MCP tools
- Custom agentic backend: Implements AgenticAdapter interface, registered as `type: 'custom-agentic'`

## Data Impact
| Data | Action | Location |
|------|--------|----------|
| Agentic cost (USD) | Converted to cents, attributed to node | CostTracker |
| Agentic output | Stored same as LLM output | In-memory output map |
| MCP tool calls | Internal to agentic session | Not directly visible in events |

## CS Notes
- The key insight: both runner types produce identical SwarmEvent streams — consumer code doesn't need to differentiate
- Agentic nodes are typically more expensive than LLM nodes — budget limits are important
- The `pathToClaudeCodeExecutable` option can be set if the SDK can't auto-detect the CLI location
