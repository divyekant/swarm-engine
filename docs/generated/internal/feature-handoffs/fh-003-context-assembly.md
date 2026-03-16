---
id: fh-003
type: feature-handoff
audience: internal
topic: Context Assembly
status: draft
generated: 2026-03-15
source-tier: direct
context-files: [src/context/, docs/ARCHITECTURE.md]
hermes-version: 1.0.1
---

# Context Assembly

## What It Does

The context assembly system builds the message array that an LLM agent receives when it runs. It gathers context from multiple adapter sources -- persona identity, system prompt, task, upstream agent outputs, inter-agent messages, shared scratchpad state, entity context, semantic memory search results, and codebase context -- and fits them within the model's context window using priority-based truncation.

The system has two components:

- **ContextAssembler** -- The pipeline that collects context from all sources in priority order and produces a Message array ready for the provider.
- **TokenBudget** -- The budget manager that tracks how much of the context window has been consumed and truncates low-priority sections when the total exceeds the available space.

Context assembly is used only by AgentRunner (LLM nodes). AgenticRunner handles its own context formatting differently -- it builds a flat text string from upstream outputs, inbox messages, and scratchpad state, and passes it directly to the agentic backend.

## How It Works

### ContextAssembler

ContextAssembler is initialized with four adapter dependencies and an optional Logger:

- `context` (ContextProvider) -- Retrieves entity-specific context (e.g., organization metadata, project details).
- `memory` (MemoryProvider) -- Performs semantic search against a memory store.
- `codebase` (CodebaseProvider) -- Queries a codebase for relevant code context.
- `persona` (PersonaProvider) -- Retrieves persona identity configuration for an agent.

All four adapters are pluggable interfaces with noop defaults. When running standalone (without external services), every adapter returns empty results, and the system works with just the system prompt, task, and upstream outputs.

The `assemble()` method takes an AssembleParams object and returns a Message array. The assembly process runs as follows:

1. **Budget allocation** -- The assembler reserves 75% of the model's context window for the system message content. The remaining 25% is reserved for the response and thread history overhead. A TokenBudget instance is created with this calculated token limit.

2. **Priority 1: Persona identity** -- The assembler calls `PersonaProvider.getPersona()` with the agent role (falling back to the agent ID when needed). If a persona is found, it is added to the budget at priority 1 (never truncated). Two formats are supported: if the persona has a `fullPrompt` field, it is injected as-is for maximum fidelity. Otherwise, a structured block is built from the persona's name, role, traits, constraints, communication style, and expertise fields.

3. **Priority 1: System prompt** -- The agent's system prompt is added at priority 1. It is never truncated.

4. **Priority 1: Task** -- The task message is added at priority 1, prefixed with a "## Task" header. It is never truncated.

5. **Priority 2: Upstream outputs** -- If upstream agent outputs exist (from completed predecessor nodes in the DAG), they are formatted as markdown sections with the agent role and node ID as headers, then added at priority 2.

6. **Priority 3: Inbox messages** -- If SwarmMemory is available and the agent has an ID, the assembler retrieves inbox messages from the channels and formats them as `[from]: content` lines under a "## Messages" header. Added at priority 3.

7. **Priority 3: Scratchpad snapshot** -- If SwarmMemory is available, the assembler reads the scratchpad's current state via `toContext()` and adds it under a "## Shared State" header at priority 3.

8. **Priority 4: Entity context** -- If an entity type and entity ID are provided, the assembler calls `ContextProvider.getContext()` and adds the result under an "## Entity Context" header at priority 4.

9. **Priority 5: Memory search** -- The assembler calls `MemoryProvider.search()` with the task as the query and a limit of 5 results. Matching memories are formatted as a bulleted list under a "## Relevant Memory" header at priority 5.

10. **Priority 6: Codebase context** -- If an entity ID is provided, the assembler calls `CodebaseProvider.query()` with the entity ID, task, and `mini` tier. The result is added under a "## Codebase" header at priority 6.

11. **Build system message** -- The TokenBudget builds the final system message content by combining all sections, applying truncation if needed.

12. **Construct message array** -- The assembler creates the final Message array: a system message with the assembled content, followed by any thread history messages, followed by a user message containing the task.

The Logger receives debug entries for each context section added (with character lengths) and a final summary of total sections and character count.

### TokenBudget

TokenBudget manages the allocation of context within a token limit. It stores segments as ordered entries, each with a label, content string, and priority number (1 = highest).

Token estimation uses a conservative 1 token = 4 characters ratio. This is deliberately conservative to avoid overflowing the actual model context window.

The `build()` method works as follows:

