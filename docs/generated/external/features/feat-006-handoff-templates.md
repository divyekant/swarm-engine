---
id: feat-006
type: feature-doc
audience: external
topic: handoff-templates
status: draft
generated: 2026-03-08
source-tier: direct
hermes-version: 1.0.0
---

# Handoff Templates

## Overview

When agents pass work to the next node in a DAG, the handoff can be messy -- unstructured text with no consistent format for the receiving agent to parse. Handoff templates solve this by defining a structured output format on each edge, so the upstream agent knows exactly what sections to produce and the downstream agent receives predictable, well-organized context. You can use one of the four built-in presets or define your own inline template.

## How to Use It

The most common way to use handoff templates is to assign a preset name to an edge. The engine injects formatting instructions into the upstream agent's prompt automatically, and structures its output before passing it downstream.

### Step 1: Add a preset to an edge

```typescript
import { SwarmEngine, DAGBuilder } from '@swarmengine/core';

const engine = new SwarmEngine({
  providers: {
    anthropic: { type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  },
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
});

const dag = engine.dag()
  .agent('dev', {
    id: 'dev',
    name: 'Developer',
    role: 'developer',
    systemPrompt: 'You are a senior developer. Implement the requested feature.',
  })
  .agent('qa', {
    id: 'qa',
    name: 'QA Reviewer',
    role: 'reviewer',
    systemPrompt: 'You review code for correctness and quality.',
  })
  .edge('dev', 'qa', { handoff: 'standard' })
  .build();
```

The `standard` preset tells the developer agent to structure its output with three sections: **Summary**, **Deliverables**, and **Context for Next Step**. The QA reviewer receives this structured output instead of raw freeform text.

### Step 2: Consume events as usual

Nothing changes in your event loop. Handoff formatting happens transparently inside the engine.

```typescript
for await (const event of engine.run({ dag, task: 'Add input validation to the signup form' })) {
  if (event.type === 'agent_chunk') {
    process.stdout.write(event.content);
  }
}
```

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `handoff` on `EdgeOptions` | A preset name (`string`) or an inline `HandoffTemplate` object. | `undefined` (no formatting) |
| `HandoffTemplate.id` | Unique identifier for the template. | Required for inline templates. |
| `HandoffTemplate.sections` | Array of `{ key, label, required }` objects defining output sections. | Required for inline templates. |
| `HandoffSection.key` | Machine-readable key for the section (e.g., `'code'`). | Required. |
| `HandoffSection.label` | Human-readable label shown in the output (e.g., `'Code Changes'`). | Required. |
| `HandoffSection.required` | Whether the agent must include this section. | `false` |

### Built-in presets

| Preset Name | Sections | Best For |
|-------------|----------|----------|
| `standard` | Summary, Deliverables, Context for Next Step | General-purpose handoffs between any two agents. |
| `qa-review` | Deliverables, Test Criteria, Known Limitations | Handing work to a QA or review agent. |
| `qa-feedback` | Verdict, Issues Found, Suggestions | QA agent passing feedback back to the author. |
| `escalation` | Problem Description, Attempts Made, Recommendation | Escalating an issue to a human or senior agent. |

## Examples

### Example: Custom inline template

When none of the presets fit, you can define your own template inline on any edge.

```typescript
const dag = engine.dag()
  .agent('researcher', {
    id: 'researcher',
    name: 'Researcher',
    role: 'researcher',
    systemPrompt: 'You research technical topics thoroughly.',
  })
  .agent('writer', {
    id: 'writer',
    name: 'Writer',
    role: 'writer',
    systemPrompt: 'You write clear technical documentation.',
  })
  .edge('researcher', 'writer', {
    handoff: {
      id: 'research-to-writing',
      sections: [
        { key: 'findings', label: 'Key Findings', required: true },
        { key: 'sources', label: 'Sources', required: true },
        { key: 'outline', label: 'Suggested Outline', required: false },
      ],
    },
  })
  .build();
```

### Example: Using the helper functions directly

You can access presets and formatting functions if you need them outside of DAG execution.

```typescript
import {
  HANDOFF_PRESETS,
  getHandoffTemplate,
  formatHandoffInstructions,
  formatHandoffOutput,
} from '@swarmengine/core';

// Get a preset by name
const template = getHandoffTemplate('qa-review');

// Generate instruction text to append to a system prompt
const instructions = formatHandoffInstructions(template);

// Format raw output according to a template's sections
const formatted = formatHandoffOutput(template, rawAgentOutput);
```

### Example: Dev-to-QA pipeline with different handoff styles

```typescript
const dag = engine.dag()
  .agent('dev', { id: 'dev', name: 'Dev', role: 'developer', systemPrompt: '...' })
  .agent('qa', { id: 'qa', name: 'QA', role: 'reviewer', systemPrompt: '...' })
  .agent('lead', { id: 'lead', name: 'Lead', role: 'lead', systemPrompt: '...' })
  .edge('dev', 'qa', { handoff: 'qa-review' })
  .edge('qa', 'lead', { handoff: 'qa-feedback' })
  .build();
```

## Limitations

- Handoff templates guide the agent's output format through prompt instructions. They do not enforce strict schema validation on the output. An agent may produce output that deviates from the template, especially with lower-quality models.
- Templates are per-edge, not per-node. If a node has multiple outgoing edges with different templates, the engine uses the template from each respective edge.
- Inline templates are not reusable across DAGs. If you need the same custom template in multiple places, store it in a variable and reference it on each edge.

## Related

- [DAG Orchestration](feat-001-dag-orchestration.md) -- How edges and nodes work.
- [Feedback Loops](feat-007-feedback-loops.md) -- Combine handoff templates with feedback loops for structured Dev-QA cycles.
- [Anti-Pattern Guards](feat-008-guards.md) -- Validate output quality after handoff formatting.
