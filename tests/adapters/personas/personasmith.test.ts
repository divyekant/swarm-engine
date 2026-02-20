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
    vi.clearAllMocks();
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
