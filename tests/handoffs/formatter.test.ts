import { describe, it, expect } from 'vitest';
import { formatHandoffInstructions, formatHandoffOutput } from '../../src/handoffs/formatter.js';
import type { HandoffTemplate } from '../../src/types.js';

const template: HandoffTemplate = {
  id: 'test',
  sections: [
    { key: 'summary', label: 'Summary', required: true },
    { key: 'details', label: 'Details' },
  ],
};

describe('formatHandoffInstructions', () => {
  it('generates output formatting instructions from template', () => {
    const result = formatHandoffInstructions(template);
    expect(result).toContain('## Summary (REQUIRED)');
    expect(result).toContain('## Details');
    expect(result).not.toContain('Details (REQUIRED)');
    expect(result).toContain('## Output Format');
  });
});

describe('formatHandoffOutput', () => {
  it('wraps raw output with structured header', () => {
    const raw = '## Summary\nDid the thing\n\n## Details\nMore info';
    const result = formatHandoffOutput(template, raw, 'dev', 'node-1');
    expect(result).toContain('Output from dev (node-1)');
    expect(result).toContain('Did the thing');
    expect(result).toContain('More info');
  });

  it('passes through raw output unchanged when no template sections detected', () => {
    const raw = 'Just plain text output';
    const result = formatHandoffOutput(template, raw, 'dev', 'node-1');
    expect(result).toContain('Just plain text output');
    expect(result).toContain('Output from dev (node-1)');
  });
});
