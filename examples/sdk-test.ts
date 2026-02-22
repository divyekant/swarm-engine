/**
 * Minimal Claude Agent SDK test — verifies basic query works.
 * Usage: npx tsx examples/sdk-test.ts
 */
import { query } from '@anthropic-ai/claude-agent-sdk';

async function main() {
  console.log('Starting Claude Agent SDK test...\n');

  // Strip CLAUDECODE env var to avoid nested-session detection
  const env: Record<string, string | undefined> = { ...process.env };
  delete env['CLAUDECODE'];

  const q = query({
    prompt: 'Say "hello from SDK" and nothing else.',
    options: {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 1,
      maxBudgetUsd: 0.05,
      cwd: '/tmp/swarm-test-workspace',
      systemPrompt: 'You are a test agent. Be brief.',
      env,
      stderr: (data: string) => {
        process.stderr.write(`[stderr] ${data}`);
      },
    },
  });

  for await (const message of q) {
    const summary = JSON.stringify(message, null, 2).slice(0, 500);
    console.log(`[${message.type}]`, summary);
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
