import type {
  SwarmEngineConfig,
  RunOptions,
  SwarmEvent,
  ProviderAdapter,
} from './types.js';
import { DAGBuilder } from './dag/builder.js';
import { DAGGraph } from './dag/graph.js';
import { DAGExecutor } from './dag/executor.js';
import { AgentRunner } from './agent/runner.js';
import { CostTracker } from './cost/tracker.js';
import { SwarmMemory } from './memory/index.js';
import { ContextAssembler } from './context/assembler.js';
import { validateDAG } from './dag/validator.js';
import { createProvider } from './adapters/providers/index.js';
import {
  InMemoryPersistence,
  NoopContextProvider,
  NoopMemoryProvider,
  NoopCodebaseProvider,
  NoopPersonaProvider,
} from './adapters/defaults.js';

/**
 * SwarmEngine is the main entry point for the multi-agent DAG orchestration engine.
 *
 * Usage:
 * ```ts
 * const engine = new SwarmEngine({
 *   providers: { anthropic: { type: 'anthropic', apiKey: '...' } },
 *   defaults: { provider: 'anthropic' },
 * });
 *
 * const dag = engine.dag()
 *   .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: '...' })
 *   .agent('dev', { id: 'dev', name: 'Dev', role: 'developer', systemPrompt: '...' })
 *   .edge('pm', 'dev')
 *   .build();
 *
 * for await (const event of engine.run({ dag, task: 'Build a feature' })) {
 *   console.log(event);
 * }
 * ```
 */
export class SwarmEngine {
  private readonly config: SwarmEngineConfig;
  private readonly providers: Map<string, ProviderAdapter>;
  private readonly persistence;
  private readonly context;
  private readonly memory;
  private readonly codebase;
  private readonly persona;

  constructor(config: SwarmEngineConfig) {
    this.config = config;

    // Initialize providers map
    this.providers = new Map();
    for (const [name, providerConfig] of Object.entries(config.providers)) {
      this.providers.set(name, createProvider(providerConfig));
    }

    // Store adapter instances with noop defaults
    this.persistence = config.persistence ?? new InMemoryPersistence();
    this.context = config.context ?? new NoopContextProvider();
    this.memory = config.memory ?? new NoopMemoryProvider();
    this.codebase = config.codebase ?? new NoopCodebaseProvider();
    this.persona = config.persona ?? new NoopPersonaProvider();
  }

  /**
   * Returns a new DAGBuilder instance for constructing DAG definitions.
   */
  dag(): DAGBuilder {
    return new DAGBuilder();
  }

  /**
   * Validates and executes a DAG, yielding SwarmEvents throughout the process.
   */
  async *run(options: RunOptions): AsyncGenerator<SwarmEvent> {
    // 1. Validate the DAG
    const validation = validateDAG(options.dag, { providers: this.config.providers });
    if (!validation.valid) {
      yield {
        type: 'swarm_error',
        message: `DAG validation failed: ${validation.errors.join('; ')}`,
        completedNodes: [],
        partialCost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 },
      };
      return;
    }

    // 1b. Apply engine defaults to agent descriptors
    const defaults = this.config.defaults;
    if (defaults) {
      for (const node of options.dag.nodes) {
        if (!node.agent.model && defaults.model) {
          node.agent.model = defaults.model;
        }
        if (node.agent.temperature === undefined && defaults.temperature !== undefined) {
          node.agent.temperature = defaults.temperature;
        }
        if (node.agent.maxTokens === undefined && defaults.maxTokens !== undefined) {
          node.agent.maxTokens = defaults.maxTokens;
        }
        if (!node.agent.providerId && defaults.provider) {
          node.agent.providerId = defaults.provider;
        }
      }
    }

    // 2. Create cost tracker with budget from config
    const costTracker = new CostTracker(
      this.config.limits?.maxSwarmBudgetCents ?? null,
      this.config.limits?.maxPerAgentBudgetCents ?? null,
    );

    // 3. Create swarm memory with scratchpad size limit
    const maxScratchpadBytes = this.config.limits?.maxScratchpadSizeBytes;
    const swarmMemory = new SwarmMemory(
      maxScratchpadBytes ? { maxTotalBytes: maxScratchpadBytes } : undefined,
    );

    // 4. Create context assembler with adapter instances
    const assembler = new ContextAssembler({
      context: this.context,
      memory: this.memory,
      codebase: this.codebase,
      persona: this.persona,
    });

    // 5. Determine the default provider
    const defaultProviderKey = this.config.defaults?.provider
      ?? this.providers.keys().next().value;
    const defaultProvider = defaultProviderKey
      ? this.providers.get(defaultProviderKey)
      : undefined;

    if (!defaultProvider) {
      yield {
        type: 'swarm_error',
        message: 'No provider available',
        completedNodes: [],
        partialCost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 },
      };
      return;
    }

    // 6. Create agent runner
    const runner = new AgentRunner(defaultProvider, assembler, costTracker);

    // 7. Create DAG graph
    const graph = new DAGGraph(options.dag);

    // 8. Create DAG executor
    const executor = new DAGExecutor(
      graph,
      runner,
      costTracker,
      swarmMemory,
      options.task,
      options.signal,
      defaultProvider,
    );

    // 9. Yield all events from executor
    let results: Extract<SwarmEvent, { type: 'swarm_done' }>['results'] | undefined;

    for await (const event of executor.execute()) {
      yield event;

      if (event.type === 'swarm_done') {
        results = event.results;
      }
    }

    // 10. Call lifecycle hooks if configured
    if (results && this.config.lifecycle?.onSwarmComplete) {
      await this.config.lifecycle.onSwarmComplete(options.dag.id, results);
    }
  }
}
