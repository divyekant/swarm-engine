import { describe, it, expect } from 'vitest';
import { SwarmEventEmitter } from '../../src/streaming/emitter.js';
import type { SwarmEvent } from '../../src/types.js';

describe('SwarmEventEmitter', () => {
  it('emits events and allows async iteration', async () => {
    const emitter = new SwarmEventEmitter();
    const collected: SwarmEvent[] = [];

    const consumePromise = (async () => {
      for await (const event of emitter) {
        collected.push(event);
      }
    })();

    emitter.emit({ type: 'swarm_start', dagId: 'test', nodeCount: 2 });
    emitter.emit({ type: 'agent_start', nodeId: 'a', agentRole: 'pm', agentName: 'PM' });
    emitter.close();

    await consumePromise;
    expect(collected).toHaveLength(2);
    expect(collected[0].type).toBe('swarm_start');
    expect(collected[1].type).toBe('agent_start');
  });

  it('handles backpressure by buffering events', async () => {
    const emitter = new SwarmEventEmitter();
    emitter.emit({ type: 'swarm_start', dagId: 'test', nodeCount: 1 });
    emitter.emit({ type: 'swarm_done', results: [], totalCost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 } });
    emitter.close();

    const collected: SwarmEvent[] = [];
    for await (const event of emitter) {
      collected.push(event);
    }
    expect(collected).toHaveLength(2);
  });

  it('propagates errors', async () => {
    const emitter = new SwarmEventEmitter();
    emitter.error(new Error('test error'));

    await expect(async () => {
      for await (const _event of emitter) { /* Should throw */ }
    }).rejects.toThrow('test error');
  });
});
