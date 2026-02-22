// tests/agent/agentic-runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AgenticRunner } from '../../src/agent/agentic-runner.js';
import { SwarmMemory } from '../../src/memory/index.js';
import { CostTracker } from '../../src/cost/tracker.js';
import type { AgenticAdapter, AgenticEvent, AgenticTool, SwarmEvent } from '../../src/types.js';

function createMockAdapter(events: AgenticEvent[]): AgenticAdapter {
  return {
    async *run() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

const baseAgent = {
  id: 'researcher',
  name: 'Researcher',
  role: 'researcher',
  systemPrompt: 'You are a researcher.',
};

describe('AgenticRunner', () => {
  it('yields agent_start, agent_chunk(s), and agent_done for a successful run', async () => {
    const adapter = createMockAdapter([
      { type: 'chunk', content: 'Hello ' },
      { type: 'chunk', content: 'world' },
      { type: 'result', output: 'Hello world' },
    ]);

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'research-node',
      agent: baseAgent,
      task: 'Research topic X',
      adapter,
      memory: new SwarmMemory(),
    })) {
      events.push(event);
    }

    const starts = events.filter(e => e.type === 'agent_start');
    const chunks = events.filter(e => e.type === 'agent_chunk');
    const dones = events.filter(e => e.type === 'agent_done');

    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      type: 'agent_start',
      nodeId: 'research-node',
      agentRole: 'researcher',
      agentName: 'Researcher',
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ type: 'agent_chunk', nodeId: 'research-node', content: 'Hello ' });
    expect(chunks[1]).toMatchObject({ type: 'agent_chunk', nodeId: 'research-node', content: 'world' });

    expect(dones).toHaveLength(1);
    expect(dones[0]).toMatchObject({
      type: 'agent_done',
      nodeId: 'research-node',
      agentRole: 'researcher',
      output: 'Hello world',
    });
  });

  it('yields agent_error when adapter emits an error event', async () => {
    const adapter = createMockAdapter([
      { type: 'chunk', content: 'partial' },
      { type: 'error', message: 'Rate limit exceeded 429' },
    ]);

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'err-node',
      agent: baseAgent,
      task: 'Do something',
      adapter,
      memory: new SwarmMemory(),
    })) {
      events.push(event);
    }

    const errors = events.filter(e => e.type === 'agent_error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: 'agent_error',
      nodeId: 'err-node',
      agentRole: 'researcher',
      message: 'Rate limit exceeded 429',
    });
  });

  it('yields agent_error with classified errorType when adapter throws', async () => {
    const adapter: AgenticAdapter = {
      async *run() {
        throw new Error('401 Unauthorized');
      },
    };

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'throw-node',
      agent: baseAgent,
      task: 'Do something',
      adapter,
      memory: new SwarmMemory(),
    })) {
      events.push(event);
    }

    const errors = events.filter(e => e.type === 'agent_error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: 'agent_error',
      nodeId: 'throw-node',
      agentRole: 'researcher',
      message: '401 Unauthorized',
      errorType: 'auth_error',
    });
  });

  it('forwards tool_use events as agent_tool_use', async () => {
    const adapter = createMockAdapter([
      { type: 'tool_use', tool: 'web_search', input: { query: 'vitest docs' } },
      { type: 'chunk', content: 'Found results' },
      { type: 'result', output: 'Found results' },
    ]);

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'tool-node',
      agent: baseAgent,
      task: 'Search',
      adapter,
      memory: new SwarmMemory(),
    })) {
      events.push(event);
    }

    const toolEvents = events.filter(e => e.type === 'agent_tool_use');
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]).toMatchObject({
      type: 'agent_tool_use',
      nodeId: 'tool-node',
      tool: 'web_search',
      input: { query: 'vitest docs' },
    });
  });

  it('formats upstream outputs into upstreamContext passed to adapter', async () => {
    let capturedParams: Record<string, unknown> = {};
    const adapter: AgenticAdapter = {
      async *run(params) {
        capturedParams = { ...params };
        yield { type: 'result' as const, output: 'done' };
      },
    };

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'downstream-node',
      agent: baseAgent,
      task: 'Analyze findings',
      adapter,
      memory: new SwarmMemory(),
      upstreamOutputs: [
        { nodeId: 'planner-node', agentRole: 'planner', output: 'Step 1: Gather data' },
        { nodeId: 'data-node', agentRole: 'data_collector', output: 'Found 42 records' },
      ],
    })) {
      events.push(event);
    }

    const ctx = capturedParams.upstreamContext as string;
    expect(ctx).toContain('## Upstream Agent Outputs');
    expect(ctx).toContain('### planner (planner-node)');
    expect(ctx).toContain('Step 1: Gather data');
    expect(ctx).toContain('### data_collector (data-node)');
    expect(ctx).toContain('Found 42 records');
  });

  it('builds communication tools that interact with SwarmMemory', async () => {
    let capturedTools: AgenticTool[] = [];
    const adapter: AgenticAdapter = {
      async *run(params) {
        capturedTools = [...(params.tools ?? [])];
        yield { type: 'result' as const, output: 'done' };
      },
    };

    const memory = new SwarmMemory();
    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    for await (const _event of runner.run({
      nodeId: 'comm-node',
      agent: baseAgent,
      task: 'Communicate',
      adapter,
      memory,
    })) {
      // consume events
    }

    // Verify all 4 tools are built
    const toolNames = capturedTools.map(t => t.name);
    expect(toolNames).toContain('send_message');
    expect(toolNames).toContain('scratchpad_set');
    expect(toolNames).toContain('scratchpad_read');
    expect(toolNames).toContain('scratchpad_append');

    // Test send_message tool
    const sendTool = capturedTools.find(t => t.name === 'send_message')!;
    const sendResult = await sendTool.execute({ to: 'planner', content: 'hello from researcher' });
    expect(sendResult).toContain('planner');
    const inbox = memory.channels.getInbox('planner');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].content).toBe('hello from researcher');
    expect(inbox[0].from).toBe('researcher');

    // Test scratchpad_set tool
    const setTool = capturedTools.find(t => t.name === 'scratchpad_set')!;
    const setResult = await setTool.execute({ key: 'findings', value: 'important data' });
    expect(setResult).toContain('findings');
    expect(memory.scratchpad.get('findings')).toBe('important data');

    // Test scratchpad_read tool
    const readTool = capturedTools.find(t => t.name === 'scratchpad_read')!;
    const readResult = await readTool.execute({ key: 'findings' });
    expect(readResult).toContain('important data');

    // Test scratchpad_read for missing key
    const missingResult = await readTool.execute({ key: 'nonexistent' });
    expect(missingResult).toContain('not found');

    // Test scratchpad_append tool
    const appendTool = capturedTools.find(t => t.name === 'scratchpad_append')!;
    const appendResult = await appendTool.execute({ key: 'log', value: 'entry 1' });
    expect(appendResult).toContain('log');
    expect(memory.scratchpad.getList('log')).toEqual(['entry 1']);
  });

  it('records cost via CostTracker when result has cost data', async () => {
    const adapter = createMockAdapter([
      { type: 'chunk', content: 'output text' },
      { type: 'result', output: 'output text', inputTokens: 500, outputTokens: 200 },
    ]);

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    for await (const _event of runner.run({
      nodeId: 'cost-node',
      agent: { ...baseAgent, model: 'claude-sonnet-4-20250514' },
      task: 'Do work',
      adapter,
      memory: new SwarmMemory(),
    })) {
      // consume events
    }

    // Cost should be recorded
    const total = costTracker.getSwarmTotal();
    expect(total.inputTokens).toBe(500);
    expect(total.outputTokens).toBe(200);
    expect(total.calls).toBe(1);

    // Per-node cost should be recorded
    const nodeCosts = costTracker.getPerNode();
    const nodeCost = nodeCosts.get('cost-node');
    expect(nodeCost).toBeDefined();
    expect(nodeCost!.inputTokens).toBe(500);
    expect(nodeCost!.outputTokens).toBe(200);
  });

  it('includes agent_done cost from CostTracker when cost data is available', async () => {
    const adapter = createMockAdapter([
      { type: 'result', output: 'result', inputTokens: 1000, outputTokens: 500 },
    ]);

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'cost-done-node',
      agent: { ...baseAgent, model: 'claude-sonnet-4-20250514' },
      task: 'Work',
      adapter,
      memory: new SwarmMemory(),
    })) {
      events.push(event);
    }

    const doneEvent = events.find(e => e.type === 'agent_done');
    expect(doneEvent).toBeDefined();
    if (doneEvent && doneEvent.type === 'agent_done') {
      expect(doneEvent.cost.inputTokens).toBe(1000);
      expect(doneEvent.cost.outputTokens).toBe(500);
      expect(doneEvent.cost.calls).toBe(1);
    }
  });

  it('includes inbox messages and scratchpad in upstreamContext', async () => {
    let capturedParams: Record<string, unknown> = {};
    const adapter: AgenticAdapter = {
      async *run(params) {
        capturedParams = { ...params };
        yield { type: 'result' as const, output: 'done' };
      },
    };

    const memory = new SwarmMemory();
    // Pre-populate memory
    memory.channels.send('planner', 'researcher', 'Please focus on topic A');
    memory.scratchpad.set('status', 'in-progress', 'planner');

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    for await (const _event of runner.run({
      nodeId: 'ctx-node',
      agent: baseAgent,
      task: 'Research',
      adapter,
      memory,
    })) {
      // consume events
    }

    const ctx = capturedParams.upstreamContext as string;
    expect(ctx).toContain('## Messages');
    expect(ctx).toContain('From planner:');
    expect(ctx).toContain('Please focus on topic A');
    expect(ctx).toContain('## Shared Scratchpad');
    expect(ctx).toContain('status');
  });

  it('passes agenticOptions from agent descriptor to adapter', async () => {
    let capturedParams: Record<string, unknown> = {};
    const adapter: AgenticAdapter = {
      async *run(params) {
        capturedParams = { ...params };
        yield { type: 'result' as const, output: 'done' };
      },
    };

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    for await (const _event of runner.run({
      nodeId: 'opts-node',
      agent: {
        ...baseAgent,
        agentic: {
          maxTurns: 5,
          model: 'claude-sonnet-4-20250514',
          allowedTools: ['Read', 'Write'],
        },
      },
      task: 'Code review',
      adapter,
      memory: new SwarmMemory(),
    })) {
      // consume events
    }

    expect(capturedParams.agenticOptions).toMatchObject({
      maxTurns: 5,
      model: 'claude-sonnet-4-20250514',
      allowedTools: ['Read', 'Write'],
    });
  });

  it('handles result with no cost data gracefully', async () => {
    const adapter = createMockAdapter([
      { type: 'result', output: 'no cost info' },
    ]);

    const costTracker = new CostTracker();
    const runner = new AgenticRunner(costTracker);

    const events: SwarmEvent[] = [];
    for await (const event of runner.run({
      nodeId: 'no-cost-node',
      agent: baseAgent,
      task: 'Work',
      adapter,
      memory: new SwarmMemory(),
    })) {
      events.push(event);
    }

    const doneEvent = events.find(e => e.type === 'agent_done');
    expect(doneEvent).toBeDefined();
    if (doneEvent && doneEvent.type === 'agent_done') {
      expect(doneEvent.cost).toBeDefined();
      // No cost recorded via CostTracker
      expect(costTracker.getSwarmTotal().calls).toBe(0);
    }
  });
});
