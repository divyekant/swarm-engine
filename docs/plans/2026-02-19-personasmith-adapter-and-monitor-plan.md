# PersonaSmith Adapter + Real-Time DAG Monitor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a PersonaSmith-backed `PersonaProvider` that injects full persona Markdown into agent system prompts, and an SSE-based real-time DAG monitor web app.

**Architecture:** The PersonaSmith adapter reads `.md` files from PersonaSmith's `personas/` directory, parses XML-tagged sections into `PersonaConfig` metadata, and stores the full Markdown as `fullPrompt` for system prompt injection. The monitor is a thin SSE bridge in core that broadcasts `SwarmEvent`s, plus a separate React + React Flow web app.

**Tech Stack:** TypeScript, Vitest, Node.js `fs/promises`, `node:http`, React, React Flow, Vite, TailwindCSS

**Design Doc:** `docs/plans/2026-02-19-personasmith-adapter-and-monitor-design.md`

---

## Task 1: Extend PersonaConfig Type

**Files:**
- Modify: `src/types.ts:15-22`

**Step 1: Add new optional fields to PersonaConfig**

In `src/types.ts`, replace the `PersonaConfig` interface:

```ts
export interface PersonaConfig {
  name: string;
  role: string;
  traits: string[];
  constraints: string[];
  communicationStyle?: string;
  expertise?: string[];
  fullPrompt?: string;
  department?: string;
  seniority?: string;
  collaborationMap?: string;
}
```

**Step 2: Run typecheck to verify no breakage**

Run: `npx tsc --noEmit`
Expected: 0 errors. All existing code still compiles because the new fields are optional.

**Step 3: Run existing tests**

Run: `npx vitest run`
Expected: All 234 tests pass. No behavioral change.

**Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: extend PersonaConfig with fullPrompt, department, seniority, collaborationMap"
```

---

## Task 2: PersonaSmith Markdown Parser

**Files:**
- Create: `src/adapters/personas/parser.ts`
- Create: `tests/adapters/personas/parser.test.ts`

**Step 1: Write the failing test**

Create `tests/adapters/personas/parser.test.ts`:

```ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/personas/parser.test.ts`
Expected: FAIL — module `../../../src/adapters/personas/parser.js` does not exist.

**Step 3: Implement the parser**

Create `src/adapters/personas/parser.ts`:

```ts
import type { PersonaConfig } from '../../types.js';

/**
 * Extract content between XML-style tags from PersonaSmith Markdown.
 * Returns empty string if section not found.
 */
function extractSection(markdown: string, tagName: string): string {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const startIdx = markdown.indexOf(openTag);
  if (startIdx === -1) return '';
  const contentStart = startIdx + openTag.length;
  const endIdx = markdown.indexOf(closeTag, contentStart);
  if (endIdx === -1) return markdown.slice(contentStart).trim();
  return markdown.slice(contentStart, endIdx).trim();
}

/**
 * Extract a **Label:** Value field from a section.
 */
function extractField(section: string, label: string): string {
  const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i');
  const match = section.match(pattern);
  return match ? match[1].trim() : '';
}

/**
 * Extract bulleted list items from a section, starting after a header line.
 * Returns all `- item` lines found after the header, stopping at the next header or end.
 */
function extractBulletList(section: string, afterHeader?: string): string[] {
  let text = section;
  if (afterHeader) {
    const headerPattern = new RegExp(`\\*\\*${afterHeader}:?\\*\\*`, 'i');
    const headerMatch = text.match(headerPattern);
    if (!headerMatch || headerMatch.index === undefined) return [];
    text = text.slice(headerMatch.index + headerMatch[0].length);
    // Stop at the next ** header
    const nextHeader = text.match(/\n\*\*[A-Z]/);
    if (nextHeader?.index !== undefined) {
      text = text.slice(0, nextHeader.index);
    }
  }

  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim());
}

/**
 * Parse a PersonaSmith Markdown file into a PersonaConfig.
 *
 * Extracts structured metadata from XML-tagged sections while
 * preserving the full Markdown as `fullPrompt` for system prompt injection.
 */
