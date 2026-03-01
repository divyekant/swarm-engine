---
id: fh-007
type: feature-handoff
audience: internal
topic: Pluggable Adapters
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [src/adapters/, docs/ARCHITECTURE.md]
hermes-version: 1.0.0
---

# FH-007: Pluggable Adapters

## What It Does

The adapter system defines seven interface boundaries that separate the core orchestration engine from all external dependencies. Every adapter slot except ProviderAdapter ships with a noop or in-memory default, which means SwarmEngine works out of the box with zero external services configured. When a consumer needs real persistence, semantic memory, persona loading, or any other capability, they provide an implementation of the corresponding interface at engine construction time.

The system enables mixed workflows where some nodes call traditional LLM APIs, others spawn full agentic backends like Claude Code or Codex, and the surrounding infrastructure (storage, context, personas) can be swapped independently without touching orchestration logic.

## How It Works

### The Seven Adapter Boundaries

**1. ProviderAdapter** -- LLM streaming. This is the only adapter that ships with built-in implementations rather than a noop default. Three providers are included: AnthropicProvider (API key auth), OpenAIProvider, and OllamaProvider (local, defaults to localhost:11434). A fourth, AnthropicOAuthProvider, supports OAuth-based Anthropic access using Bearer tokens with host validation restricted to *.anthropic.com domains. The interface exposes three methods: stream() returns an async generator of ProviderEvent (chunk, tool_use, usage); estimateCost() returns cost in integer cents given model name and token counts; getModelLimits() returns context window and max output sizes. Each built-in provider carries its own pricing and limits lookup tables with prefix-based model matching and sensible fallback defaults. The createProvider() factory function takes a ProviderConfig and instantiates the correct provider. For the custom type, the consumer passes their own ProviderAdapter instance on the adapter property.

**2. AgenticAdapter** -- Full agentic execution for autonomous backends. Unlike ProviderAdapter which handles raw LLM streaming, AgenticAdapter manages complete agentic sessions where the backend can execute code, read/write files, and spawn sub-agents. The interface has a single method: run() is an async generator that accepts AgenticRunParams (task, systemPrompt, upstreamContext, agenticOptions, signal, tools) and yields AgenticEvent values (chunk, tool_use, result, error). Two built-in implementations exist: ClaudeCodeAdapter wraps the Claude Agent SDK, and CodexAdapter wraps the OpenAI Codex SDK. A custom-agentic type accepts a consumer-provided AgenticAdapter instance. The createAgenticAdapter() factory handles instantiation. The isAgenticProvider() utility function checks whether a provider type string belongs to the agentic set (claude-code, codex, custom-agentic), which the DAGExecutor uses to route nodes to the correct runner.

**3. PersistenceAdapter** -- Run, artifact, and thread storage. The interface defines six methods: createRun() and updateRun() for tracking agent execution records; createArtifact() for storing generated outputs; saveMessage() and loadThreadHistory() for conversation thread management; logActivity() for audit logging. The default InMemoryPersistence implementation stores everything in Maps with a configurable LRU cap (default 100 runs). When the run count exceeds the cap, the oldest entries are evicted by insertion order.

**4. ContextProvider** -- Entity context retrieval. The interface has a single method: getContext() takes an entity type and entity ID and returns a string. The default NoopContextProvider returns an empty string. Consumers implement this to load org metadata, entity details, or other domain-specific context from their data store.

**5. MemoryProvider** -- Semantic search and storage. The interface exposes search() (returns scored results with optional metadata) and store() (persists text with optional metadata). The default NoopMemoryProvider returns empty results and silently drops stores. This is the integration point for vector databases, embedding stores, or any semantic retrieval system.

**6. CodebaseProvider** -- Code querying with tiered detail levels. The interface has a single method: query() takes a repo ID, a query string, and a tier level (mini, standard, or full). The tier controls the depth and cost of the code search. The default NoopCodebaseProvider returns an empty string.

**7. PersonaProvider** -- Agent persona retrieval. The interface has getPersona() which takes a role string and returns a PersonaConfig or null. The default NoopPersonaProvider returns null. The built-in PersonaSmithProvider loads rich Markdown persona files from disk, parsing them with the parsePersonaMarkdown() helper. It supports department-qualified role paths (e.g., "engineering/software-engineer"), unqualified role names that search all department folders, and fuzzy matching via kebab-case normalization. An optional industry overlay can be appended from a separate directory. Results are cached in memory by default.

