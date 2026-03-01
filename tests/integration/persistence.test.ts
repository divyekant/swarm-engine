import { describe, it, expect, vi } from 'vitest';
import { SwarmEngine } from '../../src/engine.js';
import { DAGBuilder } from '../../src/dag/builder.js';
import { DAGGraph } from '../../src/dag/graph.js';
import { DAGExecutor } from '../../src/dag/executor.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { SwarmMemory } from '../../src/memory/index.js';
import type { AgentRunParams } from '../../src/agent/runner.js';
import type { AgentRunner } from '../../src/agent/runner.js';
import type {
  SwarmEvent,
  SwarmEngineConfig,
  AgentDescriptor,
  CostSummary,
  PersistenceAdapter,
  CreateRunParams,
  ArtifactRequest,
  Message,
  ActivityParams,
  ProviderAdapter,
} from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agent(id: string): AgentDescriptor {
  return { id, name: id, role: id, systemPrompt: '' };
}

function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

/** Create a spy-based PersistenceAdapter that records all calls. */
function createSpyPersistence() {
  const runs = new Map<string, Record<string, unknown>>();
  let runCounter = 0;

  const adapter: PersistenceAdapter = {
    createRun: vi.fn(async (params: CreateRunParams) => {
      const id = `run-${++runCounter}`;
      runs.set(id, { ...params, id, status: 'running' });
      return id;
    }),
    updateRun: vi.fn(async (runId: string, updates: Record<string, unknown>) => {
      const run = runs.get(runId);
      if (run) Object.assign(run, updates);
    }),
    createArtifact: vi.fn(async (_params: ArtifactRequest) => `artifact-1`),
    saveMessage: vi.fn(async (_threadId: string, _role: string, _content: string) => {}),
    loadThreadHistory: vi.fn(async (_threadId: string): Promise<Message[]> => []),
    logActivity: vi.fn(async (_params: ActivityParams) => {}),
  };

  return { adapter, runs };
}

function createMockRunner(
  outputMap: Record<string, string>,
  options?: { failNodes?: Set<string>; artifactNodes?: Set<string> },
): AgentRunner {
  return {
    async *run(params: AgentRunParams): AsyncGenerator<SwarmEvent> {
      const { nodeId, agent: agentDesc } = params;

      yield { type: 'agent_start', nodeId, agentRole: agentDesc.role, agentName: agentDesc.name };

      if (options?.failNodes?.has(nodeId)) {
        yield { type: 'agent_error', nodeId, agentRole: agentDesc.role, message: `Node ${nodeId} failed`, errorType: 'unknown' };
        return;
      }

      const output = outputMap[nodeId] ?? `output-${nodeId}`;

      yield { type: 'agent_chunk', nodeId, agentRole: agentDesc.role, content: output };

      const artifactRequest = options?.artifactNodes?.has(nodeId)
        ? { type: 'document', title: `${nodeId} artifact`, content: output }
        : undefined;

      yield { type: 'agent_done', nodeId, agentRole: agentDesc.role, output, artifactRequest, cost: emptyCost() };
    },
  } as AgentRunner;
}

async function collectEvents(gen: AsyncGenerator<SwarmEvent>): Promise<SwarmEvent[]> {
  const events: SwarmEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function eventsOfType<T extends SwarmEvent['type']>(
  events: SwarmEvent[],
  type: T,
): Extract<SwarmEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<SwarmEvent, { type: T }>[];
}

// ---------------------------------------------------------------------------
// Tests — DAGExecutor persistence integration
// ---------------------------------------------------------------------------

