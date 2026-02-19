import type { ChannelMessage } from '../types.js';

export class Channels {
  private messages: ChannelMessage[] = [];

  send(from: string, to: string, content: string, metadata?: Record<string, unknown>): void {
    this.messages.push({ from, to, content, metadata, timestamp: Date.now() });
  }

  broadcast(from: string, content: string, metadata?: Record<string, unknown>): void {
    this.messages.push({ from, to: '*', content, metadata, timestamp: Date.now() });
  }

  getInbox(agentId: string): ChannelMessage[] {
    return this.messages.filter(m => m.to === agentId || m.to === '*');
  }

  getConversation(agentA: string, agentB: string): ChannelMessage[] {
    return this.messages.filter(
      m => (m.from === agentA && m.to === agentB) || (m.from === agentB && m.to === agentA),
    );
  }
}
