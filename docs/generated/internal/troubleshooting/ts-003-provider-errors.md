---
id: ts-003
type: troubleshooting
audience: internal
topic: Provider and Authentication Errors
status: draft
generated: 2026-02-28
source-tier: direct
hermes-version: 1.0.0
---

# Troubleshooting: Provider and Authentication Errors

## Symptoms
- `agent_error` event with `errorType: 'auth_error'`
- `agent_error` event with `errorType: 'rate_limit'`
- `agent_error` event with `errorType: 'network_error'`
- Error messages containing "401", "403", "429", "unauthorized", or "fetch failed"

## Quick Check
1. Check the API key for the failing provider. If it is missing, expired, or invalid, that is the issue. Fix: provide a valid API key in the engine config or environment variable.
2. If the API key is correct, proceed to diagnostic steps.

## Diagnostic Steps

### Step 1: Identify the error type
- **Check:** `agent_error` event's `errorType` field.
- **If `auth_error`:** API key is invalid, expired, or missing. See Auth resolution below.
- **If `rate_limit`:** Too many requests. See Rate Limit resolution below.
- **If `network_error`:** Network connectivity issue. See Network resolution below.
- **If `timeout`:** Request took too long. See Timeout resolution below.

### Step 2: Check provider configuration
- **Inspect:** Is the provider type correct? Is the API key set? Is the base URL correct (for Ollama or custom providers)?
- **If base URL wrong:** Correct the `baseUrl` in the provider config.
- **If API key missing:** Set it via config or environment variable.

### Step 3: Check for content filter
- **If `errorType: 'content_filter'`:** The LLM rejected the prompt or output due to safety/moderation filters.
- **Fix:** Modify the system prompt or task to avoid triggering content filters.

## Resolutions
### Auth Error (401/403)
- **Fix:** Verify and update the API key. Check that the key has the required permissions/scopes.
- **Verify:** Run a single-node DAG with a simple prompt to confirm authentication works.
- **Prevent:** Use environment variables for API keys, rotate keys before expiry.

### Rate Limit (429)
- **Fix:** Reduce `limits.maxConcurrentAgents` to lower parallelism. Implement retry logic in the consumer.
- **Verify:** Rate limit errors stop occurring.
- **Prevent:** Monitor API quota usage, use lower-tier models for non-critical nodes.

### Network Error
- **Fix:** Check network connectivity to the provider API. For Ollama, verify the server is running at the configured base URL.
- **Verify:** Can reach the provider API from the runtime environment.
- **Prevent:** Monitor network health, use timeouts via `limits.maxSwarmDurationMs`.

### Timeout
- **Fix:** Increase `limits.maxSwarmDurationMs` or reduce `maxTokens` on the agent to shorten response time.
- **Verify:** Agent completes within the timeout.

## Escalation
- **Escalate to:** DevOps (network issues), Engineering (persistent auth issues)
- **Include:** Provider type, error message, errorType, node configuration (redact API keys)
- **SLA:** High for auth errors (blocks execution), Medium for rate limits (transient)

## Related
- [fh-007 Pluggable Adapters](../feature-handoffs/fh-007-adapters.md)
- [fh-010 Error Handling](../feature-handoffs/fh-010-error-handling.md)