1. Sort all segments by priority ascending (priority 1 first).
2. Calculate the total estimated token count.
3. If the total fits within the budget, join all segments with double newlines and return.
4. If the total exceeds the budget, truncate from the lowest-priority segment backwards:
   - Segments with priority 1 are never truncated.
   - If a segment's token count is less than or equal to the excess, the entire segment is removed.
   - If a segment's token count is greater than the excess, it is partially truncated: the content is sliced to the allowed character count and an ellipsis ("...") is appended.
5. Filter out empty segments and return the joined result.

The `getSectionCount()` method returns the number of segments that have been added to the budget, which the assembler uses for logging.

### Priority System

The priority system determines what gets kept and what gets cut when context exceeds the model window. Lower numbers mean higher priority:

| Priority | Content | Truncation Behavior |
|----------|---------|---------------------|
| 1 | Persona identity, system prompt, task | Never truncated under any circumstances |
| 2 | Upstream agent outputs | Truncated only if priorities 3-6 are fully exhausted |
| 3 | Inbox messages, scratchpad snapshot | Truncated before priority 2 content |
| 4 | Entity context | Truncated before priority 3 content |
| 5 | Memory search results | Truncated before priority 4 content |
| 6 | Codebase context | Truncated first |

In practice, this means codebase context, memory search results, and entity context are the first items sacrificed when context gets tight. The agent's identity (persona + system prompt), its task, and outputs from upstream agents are preserved.

### Assembly for Agentic Nodes

Agentic nodes (those running via AgenticRunner) do not use ContextAssembler. Instead, the AgenticRunner builds its own context string by concatenating upstream outputs, inbox messages, and scratchpad state into a single markdown-formatted text block. This simpler approach is appropriate because agentic backends manage their own context windows and conversation history internally.

## User-Facing Behavior

Context assembly is internal to the engine -- consumers do not call it directly. It runs automatically whenever an LLM agent node executes. The consumer influences context assembly through:

- The agent's `systemPrompt` field, which becomes the foundation of the context.
- The agent's `persona` field, which adds identity context.
- The `threadId`, `entityType`, and `entityId` fields in `RunOptions`, which now consistently trigger thread history loading plus entity and codebase context retrieval for standard runs.
- The adapter implementations provided in SwarmEngineConfig (`context`, `memory`, `codebase`, `persona`), which determine what external context is available.

The assembled context is invisible in the SwarmEvent stream. The consumer sees only the agent's output. To observe what context was assembled, enable debug-level logging via `SwarmEngineConfig.logging` -- the assembler logs each section's character length and the final total.

### AssemblerDeps Interface

The four adapter dependencies are provided when creating a ContextAssembler:

- `context` (ContextProvider) -- Must implement `getContext(entityType, entityId): Promise<string>`. Returns entity-specific context as a string.
- `memory` (MemoryProvider) -- Must implement `search(query, k?): Promise<MemoryResult[]>` and `store(text, metadata?): Promise<void>`. Returns semantically relevant memories.
- `codebase` (CodebaseProvider) -- Must implement `query(repoId, query, tier): Promise<string>`. The `tier` parameter controls response size: `mini`, `standard`, or `full`.
- `persona` (PersonaProvider) -- Must implement `getPersona(role): Promise<PersonaConfig | null>`. Returns persona identity metadata or null.

All adapters have noop default implementations that return empty results. The engine works without any external services.

## Configuration

Context assembly has no direct configuration section in SwarmEngineConfig. Its behavior is determined by:

- **Adapter implementations** -- The context, memory, codebase, and persona adapters provided in the engine config. If not provided, noop defaults are used.
- **Model context window** -- The provider's `getModelLimits(model)` method returns the `contextWindow` and `maxOutput` values. The assembler uses `contextWindow` to calculate the token budget (75% of the window).
- **Agent descriptor fields** -- The system prompt and persona are per-agent. The model determines which context window limits apply.
- **RunOptions fields** -- `entityType` and `entityId` control whether entity and codebase context are fetched.

There is no configuration for changing the priority order, the 75% budget allocation ratio, the token estimation ratio (1:4), or the number of memory search results (hardcoded to 5). These are fixed in the current implementation.

## Edge Cases & Limitations