export function parsePersonaMarkdown(markdown: string): PersonaConfig {
  const identity = extractSection(markdown, 'identity');
  const commStyle = extractSection(markdown, 'communication_style');
  const constraintsSection = extractSection(markdown, 'constraints_and_rules');
  const collabMap = extractSection(markdown, 'collaboration_map');

  // Identity fields
  const name = extractField(identity, 'Title');
  const department = extractField(identity, 'Department') || undefined;
  const seniority = extractField(identity, 'Seniority Level') || undefined;
  const expertiseDomain = extractField(identity, 'Expertise Domain');

  // Role: use the first paragraph after the structured fields in identity
  const identityLines = identity.split('\n');
  const roleLines = identityLines.filter(
    line => line.trim() !== '' && !line.trim().startsWith('**') && !line.trim().startsWith('#')
  );
  const role = roleLines.join(' ').trim() || name;

  // Expertise: split comma-separated domain
  const expertise = expertiseDomain
    ? expertiseDomain.split(',').map(e => e.trim()).filter(Boolean)
    : [];

  // Communication style
  const tone = extractField(commStyle, 'Tone');
  const traits = tone
    ? tone.split(',').map(t => t.trim()).flatMap(t => t.split(' and ').map(s => s.trim())).filter(Boolean)
    : [];
  const communicationStyle = extractField(commStyle, 'Formality Level') || undefined;

  // Constraints: combine "Hard Rules" and "You Must Never" bullet lists
  const hardRules = extractBulletList(constraintsSection, 'Hard Rules');
  const mustNever = extractBulletList(constraintsSection, 'You Must Never');
  const constraints = [...hardRules, ...mustNever];

  // Collaboration map: raw content for programmatic use
  const collaborationMap = collabMap || undefined;

  return {
    name,
    role,
    traits,
    constraints,
    communicationStyle,
    expertise,
    fullPrompt: markdown,
    department,
    seniority,
    collaborationMap,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/personas/parser.test.ts`
Expected: All 12 tests PASS.

**Step 5: Commit**

```bash
git add src/adapters/personas/parser.ts tests/adapters/personas/parser.test.ts
git commit -m "feat: add PersonaSmith Markdown parser with tests"
```

---

## Task 3: PersonaSmith Provider

**Files:**
- Create: `src/adapters/personas/personasmith.ts`
- Create: `tests/adapters/personas/personasmith.test.ts`

**Step 1: Write the failing test**

Create `tests/adapters/personas/personasmith.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonaSmithProvider } from '../../../src/adapters/personas/personasmith.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

const MOCK_PERSONA_CONTENT = `# PersonaSmith -- Test Persona

<identity>

**Title:** Test Engineer
**Department:** Engineering
**Seniority Level:** Mid
**Expertise Domain:** Testing, QA

You are a Test Engineer.

</identity>

<communication_style>

**Tone:** Direct, clear
**Formality Level:** Professional

</communication_style>

<constraints_and_rules>

**Hard Rules:**
- Always write tests

</constraints_and_rules>

<collaboration_map>

| Role | Interaction |
|---|---|
| Dev Lead | Code review |

</collaboration_map>`;

const MOCK_INDUSTRY_OVERLAY = `# Fintech Industry Overlay

## Regulatory Context
- SOX compliance required
- PCI-DSS for payment handling`;

describe('PersonaSmithProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads persona by department-qualified role', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(MOCK_PERSONA_CONTENT);

    const provider = new PersonaSmithProvider({
      personasDir: '/fake/personas',
    });

    const persona = await provider.getPersona('engineering/test-engineer');
    expect(persona).not.toBeNull();
    expect(persona!.name).toBe('Test Engineer');
    expect(persona!.department).toBe('Engineering');
    expect(persona!.fullPrompt).toBe(MOCK_PERSONA_CONTENT);

    expect(fs.readFile).toHaveBeenCalledWith(
      '/fake/personas/engineering/test-engineer.md',
      'utf-8'
    );
  });

  it('loads persona by unqualified role using glob-style search', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    const mockReaddir = vi.fn()
      .mockResolvedValueOnce([
        { name: 'engineering', isDirectory: () => true, isFile: () => false },
        { name: 'design', isDirectory: () => true, isFile: () => false },
      ] as any)
      .mockResolvedValueOnce([
        { name: 'test-engineer.md', isDirectory: () => false, isFile: () => true },
        { name: 'other.md', isDirectory: () => false, isFile: () => true },
      ] as any);
    vi.mocked(fs.readdir).mockImplementation(mockReaddir);
    vi.mocked(fs.readFile).mockResolvedValue(MOCK_PERSONA_CONTENT);

    const provider = new PersonaSmithProvider({
      personasDir: '/fake/personas',
    });

    const persona = await provider.getPersona('test-engineer');
    expect(persona).not.toBeNull();
    expect(persona!.name).toBe('Test Engineer');
  });

  it('normalizes role name to kebab-case', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(MOCK_PERSONA_CONTENT);

    const provider = new PersonaSmithProvider({
      personasDir: '/fake/personas',
    });

    const persona = await provider.getPersona('engineering/Test Engineer');
    expect(fs.readFile).toHaveBeenCalledWith(
      '/fake/personas/engineering/test-engineer.md',
      'utf-8'
    );
    expect(persona).not.toBeNull();
  });

  it('returns null for non-existent persona', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'engineering', isDirectory: () => true, isFile: () => false },
    ] as any);
    // No matching file in engineering
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: 'engineering', isDirectory: () => true, isFile: () => false },
    ] as any);
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: 'other.md', isDirectory: () => false, isFile: () => true },
    ] as any);

    const provider = new PersonaSmithProvider({
      personasDir: '/fake/personas',
    });

    const persona = await provider.getPersona('nonexistent');
    expect(persona).toBeNull();
  });

  it('caches personas by default', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(MOCK_PERSONA_CONTENT);

    const provider = new PersonaSmithProvider({
      personasDir: '/fake/personas',
    });

    await provider.getPersona('engineering/test-engineer');
    await provider.getPersona('engineering/test-engineer');

    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('skips cache when cacheEnabled is false', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(MOCK_PERSONA_CONTENT);

    const provider = new PersonaSmithProvider({
      personasDir: '/fake/personas',
      cacheEnabled: false,
    });

    await provider.getPersona('engineering/test-engineer');
    await provider.getPersona('engineering/test-engineer');

    expect(fs.readFile).toHaveBeenCalledTimes(2);
  });

  it('appends industry overlay when configured', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(MOCK_PERSONA_CONTENT)
      .mockResolvedValueOnce(MOCK_INDUSTRY_OVERLAY);

    const provider = new PersonaSmithProvider({
      personasDir: '/fake/personas',
      industriesDir: '/fake/industries',
      defaultIndustry: 'fintech',
    });

    const persona = await provider.getPersona('engineering/test-engineer');
    expect(persona).not.toBeNull();
    expect(persona!.fullPrompt).toContain(MOCK_PERSONA_CONTENT);
    expect(persona!.fullPrompt).toContain('Fintech Industry Overlay');

    expect(fs.readFile).toHaveBeenCalledWith(
      '/fake/industries/fintech.md',
      'utf-8'
    );
  });

  it('returns persona without overlay if industry file not found', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(MOCK_PERSONA_CONTENT)
      .mockRejectedValueOnce(new Error('ENOENT'));

    const provider = new PersonaSmithProvider({
      personasDir: '/fake/personas',
      industriesDir: '/fake/industries',
      defaultIndustry: 'nonexistent',
    });

    const persona = await provider.getPersona('engineering/test-engineer');
    expect(persona).not.toBeNull();
    expect(persona!.fullPrompt).toBe(MOCK_PERSONA_CONTENT);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/personas/personasmith.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Implement the provider**

Create `src/adapters/personas/personasmith.ts`:

```ts
import type { PersonaProvider, PersonaConfig } from '../../types.js';
import { parsePersonaMarkdown } from './parser.js';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface PersonaSmithOptions {
  /** Path to the PersonaSmith personas directory */
  personasDir: string;
  /** Path to the PersonaSmith industries directory (optional) */
  industriesDir?: string;
  /** Default industry overlay to apply (e.g. 'fintech') */
  defaultIndustry?: string;
  /** Enable in-memory caching (default: true) */
  cacheEnabled?: boolean;
}

/**
 * Converts a role string to kebab-case filename.
 * "Software Engineer" → "software-engineer"
 * "software-engineer" → "software-engineer" (no-op)
 */
function toKebabCase(str: string): string {
  return str
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * PersonaSmithProvider loads rich persona Markdown files from the
 * PersonaSmith library and parses them into PersonaConfig objects.
 *
 * Role resolution:
 * 1. Department-qualified: "engineering/software-engineer" → personas/engineering/software-engineer.md
 * 2. Unqualified: "software-engineer" → searches all department folders
 * 3. Fuzzy: "Software Engineer" → normalized to "software-engineer" then searched
 */
export class PersonaSmithProvider implements PersonaProvider {
  private readonly personasDir: string;
  private readonly industriesDir?: string;
  private readonly defaultIndustry?: string;
  private readonly cacheEnabled: boolean;
  private readonly cache = new Map<string, PersonaConfig>();

  constructor(options: PersonaSmithOptions) {
    this.personasDir = options.personasDir;
    this.industriesDir = options.industriesDir;
    this.defaultIndustry = options.defaultIndustry;
    this.cacheEnabled = options.cacheEnabled ?? true;
  }

  async getPersona(role: string): Promise<PersonaConfig | null> {
    // Check cache
    if (this.cacheEnabled && this.cache.has(role)) {
      return this.cache.get(role)!;
    }

    const markdown = await this.loadPersonaFile(role);
    if (!markdown) return null;

    // Load and append industry overlay if configured
    let fullContent = markdown;
    if (this.industriesDir && this.defaultIndustry) {
      const overlay = await this.loadIndustryOverlay();
      if (overlay) {
        fullContent = markdown + '\n\n---\n\n' + overlay;
      }
    }

    // Parse into PersonaConfig
    const persona = parsePersonaMarkdown(fullContent);

    // Cache the result
    if (this.cacheEnabled) {
      this.cache.set(role, persona);
    }

    return persona;
  }

  private async loadPersonaFile(role: string): Promise<string | null> {
    const parts = role.split('/');

    if (parts.length === 2) {
      // Department-qualified: "engineering/software-engineer"
      const [dept, name] = parts;
      const filePath = join(this.personasDir, dept, `${toKebabCase(name)}.md`);
      return this.readFileSafe(filePath);
    }

    // Unqualified: search all department folders
    const kebabName = toKebabCase(role);

    // Try direct path first (maybe it's already a full path)
    const directResult = await this.readFileSafe(join(this.personasDir, `${kebabName}.md`));
    if (directResult) return directResult;

    // Search department folders
    try {
      const entries = await readdir(this.personasDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const filePath = join(this.personasDir, entry.name, `${kebabName}.md`);
        const content = await this.readFileSafe(filePath);
        if (content) return content;
      }
    } catch {
      // Directory not readable
    }

    return null;
  }

  private async loadIndustryOverlay(): Promise<string | null> {
    if (!this.industriesDir || !this.defaultIndustry) return null;
    const filePath = join(this.industriesDir, `${this.defaultIndustry}.md`);
    return this.readFileSafe(filePath);
  }

  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/personas/personasmith.test.ts`
Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
git add src/adapters/personas/personasmith.ts tests/adapters/personas/personasmith.test.ts
git commit -m "feat: add PersonaSmithProvider with file loading, caching, and industry overlays"
```

---

## Task 4: Update ContextAssembler for fullPrompt

**Files:**
- Modify: `src/context/assembler.ts:70-82`
- Modify: `tests/context/assembler.test.ts` (if exists, otherwise check what file tests assembler)

**Step 1: Write the failing test**

Find the existing assembler test file. If it doesn't exist, create `tests/context/assembler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ContextAssembler } from '../../src/context/assembler.js';
import {
  NoopContextProvider,
  NoopMemoryProvider,
  NoopCodebaseProvider,
} from '../../src/adapters/defaults.js';
import type { PersonaProvider, PersonaConfig } from '../../src/types.js';

