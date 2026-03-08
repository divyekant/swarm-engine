---
id: fh-011
type: feature-handoff
audience: internal
topic: Handoff Templates
status: draft
generated: 2026-03-08
source-tier: direct
context-files: [CHANGELOG.md, docs/plans/2026-03-08-handoffs-feedback-guards-design.md]
hermes-version: 1.0.0
---

# FH-011: Handoff Templates

## What It Does

Handoff Templates provide structured output formatting between DAG nodes via edge configuration. When an edge carries a handoff template, the engine injects output format instructions into the producing agent's system prompt so its output contains clear, labeled sections. Downstream nodes receive consistently structured content instead of free-form text.

Without a handoff template, inter-node output passes through as raw text (the existing behavior). Handoff Templates are fully backwards compatible -- omitting the `handoff` field on an edge preserves raw passthrough.

## How It Works

### Template Structure

A `HandoffTemplate` consists of an `id` string and an array of `HandoffSection` objects. Each section has a `key` (machine identifier), a `label` (human-readable heading), and an optional `required` flag (defaults to false).

```typescript
interface HandoffTemplate { id: string; sections: HandoffSection[] }
interface HandoffSection { key: string; label: string; required?: boolean }
```

### Built-in Presets

Four preset templates are defined in `src/handoffs/templates.ts`:

**`standard`** -- General-purpose handoff format.
- Summary (required)
- Deliverables (required)
- Context for Next Step

**`qa-review`** -- For passing work to a QA or review node.
- Deliverables (required)
- Test Criteria (required)
- Known Limitations

**`qa-feedback`** -- For QA nodes returning review results.
- Verdict (required)
- Issues Found (required)
- Suggestions

**`escalation`** -- For escalation paths when automated resolution fails.
- Problem Description (required)
- Attempts Made (required)
- Recommendation (required)

### Edge Integration

The `DAGEdge` type accepts a `handoff` field that is either a string (preset name) or an inline `HandoffTemplate` object:

```typescript
// Preset reference
builder.edge('coder', 'reviewer', { handoff: 'qa-review' })

// Inline template
builder.edge('coder', 'reviewer', {
  handoff: {
    id: 'custom-review',
    sections: [
      { key: 'code', label: 'Code Changes', required: true },
      { key: 'rationale', label: 'Design Rationale' }
    ]
  }
})
```

### Resolution and Injection Flow

1. **Edge evaluation:** When the executor prepares to run a node, it checks all outgoing edges for a `handoff` field.
2. **Template resolution:** If `handoff` is a string, the resolver looks it up in the preset registry (`src/handoffs/templates.ts`). If it is an object, it is used directly. An unrecognized preset name produces a warning log and falls back to raw passthrough.
3. **Instruction generation:** The formatter (`src/handoffs/formatter.ts`) converts the resolved `HandoffTemplate` into a system prompt appendix. This appendix is structured as an `## Output Format` section listing each section heading. Required sections are marked with "(required)".
4. **System prompt injection:** The generated instructions are appended to the producing agent's system prompt before context assembly.
5. **Downstream consumption:** The downstream node receives the structured output as upstream context. No parsing is performed by the engine -- the sections are in Markdown heading format, which downstream agents can read naturally.

### Formatter Output Example

For the `qa-review` preset, the formatter generates:

```
## Output Format

Structure your response with the following sections:

### Deliverables (required)
### Test Criteria (required)
### Known Limitations
```

## User-Facing Behavior

- `DAGEdge` gains an optional `handoff` field (string or `HandoffTemplate`).
- `DAGBuilder.edge()` accepts `handoff` in its options parameter.
- Preset names are: `standard`, `qa-review`, `qa-feedback`, `escalation`.
- No new events are emitted. The handoff template affects only the system prompt content of the producing node.
- Existing DAGs without `handoff` fields behave identically to before.

## Configuration

| Option | Type | Default | Effect |
|--------|------|---------|--------|
| `DAGEdge.handoff` | `string \| HandoffTemplate` | `undefined` | Activates structured output formatting on the edge. String values reference a built-in preset. |
| `HandoffSection.required` | `boolean` | `false` | Marks the section as required in the output format instructions. |

## Edge Cases & Limitations

- **Multiple outgoing edges with different handoff templates:** If a node has multiple outgoing edges with different handoff templates, the engine merges all unique sections into a single output format instruction block. Duplicate section keys are deduplicated (first occurrence wins).
- **Preset name not found:** Logs a warning via the engine logger. The edge behaves as if no handoff was specified (raw passthrough). Execution is not interrupted.
- **Agent ignores format instructions:** The engine does not validate that the agent's output matches the template sections. Format instructions are best-effort guidance injected into the system prompt. LLMs may deviate.
- **Agentic backend nodes:** Handoff templates are injected into the context string passed to `AgenticRunner`, not into a system prompt message. The agentic backend receives the format instructions as part of its context but is free to structure output however it chooses.
- **Inline templates with no sections array:** An empty sections array produces no output format block (equivalent to raw passthrough).

## Common Questions

**Q: Can I create custom presets that are reusable across DAGs?**
A: Not via configuration. The four built-in presets are hardcoded in `src/handoffs/templates.ts`. For reusable custom templates, define a `HandoffTemplate` constant in your consumer code and reference it inline on edges. A future release may support a custom preset registry via `SwarmEngineConfig`.

**Q: Does the handoff template affect token usage?**
A: Yes, marginally. The output format instructions are appended to the system prompt, consuming input tokens. The overhead is small -- typically 50-100 tokens per template. The structured output from the agent may also be slightly longer than free-form text due to section headings.

**Q: What happens if the producing agent's output is very short and doesn't cover all sections?**
A: The engine does not enforce section completeness. If the agent produces output without all required sections, the downstream node receives whatever was produced. The `required` flag is an instruction to the LLM, not a runtime validation.

**Q: Can I use handoff templates on conditional edges?**
A: No. Handoff templates are supported only on `DAGEdge` (regular edges). `ConditionalEdge` does not have a `handoff` field. If you need structured output before a conditional routing decision, add a regular edge with a handoff template before the conditional edge.

**Q: Does the downstream node know which handoff template was used?**
A: No. The downstream node receives the upstream output as a string. It does not have metadata about which template (if any) was applied. The structured headings in the output are the only signal.

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Agent output is unstructured despite handoff template | Template was not resolved (preset name typo, or template object missing `sections`) | Check the edge's `handoff` value. Enable `debug` logging to see template resolution logs. |
| Warning log: "Unknown handoff preset: {name}" | Preset name is misspelled or not one of the four built-ins | Use one of: `standard`, `qa-review`, `qa-feedback`, `escalation`. Or pass an inline `HandoffTemplate` object. |
| Downstream node confused by structured output | Downstream node's system prompt does not account for structured input format | Adjust the downstream node's task or system prompt to expect sectioned input. |
| Output format instructions appear twice | Node has multiple outgoing edges with the same handoff template | The deduplication logic should prevent this. If it occurs, check for edges with identical section keys but different labels. |

## Related

- `src/handoffs/templates.ts` -- Preset definitions and resolver function
- `src/handoffs/formatter.ts` -- Instruction generator that produces the system prompt appendix
- `src/types.ts` -- `HandoffTemplate`, `HandoffSection`, `DAGEdge.handoff` type definitions
- `src/dag/executor.ts` -- Integration point where handoff templates are resolved and injected
- FH-002 (Agent Execution) -- System prompt assembly where handoff instructions are injected
- FH-003 (Context Assembly) -- Context assembly pipeline that carries the modified system prompt
