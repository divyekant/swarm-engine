import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSEBridge } from '../../src/monitor/sse-bridge.js';
import type { SwarmEvent, CostSummary } from '../../src/types.js';

function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

/** Create a mock ServerResponse-like object */
function mockResponse() {
  const chunks: string[] = [];
  return {
    writeHead: vi.fn(),
    write: vi.fn((data: string) => { chunks.push(data); return true; }),
    end: vi.fn(),
    on: vi.fn(),
    chunks,
    headersSent: false,
  };
}

describe('SSEBridge', () => {
  let bridge: SSEBridge;

  beforeEach(() => {
    bridge = new SSEBridge();
  });

  it('broadcasts events to connected SSE clients as JSON', () => {
    const res = mockResponse();
    bridge.addClient(res as any);

    const event: SwarmEvent = {
      type: 'swarm_start',
      dagId: 'dag-1',
      nodeCount: 3,
    };
    bridge.broadcast(event);

    expect(res.write).toHaveBeenCalled();
    const written = res.chunks.join('');
    expect(written).toContain('data: ');
    expect(written).toContain('"type":"swarm_start"');
  });

  it('sets correct SSE headers when adding client', () => {
    const res = mockResponse();
    bridge.addClient(res as any);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }));
  });

  it('removes client on close event', () => {
    const res = mockResponse();
    let closeHandler: (() => void) | undefined;
    res.on.mockImplementation((event: string, handler: () => void) => {
      if (event === 'close') closeHandler = handler;
    });

    bridge.addClient(res as any);
    expect(bridge.clientCount).toBe(1);

    closeHandler!();
    expect(bridge.clientCount).toBe(0);
  });

  it('maintains state snapshot from events', () => {
    bridge.broadcast({
      type: 'swarm_start',
      dagId: 'dag-1',
      nodeCount: 3,
    });

    const state = bridge.getState();
    expect(state.dagId).toBe('dag-1');
    expect(state.status).toBe('running');
  });

  it('updates node status on agent events', () => {
    bridge.broadcast({ type: 'swarm_start', dagId: 'dag-1', nodeCount: 2 });
    bridge.broadcast({ type: 'agent_start', nodeId: 'n1', agentRole: 'dev', agentName: 'Dev' });

    const state = bridge.getState();
    expect(state.nodes.get('n1')?.status).toBe('running');
  });

  it('tracks cost and completion on agent_done', () => {
    bridge.broadcast({ type: 'swarm_start', dagId: 'dag-1', nodeCount: 1 });
    bridge.broadcast({ type: 'agent_start', nodeId: 'n1', agentRole: 'dev', agentName: 'Dev' });
    bridge.broadcast({
      type: 'agent_done',
      nodeId: 'n1',
      agentRole: 'dev',
      output: 'result',
      cost: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costCents: 1, calls: 1 },
    });

    const state = bridge.getState();
    expect(state.nodes.get('n1')?.status).toBe('completed');
    expect(state.nodes.get('n1')?.cost?.costCents).toBe(1);
  });

  it('tracks route decisions', () => {
    bridge.broadcast({ type: 'route_decision', fromNode: 'n1', toNode: 'n2', reason: 'approved' });

    const state = bridge.getState();
    expect(state.routeDecisions).toHaveLength(1);
    expect(state.routeDecisions[0]).toEqual({ from: 'n1', to: 'n2', reason: 'approved' });
  });

  it('marks swarm as completed on swarm_done', () => {
    bridge.broadcast({ type: 'swarm_start', dagId: 'dag-1', nodeCount: 1 });
    bridge.broadcast({
      type: 'swarm_done',
      results: [],
      totalCost: emptyCost(),
    });

    const state = bridge.getState();
    expect(state.status).toBe('completed');
  });

  it('marks swarm as failed on swarm_error', () => {
    bridge.broadcast({ type: 'swarm_start', dagId: 'dag-1', nodeCount: 1 });
    bridge.broadcast({
      type: 'swarm_error',
      message: 'Budget exceeded',
      completedNodes: [],
      partialCost: emptyCost(),
    });

    const state = bridge.getState();
    expect(state.status).toBe('failed');
  });
});