function createMockPersonaProvider(persona: PersonaConfig | null): PersonaProvider {
  return { getPersona: async () => persona };
}

describe('ContextAssembler fullPrompt support', () => {
  it('injects fullPrompt directly when present on PersonaConfig', async () => {
    const fullMarkdown = '# Software Engineer\n\nYou are a software engineer with deep expertise...';
    const provider = createMockPersonaProvider({
      name: 'Software Engineer',
      role: 'engineer',
      traits: ['Direct'],
      constraints: ['Write tests'],
      fullPrompt: fullMarkdown,
    });

    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: provider,
    });

    const messages = await assembler.assemble({
      systemPrompt: 'Base system prompt.',
      task: 'Build a feature',
      contextWindow: 100000,
    });

    const systemContent = messages[0].content;
    // Should contain the full markdown, NOT the structured format
    expect(systemContent).toContain(fullMarkdown);
    expect(systemContent).not.toContain('## Persona: Software Engineer');
  });

  it('falls back to structured format when fullPrompt is absent', async () => {
    const provider = createMockPersonaProvider({
      name: 'PM',
      role: 'product-manager',
      traits: ['Analytical'],
      constraints: ['Stay in scope'],
    });

    const assembler = new ContextAssembler({
      context: new NoopContextProvider(),
      memory: new NoopMemoryProvider(),
      codebase: new NoopCodebaseProvider(),
      persona: provider,
    });

    const messages = await assembler.assemble({
      systemPrompt: 'Base system prompt.',
      task: 'Plan a sprint',
      contextWindow: 100000,
    });

    const systemContent = messages[0].content;
    expect(systemContent).toContain('## Persona: PM');
    expect(systemContent).toContain('Role: product-manager');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/context/assembler.test.ts`
Expected: The fullPrompt test FAILS because `ContextAssembler` currently always uses structured format.

**Step 3: Update ContextAssembler**

In `src/context/assembler.ts`, replace lines 70-82 (the persona block):

```ts
    // --- Priority 1: Persona ---
    const persona = await this.deps.persona.getPersona(agentId ?? 'default');
    if (persona) {
      if (persona.fullPrompt) {
        // Full PersonaSmith Markdown — inject as-is for maximum fidelity
        budget.add('persona', persona.fullPrompt, 1);
      } else {
        // Slim metadata — build structured block from fields
        const personaBlock = [
          `## Persona: ${persona.name}`,
          `Role: ${persona.role}`,
          `Traits: ${persona.traits.join(', ')}`,
          `Constraints: ${persona.constraints.join(', ')}`,
          persona.communicationStyle ? `Communication Style: ${persona.communicationStyle}` : '',
          persona.expertise?.length ? `Expertise: ${persona.expertise.join(', ')}` : '',
        ].filter(Boolean).join('\n');
        budget.add('persona', personaBlock, 1);
      }
    }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/context/assembler.test.ts`
Expected: All tests PASS.

Run: `npx vitest run`
Expected: All tests PASS (no regressions).

**Step 5: Commit**

```bash
git add src/context/assembler.ts tests/context/assembler.test.ts
git commit -m "feat: ContextAssembler injects fullPrompt directly when present"
```

---

## Task 5: Export PersonaSmithProvider from Package

**Files:**
- Modify: `src/index.ts`

**Step 1: Add export**

Add to `src/index.ts` alongside the other adapter exports:

```ts
export { PersonaSmithProvider } from './adapters/personas/personasmith.js';
```

Also export the parser for advanced use:

```ts
export { parsePersonaMarkdown } from './adapters/personas/parser.js';
```

**Step 2: Run build and typecheck**

Run: `npx tsc --noEmit && npx tsup src/index.ts --format esm --dts`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export PersonaSmithProvider and parsePersonaMarkdown from package"
```

---

## Task 6: SSE Bridge

**Files:**
- Create: `src/monitor/sse-bridge.ts`
- Create: `tests/monitor/sse-bridge.test.ts`

**Step 1: Write the failing test**

Create `tests/monitor/sse-bridge.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSEBridge } from '../../src/monitor/sse-bridge.js';
import type { SwarmEvent, NodeStatus, CostSummary } from '../../src/types.js';

function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

/** Create a mock ServerResponse-like object */
function mockResponse() {
  const chunks: string[] = [];
  return {
    writeHead: vi.fn(),
    write: vi.fn((data: string) => { chunks.push(data); return true; }),
    end: vi.fn(),
    on: vi.fn(),
    chunks,
    headersSent: false,
  };
}

describe('SSEBridge', () => {
  let bridge: SSEBridge;

  beforeEach(() => {
    bridge = new SSEBridge();
  });

  it('broadcasts events to connected SSE clients as JSON', () => {
    const res = mockResponse();
    bridge.addClient(res as any);

    const event: SwarmEvent = {
      type: 'swarm_start',
      dagId: 'dag-1',
      nodeCount: 3,
    };
    bridge.broadcast(event);

    expect(res.write).toHaveBeenCalled();
    const written = res.chunks.join('');
    expect(written).toContain('data: ');
    expect(written).toContain('"type":"swarm_start"');
  });

  it('sets correct SSE headers when adding client', () => {
    const res = mockResponse();
    bridge.addClient(res as any);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }));
  });

  it('removes client on close event', () => {
    const res = mockResponse();
    let closeHandler: (() => void) | undefined;
    res.on.mockImplementation((event: string, handler: () => void) => {
      if (event === 'close') closeHandler = handler;
    });

    bridge.addClient(res as any);
    expect(bridge.clientCount).toBe(1);

    closeHandler!();
    expect(bridge.clientCount).toBe(0);
  });

  it('maintains state snapshot from events', () => {
    bridge.broadcast({
      type: 'swarm_start',
      dagId: 'dag-1',
      nodeCount: 3,
    });

    const state = bridge.getState();
    expect(state.dagId).toBe('dag-1');
    expect(state.status).toBe('running');
  });

  it('updates node status on agent events', () => {
    bridge.broadcast({ type: 'swarm_start', dagId: 'dag-1', nodeCount: 2 });
    bridge.broadcast({ type: 'agent_start', nodeId: 'n1', agentRole: 'dev', agentName: 'Dev' });

    const state = bridge.getState();
    expect(state.nodes.get('n1')?.status).toBe('running');
  });

  it('tracks cost and completion on agent_done', () => {
    bridge.broadcast({ type: 'swarm_start', dagId: 'dag-1', nodeCount: 1 });
    bridge.broadcast({ type: 'agent_start', nodeId: 'n1', agentRole: 'dev', agentName: 'Dev' });
    bridge.broadcast({
      type: 'agent_done',
      nodeId: 'n1',
      agentRole: 'dev',
      output: 'result',
      cost: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costCents: 1, calls: 1 },
    });

    const state = bridge.getState();
    expect(state.nodes.get('n1')?.status).toBe('completed');
    expect(state.nodes.get('n1')?.cost?.costCents).toBe(1);
  });

  it('tracks route decisions', () => {
    bridge.broadcast({ type: 'route_decision', fromNode: 'n1', toNode: 'n2', reason: 'approved' });

    const state = bridge.getState();
    expect(state.routeDecisions).toHaveLength(1);
    expect(state.routeDecisions[0]).toEqual({ from: 'n1', to: 'n2', reason: 'approved' });
  });

  it('marks swarm as completed on swarm_done', () => {
    bridge.broadcast({ type: 'swarm_start', dagId: 'dag-1', nodeCount: 1 });
    bridge.broadcast({
      type: 'swarm_done',
      results: [],
      totalCost: emptyCost(),
    });

    const state = bridge.getState();
    expect(state.status).toBe('completed');
  });

  it('marks swarm as failed on swarm_error', () => {
    bridge.broadcast({ type: 'swarm_start', dagId: 'dag-1', nodeCount: 1 });
    bridge.broadcast({
      type: 'swarm_error',
      message: 'Budget exceeded',
      completedNodes: [],
      partialCost: emptyCost(),
    });

    const state = bridge.getState();
    expect(state.status).toBe('failed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/monitor/sse-bridge.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Implement SSEBridge**

Create `src/monitor/sse-bridge.ts`:

```ts
import type { ServerResponse } from 'node:http';
import type { SwarmEvent, CostSummary, NodeStatus } from '../types.js';

interface NodeState {
  id: string;
  agentRole: string;
  agentName: string;
  status: NodeStatus;
  output?: string;
  error?: string;
  cost?: CostSummary;
}

export interface MonitorState {
  dagId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  nodes: Map<string, NodeState>;
  routeDecisions: { from: string; to: string; reason: string }[];
  totalCost: CostSummary;
  progress: { completed: number; total: number };
  startTime: number;
}

function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

/**
 * SSEBridge converts SwarmEvent broadcasts into Server-Sent Events
 * and maintains a state snapshot for catch-up on new client connections.
 */
export class SSEBridge {
  private clients: Set<ServerResponse> = new Set();
  private state: MonitorState = {
    dagId: '',
    status: 'idle',
    nodes: new Map(),
    routeDecisions: [],
    totalCost: emptyCost(),
    progress: { completed: 0, total: 0 },
    startTime: 0,
  };

  get clientCount(): number {
    return this.clients.size;
  }

  /** Register a new SSE client connection. */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /** Broadcast a SwarmEvent to all connected clients and update state. */
  broadcast(event: SwarmEvent): void {
    this.reduceState(event);

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      client.write(data);
    }
  }

  /** Get the current state snapshot. */
  getState(): MonitorState {
    return this.state;
  }

  /** Get a JSON-serializable version of the state (for /state endpoint). */
  getStateJSON(): Record<string, unknown> {
    return {
      dagId: this.state.dagId,
      status: this.state.status,
      nodes: Object.fromEntries(this.state.nodes),
      routeDecisions: this.state.routeDecisions,
      totalCost: this.state.totalCost,
      progress: this.state.progress,
      startTime: this.state.startTime,
    };
  }

  /** Reduce an event into the state snapshot. */
  private reduceState(event: SwarmEvent): void {
    switch (event.type) {
      case 'swarm_start':
        this.state = {
          dagId: event.dagId,
          status: 'running',
          nodes: new Map(),
          routeDecisions: [],
          totalCost: emptyCost(),
          progress: { completed: 0, total: event.nodeCount },
          startTime: Date.now(),
        };
        break;

      case 'agent_start': {
        this.state.nodes.set(event.nodeId, {
          id: event.nodeId,
          agentRole: event.agentRole,
          agentName: event.agentName,
          status: 'running',
        });
        break;
      }

      case 'agent_done': {
        const node = this.state.nodes.get(event.nodeId);
        if (node) {
          node.status = 'completed';
          node.output = event.output;
          node.cost = event.cost;
        }
        break;
      }

      case 'agent_error': {
        const node = this.state.nodes.get(event.nodeId);
        if (node) {
          node.status = 'failed';
          node.error = event.message;
        }
        break;
      }

      case 'swarm_progress':
        this.state.progress = {
          completed: event.completed,
          total: event.total,
        };
        break;

      case 'swarm_done':
        this.state.status = 'completed';
        this.state.totalCost = event.totalCost;
        break;

      case 'swarm_error':
        this.state.status = 'failed';
        this.state.totalCost = event.partialCost;
        break;

      case 'swarm_cancelled':
        this.state.status = 'cancelled';
        this.state.totalCost = event.partialCost;
        break;

      case 'route_decision':
        this.state.routeDecisions.push({
          from: event.fromNode,
          to: event.toNode,
          reason: event.reason,
        });
        break;
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/monitor/sse-bridge.test.ts`
Expected: All 9 tests PASS.

**Step 5: Commit**

```bash
git add src/monitor/sse-bridge.ts tests/monitor/sse-bridge.test.ts
git commit -m "feat: add SSEBridge for real-time SwarmEvent streaming to monitor clients"
```

---

## Task 7: Monitor HTTP Server

**Files:**
- Create: `src/monitor/http-server.ts`
- Create: `src/monitor/index.ts`
- Create: `tests/monitor/http-server.test.ts`

**Step 1: Write the failing test**

Create `tests/monitor/http-server.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { startMonitor } from '../../src/monitor/index.js';
import http from 'node:http';

function httpGet(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    }).on('error', reject);
  });
}

