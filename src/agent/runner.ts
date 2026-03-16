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
import { Logger } from '../logger.js';

export interface AgentRunParams {
  nodeId: string;
  agent: AgentDescriptor;
  task: string;
  memory: SwarmMemory;
  upstreamOutputs?: { nodeId: string; agentRole: string; output: string }[];
  signal?: AbortSignal;
  handoffTemplate?: import('../types.js').HandoffTemplate;
  feedbackContext?: import('../types.js').FeedbackContext;
  threadHistory?: Message[];
  entityType?: string;
  entityId?: string;
}

/**
 * AgentRunner orchestrates a single agent execution.
 * It assembles context, streams the LLM response, handles tool calls,
 * tracks costs, and yields SwarmEvents throughout the process.
 */
export class AgentRunner {
  private defaultProvider: ProviderAdapter;
  private providers: Map<string, ProviderAdapter>;
  private assembler: ContextAssembler;
  private costTracker: CostTracker;
  private logger: Logger;

  constructor(
    defaultProvider: ProviderAdapter,
    assembler: ContextAssembler,
    costTracker: CostTracker,
    providers?: Map<string, ProviderAdapter>,
    logger?: Logger,
  ) {
    this.defaultProvider = defaultProvider;
    this.providers = providers ?? new Map();
    this.assembler = assembler;
    this.costTracker = costTracker;
    this.logger = logger ?? new Logger();
  }

  async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
    const {
      nodeId,
      agent,
      task,
      memory,
      upstreamOutputs,
      signal,
      handoffTemplate,
      feedbackContext,
      threadHistory,
      entityType,
      entityId,
    } = params;
    const startTime = Date.now();

    // Resolve provider: use agent's providerId if available, else default
    const provider = (agent.providerId ? this.providers.get(agent.providerId) : undefined)
      ?? this.defaultProvider;
    this.logger.debug('Provider selected', { nodeId, providerId: agent.providerId ?? 'default', fallback: !agent.providerId });

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
      const modelLimits = provider.getModelLimits(agent.model ?? 'default');
      const messages = await this.assembler.assemble({
        systemPrompt: agent.systemPrompt,
        task,
        contextWindow: modelLimits.contextWindow,
        upstreamOutputs,
        swarmMemory: memory,
        agentId: agent.id,
        agentRole: agent.role,
        handoffTemplate,
        feedbackContext,
        threadHistory,
        entityType,
        entityId,
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

        const stream = provider.stream({
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

            case 'tool_use': {
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
              this.logger.debug('Tool called', { nodeId, tool: event.name });

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
              this.logger.debug('Cost recorded', { nodeId, model: agent.model ?? 'default', inputTokens: event.inputTokens, outputTokens: event.outputTokens });
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
      this.logger.error('Agent stream error', { nodeId, errorType, message });
    }
  }
}
