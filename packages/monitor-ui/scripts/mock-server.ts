/**
 * Mock SSE server for testing the monitor UI.
 *
 * Uses the real startMonitorServer from @swarmengine/core to validate
 * the actual SSE pipeline end-to-end.
 *
 * Usage: npx tsx scripts/mock-server.ts
 */

import { createServer, type ServerResponse } from 'node:http';

// --- Types (inline to avoid import issues) ---

interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  calls: number;
}

type SwarmEvent =
  | { type: 'agent_start'; nodeId: string; agentRole: string; agentName: string }
  | { type: 'agent_chunk'; nodeId: string; agentRole: string; content: string }
  | { type: 'agent_done'; nodeId: string; agentRole: string; output: string; cost: CostSummary }
  | { type: 'agent_error'; nodeId: string; agentRole: string; message: string; errorType: string }
  | { type: 'swarm_start'; dagId: string; nodeCount: number }
  | { type: 'swarm_progress'; completed: number; total: number; runningNodes: string[] }
  | { type: 'swarm_done'; results: never[]; totalCost: CostSummary }
  | { type: 'route_decision'; fromNode: string; toNode: string; reason: string };

// --- Standalone SSE server (avoids ESM/CJS import issues with core) ---

const clients = new Set<ServerResponse>();
let stateJSON: Record<string, unknown> = {
  dagId: '',
  status: 'idle',
  nodes: {},
  routeDecisions: [],
  totalCost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 },
  progress: { completed: 0, total: 0 },
  startTime: 0,
};

function broadcast(event: SwarmEvent) {
  // Update state based on event (simplified reducer)
  const s = { ...stateJSON } as Record<string, unknown>;
  const nodes = { ...(s.nodes as Record<string, unknown>) };

  switch (event.type) {
    case 'swarm_start':
      stateJSON = {
        dagId: event.dagId,
        status: 'running',
        nodes: {},
        routeDecisions: [],
        totalCost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 },
        progress: { completed: 0, total: event.nodeCount },
        startTime: Date.now(),
      };
      break;
    case 'agent_start':
      nodes[event.nodeId] = {
        id: event.nodeId,
        agentRole: event.agentRole,
        agentName: event.agentName,
        status: 'running',
      };
      stateJSON = { ...stateJSON, nodes };
      break;
    case 'agent_done':
      if (nodes[event.nodeId]) {
        nodes[event.nodeId] = {
          ...(nodes[event.nodeId] as Record<string, unknown>),
          status: 'completed',
          output: event.output,
          cost: event.cost,
        };
      }
      stateJSON = { ...stateJSON, nodes };
      break;
    case 'swarm_progress':
      stateJSON = { ...stateJSON, progress: { completed: event.completed, total: event.total } };
      break;
    case 'swarm_done':
      stateJSON = { ...stateJSON, status: 'completed', totalCost: event.totalCost };
      break;
    case 'route_decision': {
      const decisions = [...(stateJSON.routeDecisions as Array<unknown>)];
      decisions.push({ from: event.fromNode, to: event.toNode, reason: event.reason });
      stateJSON = { ...stateJSON, routeDecisions: decisions };
      break;
    }
  }

  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  switch (req.url) {
    case '/events':
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      break;

    case '/state':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stateJSON));
      break;

    case '/health':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      break;

    default:
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// --- Demo event sequence ---

function makeCost(cents: number, calls = 1): CostSummary {
  const inputTokens = Math.round(cents * 400);
  const outputTokens = Math.round(cents * 200);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costCents: cents,
    calls,
  };
}