- **All adapters noop by default:** When running standalone without external services, the assembler produces context from only the system prompt, task, and upstream outputs. Persona, entity, memory, and codebase sections are all empty. This is working as designed -- it allows the engine to function without any infrastructure dependencies.
- **Context larger than window:** If the priority-1 content alone (persona + system prompt + task) exceeds 75% of the context window, the budget cannot truncate it (priority 1 is protected). The assembled content will exceed the intended budget. In practice, this means the provider may receive a request that approaches or exceeds the model's context limit. The provider is responsible for handling this case (typically by returning a context length error).
- **Token estimation is approximate:** The 1 token = 4 characters ratio is a conservative heuristic. Actual tokenization varies by model and content. The system may leave unused context window space or, rarely, exceed the actual limit by a small margin.
- **Memory search always queries with the task:** The memory search query is always the task string. There is no mechanism to customize the search query or to use the system prompt or upstream outputs as search context.
- **Codebase tier is hardcoded to mini:** The assembler always queries the codebase provider with the `mini` tier. There is no way to request `standard` or `full` tiers through the current interface.
- **No caching between nodes:** Context is assembled fresh for each node execution. If multiple nodes query the same entity context or memory, the adapters are called multiple times. Adapter implementations can add their own caching if needed.
- **Thread history position:** Thread history messages are inserted between the system message and the final user message. They are not subject to the token budget -- they are added as-is after the budget-managed system message is built. Very long thread histories could push the total context beyond the model window.

## Common Questions

**What gets truncated first?**
Codebase context (priority 6) is truncated first, followed by memory search results (priority 5), then entity context (priority 4), then inbox messages and scratchpad (priority 3), then upstream outputs (priority 2). Persona identity, system prompt, and task (all priority 1) are never truncated.

**Can I add custom context sources?**
Yes, by implementing one of the four adapter interfaces. The most flexible option is ContextProvider -- implement `getContext()` to return any string you want injected at priority 4 in the context. For semantic search context, implement MemoryProvider. For code-related context, implement CodebaseProvider. For agent identity context, implement PersonaProvider.

**How do I know what context an agent received?**
Enable debug-level logging in the engine configuration. The assembler logs each section (persona, system, task, upstream, inbox, scratchpad, entity, memory, codebase) with its character length, and a final summary with total section count and character count. The actual content is not logged -- only metadata about what was assembled.

**Does context assembly work without any external services?**
Yes. All four adapters have noop default implementations. Without any adapters configured, agents receive context from the system prompt, task, upstream outputs, and swarm memory (inbox and scratchpad). This is sufficient for standalone operation.

**How is the 75% budget split decided?**
The 75% allocation for the system message and 25% reservation for response and thread history overhead is a fixed ratio in the current implementation. It is not configurable. The 25% reserve accounts for the model's response tokens and any thread history messages that are appended after the budgeted system message.

**What happens when persona has a fullPrompt versus structured fields?**
If the PersonaConfig includes a `fullPrompt` field, it is injected verbatim as a single string at priority 1. This is intended for rich, pre-formatted persona prompts (e.g., from a PersonaSmith service). If `fullPrompt` is absent, the assembler builds a structured block from the individual fields (name, role, traits, constraints, communication style, expertise). The structured format gives the assembler more control over formatting but may lose nuances present in a full prompt.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Agent responses lack expected context | The adapter returned empty results. Noop defaults are in use. | Verify that the appropriate adapter implementations are provided in SwarmEngineConfig (context, memory, codebase, persona). |
| Agent responses cut off or miss details | Context was truncated due to budget limits. Low-priority sections were removed. | Enable debug logging to see which sections were included and their sizes. Consider shortening the system prompt or reducing upstream output volume. |
| Entity context not appearing | The `entityType` and `entityId` fields are not provided in RunOptions or AssembleParams. | Pass `entityType` and `entityId` in the RunOptions when calling `engine.run()`. |
| Memory search returns no results | The MemoryProvider has no stored memories, or the task query does not match any stored content. | Verify that the MemoryProvider implementation has data indexed. Check that the task string contains meaningful search terms. |
| Persona section missing | The PersonaProvider returned null for the agent's role/ID. | Verify that the PersonaProvider implementation has a persona configured for the agent ID being queried. |
| Context exceeds model limits | Priority-1 content (persona + system prompt + task) is larger than the 75% budget. | Shorten the system prompt or persona prompt. The budget system cannot truncate priority-1 content. |
| Debug logs show "Context section added" but agent ignores the context | The context was assembled correctly but the model may not use all provided context effectively. | This is a model behavior issue, not an assembly issue. Try restructuring the system prompt to better direct the model's attention. |

## Related

- [fh-001-dag-orchestration.md](./fh-001-dag-orchestration.md) -- DAG orchestration (executor, scheduler, validator)
- [fh-002-agent-execution.md](./fh-002-agent-execution.md) -- Agent execution (runners, node, evaluator)
- `src/context/assembler.ts` -- ContextAssembler implementation
- `src/context/budget.ts` -- TokenBudget implementation
- `src/types.ts` -- ContextProvider, MemoryProvider, CodebaseProvider, PersonaProvider interface definitions
- `src/adapters/defaults.ts` -- Noop adapter default implementations
- `docs/ARCHITECTURE.md` -- Full architecture overview
