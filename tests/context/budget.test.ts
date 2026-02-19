import { describe, it, expect } from 'vitest';
import { TokenBudget } from '../../src/context/budget.js';

describe('TokenBudget', () => {
  it('allocates budget to segments by priority', () => {
    const budget = new TokenBudget(1000); // 1000 token budget

    budget.add('system', 'You are a PM agent.', 1);        // Priority 1 = never truncate
    budget.add('task', 'Write a PRD for auth.', 1);         // Priority 1
    budget.add('entity', 'Product: MyApp. Desc: A cool app...', 3); // Priority 3
    budget.add('knowledge', 'Past decision: use JWT...'.repeat(100), 5); // Priority 5 = truncate first

    const result = budget.build();
    expect(result).toContain('You are a PM agent.');
    expect(result).toContain('Write a PRD for auth.');
    // Knowledge should be truncated if total exceeds budget
  });

  it('never truncates priority 1 segments', () => {
    const budget = new TokenBudget(50);
    budget.add('system', 'Important system prompt that is long', 1);
    budget.add('filler', 'x'.repeat(1000), 5);

    const result = budget.build();
    expect(result).toContain('Important system prompt that is long');
  });
});