describe('DAGExecutor persistence', () => {
  it('calls createRun on agent_start for each node', async () => {
    const { adapter } = createSpyPersistence();
    const dag = new DAGBuilder()
      .agent('a', agent('a'))
      .agent('b', agent('b'))
      .edge('a', 'b')
      .build();
    const graph = new DAGGraph(dag);
    const runner = createMockRunner({ a: 'hello', b: 'world' });
    const costTracker = new CostTracker();
    const memory = new SwarmMemory();

    const executor = new DAGExecutor(
      graph, runner, costTracker, memory, 'test task',
      undefined, undefined, undefined, undefined, undefined, undefined,
      adapter,
    );
    await collectEvents(executor.execute());

    expect(adapter.createRun).toHaveBeenCalledTimes(2);

    // First call should be for node 'a'
    const firstCall = (adapter.createRun as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateRunParams;
    expect(firstCall.agentId).toBe('a');
    expect(firstCall.agentRole).toBe('a');
    expect(firstCall.nodeId).toBe('a');
    expect(firstCall.task).toBe('test task');

    // Second call should be for node 'b'
    const secondCall = (adapter.createRun as ReturnType<typeof vi.fn>).mock.calls[1][0] as CreateRunParams;
    expect(secondCall.agentId).toBe('b');
    expect(secondCall.nodeId).toBe('b');
  });

  it('calls updateRun on agent_done with status and output', async () => {
    const { adapter } = createSpyPersistence();
    const dag = new DAGBuilder()
      .agent('a', agent('a'))
      .build();
    const graph = new DAGGraph(dag);
    const runner = createMockRunner({ a: 'result text' });
    const costTracker = new CostTracker();
    const memory = new SwarmMemory();

    const executor = new DAGExecutor(
      graph, runner, costTracker, memory, 'task',
      undefined, undefined, undefined, undefined, undefined, undefined,
      adapter,
    );
    await collectEvents(executor.execute());

    expect(adapter.updateRun).toHaveBeenCalledTimes(1);
    const [runId, updates] = (adapter.updateRun as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(runId).toBe('run-1');
    expect(updates.status).toBe('completed');
    expect(updates.outputSummary).toBe('result text');
    expect(updates.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('calls updateRun on agent_error with error details', async () => {
    const { adapter } = createSpyPersistence();
    const dag = new DAGBuilder()
      .agent('a', agent('a'))
      .build();
    const graph = new DAGGraph(dag);
    const runner = createMockRunner({}, { failNodes: new Set(['a']) });
    const costTracker = new CostTracker();
    const memory = new SwarmMemory();

    const executor = new DAGExecutor(
      graph, runner, costTracker, memory, 'task',
      undefined, undefined, undefined, undefined, undefined, undefined,
      adapter,
    );
    await collectEvents(executor.execute());

    expect(adapter.createRun).toHaveBeenCalledTimes(1);
    expect(adapter.updateRun).toHaveBeenCalledTimes(1);
    const [runId, updates] = (adapter.updateRun as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(runId).toBe('run-1');
    expect(updates.status).toBe('failed');
    expect(updates.error).toBe('Node a failed');
    expect(updates.errorType).toBe('unknown');
  });

  it('calls createArtifact when agent produces an artifact', async () => {
    const { adapter } = createSpyPersistence();
    const dag = new DAGBuilder()
      .agent('a', agent('a'))
      .build();
    const graph = new DAGGraph(dag);
    const runner = createMockRunner({ a: 'doc content' }, { artifactNodes: new Set(['a']) });
    const costTracker = new CostTracker();
    const memory = new SwarmMemory();

    const executor = new DAGExecutor(
      graph, runner, costTracker, memory, 'task',
      undefined, undefined, undefined, undefined, undefined, undefined,
      adapter,
    );
    await collectEvents(executor.execute());

    expect(adapter.createArtifact).toHaveBeenCalledTimes(1);
    const artifactArg = (adapter.createArtifact as ReturnType<typeof vi.fn>).mock.calls[0][0] as ArtifactRequest;
    expect(artifactArg.type).toBe('document');
    expect(artifactArg.title).toBe('a artifact');
    expect(artifactArg.content).toBe('doc content');
  });

  it('does not call createArtifact when agent has no artifact', async () => {
    const { adapter } = createSpyPersistence();
    const dag = new DAGBuilder()
      .agent('a', agent('a'))
      .build();
    const graph = new DAGGraph(dag);
    const runner = createMockRunner({ a: 'plain output' });
    const costTracker = new CostTracker();
    const memory = new SwarmMemory();

    const executor = new DAGExecutor(
      graph, runner, costTracker, memory, 'task',
      undefined, undefined, undefined, undefined, undefined, undefined,
      adapter,
    );
    await collectEvents(executor.execute());

    expect(adapter.createArtifact).not.toHaveBeenCalled();
  });

  it('persists runs for parallel fan-out nodes', async () => {
    const { adapter } = createSpyPersistence();
    const dag = new DAGBuilder()
      .agent('root', agent('root'))
      .agent('left', agent('left'))
      .agent('right', agent('right'))
      .edge('root', 'left')
      .edge('root', 'right')
      .build();
    const graph = new DAGGraph(dag);
    const runner = createMockRunner({ root: 'r', left: 'l', right: 'r' });
    const costTracker = new CostTracker();
    const memory = new SwarmMemory();

    const executor = new DAGExecutor(
      graph, runner, costTracker, memory, 'parallel task',
      undefined, undefined, undefined, undefined, undefined, undefined,
      adapter,
    );
    await collectEvents(executor.execute());

    // All 3 nodes should have createRun and updateRun calls
    expect(adapter.createRun).toHaveBeenCalledTimes(3);
    expect(adapter.updateRun).toHaveBeenCalledTimes(3);
  });

  it('handles persistence errors gracefully without breaking execution', async () => {
    const adapter: PersistenceAdapter = {
      createRun: vi.fn(async () => { throw new Error('DB connection failed'); }),
      updateRun: vi.fn(async () => {}),
      createArtifact: vi.fn(async () => 'art-1'),
      saveMessage: vi.fn(async () => {}),
      loadThreadHistory: vi.fn(async () => []),
      logActivity: vi.fn(async () => {}),
    };

    const dag = new DAGBuilder()
      .agent('a', agent('a'))
      .build();
    const graph = new DAGGraph(dag);
    const runner = createMockRunner({ a: 'output' });
    const costTracker = new CostTracker();
    const memory = new SwarmMemory();

    const executor = new DAGExecutor(
      graph, runner, costTracker, memory, 'task',
      undefined, undefined, undefined, undefined, undefined, undefined,
      adapter,
    );
    const events = await collectEvents(executor.execute());

    // Execution should still complete — persistence failures shouldn't crash the DAG
    const doneEvents = eventsOfType(events, 'swarm_done');
    expect(doneEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — SwarmEngine persistence pass-through
// ---------------------------------------------------------------------------

describe('SwarmEngine persistence pass-through', () => {
  it('passes persistence adapter to DAGExecutor during run', async () => {
    const { adapter } = createSpyPersistence();

    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              yield { type: 'chunk' as const, content: 'output' };
              yield { type: 'usage' as const, inputTokens: 10, outputTokens: 6 };
            },
            estimateCost: () => 1,
            getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
          },
        },
      },
      defaults: { provider: 'test' },
      persistence: adapter,
    };

    const engine = new SwarmEngine(config);
    const dag = engine.dag()
      .agent('a', { id: 'a', name: 'A', role: 'writer', systemPrompt: 'Write.' })
      .build();

    await collectEvents(engine.run({ dag, task: 'test persistence' }));

    // Persistence adapter should have been called
    expect(adapter.createRun).toHaveBeenCalledTimes(1);
    expect(adapter.updateRun).toHaveBeenCalledTimes(1);

    const createParams = (adapter.createRun as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateRunParams;
    expect(createParams.agentId).toBe('a');
    expect(createParams.agentRole).toBe('writer');
    expect(createParams.swarmId).toBe(dag.id);
  });

  it('calls lifecycle hooks onRunStart and onRunComplete', async () => {
    const onRunStart = vi.fn();
    const onRunComplete = vi.fn();

    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              yield { type: 'chunk' as const, content: 'done' };
              yield { type: 'usage' as const, inputTokens: 10, outputTokens: 4 };
            },
            estimateCost: () => 1,
            getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
          },
        },
      },
      defaults: { provider: 'test' },
      lifecycle: { onRunStart, onRunComplete },
    };

    const engine = new SwarmEngine(config);
    const dag = engine.dag()
      .agent('a', { id: 'a', name: 'A', role: 'worker', systemPrompt: '' })
      .build();

    await collectEvents(engine.run({ dag, task: 'lifecycle test' }));

    expect(onRunStart).toHaveBeenCalledTimes(1);
    expect(onRunComplete).toHaveBeenCalledTimes(1);
    // onRunComplete receives (runId, agentId, output, artifactRequest?)
    expect(onRunComplete).toHaveBeenCalledWith(
      expect.any(String),
      'a',
      'done',
      undefined,
    );
  });

  it('calls lifecycle hook onRunFailed on agent error', async () => {
    const onRunFailed = vi.fn();

    const config: SwarmEngineConfig = {
      providers: {
        test: {
          type: 'custom',
          adapter: {
            async *stream() {
              throw new Error('LLM exploded');
            },
            estimateCost: () => 1,
            getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
          },
        },
      },
      defaults: { provider: 'test' },
      lifecycle: { onRunFailed },
    };

    const engine = new SwarmEngine(config);
    const dag = engine.dag()
      .agent('a', { id: 'a', name: 'A', role: 'worker', systemPrompt: '' })
      .build();

    await collectEvents(engine.run({ dag, task: 'fail test' }));

    expect(onRunFailed).toHaveBeenCalledTimes(1);
    expect(onRunFailed).toHaveBeenCalledWith(
      expect.any(String),
      'a',
      expect.stringContaining('LLM exploded'),
      expect.any(String),
    );
  });
});
