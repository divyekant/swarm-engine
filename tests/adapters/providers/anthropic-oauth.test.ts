import { describe, it, expect } from 'vitest';
import { AnthropicOAuthProvider } from '../../../src/adapters/providers/anthropic-oauth.js';

describe('AnthropicOAuthProvider', () => {
  it('rejects construction with non-Anthropic baseUrl', () => {
    expect(() => {
      new AnthropicOAuthProvider('sk-ant-oat01-test', 'https://evil.com');
    }).toThrow(/not an allowed Anthropic host/i);
  });

  it('allows construction with default baseUrl (no baseUrl)', () => {
    const provider = new AnthropicOAuthProvider('sk-ant-oat01-test');
    expect(provider).toBeDefined();
  });

  it('allows construction with api.anthropic.com baseUrl', () => {
    const provider = new AnthropicOAuthProvider('sk-ant-oat01-test', 'https://api.anthropic.com');
    expect(provider).toBeDefined();
  });

  it('allows construction with anthropic subdomain baseUrl', () => {
    const provider = new AnthropicOAuthProvider('sk-ant-oat01-test', 'https://api.us.anthropic.com');
    expect(provider).toBeDefined();
  });
});
