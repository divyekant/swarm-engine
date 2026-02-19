import type { ProviderAdapter, ProviderConfig } from '../../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';

export function createProvider(config: ProviderConfig): ProviderAdapter {
  if (config.type === 'custom') {
    if (!config.adapter) throw new Error('Custom provider requires adapter');
    return config.adapter;
  }

  if (config.type === 'anthropic') {
    if (!config.apiKey) throw new Error('Anthropic provider requires apiKey');
    return new AnthropicProvider(config.apiKey, config.baseUrl);
  }

  if (config.type === 'openai') {
    if (!config.apiKey) throw new Error('OpenAI provider requires apiKey');
    return new OpenAIProvider(config.apiKey, config.baseUrl);
  }

  if (config.type === 'ollama') {
    return new OllamaProvider(config.baseUrl ?? 'http://localhost:11434');
  }

  if (config.type === 'google') {
    throw new Error('Google provider not yet implemented');
  }

  throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
}

export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export { OllamaProvider } from './ollama.js';
