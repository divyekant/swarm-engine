import type { ProviderAdapter } from '../types.js';

export interface ScopeCreepResult {
  triggered: boolean;
  message: string;
}

export async function scopeCreepGuard(
  task: string,
  output: string,
  provider: ProviderAdapter,
): Promise<ScopeCreepResult> {
  if (!provider) {
    throw new Error('Scope creep guard requires a provider');
  }

  let result = '';
  for await (const event of provider.stream({
    model: 'default',
    messages: [
      {
        role: 'system',
        content: 'You evaluate whether an agent\'s output stays within scope of its task. Return ONLY "SCOPED" if the output addresses only what was asked, or "OVERSCOPED: <one-line reason>" if the output contains work beyond the task.',
      },
      {
        role: 'user',
        content: `Task: ${task}\n\nOutput:\n${output.slice(0, 3000)}`,
      },
    ],
    temperature: 0,
    maxTokens: 100,
  })) {
    if (event.type === 'chunk') {
      result += event.content;
    }
  }

  const trimmed = result.trim();

  if (trimmed.startsWith('SCOPED') && !trimmed.startsWith('OVERSCOPED')) {
    return { triggered: false, message: '' };
  }

  return {
    triggered: true,
    message: trimmed,
  };
}
