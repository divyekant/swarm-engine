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
 * "Software Engineer" -> "software-engineer"
 * "software-engineer" -> "software-engineer" (no-op)
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
 * 1. Department-qualified: "engineering/software-engineer" -> personas/engineering/software-engineer.md
 * 2. Unqualified: "software-engineer" -> searches all department folders
 * 3. Fuzzy: "Software Engineer" -> normalized to "software-engineer" then searched
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
