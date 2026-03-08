import type { HandoffTemplate } from '../types.js';

export const HANDOFF_PRESETS: Record<string, HandoffTemplate> = {
  standard: {
    id: 'standard',
    sections: [
      { key: 'summary', label: 'Summary', required: true },
      { key: 'deliverables', label: 'Deliverables', required: true },
      { key: 'context_for_next', label: 'Context for Next Step' },
    ],
  },
  'qa-review': {
    id: 'qa-review',
    sections: [
      { key: 'deliverables', label: 'Deliverables', required: true },
      { key: 'test_criteria', label: 'Test Criteria', required: true },
      { key: 'known_limitations', label: 'Known Limitations' },
    ],
  },
  'qa-feedback': {
    id: 'qa-feedback',
    sections: [
      { key: 'verdict', label: 'Verdict', required: true },
      { key: 'issues_found', label: 'Issues Found', required: true },
      { key: 'suggestions', label: 'Suggestions' },
    ],
  },
  escalation: {
    id: 'escalation',
    sections: [
      { key: 'problem_description', label: 'Problem Description', required: true },
      { key: 'attempts_made', label: 'Attempts Made', required: true },
      { key: 'recommendation', label: 'Recommendation', required: true },
    ],
  },
};

/**
 * Resolve a handoff reference to a HandoffTemplate.
 * If `ref` is a string, look up the preset by name. If it's already a
 * HandoffTemplate object, return it as-is.
 */
export function getHandoffTemplate(ref: string | HandoffTemplate): HandoffTemplate {
  if (typeof ref !== 'string') {
    return ref;
  }
  const preset = HANDOFF_PRESETS[ref];
  if (!preset) {
    throw new Error(`Unknown handoff preset: "${ref}"`);
  }
  return preset;
}
