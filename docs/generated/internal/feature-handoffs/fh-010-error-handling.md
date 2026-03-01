---
id: fh-010
type: feature-handoff
audience: internal
topic: Error Handling
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [src/errors/classification.ts, src/types.ts]
hermes-version: 1.0.0
---

# FH-010: Error Handling

## What It Does

The error handling system provides deterministic error classification for the engine. Every error that occurs during agent execution is analyzed and assigned one of seven error types. This classification drives recovery behavior: the consumer or the engine itself can decide whether to retry, surface to the user, or halt the swarm based on the error type rather than parsing error messages.

## How It Works

### SwarmError Class

SwarmError extends the native Error class with two additional properties: errorType (an AgentErrorType string) and cause (an optional reference to the original Error that triggered the classification). The class sets its name property to 'SwarmError' for identification in stack traces and error handling code.

SwarmError is used when the engine needs to throw a typed error or wrap an underlying error with classification metadata. It is not used for every error in the system -- raw errors from LLM providers, network failures, and other sources are classified on the fly using the classifyError function.

### classifyError Function

classifyError takes an unknown value and returns an AgentErrorType string. If the input is not an Error instance, it returns 'unknown' immediately. Otherwise, it inspects the error's message (lowercased) and name properties against a series of pattern checks, evaluated in a fixed order. The first matching pattern wins.

### The Seven Error Types

**1. rate_limit** -- Detected when the error message contains '429', 'rate_limit', or 'rate limit'. This indicates the LLM provider is throttling requests. The expected recovery is retry with exponential backoff.

**2. auth_error** -- Detected when the error message contains '401', '403', 'unauthorized', 'invalid api key', or 'authentication'. This indicates the API key is missing, invalid, or lacks permissions. Recovery is not automatic -- the consumer must fix credentials.

**3. timeout** -- Detected when the error name is 'AbortError' or the message contains 'timed out', 'timeout', or 'deadline'. This covers both explicit AbortSignal cancellations and provider-side timeouts. Recovery depends on context: retrying may help for transient timeouts, but persistent timeouts suggest the request is too large or the provider is overloaded.

**4. content_filter** -- Detected when the error message contains 'content_policy', 'content_filter', 'safety', or 'moderation'. This indicates the LLM provider rejected the input or output due to content safety policies. Retrying with the same input will produce the same result. The consumer should review the prompt content.

**5. network_error** -- Detected when the error name is 'TypeError' (the standard fetch failure error type) or the message contains 'fetch failed', 'econnrefused', 'enotfound', or 'network'. This covers DNS failures, connection refused, and general network connectivity problems. Retry with backoff is appropriate.

**6. budget_exceeded** -- This type is not detected by classifyError. It is set directly by the CostTracker when a swarm or agent exceeds its configured budget limit. When budget_exceeded occurs, the engine stops the swarm. There is no automatic recovery.

**7. unknown** -- The fallback for any error that does not match the patterns above. This is the default classification for unexpected failures.

### Classification Order

The pattern checks execute in a fixed sequence: rate_limit, auth_error, timeout, content_filter, network_error. The first match wins. This ordering matters in edge cases where an error message might match multiple patterns. For example, a message containing both "401" and "timeout" would be classified as auth_error because that check runs first.

### Error Flow in the Engine

When an agent execution fails (in AgentRunner or AgenticRunner), the error is caught and classified using classifyError(). The classified type is included in the agent_error SwarmEvent that gets emitted. The same type is passed to the LifecycleHooks.onRunFailed callback. If the error is severe enough to stop the entire swarm (budget_exceeded, or a failure with no fallback path in the DAG), a swarm_error event is emitted with the partial cost summary and list of completed nodes.

The classification does not dictate retry behavior within the engine itself. The engine currently does not implement automatic retries. The error type is surfaced to the consumer via events, and the consumer decides how to handle it.

### AgentErrorType in Events

The AgentErrorType appears in two event types:

- **agent_error**: Carries nodeId, agentRole, error message string, and errorType. Emitted when a single node fails.
- **swarm_error**: Carries a top-level message, completedNodes list, and partialCost. The individual error type is in the preceding agent_error event; swarm_error aggregates the failure context.

## User-Facing Behavior

Consumers observe error classifications through the SwarmEvent stream. When an agent fails, the agent_error event includes the errorType field. Consumers can switch on this field to implement appropriate recovery:

- **rate_limit**: Wait and retry the swarm or node.
- **auth_error**: Check API keys, surface to the user for correction.
- **timeout**: Retry with a longer timeout, or reduce the request size.
- **content_filter**: Review the prompt content, modify and retry.
- **network_error**: Check connectivity, retry with backoff.
- **budget_exceeded**: The swarm has been stopped. Increase the budget or reduce the DAG scope.
- **unknown**: Inspect the full error message for debugging.

The SwarmError class is exported from the package, so consumers can catch and inspect typed errors in their own try/catch blocks if they call engine methods directly rather than consuming the event stream.

## Configuration

There is no configuration for error classification itself. The classification logic is built-in and deterministic.

Related configuration that affects error behavior:

- **EngineLimits.maxSwarmBudgetCents**: Sets the total budget for a swarm run. Exceeding this triggers budget_exceeded.
- **EngineLimits.maxPerAgentBudgetCents**: Sets the per-agent budget. Exceeding this on a single node triggers budget_exceeded for that node.
- **EngineLimits.maxSwarmDurationMs**: Sets a time limit for the entire swarm. Exceeding this produces a timeout error.
- **AbortSignal (RunOptions.signal)**: External cancellation signal. Aborting produces an AbortError, classified as timeout.

## Edge Cases & Limitations

- **Multiple patterns might match.** An error message containing both "429" and "network" would be classified as rate_limit because rate_limit is checked first. The fixed ordering (rate_limit > auth_error > timeout > content_filter > network_error) resolves all ambiguity deterministically.
- **Non-Error inputs return unknown.** If classifyError receives a string, number, null, or any non-Error value, it returns 'unknown' without further analysis. This handles cases where a throw statement uses a non-Error value.
- **budget_exceeded is never detected by classifyError.** It is set explicitly by the CostTracker. Passing a budget-exceeded error through classifyError would return 'unknown' unless the message happened to match another pattern.
- **TypeError matches network_error.** In Node.js, fetch failures throw TypeError with messages like "fetch failed". The classifier checks error.name === 'TypeError' as a network_error indicator. This means any TypeError (including non-network TypeErrors) will be classified as network_error if it does not match an earlier pattern. In practice, TypeErrors reaching the classifier almost always originate from fetch calls.
- **Case-insensitive matching.** The error message is lowercased before pattern matching. The error name is compared as-is (case-sensitive). 'AbortError' must be exact; 'aborterror' in the name field would not match.
- **No custom error types.** The seven types are hardcoded. Consumers cannot add new classification patterns or types. If a new error category is needed, the classification module must be updated.
- **No automatic retries.** The engine classifies errors but does not retry automatically. The consumer receives the classified error type and implements their own retry logic.

## Common Questions

**Can I add custom error types?**
Not currently. The classification function and the AgentErrorType union are built into the engine. Adding a new type requires modifying the source. The 'unknown' fallback covers any unrecognized errors.

**How should I handle rate_limit errors?**
Implement exponential backoff with jitter in your consumer code. When you receive an agent_error event with errorType 'rate_limit', wait before re-executing the swarm or the specific node. Most LLM providers include a Retry-After header, but this information is not currently surfaced through the classification.

**What errors stop the entire swarm?**
budget_exceeded always stops the swarm immediately. Other error types stop only the individual node that failed. Whether a node failure cascades depends on the DAG structure -- if downstream nodes depend on the failed node, they cannot execute, which may eventually lead to a swarm-level failure.

**How is budget_exceeded different from other errors?**
It is the only error type not detected by pattern matching. The CostTracker sets it directly when cumulative costs exceed the configured limit. It is also the only error type that always triggers an immediate swarm stop.

**What happens when an agentic node (Claude Code, Codex) fails?**
The agentic adapter yields an error event with a message string. The AgenticRunner wraps this into the standard error classification flow. The same seven error types apply, though agentic backends may produce error messages with different patterns than direct LLM API errors.

**Does classifyError work on non-Error objects?**
It accepts unknown, so any value can be passed. Non-Error values always return 'unknown'. This is a safety measure for JavaScript's ability to throw any value.

## Troubleshooting

- **Error classified as 'unknown' when it should be specific**: Check the error message string against the known patterns. The message is lowercased for matching. Common misses: misspelled status codes, provider-specific error formats that do not contain the expected keywords.
- **auth_error on a valid API key**: Some providers return 403 for quota exhaustion, not just authentication failures. If the message contains '403', it will be classified as auth_error even if the root cause is quota. Check the full error message for more context.
- **timeout but no AbortSignal was used**: The classification also triggers on error messages containing 'timed out', 'timeout', or 'deadline'. The LLM provider may have its own server-side timeout that fires independently of any client-side AbortSignal.
- **network_error from a TypeError unrelated to network**: The classifier checks error.name === 'TypeError' as a network indicator. If a genuine programming TypeError reaches the classifier, it will be misclassified as network_error. Ensure programming errors are caught and handled before they reach the agent execution boundary.
- **budget_exceeded with no budget configured**: Check EngineLimits. If maxSwarmBudgetCents or maxPerAgentBudgetCents is set (even to a very low value), budget enforcement is active. If neither is set, budget_exceeded should never occur.

## Related

- `src/errors/classification.ts` -- SwarmError class and classifyError function
- `src/types.ts` -- AgentErrorType union and SwarmEvent definitions (agent_error, swarm_error)
- `src/cost/tracker.ts` -- CostTracker, which triggers budget_exceeded
- `src/agent/runner.ts` -- AgentRunner error handling and classification callsite
- `src/agent/agentic-runner.ts` -- AgenticRunner error handling
- `docs/ARCHITECTURE.md` -- Error classification overview
- FH-007 (Adapters) -- Adapter calls are the primary source of errors that get classified
- FH-009 (Logging) -- Errors are logged before classification and event emission