const DEMO_EVENTS: Array<{ delay: number; event: SwarmEvent }> = [
  // 7-node DAG: PM -> Architect -> [Developer, Designer, Security] -> QA -> Release
  { delay: 0, event: { type: 'swarm_start', dagId: 'demo-product-team', nodeCount: 7 } },

  // --- Layer 1: PM ---
  { delay: 800, event: { type: 'agent_start', nodeId: 'pm', agentRole: 'product-manager', agentName: 'Product Manager' } },
  { delay: 1200, event: { type: 'agent_chunk', nodeId: 'pm', agentRole: 'product-manager', content: 'Analyzing requirements and market research...' } },
  { delay: 2500, event: {
    type: 'agent_done', nodeId: 'pm', agentRole: 'product-manager',
    output: 'PRD: Authentication system with OAuth2, MFA support, and social login integration. Target: 99.9% uptime SLA.',
    cost: makeCost(0.45),
  }},
  { delay: 2600, event: { type: 'swarm_progress', completed: 1, total: 7, runningNodes: [] } },

  // --- Layer 2: Architect ---
  { delay: 2800, event: { type: 'route_decision', fromNode: 'pm', toNode: 'architect', reason: 'PRD approved' } },
  { delay: 3000, event: { type: 'agent_start', nodeId: 'architect', agentRole: 'architect', agentName: 'System Architect' } },
  { delay: 3500, event: { type: 'agent_chunk', nodeId: 'architect', agentRole: 'architect', content: 'Designing microservice architecture with event-driven auth flow...' } },
  { delay: 5000, event: {
    type: 'agent_done', nodeId: 'architect', agentRole: 'architect',
    output: 'Architecture: Auth service (Go) + Token service (Rust) + Gateway (Node.js). Redis for session cache, PostgreSQL for user store.',
    cost: makeCost(0.82),
  }},
  { delay: 5100, event: { type: 'swarm_progress', completed: 2, total: 7, runningNodes: [] } },

  // --- Layer 3: PARALLEL cluster — Developer + Designer + Security ---
  { delay: 5300, event: { type: 'route_decision', fromNode: 'architect', toNode: 'developer', reason: 'Backend track' } },
  { delay: 5300, event: { type: 'route_decision', fromNode: 'architect', toNode: 'designer', reason: 'Frontend track' } },
  { delay: 5300, event: { type: 'route_decision', fromNode: 'architect', toNode: 'security', reason: 'Security track' } },

  // All three start near-simultaneously
  { delay: 5500, event: { type: 'agent_start', nodeId: 'developer', agentRole: 'developer', agentName: 'Senior Developer' } },
  { delay: 5600, event: { type: 'agent_start', nodeId: 'designer', agentRole: 'designer', agentName: 'UI/UX Designer' } },
  { delay: 5700, event: { type: 'agent_start', nodeId: 'security', agentRole: 'security-engineer', agentName: 'Security Engineer' } },

  { delay: 6000, event: { type: 'agent_chunk', nodeId: 'developer', agentRole: 'developer', content: 'Implementing OAuth2 flow with PKCE, setting up JWT signing...' } },
  { delay: 6200, event: { type: 'agent_chunk', nodeId: 'designer', agentRole: 'designer', content: 'Designing login screens, MFA flow, social login buttons...' } },
  { delay: 6400, event: { type: 'agent_chunk', nodeId: 'security', agentRole: 'security-engineer', content: 'Threat modeling, OWASP review, pen-test plan...' } },

  // Designer finishes first
  { delay: 7200, event: {
    type: 'agent_done', nodeId: 'designer', agentRole: 'designer',
    output: 'UI kit: Login page, MFA challenge screen, social auth buttons, error states. Figma handoff ready. Accessibility: WCAG 2.1 AA.',
    cost: makeCost(0.38),
  }},
  { delay: 7300, event: { type: 'swarm_progress', completed: 3, total: 7, runningNodes: ['developer', 'security'] } },

  // Security finishes next
  { delay: 8000, event: {
    type: 'agent_done', nodeId: 'security', agentRole: 'security-engineer',
    output: 'Threat model complete. Recommendations: PKCE mandatory, token rotation every 15min, rate-limit login to 5/min/IP. No critical vulnerabilities in architecture.',
    cost: makeCost(0.56),
  }},
  { delay: 8100, event: { type: 'swarm_progress', completed: 4, total: 7, runningNodes: ['developer'] } },

  // Developer finishes last in the cluster
  { delay: 9000, event: {
    type: 'agent_done', nodeId: 'developer', agentRole: 'developer',
    output: 'Implementation complete: OAuth2 + PKCE flow, JWT RS256 signing, refresh token rotation, rate limiting middleware. 94% test coverage.',
    cost: makeCost(1.23),
  }},
  { delay: 9100, event: { type: 'swarm_progress', completed: 5, total: 7, runningNodes: [] } },

  // --- Layer 4: QA (waits for all three) ---
  { delay: 9300, event: { type: 'route_decision', fromNode: 'developer', toNode: 'qa', reason: 'Implementation ready' } },
  { delay: 9300, event: { type: 'route_decision', fromNode: 'designer', toNode: 'qa', reason: 'Designs delivered' } },
  { delay: 9300, event: { type: 'route_decision', fromNode: 'security', toNode: 'qa', reason: 'Security cleared' } },

  { delay: 9500, event: { type: 'agent_start', nodeId: 'qa', agentRole: 'qa-engineer', agentName: 'QA Engineer' } },
  { delay: 10000, event: { type: 'agent_chunk', nodeId: 'qa', agentRole: 'qa-engineer', content: 'Integration testing, UI regression, security verification...' } },
  { delay: 11500, event: {
    type: 'agent_done', nodeId: 'qa', agentRole: 'qa-engineer',
    output: 'QA passed: 47 test cases, 0 critical bugs. Load test: 10K req/s. UI pixel-perfect vs designs. Security checklist verified.',
    cost: makeCost(0.31),
  }},
  { delay: 11600, event: { type: 'swarm_progress', completed: 6, total: 7, runningNodes: [] } },

  // --- Layer 5: Release Manager ---
  { delay: 11800, event: { type: 'route_decision', fromNode: 'qa', toNode: 'release', reason: 'QA approved' } },
  { delay: 12000, event: { type: 'agent_start', nodeId: 'release', agentRole: 'release-manager', agentName: 'Release Manager' } },
  { delay: 12500, event: { type: 'agent_chunk', nodeId: 'release', agentRole: 'release-manager', content: 'Preparing release notes, deployment plan, rollback strategy...' } },
  { delay: 13500, event: {
    type: 'agent_done', nodeId: 'release', agentRole: 'release-manager',
    output: 'Release v2.1.0 staged. Canary deploy to 5% traffic, full rollout in 24h. Rollback plan documented. Stakeholders notified.',
    cost: makeCost(0.22),
  }},
  { delay: 13600, event: { type: 'swarm_progress', completed: 7, total: 7, runningNodes: [] } },

  // Swarm done
  { delay: 14000, event: {
    type: 'swarm_done',
    results: [],
    totalCost: makeCost(3.97, 7),
  }},
];

async function runDemo() {
  console.log('\n🔄 Starting demo sequence...\n');
  let lastDelay = 0;
  for (const { delay, event } of DEMO_EVENTS) {
    const wait = delay - lastDelay;
    if (wait > 0) await sleep(wait);
    lastDelay = delay;
    broadcast(event);
    console.log(`  📡 ${event.type}${
      'nodeId' in event ? ` [${event.nodeId}]` : ''
    }${
      'dagId' in event ? ` "${event.dagId}"` : ''
    }`);
  }
  console.log('\n✅ Demo complete. Restarting in 12 seconds...\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Main ---

const PORT = 4820;

server.listen(PORT, () => {
  console.log(`\n🖥️  SwarmEngine Monitor - Mock SSE Server`);
  console.log(`   ├── SSE Events:  http://localhost:${PORT}/events`);
  console.log(`   ├── State JSON:  http://localhost:${PORT}/state`);
  console.log(`   └── Health:      http://localhost:${PORT}/health\n`);
  console.log(`   Open the monitor UI at http://localhost:5173\n`);

  // Run demo loop
  (async () => {
    // Small initial delay to let UI connect
    await sleep(2000);
    while (true) {
      await runDemo();
      await sleep(12000);
    }
  })();
});