### LifecycleHooks (Not an Adapter, but Pluggable)

LifecycleHooks provides four optional callbacks: onRunStart, onRunComplete, onRunFailed, and onSwarmComplete. These fire at the corresponding execution points and can be synchronous or async. The default NoopLifecycleHooks is an empty class. These hooks are for observability and side effects only -- they cannot alter execution flow.

### Provider Type Enum

The ProviderConfig type field accepts: 'anthropic', 'anthropic-oauth', 'openai', 'google', 'ollama', 'custom', 'claude-code', 'codex', or 'custom-agentic'. The google type is declared but throws "not yet implemented" if used. The DAGExecutor splits these into two groups: standard providers (anthropic, anthropic-oauth, openai, google, ollama, custom) go through ProviderAdapter and AgentRunner; agentic providers (claude-code, codex, custom-agentic) go through AgenticAdapter and AgenticRunner.

### Lazy Initialization

Both agentic adapter classes are statically imported but lazily instantiated. The ClaudeCodeAdapter and CodexAdapter constructors are not called until the first run() invocation. Furthermore, the underlying SDK packages (@anthropic-ai/claude-agent-sdk and @openai/codex-sdk) are dynamically imported inside run(), so the import cost is deferred until actual execution. If the SDK is not installed and a node tries to use it, the dynamic import fails with a clear error at runtime rather than at engine construction.

### SDK Dependency Model

Both agentic SDKs are listed as optionalDependencies in package.json. The engine installs and operates fully without them. Users install only the SDK they need. Type declarations for the optional SDKs are provided in a .d.ts file so TypeScript consumers get type safety without requiring the package to be installed.

## User-Facing Behavior

When a consumer constructs a SwarmEngine, they pass a SwarmEngineConfig object. The providers field (a Record of string keys to ProviderConfig values) is the only required adapter configuration. All other adapter slots -- persistence, context, memory, codebase, persona, lifecycle -- default to their noop implementations if not provided.

Each agent node in a DAG can specify a providerId that maps to a key in the providers record. Different nodes in the same DAG can use different providers. A DAG might have three nodes using Anthropic for text generation and one node using Claude Code for autonomous code execution, all in the same swarm run.

The engine emits the same SwarmEvent stream regardless of which adapter implementations are in use. Consumers observe identical event shapes whether a node ran via LLM streaming or agentic execution.

## Configuration

Adapters are configured through SwarmEngineConfig:

- **providers** (required): Record of provider ID strings to ProviderConfig objects. Each ProviderConfig specifies type, optional apiKey, optional baseUrl, and optional adapter/agenticAdapter for custom types.
- **persistence**: A PersistenceAdapter implementation. Defaults to InMemoryPersistence(100).
- **context**: A ContextProvider implementation. Defaults to NoopContextProvider.
- **memory**: A MemoryProvider implementation. Defaults to NoopMemoryProvider.
- **codebase**: A CodebaseProvider implementation. Defaults to NoopCodebaseProvider.
- **persona**: A PersonaProvider implementation. Defaults to NoopPersonaProvider.
- **lifecycle**: A LifecycleHooks implementation. Defaults to NoopLifecycleHooks.

For PersonaSmithProvider specifically, the constructor takes a PersonaSmithOptions object with personasDir (required), industriesDir (optional), defaultIndustry (optional), and cacheEnabled (default true).

For AnthropicOAuthProvider, the constructor takes an OAuth token string and an optional base URL. The base URL is validated against an allowlist of Anthropic-owned hosts -- non-Anthropic hosts are rejected with an error to prevent token leakage.

## Edge Cases & Limitations

