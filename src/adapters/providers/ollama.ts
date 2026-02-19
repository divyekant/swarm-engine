import type { ProviderAdapter, ProviderEvent, StreamParams } from '../../types.js';

const DEFAULT_LIMITS = { contextWindow: 128_000, maxOutput: 4096 };

interface OllamaChatMessage {
  role: string;
  content: string;
}

interface OllamaStreamChunk {
  message?: { role?: string; content?: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements ProviderAdapter {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async *stream(params: StreamParams): AsyncGenerator<ProviderEvent> {
    const messages: OllamaChatMessage[] = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const body = JSON.stringify({
      model: params.model,
      messages,
      stream: true,
      options: {
        temperature: params.temperature,
        num_predict: params.maxTokens,
      },
    });

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: params.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Ollama response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let chunk: OllamaStreamChunk;
          try {
            chunk = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (chunk.message?.content) {
            yield { type: 'chunk', content: chunk.message.content };
          }

          if (chunk.done) {
            totalInputTokens = chunk.prompt_eval_count ?? 0;
            totalOutputTokens = chunk.eval_count ?? 0;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      yield {
        type: 'usage',
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      };
    }
  }

  estimateCost(_model: string, _inputTokens: number, _outputTokens: number): number {
    return 0;
  }

  getModelLimits(_model: string): { contextWindow: number; maxOutput: number } {
    return { ...DEFAULT_LIMITS };
  }
}
