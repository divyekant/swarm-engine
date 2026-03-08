import type {
  AgentDescriptor,
  AgenticAdapter,
  AgenticTool,
  CostSummary,
  SwarmEvent,
} from '../types.js';
import type { SwarmMemory } from '../memory/index.js';
import type { CostTracker } from '../cost/tracker.js';
import { classifyError } from '../errors/classification.js';

export interface AgenticRunnerParams {
  nodeId: string;
  agent: AgentDescriptor;
  task: string;
  adapter: AgenticAdapter;
  memory: SwarmMemory;
  upstreamOutputs?: { nodeId: string; agentRole: string; output: string }[];
  signal?: AbortSignal;
  handoffTemplate?: import('../types.js').HandoffTemplate;
  feedbackContext?: import('../types.js').FeedbackContext;
}

/**
 * AgenticRunner orchestrates a single agentic backend execution.
 *
 * Unlike AgentRunner, it does NOT assemble context into message arrays
 * or manage a tool-use loop — the agentic backend (e.g. Claude Code,
 * Codex) handles those internally. Instead, this runner:
 *
 * 1. Yields an `agent_start` event
 * 2. Formats upstream outputs, scratchpad, and inbox into a context string
 * 3. Builds 4 communication tools as AgenticTool[]
 * 4. Calls adapter.run() with the assembled parameters
 * 5. Maps AgenticEvents to SwarmEvents
 * 6. Records cost via CostTracker when result has cost data
 * 7. Classifies errors via classifyError()
 */
export class AgenticRunner {
  private costTracker: CostTracker;

  constructor(costTracker: CostTracker) {
    this.costTracker = costTracker;
  }

  async *run(params: AgenticRunnerParams): AsyncGenerator<SwarmEvent> {
    const { nodeId, agent, task, adapter, memory, upstreamOutputs, signal } = params;
    // TODO: handoffTemplate and feedbackContext are accepted but not yet injected
    // into agentic backends. Agentic adapters manage their own context assembly,
    // so these need a new adapter.run() parameter or convention. (#follow-up)

    // 1. Yield agent_start
    yield {
      type: 'agent_start',
      nodeId,
      agentRole: agent.role,
      agentName: agent.name,
    };

    try {
      // 2. Format upstream context
      const upstreamContext = this.buildUpstreamContext(agent.id, memory, upstreamOutputs);

      // 3. Build communication tools
      const tools = this.buildCommunicationTools(agent.id, memory);

      // 4. Call adapter.run()
      const stream = adapter.run({
        task,
        systemPrompt: agent.systemPrompt,
        upstreamContext,
        agenticOptions: agent.agentic,
        signal,
        tools,
      });

      // 5. Map AgenticEvents to SwarmEvents
      let finalOutput = '';
      let costRecorded = false;

      for await (const event of stream) {
        switch (event.type) {
          case 'chunk': {
            yield {
              type: 'agent_chunk',
              nodeId,
              agentRole: agent.role,
              content: event.content,
            };
            break;
          }

          case 'tool_use': {
            yield {
              type: 'agent_tool_use',
              nodeId,
              tool: event.tool,
              input: event.input,
            };
            break;
          }

          case 'result': {
            finalOutput = event.output;

            // 6. Record cost if available
            if (event.inputTokens !== undefined && event.outputTokens !== undefined) {
              this.costTracker.recordUsage(agent.id, nodeId, {
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                model: agent.model ?? 'default',
              });
              costRecorded = true;
            }
            break;
          }

          case 'error': {
            // Classify the error via classifyError
            const classifiedType = classifyError(new Error(event.message));

            yield {
              type: 'agent_error',
              nodeId,
              agentRole: agent.role,
              message: event.message,
              errorType: classifiedType,
            };
            return;
          }
        }
      }

      // Build cost summary for agent_done
      const nodeCosts = this.costTracker.getPerNode().get(nodeId);
      const cost: CostSummary = nodeCosts ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costCents: 0,
        calls: 0,
      };

      yield {
        type: 'agent_done',
        nodeId,
        agentRole: agent.role,
        output: finalOutput,
        cost,
      };
    } catch (err: unknown) {
      const errorType = classifyError(err);
      const message = err instanceof Error ? err.message : String(err);

      yield {
        type: 'agent_error',
        nodeId,
        agentRole: agent.role,
        message,
        errorType,
      };
    }
  }

  /**
   * Formats upstream outputs, inbox messages, and scratchpad state
   * into a single context string for the agentic backend.
   */
  private buildUpstreamContext(
    agentId: string,
    memory: SwarmMemory,
    upstreamOutputs?: { nodeId: string; agentRole: string; output: string }[],
  ): string {
    const sections: string[] = [];

    // Upstream agent outputs
    if (upstreamOutputs && upstreamOutputs.length > 0) {
      const outputLines = upstreamOutputs.map(
        u => `### ${u.agentRole} (${u.nodeId})\n${u.output}`,
      );
      sections.push(`## Upstream Agent Outputs\n${outputLines.join('\n\n')}`);
    }

    // Inbox messages
    const inbox = memory.channels.getInbox(agentId);
    if (inbox.length > 0) {
      const messageLines = inbox.map(m => `From ${m.from}: ${m.content}`);
      sections.push(`## Messages\n${messageLines.join('\n')}`);
    }

    // Shared scratchpad
    const scratchpadContext = memory.scratchpad.toContext();
    if (scratchpadContext.length > 0) {
      sections.push(`## Shared Scratchpad\n\`\`\`\n${scratchpadContext}\n\`\`\``);
    }

    return sections.join('\n\n');
  }

  /**
   * Builds the 4 communication tools as AgenticTool[] that allow the
   * agentic backend to interact with SwarmMemory.
   */
  private buildCommunicationTools(agentId: string, memory: SwarmMemory): AgenticTool[] {
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
        execute: (input: Record<string, unknown>): string => {
          const to = input.to as string;
          const content = input.content as string;
          memory.channels.send(agentId, to, content);
          return `Message sent to ${to}.`;
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
        execute: (input: Record<string, unknown>): string => {
          const key = input.key as string;
          const value = input.value;
          memory.scratchpad.set(key, value, agentId);
          return `Set "${key}" in scratchpad.`;
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
        execute: (input: Record<string, unknown>): string => {
          const key = input.key as string;
          const value = memory.scratchpad.get(key);
          if (value === undefined) {
            return `Key "${key}" not found in scratchpad.`;
          }
          return JSON.stringify(value);
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
        execute: (input: Record<string, unknown>): string => {
          const key = input.key as string;
          const value = input.value;
          memory.scratchpad.append(key, value, agentId);
          return `Appended to "${key}" in scratchpad.`;
        },
      },
    ];
  }
}
