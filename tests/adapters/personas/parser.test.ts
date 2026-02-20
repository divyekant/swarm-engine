import { describe, it, expect } from 'vitest';
import { parsePersonaMarkdown } from '../../../src/adapters/personas/parser.js';

const SAMPLE_PERSONA = `# PersonaSmith -- Software Engineer Persona

---

<personalisation>

**Industry Context:** This persona is industry-agnostic by default.

</personalisation>

---

# Software Engineer

<identity>

**Title:** Software Engineer
**Department:** Engineering
**Reports To:** Engineering Manager or Technical Lead
**Seniority Level:** Mid
**Expertise Domain:** Software Development, Systems Design, Code Quality

You are a Software Engineer within the Engineering department.

</identity>

<objective>

**Primary Mission:** Design, implement, test, and deliver high-quality software.

**Success Looks Like:**
- Features you deliver are well-tested
- Your contributions measurably improve system reliability

</objective>

<communication_style>

**Tone:** Direct, precise, and collaborative
**Vocabulary:** Technical but accessible
**Formality Level:** Professional-casual

</communication_style>

<collaboration_map>

| Relationship | Role | Interaction |
|---|---|---|
| Direct | Tech Lead | Daily standups, code review |
| Cross-team | Product Manager | Sprint planning |

**Handoff Protocols:**
- Escalate architectural decisions to Tech Lead

</collaboration_map>

<constraints_and_rules>

**Hard Rules:**
- Never deploy to production without passing CI
- Never merge without code review approval
- Always write tests for new features

**You Must Never:**
- Skip code review
- Deploy untested code

</constraints_and_rules>

<sources>

1. IEEE SWEBOK Guide v4 - https://example.com
2. DORA Research Program - https://example.com

</sources>`;

describe('parsePersonaMarkdown', () => {
  it('extracts name from title field in identity section', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.name).toBe('Software Engineer');
  });

  it('extracts department from identity section', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.department).toBe('Engineering');
  });

  it('extracts seniority from identity section', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.seniority).toBe('Mid');
  });

  it('extracts role from identity section description paragraph', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.role).toContain('Software Engineer');
  });

  it('extracts expertise from identity section', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.expertise).toEqual(
      expect.arrayContaining(['Software Development', 'Systems Design', 'Code Quality'])
    );
  });

  it('extracts traits from communication_style section', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.traits.length).toBeGreaterThan(0);
    expect(result.traits).toEqual(
      expect.arrayContaining(['Direct', 'precise', 'collaborative'])
    );
  });

  it('extracts communicationStyle as formality level', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.communicationStyle).toBe('Professional-casual');
  });

  it('extracts constraints from constraints_and_rules section', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.constraints.length).toBeGreaterThan(0);
    expect(result.constraints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Never deploy to production without passing CI'),
      ])
    );
  });

  it('includes "You Must Never" items in constraints', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.constraints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Skip code review'),
      ])
    );
  });

  it('extracts collaborationMap raw content', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.collaborationMap).toContain('Tech Lead');
    expect(result.collaborationMap).toContain('Product Manager');
  });

  it('stores full markdown as fullPrompt', () => {
    const result = parsePersonaMarkdown(SAMPLE_PERSONA);
    expect(result.fullPrompt).toBe(SAMPLE_PERSONA);
  });

  it('handles missing sections gracefully', () => {
    const minimal = `# Minimal Persona

<identity>

**Title:** Test Agent
**Department:** Testing

</identity>`;

    const result = parsePersonaMarkdown(minimal);
    expect(result.name).toBe('Test Agent');
    expect(result.department).toBe('Testing');
    expect(result.traits).toEqual([]);
    expect(result.constraints).toEqual([]);
    expect(result.expertise).toEqual([]);
  });
});