- **Google provider declared but not implemented.** Configuring type 'google' throws an error at provider creation time.
- **Custom provider without adapter.** Configuring type 'custom' without passing an adapter property on ProviderConfig throws immediately.
- **Custom-agentic without agenticAdapter.** Same pattern -- the factory throws with a descriptive error.
- **Missing SDK for agentic providers.** The error surfaces on first run() call, not at construction. The error message is the standard Node.js "Cannot find module" error from the dynamic import.
- **InMemoryPersistence LRU eviction.** When maxRuns is exceeded, the oldest run record is deleted. Artifacts and threads associated with evicted runs are not cleaned up -- they remain in their respective Maps.
- **PersonaSmithProvider file search.** If the personas directory is unreadable, getPersona() returns null silently rather than throwing. The same applies to missing persona files.
- **AnthropicOAuthProvider host validation.** Only *.anthropic.com hosts are allowed. Attempting to use a proxy or custom endpoint for OAuth will be rejected.
- **Ollama has zero cost.** The OllamaProvider.estimateCost() always returns 0 since Ollama models run locally.
- **Model lookup uses prefix matching.** If a model string is not found in the pricing/limits table, the provider tries prefix matching before falling back to defaults. This means "claude-sonnet-4-20250514-custom" would match "claude-sonnet-4-20250514" pricing.

## Common Questions

**Do I need all seven adapters?**
No. Only the providers field is required. All other adapters have noop defaults that do nothing. The engine works standalone with just LLM provider configuration.

**Can I use multiple LLM providers in the same swarm?**
Yes. Define multiple entries in the providers record with different keys. Each agent node specifies which provider to use via its providerId field. One node can use Anthropic while another uses OpenAI in the same DAG.

**How do I add a custom LLM provider?**
Implement the ProviderAdapter interface (stream, estimateCost, getModelLimits), then pass it in a ProviderConfig with type 'custom' and your implementation on the adapter property.

**How do I add a custom agentic backend?**
Implement the AgenticAdapter interface (an async generator run method), then pass it in a ProviderConfig with type 'custom-agentic' and your implementation on the agenticAdapter property.

**Do agentic SDKs need to be installed?**
Only if you configure agentic provider types. If your DAG only uses standard LLM nodes, neither SDK is needed. Install @anthropic-ai/claude-agent-sdk for Claude Code nodes, or @openai/codex-sdk for Codex nodes.

**What happens if an agentic SDK is not installed but a node references it?**
The engine constructs without error. The dynamic import fails when that node actually runs, producing a module-not-found error that gets classified as an agent_error event.

**Can I swap adapters between swarm runs?**
No. Adapters are set at engine construction time. To use different adapters, construct a new SwarmEngine instance.

## Troubleshooting

- **"Custom provider requires adapter"**: The ProviderConfig has type 'custom' but no adapter property. Provide an object implementing ProviderAdapter.
- **"Custom agentic provider requires agenticAdapter"**: Same pattern for type 'custom-agentic'. Provide an object implementing AgenticAdapter.
- **"Anthropic provider requires apiKey"**: The ProviderConfig has type 'anthropic' but no apiKey. Set the apiKey field.
- **"is not an allowed Anthropic host"**: AnthropicOAuthProvider rejects non-Anthropic base URLs. Only *.anthropic.com hosts are permitted for OAuth tokens.
- **"Google provider not yet implemented"**: The google provider type is reserved but has no implementation. Use a custom provider to integrate Google models.
- **Agent runs but context/memory/persona is empty**: Check whether you provided implementations for the corresponding adapter slots. The defaults are noops that return empty values.
- **"Cannot find module '@anthropic-ai/claude-agent-sdk'"**: Install the optional SDK package. It is not included automatically.
- **PersonaSmithProvider returns null for a known role**: Verify the persona file exists at the expected path. Check that the role string maps to the correct kebab-case filename. For department-qualified paths, the format is "department/role-name".

## Related

- `src/adapters/defaults.ts` -- InMemoryPersistence and all Noop* default implementations
- `src/adapters/providers/` -- Built-in LLM provider implementations
- `src/adapters/agentic/` -- Agentic adapter implementations and factory
- `src/adapters/personas/` -- PersonaSmithProvider and parsePersonaMarkdown
- `src/types.ts` -- All adapter interface definitions
- `docs/ARCHITECTURE.md` -- System-level adapter overview
- FH-008 (Monitor) -- Uses SwarmEvent, which adapters produce
- FH-009 (Logging) -- Logger is threaded through adapter-using components
- FH-010 (Error Handling) -- classifyError processes errors from adapter calls
