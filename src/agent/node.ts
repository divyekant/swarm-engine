import type {
  AgentDescriptor,
  NodeStatus,
  ToolDefinition,
  ToolCall,
  ChannelMessage,
} from '../types.js';
import type { SwarmMemory } from '../memory/index.js';

/**
 * AgentNode is the actor wrapper for a single agent within a swarm.
 * It holds the agent descriptor, tracks execution status, accumulates output,
 * and provides communication tools that the LLM can invoke during execution.
 */
export class AgentNode {
  public readonly agent: AgentDescriptor;
  public readonly nodeId: string;
  public status: NodeStatus = 'pending';
  public output = '';

  private inbox: ChannelMessage[] = [];
  private outbox: ChannelMessage[] = [];

  constructor(nodeId: string, agent: AgentDescriptor) {
    this.nodeId = nodeId;
    this.agent = agent;
  }

  /**
   * Returns the set of communication tools available to this agent.
   * These are provided to the LLM as tool definitions so the agent
   * can interact with shared memory and other agents.
   */
  getTools(_memory: SwarmMemory): ToolDefinition[] {
    return [
      {
        name: 'send_message',
        description: 'Send a message to another agent in the swarm.',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'The agent ID to send the message to.' },
            content: { type: 'string', description: 'The message content.' },
          },
          required: ['to', 'content'],
        },
      },
      {
        name: 'scratchpad_set',
        description: 'Set a key/value pair in the shared scratchpad.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The key to set.' },
            value: { description: 'The value to store.' },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'scratchpad_read',
        description: 'Read a value from the shared scratchpad by key.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The key to read.' },
          },
          required: ['key'],
        },
      },
      {
        name: 'scratchpad_append',
        description: 'Append a value to a list in the shared scratchpad.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The list key to append to.' },
            value: { description: 'The value to append.' },
          },
          required: ['key', 'value'],
        },
      },
    ];
  }

  /**
   * Executes a tool call from the LLM and returns the result as a string.
   */
  handleToolCall(call: ToolCall, memory: SwarmMemory): string {
    switch (call.name) {
      case 'send_message': {
        const to = call.input.to as string;
        const content = call.input.content as string;
        memory.channels.send(this.agent.id, to, content);
        this.outbox.push({
          from: this.agent.id,
          to,
          content,
          timestamp: Date.now(),
        });
        return `Message sent to ${to}.`;
      }

      case 'scratchpad_set': {
        const key = call.input.key as string;
        const value = call.input.value;
        memory.scratchpad.set(key, value, this.agent.id);
        return `Set "${key}" in scratchpad.`;
      }

      case 'scratchpad_read': {
        const key = call.input.key as string;
        const value = memory.scratchpad.get(key);
        if (value === undefined) {
          return `Key "${key}" not found in scratchpad.`;
        }
        return JSON.stringify(value);
      }

      case 'scratchpad_append': {
        const key = call.input.key as string;
        const value = call.input.value;
        memory.scratchpad.append(key, value, this.agent.id);
        return `Appended to "${key}" in scratchpad.`;
      }

      default:
        return `Unknown tool: ${call.name}`;
    }
  }

  /**
   * Returns messages received by this agent.
   */
  getInbox(): ChannelMessage[] {
    return [...this.inbox];
  }

  /**
   * Returns messages sent by this agent.
   */
  getOutbox(): ChannelMessage[] {
    return [...this.outbox];
  }
}
