import { describe, it, expect } from 'vitest';
import { isAgenticProvider, createAgenticAdapter } from '../../../src/adapters/agentic/index.js';
import type { AgenticAdapter, AgenticEvent } from '../../../src/adapters/agentic/types.js';

describe('isAgenticProvider', () => {
  it('returns true for claude-code', () => {
    expect(isAgenticProvider('claude-code')).toBe(true);
  });
  it('returns true for codex', () => {
    expect(isAgenticProvider('codex')).toBe(true);
  });
  it('returns true for custom-agentic', () => {
    expect(isAgenticProvider('custom-agentic')).toBe(true);
  });
  it('returns false for standard providers', () => {
    expect(isAgenticProvider('anthropic')).toBe(false);
    expect(isAgenticProvider('openai')).toBe(false);
    expect(isAgenticProvider('ollama')).toBe(false);
    expect(isAgenticProvider('custom')).toBe(false);
  });
});

describe('createAgenticAdapter', () => {
  it('returns custom adapter when provided', () => {
    const customAdapter: AgenticAdapter = {
      async *run() { yield { type: 'result', output: 'custom' } as AgenticEvent; },
    };
    const adapter = createAgenticAdapter({ type: 'custom-agentic', agenticAdapter: customAdapter });
    expect(adapter).toBe(customAdapter);
  });
  it('throws for custom-agentic without adapter', () => {
    expect(() => createAgenticAdapter({ type: 'custom-agentic' })).toThrow('Custom agentic provider requires agenticAdapter');
  });
  it('throws helpful error for claude-code when SDK not installed', () => {
    expect(() => createAgenticAdapter({ type: 'claude-code' })).toThrow(/claude-agent-sdk.*not installed/i);
  });
  it('throws helpful error for codex when SDK not installed', () => {
    expect(() => createAgenticAdapter({ type: 'codex' })).toThrow(/codex-sdk.*not installed/i);
  });
});
