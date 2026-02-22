/**
 * Live test: Claude Code agentic node in a DAG.
 * Starts the monitor server on port 4820 so the UI can visualize.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/live-agentic-test.ts
 */
import { SwarmEngine } from '../src/engine.js';
import { startMonitor } from '../src/monitor/index.js';
import type { ProviderAdapter, ProviderEvent } from '../src/types.js';

// API key not needed for mock LLM providers.
// Claude Code uses its own authentication.

// Simple mock LLM that returns a static plan (avoids OAuth provider tool-role bug)
function createPlannerProvider(): ProviderAdapter {
  return {
    async *stream(): AsyncGenerator<ProviderEvent> {
      const plan = `1. Create a TypeScript file with an isValidEmail function using regex
2. Add test cases that verify valid and invalid emails
3. Export the function for use in other modules`;
      yield { type: 'chunk', content: plan };
      yield { type: 'usage', inputTokens: 50, outputTokens: 30 };
    },
    estimateCost: () => 0,
    getModelLimits: () => ({ contextWindow: 200_000, maxOutput: 8192 }),
  };
}

function createReviewerProvider(): ProviderAdapter {
  return {
    async *stream(params): AsyncGenerator<ProviderEvent> {
      // Extract upstream output to include in review
      const upstream = params.messages.find(m => m.role === 'user')?.content ?? '';
      const review = `Code review: The implementation looks solid. The email regex covers standard patterns. Test cases include both valid and invalid examples. Consider adding edge cases for international domains.`;
      yield { type: 'chunk', content: review };
      yield { type: 'usage', inputTokens: 200, outputTokens: 40 };
    },
    estimateCost: () => 0,
    getModelLimits: () => ({ contextWindow: 200_000, maxOutput: 8192 }),
  };
}

async function main() {
  // 1. Start monitor server
  const monitor = await startMonitor({ port: 4820 });
  console.log(`\nMonitor UI: open http://localhost:5173 (vite dev server)`);
  console.log(`   SSE stream:  http://localhost:${monitor.port}/events`);
  console.log(`   State:       http://localhost:${monitor.port}/state\n`);

  // 2. Create engine: mock LLM planner/reviewer + real CC coder
  const engine = new SwarmEngine({
    providers: {
      planner: {
        type: 'custom',
        adapter: createPlannerProvider(),
      },
      reviewer: {
        type: 'custom',
        adapter: createReviewerProvider(),
      },
      'claude-code': {
        type: 'claude-code',
      },
    },
    defaults: {
      provider: 'planner',
      model: 'mock',
    },
    limits: {
      maxSwarmBudgetCents: 50,
    },
  });

  // 3. Build DAG: Planner (mock) -> Coder (CC) -> Reviewer (mock)
  const dag = engine.dag()
    .agent('planner', {
      id: 'planner',
      name: 'Planner',
      role: 'planner',
      systemPrompt: 'Plan the task.',
      providerId: 'planner',
    })
    .agent('coder', {
      id: 'coder',
      name: 'Coder',
      role: 'coder',
      systemPrompt: `You are a coding agent. Implement the plan given to you.
Write the code to a file in the current working directory.
Keep it simple — a single file is fine. Do NOT use any tools beyond Read, Write, and Bash.`,
      providerId: 'claude-code',
      agentic: {
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        permissionMode: 'bypassPermissions',
        cwd: '/tmp/swarm-test-workspace',
        maxTurns: 15,
        maxBudgetUsd: 0.50,
      },
    })
    .agent('reviewer', {
      id: 'reviewer',
      name: 'Reviewer',
      role: 'reviewer',
      systemPrompt: 'Review the code.',
      providerId: 'reviewer',
    })
    .edge('planner', 'coder')
    .edge('coder', 'reviewer')
    .build();

  // 4. Create workspace
  const { mkdirSync } = await import('node:fs');
  mkdirSync('/tmp/swarm-test-workspace', { recursive: true });

  // 5. Run
  console.log('Starting DAG: Planner (mock) -> Coder (Claude Code) -> Reviewer (mock)\n');
  console.log('─'.repeat(60));

  for await (const event of engine.run({
    dag,
    task: 'Create a TypeScript function that checks if a string is a valid email address. Include a few test cases that verify the function works.',
  })) {
    // Broadcast to monitor UI
    monitor.broadcast(event);

    // Log key events
    switch (event.type) {
      case 'agent_start':
        console.log(`\n▶ ${event.agentName} (${event.agentRole}) started`);
        break;
      case 'agent_chunk':
        process.stdout.write(event.content);
        break;
      case 'agent_done':
        console.log(`\n✓ ${event.agentRole} done (${event.cost.totalTokens} tokens, ${event.cost.costCents.toFixed(2)}¢)`);
        console.log('─'.repeat(60));
        break;
      case 'agent_error':
        console.error(`\n✗ ${event.agentRole} error: ${event.message}`);
        break;
      case 'swarm_done':
        console.log(`\nSwarm complete! ${event.results.length} nodes, total cost: ${event.totalCost.costCents.toFixed(2)}¢`);
        break;
      case 'swarm_error':
        console.error(`\nSwarm error: ${event.message}`);
        break;
      case 'route_decision':
        console.log(`  → Routed: ${event.fromNode} -> ${event.toNode} (${event.reason})`);
        break;
    }
  }

  // Keep monitor running for 30s so you can inspect the UI
  console.log('\nMonitor still running for 30s — check the UI...');
  await new Promise((resolve) => setTimeout(resolve, 30000));

  await monitor.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
