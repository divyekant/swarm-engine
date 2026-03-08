import type { Guard, ProviderAdapter } from '../types.js';
import { evidenceGuard } from './evidence.js';
import { scopeCreepGuard } from './scope-creep.js';

export interface GuardResult {
  guardId: string;
  guardType: string;
  triggered: boolean;
  blocked: boolean;
  skipped?: boolean;
  message: string;
}

/**
 * Run all guards against a node's output.
 * Evidence guards run first (fast, pattern-based).
 * Scope-creep guards run second (requires LLM).
 */
export async function runGuards(
  guards: Guard[],
  task: string,
  output: string,
  provider?: ProviderAdapter,
): Promise<GuardResult[]> {
  if (guards.length === 0) return [];

  // Sort: evidence first, then scope-creep, then others
  const sorted = [...guards].sort((a, b) => {
    const order: Record<string, number> = { evidence: 0, 'scope-creep': 1 };
    return (order[a.type] ?? 2) - (order[b.type] ?? 2);
  });

  const results: GuardResult[] = [];

  for (const guard of sorted) {
    if (guard.type === 'evidence') {
      const result = evidenceGuard(output);
      results.push({
        guardId: guard.id,
        guardType: guard.type,
        triggered: result.triggered,
        blocked: result.triggered && guard.mode === 'block',
        message: result.message,
      });
    } else if (guard.type === 'scope-creep') {
      if (!provider) {
        results.push({
          guardId: guard.id,
          guardType: guard.type,
          triggered: false,
          blocked: false,
          skipped: true,
          message: 'Scope creep guard skipped: no provider available',
        });
        continue;
      }
      const result = await scopeCreepGuard(task, output, provider);
      results.push({
        guardId: guard.id,
        guardType: guard.type,
        triggered: result.triggered,
        blocked: result.triggered && guard.mode === 'block',
        message: result.message,
      });
    }
  }

  return results;
}
