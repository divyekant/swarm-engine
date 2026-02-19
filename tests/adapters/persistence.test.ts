import { describe, it, expect } from 'vitest';
import { InMemoryPersistence } from '../../src/adapters/defaults.js';

describe('InMemoryPersistence', () => {
  it('creates and retrieves runs', async () => {
    const persistence = new InMemoryPersistence();
    const id = await persistence.createRun({ agentId: 'a1', agentRole: 'pm', task: 'do stuff' });
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('updates runs', async () => {
    const persistence = new InMemoryPersistence();
    const id = await persistence.createRun({ agentId: 'a1', agentRole: 'pm', task: 'do stuff' });
    await persistence.updateRun(id, { status: 'completed' });
  });

  it('creates artifacts', async () => {
    const persistence = new InMemoryPersistence();
    const id = await persistence.createArtifact({ type: 'prd', title: 'Test', content: 'content' });
    expect(id).toBeTruthy();
  });

  it('stores and loads thread history', async () => {
    const persistence = new InMemoryPersistence();
    await persistence.saveMessage('thread-1', 'user', 'hello');
    await persistence.saveMessage('thread-1', 'assistant', 'hi');
    const history = await persistence.loadThreadHistory('thread-1');
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
  });

  it('returns empty history for unknown thread', async () => {
    const persistence = new InMemoryPersistence();
    const history = await persistence.loadThreadHistory('unknown');
    expect(history).toEqual([]);
  });

  it('evicts oldest runs when capacity exceeded', async () => {
    const persistence = new InMemoryPersistence(3);
    await persistence.createRun({ agentId: 'a1', agentRole: 'pm', task: 'run 1' });
    await persistence.createRun({ agentId: 'a2', agentRole: 'pm', task: 'run 2' });
    await persistence.createRun({ agentId: 'a3', agentRole: 'pm', task: 'run 3' });
    await persistence.createRun({ agentId: 'a4', agentRole: 'pm', task: 'run 4' });
    expect(persistence.runCount).toBe(3);
  });

  it('logs activities', async () => {
    const persistence = new InMemoryPersistence();
    await persistence.logActivity({ action: 'test', entityType: 'product', entityId: '123' });
  });
});
