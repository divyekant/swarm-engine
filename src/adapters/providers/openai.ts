import OpenAI from 'openai';
import type { ProviderAdapter, ProviderEvent, StreamParams } from '../../types.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 250, output: 1000 },
  'gpt-4o-mini': { input: 15, output: 60 },
  'gpt-4.1': { input: 200, output: 800 },
  'gpt-4.1-mini': { input: 40, output: 160 },
  'gpt-4.1-nano': { input: 10, output: 40 },
};

const MODEL_LIMITS: Record<string, { contextWindow: number; maxOutput: number }> = {
  'gpt-4o': { contextWindow: 128_000, maxOutput: 16_384 },
  'gpt-4o-mini': { contextWindow: 128_000, maxOutput: 16_384 },
  'gpt-4.1': { contextWindow: 1_047_576, maxOutput: 32_768 },
  'gpt-4.1-mini': { contextWindow: 1_047_576, maxOutput: 32_768 },
  'gpt-4.1-nano': { contextWindow: 1_047_576, maxOutput: 32_768 },
};

const DEFAULT_PRICING = { input: 250, output: 1000 };
const DEFAULT_LIMITS = { contextWindow: 128_000, maxOutput: 16_384 };

function lookupByPrefix<T>(table: Record<string, T>, model: string, fallback: T): T {
  if (table[model]) return table[model];
  for (const [key, value] of Object.entries(table)) {
    if (model.startsWith(key)) return value;
  }
  return fallback;
}

export class OpenAIProvider implements ProviderAdapter {
  private client: OpenAI;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

  async *stream(params: StreamParams): AsyncGenerator<ProviderEvent> {
    const messages: OpenAI.ChatCompletionMessageParam[] = params.messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId ?? '',
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      };
    });

    const tools: OpenAI.ChatCompletionTool[] | undefined = params.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of response) {
      const choice = chunk.choices?.[0];

      if (choice?.delta?.content) {
        yield { type: 'chunk', content: choice.delta.content };
      }

      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls.has(idx)) {
            toolCalls.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
          }
          const entry = toolCalls.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
        }
      }

      if (choice?.finish_reason === 'tool_calls') {
        for (const [, tc] of toolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.args || '{}');
          } catch {
            // Malformed arguments; use empty object
          }
          yield { type: 'tool_use', id: tc.id, name: tc.name, input };
        }
        toolCalls.clear();
      }

      if (chunk.usage) {
        yield {
          type: 'usage',
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    }
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = lookupByPrefix(MODEL_PRICING, model, DEFAULT_PRICING);
    const inputCost = Math.ceil((inputTokens * pricing.input) / 1_000_000);
    const outputCost = Math.ceil((outputTokens * pricing.output) / 1_000_000);
    return inputCost + outputCost;
  }

  getModelLimits(model: string): { contextWindow: number; maxOutput: number } {
    return lookupByPrefix(MODEL_LIMITS, model, DEFAULT_LIMITS);
  }
}
