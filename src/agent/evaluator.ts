import type { Evaluator, ProviderAdapter } from '../types.js';

/**
 * Evaluate an agent's output using the given evaluator and return the target node ID.
 *
 * Three evaluator tiers:
 * - rule: A synchronous function that maps output -> target node ID (free)
 * - regex: Tests a RegExp pattern against the output; returns matchTarget or elseTarget (free)
 * - llm: Sends the output to a cheap LLM with a tight max_tokens to determine the target label
 */
export async function evaluate(
  evaluator: Evaluator,
  output: string,
  provider?: ProviderAdapter,
): Promise<string> {
  switch (evaluator.type) {
    case 'rule':
      return evaluator.fn(output);

    case 'regex': {
      const match = new RegExp(evaluator.pattern).test(output);
      return match ? evaluator.matchTarget : evaluator.elseTarget;
    }

    case 'llm': {
      if (!provider) {
        throw new Error('LLM evaluator requires a provider');
      }

      let result = '';
      for await (const event of provider.stream({
        model: evaluator.model ?? 'default',
        messages: [
          { role: 'system', content: 'Return ONLY the target label, nothing else.' },
          { role: 'user', content: `${evaluator.prompt}\n\nAgent output:\n${output}` },
        ],
        temperature: 0,
        maxTokens: 50,
      })) {
        if (event.type === 'chunk') {
          result += event.content;
        }
      }

      return result.trim();
    }
  }
}
