import type { HandoffTemplate } from '../types.js';

/**
 * Generate output formatting instructions to inject into a producing agent's
 * system prompt so it structures its output with the template's sections.
 */
export function formatHandoffInstructions(template: HandoffTemplate): string {
  const lines = [
    '## Output Format',
    'Structure your output with the following sections:',
    '',
  ];
  for (const section of template.sections) {
    const req = section.required ? ' (REQUIRED)' : '';
    lines.push(`## ${section.label}${req}`);
    lines.push(`[Your ${section.label.toLowerCase()} here]`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Format a node's raw output for downstream consumption.
 * Wraps with agent identity header. The raw output is passed through —
 * the template was used to shape it at generation time, not parse it after.
 */
export function formatHandoffOutput(
  _template: HandoffTemplate,
  rawOutput: string,
  agentRole: string,
  nodeId: string,
): string {
  return `### Output from ${agentRole} (${nodeId})\n${rawOutput}`;
}
