import { describe, it, expect } from 'vitest';
import { Channels } from '../../src/memory/channels.js';

describe('Channels', () => {
  it('sends and receives messages', () => {
    const ch = new Channels();
    ch.send('pm', 'architect', 'Focus on API-first');
    const inbox = ch.getInbox('architect');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].content).toBe('Focus on API-first');
    expect(inbox[0].from).toBe('pm');
  });

  it('broadcasts to all agents', () => {
    const ch = new Channels();
    ch.broadcast('coordinator', 'Scope is MVP only');
    const inbox = ch.getInbox('any-agent');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].to).toBe('*');
  });

  it('gets conversation between two agents', () => {
    const ch = new Channels();
    ch.send('pm', 'architect', 'msg 1');
    ch.send('architect', 'pm', 'msg 2');
    ch.send('pm', 'qa', 'msg 3');
    const convo = ch.getConversation('pm', 'architect');
    expect(convo).toHaveLength(2);
  });

  it('returns empty inbox for unknown agent', () => {
    const ch = new Channels();
    expect(ch.getInbox('unknown')).toEqual([]);
  });
});
