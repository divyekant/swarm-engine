import { describe, it, expect } from 'vitest';
import { Scratchpad } from '../../src/memory/scratchpad.js';

describe('Scratchpad', () => {
  it('sets and gets values', () => {
    const pad = new Scratchpad();
    pad.set('stage', 'mvp', 'pm-agent');
    expect(pad.get('stage')).toBe('mvp');
  });

  it('appends to lists', () => {
    const pad = new Scratchpad();
    pad.append('issues', 'no auth spec', 'qa-agent');
    pad.append('issues', 'no rate limits', 'qa-agent');
    expect(pad.getList('issues')).toEqual(['no auth spec', 'no rate limits']);
  });

  it('tracks history', () => {
    const pad = new Scratchpad();
    pad.set('key', 'v1', 'agent-a');
    pad.set('key', 'v2', 'agent-b');
    const history = pad.getHistory('key');
    expect(history).toHaveLength(2);
    expect(history[0].writtenBy).toBe('agent-a');
    expect(history[1].writtenBy).toBe('agent-b');
  });

  it('lists keys', () => {
    const pad = new Scratchpad();
    pad.set('a', 1, 'agent');
    pad.set('b', 2, 'agent');
    expect(pad.keys()).toEqual(['a', 'b']);
  });

  it('generates context string', () => {
    const pad = new Scratchpad();
    pad.set('stage', 'mvp', 'pm');
    pad.append('issues', 'no auth', 'qa');
    const ctx = pad.toContext();
    expect(ctx).toContain('stage');
    expect(ctx).toContain('mvp');
    expect(ctx).toContain('issues');
    expect(ctx).toContain('no auth');
  });

  it('enforces per-key size limits', () => {
    const pad = new Scratchpad({ maxKeyBytes: 50, maxTotalBytes: 1000 });
    const bigValue = 'x'.repeat(60);
    expect(() => pad.set('key', bigValue, 'agent')).toThrow(/exceeds max size/);
  });

  it('enforces total size limits', () => {
    const pad = new Scratchpad({ maxKeyBytes: 10000, maxTotalBytes: 100 });
    pad.set('a', 'x'.repeat(40), 'agent');
    expect(() => pad.set('b', 'x'.repeat(80), 'agent')).toThrow(/exceed limit/);
  });
});
