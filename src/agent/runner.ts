import type {
  AgentDescriptor,
  ProviderAdapter,
  SwarmEvent,
  CostSummary,
  Message,
} from '../types.js';
import type { SwarmMemory } from '../memory/index.js';
import type { ContextAssembler } from '../context/assembler.js';
import type { CostTracker } from '../cost/tracker.js';
import { AgentNode } from './node.js';
import { classifyError } from '../errors/classification.js';

export interface AgentRunParams {
  nodeId: string;
  agent: AgentDescriptor;
  task: string;
  memory: SwarmMemory;
  upstreamOutputs?: { nodeId: string; agentRole: string; output: string }[];
  signal?: AbortSignal;
}

/**
 * AgentRunner orchestrates a single agent execution.
 * It assembles context, streams the LLM response, handles tool calls,
 * tracks costs, and yields SwarmEvents throughout the process.
 */
export class AgentRunner {
  private provider: ProviderAdapter;
  private assembler: ContextAssembler;
  private costTracker: CostTracker;

  constructor(
    provider: ProviderAdapter,
    assembler: ContextAssembler,
    costTracker: CostTracker,
  ) {
    this.provider = provider;
    this.assembler = assembler;
    this.costTracker = costTracker;
  }

  async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
    const { nodeId, agent, task, memory, upstreamOutputs, signal } = params;
    const startTime = Date.now();

    const node = new AgentNode(nodeId, agent);
    node.status = 'running';

    // 1. Yield agent_start
    yield {
      type: 'agent_start',
      nodeId,
      agentRole: agent.role,
      agentName: agent.name,
    };

    try {
      // 2. Assemble context
      const modelLimits = this.provider.getModelLimits(agent.model ?? 'default');
      const messages = await this.assembler.assemble({
        systemPrompt: agent.systemPrompt,
        task,
        contextWindow: modelLimits.contextWindow,
        upstreamOutputs,
        swarmMemory: memory,
        agentId: agent.id,
      });

      // 3. Get agent communication tools
      const tools = node.getTools(memory);

      // 4. Stream with tool use loop
      let output = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let currentMessages = [...messages];

      let continueLoop = true;
      while (continueLoop) {
        continueLoop = false;

        const stream = this.provider.stream({
          model: agent.model ?? 'default',
          messages: currentMessages,
          temperature: agent.temperature ?? 0.7,
          maxTokens: agent.maxTokens ?? modelLimits.maxOutput,
          tools,
          signal,
        });

        for await (const event of stream) {
          switch (event.type) {
            case 'chunk': {
              output += event.content;
              yield {
                type: 'agent_chunk',
                nodeId,
                agentRole: agent.role,
                content: event.content,
              };
              break;
            }

            case 'tool_result_needed': {
              // Handle tool call: execute via AgentNode, yield event
              const result = node.handleToolCall(
                { id: event.id, name: event.name, input: event.input },
                memory,
              );

              yield {
                type: 'agent_tool_use',
                nodeId,
                tool: event.name,
                input: event.input,
              };

              // Append assistant tool_calls and tool result to messages, then re-stream
              currentMessages.push({
                role: 'assistant',
                content: output,
                toolCalls: [{ id: event.id, name: event.name, input: event.input }],
              });
              currentMessages.push({
                role: 'tool',
                content: result,
                toolCallId: event.id,
              });

              // Reset output for next iteration
              output = '';
              continueLoop = true;
              break;
            }

            case 'usage': {
              totalInputTokens += event.inputTokens;
              totalOutputTokens += event.outputTokens;

              // Record via cost tracker
              this.costTracker.recordUsage(agent.id, nodeId, {
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                model: agent.model ?? 'default',
              });
              break;
            }
          }

          // If we need to re-stream for tool use, break out of the for-await
          if (continueLoop) break;
        }
      }

      // 5. Agent done
      node.output = output;
      node.status = 'completed';

      const nodeCosts = this.costTracker.getPerNode().get(nodeId);
      const cost: CostSummary = nodeCosts ?? {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        costCents: 0,
        calls: 0,
      };

      yield {
        type: 'agent_done',
        nodeId,
        agentRole: agent.role,
        output,
        cost,
      };
    } catch (err: unknown) {
      node.status = 'failed';

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
}