describe('Monitor HTTP Server', () => {
  let monitor: Awaited<ReturnType<typeof startMonitor>> | null = null;

  afterEach(async () => {
    if (monitor) {
      await monitor.close();
      monitor = null;
    }
  });

  it('starts on the specified port', async () => {
    monitor = await startMonitor({ port: 0 }); // port 0 = random available port
    expect(monitor.port).toBeGreaterThan(0);
  });

  it('returns health check on GET /health', async () => {
    monitor = await startMonitor({ port: 0 });
    const { status, body } = await httpGet(`http://localhost:${monitor.port}/health`);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: 'ok' });
  });

  it('returns state snapshot on GET /state', async () => {
    monitor = await startMonitor({ port: 0 });
    const { status, body } = await httpGet(`http://localhost:${monitor.port}/state`);
    expect(status).toBe(200);
    const state = JSON.parse(body);
    expect(state).toHaveProperty('dagId');
    expect(state).toHaveProperty('status');
  });

  it('returns SSE stream on GET /events', async () => {
    monitor = await startMonitor({ port: 0 });

    // Connect to SSE endpoint and collect first event
    const eventPromise = new Promise<string>((resolve) => {
      http.get(`http://localhost:${monitor!.port}/events`, (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream');
        res.on('data', (chunk) => {
          resolve(chunk.toString());
          res.destroy(); // close after first event
        });
      });
    });

    // Broadcast an event
    monitor.broadcast({
      type: 'swarm_start',
      dagId: 'test-dag',
      nodeCount: 2,
    });

    const sseData = await eventPromise;
    expect(sseData).toContain('data: ');
    expect(sseData).toContain('"type":"swarm_start"');
  });

  it('returns 404 for unknown routes', async () => {
    monitor = await startMonitor({ port: 0 });
    const { status } = await httpGet(`http://localhost:${monitor.port}/unknown`);
    expect(status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/monitor/http-server.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Implement HTTP server and public exports**

Create `src/monitor/http-server.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { SSEBridge } from './sse-bridge.js';
import type { SwarmEvent } from '../types.js';

export interface MonitorHandle {
  /** The port the monitor is listening on. */
  port: number;
  /** Broadcast a SwarmEvent to all connected SSE clients. */
  broadcast(event: SwarmEvent): void;
  /** Get the current state snapshot. */
  getState(): ReturnType<SSEBridge['getStateJSON']>;
  /** Close the HTTP server. */
  close(): Promise<void>;
}

export interface MonitorOptions {
  /** Port to listen on. Use 0 for random available port. Default: 4820. */
  port?: number;
}

export function createMonitorServer(options?: MonitorOptions): {
  server: Server;
  bridge: SSEBridge;
} {
  const bridge = new SSEBridge();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for cross-origin access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';

    switch (url) {
      case '/events':
        bridge.addClient(res);
        break;

      case '/state':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bridge.getStateJSON()));
        break;

      case '/health':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        break;

      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  return { server, bridge };
}

export async function startMonitorServer(options?: MonitorOptions): Promise<MonitorHandle> {
  const port = options?.port ?? 4820;
  const { server, bridge } = createMonitorServer(options);

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;

      resolve({
        port: actualPort,
        broadcast: (event: SwarmEvent) => bridge.broadcast(event),
        getState: () => bridge.getStateJSON(),
        close: () => new Promise<void>((res, rej) => {
          server.close((err) => err ? rej(err) : res());
        }),
      });
    });
  });
}
```

Create `src/monitor/index.ts`:

```ts
export { SSEBridge } from './sse-bridge.js';
export type { MonitorState } from './sse-bridge.js';
export { startMonitorServer as startMonitor, createMonitorServer } from './http-server.js';
export type { MonitorHandle, MonitorOptions } from './http-server.js';
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/monitor/http-server.test.ts`
Expected: All 5 tests PASS.

**Step 5: Commit**

```bash
git add src/monitor/sse-bridge.ts src/monitor/http-server.ts src/monitor/index.ts tests/monitor/http-server.test.ts
git commit -m "feat: add monitor HTTP server with /events (SSE), /state, and /health endpoints"
```

---

## Task 8: Export Monitor from Package

**Files:**
- Modify: `src/index.ts`

**Step 1: Add monitor exports**

Add to `src/index.ts`:

```ts
export { SSEBridge, startMonitor, createMonitorServer } from './monitor/index.js';
export type { MonitorState, MonitorHandle, MonitorOptions } from './monitor/index.js';
```

**Step 2: Run full build and tests**

Run: `npx tsc --noEmit && npx vitest run && npx tsup src/index.ts --format esm --dts`
Expected: All tests pass, clean typecheck, clean build.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export SSEBridge, startMonitor, createMonitorServer from package"
```

---

## Task 9: Final Verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (previous 234 + new ~30 tests).

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Run build**

Run: `npx tsup src/index.ts --format esm --dts`
Expected: Clean build with no warnings.

**Step 4: Commit any remaining changes**

---

## Monitor Web App (Separate Follow-Up)

The React + React Flow monitor web app (`@swarmengine/monitor`) is a separate follow-up implementation. It will be scaffolded as a new package in `packages/monitor/` with:
- Vite + React + TypeScript
- React Flow for DAG visualization
- TailwindCSS for styling
- `useSwarmEvents` hook connecting to the SSE endpoint
- State reducer consuming `SwarmEvent`s

This is tracked separately because it has different dependencies and deployment considerations.

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | Extend `PersonaConfig` type | Typecheck only |
| 2 | PersonaSmith Markdown parser | 12 unit tests |
| 3 | `PersonaSmithProvider` | 8 unit tests |
| 4 | Update `ContextAssembler` for `fullPrompt` | 2 tests |
| 5 | Export `PersonaSmithProvider` | Build verification |
| 6 | `SSEBridge` | 9 unit tests |
| 7 | Monitor HTTP server | 5 integration tests |
| 8 | Export monitor | Build verification |
| 9 | Final verification | Full suite |
