import { describe, it, expect } from 'vitest';
import { HANDOFF_PRESETS, getHandoffTemplate } from '../../src/handoffs/templates.js';
import type { HandoffTemplate } from '../../src/types.js';

describe('HANDOFF_PRESETS', () => {
  const expectedPresets = ['standard', 'qa-review', 'qa-feedback', 'escalation'];

  it('contains all four built-in presets', () => {
    for (const name of expectedPresets) {
      expect(HANDOFF_PRESETS).toHaveProperty(name);
    }
    expect(Object.keys(HANDOFF_PRESETS)).toHaveLength(4);
  });

  it('each preset has id matching its key', () => {
    for (const [key, template] of Object.entries(HANDOFF_PRESETS)) {
      expect(template.id).toBe(key);
    }
  });

  it('each preset has non-empty sections', () => {
    for (const template of Object.values(HANDOFF_PRESETS)) {
      expect(template.sections.length).toBeGreaterThan(0);
    }
  });

  it('standard preset has correct sections', () => {
    const t = HANDOFF_PRESETS.standard;
    const keys = t.sections.map((s) => s.key);
    expect(keys).toContain('summary');
    expect(keys).toContain('deliverables');
    expect(keys).toContain('context_for_next');
    // summary and deliverables are required
    expect(t.sections.find((s) => s.key === 'summary')?.required).toBe(true);
    expect(t.sections.find((s) => s.key === 'deliverables')?.required).toBe(true);
    expect(t.sections.find((s) => s.key === 'context_for_next')?.required).toBeFalsy();
  });

  it('qa-review preset has correct sections', () => {
    const t = HANDOFF_PRESETS['qa-review'];
    const keys = t.sections.map((s) => s.key);
    expect(keys).toContain('deliverables');
    expect(keys).toContain('test_criteria');
    expect(keys).toContain('known_limitations');
    expect(t.sections.find((s) => s.key === 'deliverables')?.required).toBe(true);
    expect(t.sections.find((s) => s.key === 'test_criteria')?.required).toBe(true);
    expect(t.sections.find((s) => s.key === 'known_limitations')?.required).toBeFalsy();
  });

  it('qa-feedback preset has correct sections', () => {
    const t = HANDOFF_PRESETS['qa-feedback'];
    const keys = t.sections.map((s) => s.key);
    expect(keys).toContain('verdict');
    expect(keys).toContain('issues_found');
    expect(keys).toContain('suggestions');
    expect(t.sections.find((s) => s.key === 'verdict')?.required).toBe(true);
    expect(t.sections.find((s) => s.key === 'issues_found')?.required).toBe(true);
    expect(t.sections.find((s) => s.key === 'suggestions')?.required).toBeFalsy();
  });

  it('escalation preset has correct sections', () => {
    const t = HANDOFF_PRESETS.escalation;
    const keys = t.sections.map((s) => s.key);
    expect(keys).toContain('problem_description');
    expect(keys).toContain('attempts_made');
    expect(keys).toContain('recommendation');
    expect(t.sections.find((s) => s.key === 'problem_description')?.required).toBe(true);
    expect(t.sections.find((s) => s.key === 'attempts_made')?.required).toBe(true);
    expect(t.sections.find((s) => s.key === 'recommendation')?.required).toBe(true);
  });
});

describe('getHandoffTemplate', () => {
  it('resolves a preset by name', () => {
    const t = getHandoffTemplate('standard');
    expect(t.id).toBe('standard');
    expect(t.sections.length).toBeGreaterThan(0);
  });

  it('resolves all preset names', () => {
    for (const name of ['standard', 'qa-review', 'qa-feedback', 'escalation']) {
      const t = getHandoffTemplate(name);
      expect(t.id).toBe(name);
    }
  });

  it('returns inline template as-is when given a HandoffTemplate object', () => {
    const inline: HandoffTemplate = {
      id: 'custom',
      sections: [{ key: 'notes', label: 'Notes', required: true }],
    };
    const t = getHandoffTemplate(inline);
    expect(t).toBe(inline);
  });

  it('throws for unknown preset name', () => {
    expect(() => getHandoffTemplate('nonexistent')).toThrow();
  });
});
