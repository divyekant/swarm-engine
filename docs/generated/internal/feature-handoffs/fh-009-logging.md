---
id: fh-009
type: feature-handoff
audience: internal
topic: Structured Logging
status: draft
generated: 2026-02-28
source-tier: direct
context-files: [src/logger.ts, src/types.ts]
hermes-version: 1.0.0
---

# FH-009: Structured Logging

## What It Does

The logging system provides zero-dependency structured logging throughout the engine. It is completely inert by default -- when no LoggingConfig is provided, all log calls are noop with zero runtime overhead. When configured, it outputs to stderr in either human-readable or JSON format, with an optional programmatic callback for capturing log entries in application code.

## How It Works

### Logger Class

The Logger class is a single file with no external dependencies. It is constructed with an optional LoggingConfig and an optional base context object. When config is absent, the enabled flag is set to false, and every log method returns immediately without doing any work.

When config is present, the logger stores the level threshold, the structured output flag, and the onLog callback. The threshold is resolved from a static mapping: debug=0, info=1, warn=2, error=3. Any log call below the threshold is discarded.

### Log Levels

Four levels are supported: debug, info, warn, error. Each has a corresponding method on the Logger instance. The level set in LoggingConfig acts as a floor -- setting level to 'warn' suppresses debug and info entries.

### Output Modes

The logger writes to process.stderr (not stdout, which is reserved for application output). Two formats are available:

**Human-readable (structured: false, the default):** Outputs lines in the format "[LEVEL] message {context}". The context is JSON-stringified and appended only if present. This is the format used during development.

**JSON lines (structured: true):** Outputs one JSON object per line containing level, message, timestamp (epoch milliseconds), and optional context. This format is suitable for log aggregation pipelines.

### onLog Callback

In addition to stderr output, every log entry is passed to the optional onLog callback if configured. The callback receives a LogEntry object with level, message, timestamp, and optional context. This allows consumers to route logs to their own systems (databases, monitoring, in-memory buffers) without parsing stderr output.

The callback is invoked synchronously. If the callback throws, the error propagates to the caller.

### Child Loggers

The child() method creates a new Logger instance that inherits the parent's configuration but merges additional context. The child is constructed via the Logger constructor (not Object.create or prototype delegation), which means it is a fully independent instance that shares the same config reference.

Context merging uses object spread: the child's base context is { ...parentBaseContext, ...childContext }. When a child logger logs a message with additional per-call context, the final context is { ...baseContext, ...callContext }. This means per-call context keys override base context keys, and child base context keys override parent base context keys.

### Threading Through Components

The Logger is created once at SwarmEngine construction time from the optional logging field in SwarmEngineConfig. It is then passed down to every major component: DAGExecutor, AgentRunner, AgenticRunner, ContextAssembler, and others. Each component typically creates a child logger with component-specific context (e.g., { component: 'dag-executor' } or { nodeId: 'some-node' }).

### Log Entry Structure

Every log entry is a LogEntry object:

- **level**: One of debug, info, warn, error.
- **message**: A human-readable string describing what happened.
- **timestamp**: Epoch milliseconds (Date.now()), integer.
- **context** (optional): A flat key-value object with additional structured data.

### Log Points

The engine logs at the following points (non-exhaustive, covers the primary instrumentation):

- Engine initialization and configuration summary
- DAG validation results (cycle detection, orphan nodes, provider availability)
- Node lifecycle: start, completion, failure
- Parallel batch scheduling (which nodes, concurrency level)
- Budget warnings and exceeded events
- Persistence operation errors
- Conditional routing decisions (which evaluator, which target)
- Dynamic DAG expansion events
- Context assembly statistics (token counts, truncation decisions)

## User-Facing Behavior

When no LoggingConfig is provided in SwarmEngineConfig, the engine produces zero log output and incurs zero logging overhead. This is the default experience.

When logging is enabled, entries appear on stderr. They do not mix with the SwarmEvent stream or any application output on stdout. The consumer chooses between human-readable format (good for terminal use) and JSON format (good for piping to log aggregators).

The onLog callback provides a programmatic hook. A consumer can, for example, collect all log entries in an array during a test run, or forward entries to an external logging service.

## Configuration

Logging is configured through the logging field on SwarmEngineConfig:

- **level** (required): 'debug' | 'info' | 'warn' | 'error'. Sets the minimum severity that will be emitted. All entries below this level are silently discarded.
- **structured** (optional, boolean, default false): When true, log entries are emitted as JSON lines to stderr. When false, entries use the human-readable "[LEVEL] message" format.
- **onLog** (optional, function): A callback that receives each LogEntry after it is written to stderr. Signature: (entry: LogEntry) => void.

Setting level to 'debug' produces the most verbose output. Setting it to 'error' produces only error entries.

## Edge Cases & Limitations

- **No config equals zero cost.** When LoggingConfig is not provided, the Logger sets an internal enabled flag to false. Every log method checks this flag first and returns immediately. There is no string formatting, no context merging, no timestamp creation.
- **Synchronous onLog callback.** The callback is called synchronously in the logging path. A slow or throwing callback will affect the calling component. Consumers who need async log forwarding should buffer entries in the callback and flush asynchronously.
- **Child loggers inherit config by reference.** If a parent's config were mutated after child creation (which the types discourage since config is set at construction), the child would see the mutation. In practice this is not an issue because config is set once at engine construction and never changed.
- **Context merge is shallow.** Only top-level keys are merged. Nested objects in context are replaced entirely, not deep-merged.
- **No log rotation or size limits.** The logger writes to stderr without any rotation, buffering, or size constraints. Long-running processes should use an external log management solution.
- **Timestamp is epoch milliseconds.** The timestamp is Date.now(), which is an integer. It does not include timezone information or ISO formatting. Consumers who need formatted timestamps should transform the value in onLog or post-processing.

## Common Questions

**Does logging affect performance?**
No, when unconfigured. The Logger is noop by default. When configured, the overhead is minimal: one level comparison, context merging (if context is provided), JSON serialization, and a stderr write. For high-throughput scenarios, set level to 'warn' or 'error' to reduce output volume.

**Can I capture logs programmatically?**
Yes. Set the onLog callback in LoggingConfig. Every log entry is passed to this function after being written to stderr. Use this for test assertions, in-memory log buffers, or forwarding to external systems.

**What format are structured logs?**
JSON lines written to stderr. Each line is a single JSON object with level, message, timestamp, and optional context fields. One object per line, newline-terminated.

**Why stderr instead of stdout?**
stdout is reserved for application output (SwarmEvent streams, results). Logging to stderr keeps the two streams separate, allowing consumers to pipe stdout to one destination and stderr to another.

**Can I change the log level at runtime?**
No. The LoggingConfig is set at Logger construction time and is not mutable. To change the level, construct a new SwarmEngine with a new LoggingConfig.

**How do child loggers work?**
Calling logger.child({ nodeId: 'abc' }) creates a new Logger instance that shares the same config but has merged context. Every log entry from the child automatically includes nodeId: 'abc' in its context, in addition to any context passed in the individual log call.

## Troubleshooting

- **No log output visible**: Check that LoggingConfig is provided in SwarmEngineConfig. Without it, the logger is completely silent. Also verify the level is not set higher than the entries you expect (e.g., level 'error' suppresses debug/info/warn).
- **Logs appearing in wrong stream**: The logger writes to process.stderr, not stdout. If you are redirecting stdout, logs will still appear on stderr. Use 2>/dev/null to suppress or 2>logs.txt to redirect.
- **onLog callback not firing**: The callback is only invoked when the log entry passes the level threshold. Entries below the configured level are discarded before reaching the callback.
- **Context keys overwritten**: Context merging is last-writer-wins with shallow spread. If both the base context and a per-call context have the same key, the per-call value takes precedence. If a parent and child logger share a context key, the child's value takes precedence.
- **Large context objects in structured mode**: JSON.stringify is called on the entire merged context. Extremely large or circular objects will cause issues. Keep context values small and serializable.

## Related

- `src/logger.ts` -- Logger class implementation
- `src/types.ts` -- LogEntry and LoggingConfig type definitions
- `src/engine.ts` -- Logger construction and initial threading
- `docs/ARCHITECTURE.md` -- System-level overview of logging decisions
- FH-007 (Adapters) -- Logger is threaded through adapter-using components
- FH-008 (Monitor) -- Monitor handles SwarmEvent streaming; Logger handles internal diagnostics. They are complementary, not overlapping.
- FH-010 (Error Handling) -- Errors are logged via the Logger before being classified and emitted as events
