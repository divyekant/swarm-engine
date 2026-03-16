import { describe, it, expect } from 'vitest';
import { SwarmEngine } from '../../src/engine.js';
import type { SwarmEngineConfig, SwarmEvent, ProviderAdapter } from '../../src/types.js';
import type { AgenticAdapter, AgenticRunParams, AgenticEvent } from '../../src/adapters/agentic/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectEvents(gen: AsyncGenerator<SwarmEvent>): Promise<SwarmEvent[]> {
  const events: SwarmEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function eventsOfType<T extends SwarmEvent['type']>(
  events: SwarmEvent[],
  type: T,
): Extract<SwarmEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<SwarmEvent, { type: T }>[];
}

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock LLM ProviderAdapter.
 * Records the messages sent to each call so tests can verify upstream context.
 */
function mockLLMProvider(callLog?: { nodeIndex: number; messages: string }[]): ProviderAdapter {
  return {
    async *stream(params) {
      const messagesStr = params.messages.map((m) => m.content).join(' | ');
      callLog?.push({ nodeIndex: callLog.length, messages: messagesStr });

      yield { type: 'chunk' as const, content: 'LLM: processed' };
      yield { type: 'usage' as const, inputTokens: 100, outputTokens: 50 };
    },
    estimateCost: () => 0.01,
    getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
  };
}

/**
 * Creates a mock AgenticAdapter that reflects its name and upstream context presence.
 * When receivedParams is passed, records the params for later assertions.
 */
function mockAgenticAdapter(
  name: string,
  receivedParams?: AgenticRunParams[],
): AgenticAdapter {
  return {
    async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
      receivedParams?.push(params);

      const hasUpstream = params.upstreamContext.length > 0;
      yield { type: 'chunk', content: `${name}: working (upstream: ${hasUpstream})` };
      yield {
        type: 'result',
        output: `${name}: done (upstream: ${hasUpstream})`,
        inputTokens: 500,
        outputTokens: 200,
        costUsd: 0.10,
      };
    },
  };
}

/**
 * Creates a mock agentic adapter that calls the injected scratchpad_set tool
 * during its run, then yields a result.
 */
function mockAgenticAdapterWithScratchpad(
  agentName: string,
  scratchpadKey: string,
  scratchpadValue: string,
): AgenticAdapter {
  return {
    async *run(params: AgenticRunParams): AsyncGenerator<AgenticEvent> {
      // Find the scratchpad_set tool from the injected tools
      const scratchpadSetTool = params.tools?.find((t) => t.name === 'scratchpad_set');

      if (scratchpadSetTool) {
        // Execute the tool to write to the scratchpad
        const toolResult = await scratchpadSetTool.execute({
          key: scratchpadKey,
          value: scratchpadValue,
        });
        yield { type: 'tool_use', tool: 'scratchpad_set', input: { key: scratchpadKey, value: scratchpadValue } };
      }

      yield { type: 'chunk', content: `${agentName}: wrote to scratchpad` };
      yield {
        type: 'result',
        output: `${agentName}: wrote ${scratchpadKey}=${scratchpadValue}`,
        inputTokens: 300,
        outputTokens: 100,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1: 3-node pipeline — LLM planner → CC coder → LLM reviewer
// ---------------------------------------------------------------------------

describe('Integration: Mixed DAG with agentic + LLM nodes', () => {
  describe('Test 1: 3-node pipeline — LLM planner → CC coder → LLM reviewer', () => {
    it('executes planner → coder → reviewer in correct order', async () => {
      const ccParams: AgenticRunParams[] = [];

      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider() },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC', ccParams) },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('planner', { id: 'p', name: 'Planner', role: 'planner', systemPrompt: 'Plan', providerId: 'llm' })
        .agent('coder', { id: 'c', name: 'Coder', role: 'coder', systemPrompt: 'Code', providerId: 'cc', agentic: { allowedTools: ['Read', 'Edit', 'Bash'] } })
        .agent('reviewer', { id: 'r', name: 'Reviewer', role: 'reviewer', systemPrompt: 'Review', providerId: 'llm' })
        .edge('planner', 'coder')
        .edge('coder', 'reviewer')
        .build();

      const events = await collectEvents(engine.run({ dag, task: 'Build a feature' }));

      // --- Verify execution order: planner → coder → reviewer ---
      const agentStarts = eventsOfType(events, 'agent_start');
      expect(agentStarts).toHaveLength(3);
      expect(agentStarts.map((e) => e.nodeId)).toEqual(['planner', 'coder', 'reviewer']);

      // --- Verify planner output comes from LLM (text chunk) ---
      const agentDones = eventsOfType(events, 'agent_done');
      expect(agentDones).toHaveLength(3);

      const plannerDone = agentDones.find((e) => e.nodeId === 'planner');
      expect(plannerDone).toBeDefined();
      expect(plannerDone!.output).toBe('LLM: processed');

      // --- Verify coder output comes from agentic adapter (with upstream context) ---
      const coderDone = agentDones.find((e) => e.nodeId === 'coder');
      expect(coderDone).toBeDefined();
      expect(coderDone!.output).toBe('CC: done (upstream: true)');

      // Verify the agentic adapter received upstream context from planner
      expect(ccParams).toHaveLength(1);
      expect(ccParams[0].upstreamContext).toContain('LLM: processed');

      // Verify the agentic options were passed through
      expect(ccParams[0].agenticOptions?.allowedTools).toEqual(['Read', 'Edit', 'Bash']);

      // --- Verify reviewer output comes from LLM (with upstream context from agentic coder) ---
      const reviewerDone = agentDones.find((e) => e.nodeId === 'reviewer');
      expect(reviewerDone).toBeDefined();
      expect(reviewerDone!.output).toBe('LLM: processed');

      // --- Verify swarm_done has 3 results ---
      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(1);
      expect(swarmDones[0].results).toHaveLength(3);

      const resultNodeIds = swarmDones[0].results.map((r) => r.nodeId);
      expect(resultNodeIds).toEqual(['planner', 'coder', 'reviewer']);

      // Verify no errors
      const errors = eventsOfType(events, 'swarm_error');
      expect(errors).toHaveLength(0);
    });

    it('reviewer receives coder agentic output as upstream context', async () => {
      const llmCallLog: { nodeIndex: number; messages: string }[] = [];

      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider(llmCallLog) },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC') },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('planner', { id: 'p', name: 'Planner', role: 'planner', systemPrompt: 'Plan', providerId: 'llm' })
        .agent('coder', { id: 'c', name: 'Coder', role: 'coder', systemPrompt: 'Code', providerId: 'cc' })
        .agent('reviewer', { id: 'r', name: 'Reviewer', role: 'reviewer', systemPrompt: 'Review', providerId: 'llm' })
        .edge('planner', 'coder')
        .edge('coder', 'reviewer')
        .build();

      await collectEvents(engine.run({ dag, task: 'Build a feature' }));

      // llmCallLog[0] is planner (no upstream)
      // llmCallLog[1] is reviewer (should see coder's output)
      expect(llmCallLog).toHaveLength(2);

      // Reviewer should see the coder's agentic output in its upstream context
      const reviewerMessages = llmCallLog[1].messages;
      expect(reviewerMessages).toContain('CC: done (upstream: true)');
    });

    it('accumulates cost from both LLM and agentic nodes', async () => {
      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider() },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC') },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('planner', { id: 'p', name: 'Planner', role: 'planner', systemPrompt: 'Plan', providerId: 'llm' })
        .agent('coder', { id: 'c', name: 'Coder', role: 'coder', systemPrompt: 'Code', providerId: 'cc' })
        .agent('reviewer', { id: 'r', name: 'Reviewer', role: 'reviewer', systemPrompt: 'Review', providerId: 'llm' })
        .edge('planner', 'coder')
        .edge('coder', 'reviewer')
        .build();

      const events = await collectEvents(engine.run({ dag, task: 'Build a feature' }));

      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(1);

      // All 3 nodes should contribute to total cost
      const totalCost = swarmDones[0].totalCost;
      expect(totalCost.calls).toBe(3);

      // LLM nodes: 100 input each = 200
      // Agentic node: 500 input
      // Total input tokens: 700
      expect(totalCost.inputTokens).toBe(700);

      // LLM nodes: 50 output each = 100
      // Agentic node: 200 output
      // Total output tokens: 300
      expect(totalCost.outputTokens).toBe(300);
    });

    it('injects handoff instructions into an agentic producer prompt context', async () => {
      const ccParams: AgenticRunParams[] = [];

      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider() },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC', ccParams) },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('planner', { id: 'p', name: 'Planner', role: 'planner', systemPrompt: 'Plan', providerId: 'llm' })
        .agent('coder', { id: 'c', name: 'Coder', role: 'coder', systemPrompt: 'Code', providerId: 'cc' })
        .agent('reviewer', { id: 'r', name: 'Reviewer', role: 'reviewer', systemPrompt: 'Review', providerId: 'llm' })
        .edge('planner', 'coder')
        .edge('coder', 'reviewer', {
          handoff: {
            id: 'structured-review',
            sections: [{ key: 'summary', label: 'Summary', required: true }],
          },
        })
        .build();

      await collectEvents(engine.run({ dag, task: 'Build a feature' }));

      expect(ccParams).toHaveLength(1);
      expect(ccParams[0].upstreamContext).toContain('## Output Format');
      expect(ccParams[0].upstreamContext).toContain('## Summary (REQUIRED)');
    });

    it('injects retry feedback into an agentic node on feedback reruns', async () => {
      const devParams: AgenticRunParams[] = [];
      let qaCallCount = 0;

      const qaProvider: ProviderAdapter = {
        async *stream() {
          qaCallCount++;
          const response = qaCallCount === 1 ? 'reject: add tests' : 'approve';
          yield { type: 'chunk' as const, content: response };
          yield { type: 'usage' as const, inputTokens: 50, outputTokens: response.length };
        },
        estimateCost: () => 0.01,
        getModelLimits: () => ({ contextWindow: 128_000, maxOutput: 4096 }),
      };

      const engine = new SwarmEngine({
        providers: {
          qa: { type: 'custom', adapter: qaProvider },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC', devParams) },
        },
        defaults: { provider: 'qa', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('developer', { id: 'dev', name: 'Developer', role: 'developer', systemPrompt: 'Build', providerId: 'cc' })
        .agent('qa', { id: 'qa', name: 'QA', role: 'qa', systemPrompt: 'Review', providerId: 'qa' })
        .edge('developer', 'qa')
        .feedbackEdge({
          from: 'qa',
          to: 'developer',
          maxRetries: 2,
          evaluate: { type: 'rule', fn: (output) => output.includes('approve') ? 'pass' : 'fail' },
          passLabel: 'pass',
        })
        .build();

      const events = await collectEvents(engine.run({ dag, task: 'Build a feature' }));

      expect(events.some((event) => event.type === 'feedback_retry')).toBe(true);
      expect(events.some((event) => event.type === 'swarm_done')).toBe(true);
      expect(devParams).toHaveLength(2);
      expect(devParams[1].upstreamContext).toContain('## Retry Feedback');
      expect(devParams[1].upstreamContext).toContain('reject: add tests');
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Parallel fan-out with mixed provider types
  // ---------------------------------------------------------------------------

  describe('Test 2: Parallel fan-out — coordinator(LLM) → [cc-worker(CC), codex-worker(Codex)] → aggregator(LLM)', () => {
    it('all 4 nodes complete successfully', async () => {
      const ccParams: AgenticRunParams[] = [];
      const codexParams: AgenticRunParams[] = [];

      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider() },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC', ccParams) },
          codex: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('Codex', codexParams) },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('coordinator', { id: 'coord', name: 'Coordinator', role: 'coordinator', systemPrompt: 'Coordinate', providerId: 'llm' })
        .agent('cc-worker', { id: 'ccw', name: 'CC Worker', role: 'cc-worker', systemPrompt: 'CC code', providerId: 'cc' })
        .agent('codex-worker', { id: 'cdxw', name: 'Codex Worker', role: 'codex-worker', systemPrompt: 'Codex code', providerId: 'codex' })
        .agent('aggregator', { id: 'agg', name: 'Aggregator', role: 'aggregator', systemPrompt: 'Aggregate', providerId: 'llm' })
        .edge('coordinator', 'cc-worker')
        .edge('coordinator', 'codex-worker')
        .edge('cc-worker', 'aggregator')
        .edge('codex-worker', 'aggregator')
        .build();

      const events = await collectEvents(engine.run({ dag, task: 'Parallel work' }));

      // --- All 4 nodes complete ---
      const agentDones = eventsOfType(events, 'agent_done');
      expect(agentDones).toHaveLength(4);

      const doneNodeIds = agentDones.map((e) => e.nodeId).sort();
      expect(doneNodeIds).toEqual(['aggregator', 'cc-worker', 'codex-worker', 'coordinator']);

      // --- swarm_done with 4 results ---
      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(1);
      expect(swarmDones[0].results).toHaveLength(4);

      // No errors
      const errors = eventsOfType(events, 'swarm_error');
      expect(errors).toHaveLength(0);
    });

    it('both workers receive upstream context from coordinator', async () => {
      const ccParams: AgenticRunParams[] = [];
      const codexParams: AgenticRunParams[] = [];

      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider() },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC', ccParams) },
          codex: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('Codex', codexParams) },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('coordinator', { id: 'coord', name: 'Coordinator', role: 'coordinator', systemPrompt: 'Coordinate', providerId: 'llm' })
        .agent('cc-worker', { id: 'ccw', name: 'CC Worker', role: 'cc-worker', systemPrompt: 'CC code', providerId: 'cc' })
        .agent('codex-worker', { id: 'cdxw', name: 'Codex Worker', role: 'codex-worker', systemPrompt: 'Codex code', providerId: 'codex' })
        .agent('aggregator', { id: 'agg', name: 'Aggregator', role: 'aggregator', systemPrompt: 'Aggregate', providerId: 'llm' })
        .edge('coordinator', 'cc-worker')
        .edge('coordinator', 'codex-worker')
        .edge('cc-worker', 'aggregator')
        .edge('codex-worker', 'aggregator')
        .build();

      const events = await collectEvents(engine.run({ dag, task: 'Parallel work' }));

      // Both workers should have received upstream context (coordinator's LLM output)
      expect(ccParams).toHaveLength(1);
      expect(ccParams[0].upstreamContext).toContain('LLM: processed');

      expect(codexParams).toHaveLength(1);
      expect(codexParams[0].upstreamContext).toContain('LLM: processed');

      // Both worker outputs should reflect upstream presence
      const agentDones = eventsOfType(events, 'agent_done');
      const ccDone = agentDones.find((e) => e.nodeId === 'cc-worker');
      const codexDone = agentDones.find((e) => e.nodeId === 'codex-worker');

      expect(ccDone!.output).toBe('CC: done (upstream: true)');
      expect(codexDone!.output).toBe('Codex: done (upstream: true)');
    });

    it('aggregator receives upstream from both workers', async () => {
      const llmCallLog: { nodeIndex: number; messages: string }[] = [];

      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider(llmCallLog) },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC') },
          codex: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('Codex') },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('coordinator', { id: 'coord', name: 'Coordinator', role: 'coordinator', systemPrompt: 'Coordinate', providerId: 'llm' })
        .agent('cc-worker', { id: 'ccw', name: 'CC Worker', role: 'cc-worker', systemPrompt: 'CC code', providerId: 'cc' })
        .agent('codex-worker', { id: 'cdxw', name: 'Codex Worker', role: 'codex-worker', systemPrompt: 'Codex code', providerId: 'codex' })
        .agent('aggregator', { id: 'agg', name: 'Aggregator', role: 'aggregator', systemPrompt: 'Aggregate', providerId: 'llm' })
        .edge('coordinator', 'cc-worker')
        .edge('coordinator', 'codex-worker')
        .edge('cc-worker', 'aggregator')
        .edge('codex-worker', 'aggregator')
        .build();

      await collectEvents(engine.run({ dag, task: 'Parallel work' }));

      // llmCallLog[0] = coordinator (no upstream)
      // llmCallLog[1] = aggregator (should have both workers' outputs)
      expect(llmCallLog).toHaveLength(2);

      const aggregatorMessages = llmCallLog[1].messages;
      expect(aggregatorMessages).toContain('CC: done (upstream: true)');
      expect(aggregatorMessages).toContain('Codex: done (upstream: true)');
    });

    it('execution order: coordinator first, then workers in parallel, then aggregator last', async () => {
      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider() },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC') },
          codex: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('Codex') },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('coordinator', { id: 'coord', name: 'Coordinator', role: 'coordinator', systemPrompt: 'Coordinate', providerId: 'llm' })
        .agent('cc-worker', { id: 'ccw', name: 'CC Worker', role: 'cc-worker', systemPrompt: 'CC code', providerId: 'cc' })
        .agent('codex-worker', { id: 'cdxw', name: 'Codex Worker', role: 'codex-worker', systemPrompt: 'Codex code', providerId: 'codex' })
        .agent('aggregator', { id: 'agg', name: 'Aggregator', role: 'aggregator', systemPrompt: 'Aggregate', providerId: 'llm' })
        .edge('coordinator', 'cc-worker')
        .edge('coordinator', 'codex-worker')
        .edge('cc-worker', 'aggregator')
        .edge('codex-worker', 'aggregator')
        .build();

      const events = await collectEvents(engine.run({ dag, task: 'Parallel work' }));

      const agentStarts = eventsOfType(events, 'agent_start');
      const startOrder = agentStarts.map((e) => e.nodeId);

      // Coordinator must start first
      expect(startOrder[0]).toBe('coordinator');

      // Aggregator must start last
      expect(startOrder[3]).toBe('aggregator');

      // Workers in the middle (order may vary since they're parallel)
      const middleNodes = startOrder.slice(1, 3).sort();
      expect(middleNodes).toEqual(['cc-worker', 'codex-worker']);
    });

    it('accumulates cost from all 4 mixed nodes', async () => {
      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider() },
          cc: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('CC') },
          codex: { type: 'custom-agentic', agenticAdapter: mockAgenticAdapter('Codex') },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('coordinator', { id: 'coord', name: 'Coordinator', role: 'coordinator', systemPrompt: 'Coordinate', providerId: 'llm' })
        .agent('cc-worker', { id: 'ccw', name: 'CC Worker', role: 'cc-worker', systemPrompt: 'CC code', providerId: 'cc' })
        .agent('codex-worker', { id: 'cdxw', name: 'Codex Worker', role: 'codex-worker', systemPrompt: 'Codex code', providerId: 'codex' })
        .agent('aggregator', { id: 'agg', name: 'Aggregator', role: 'aggregator', systemPrompt: 'Aggregate', providerId: 'llm' })
        .edge('coordinator', 'cc-worker')
        .edge('coordinator', 'codex-worker')
        .edge('cc-worker', 'aggregator')
        .edge('codex-worker', 'aggregator')
        .build();

      const events = await collectEvents(engine.run({ dag, task: 'Parallel work' }));

      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(1);

      const totalCost = swarmDones[0].totalCost;
      expect(totalCost.calls).toBe(4);

      // 2 LLM nodes: 100 input each = 200
      // 2 agentic nodes: 500 input each = 1000
      // Total: 1200
      expect(totalCost.inputTokens).toBe(1200);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Agentic node uses communication tools (scratchpad)
  // ---------------------------------------------------------------------------

  describe('Test 3: Agentic node uses communication tools (scratchpad)', () => {
    it('agentic node writes to scratchpad and downstream LLM node sees it in context', async () => {
      const llmCallLog: { nodeIndex: number; messages: string }[] = [];

      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider(llmCallLog) },
          cc: {
            type: 'custom-agentic',
            agenticAdapter: mockAgenticAdapterWithScratchpad(
              'CC',
              'analysis_result',
              'Found 3 critical bugs',
            ),
          },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('analyzer', { id: 'analyzer', name: 'Analyzer', role: 'analyzer', systemPrompt: 'Analyze code', providerId: 'cc' })
        .agent('reporter', { id: 'reporter', name: 'Reporter', role: 'reporter', systemPrompt: 'Write report', providerId: 'llm' })
        .edge('analyzer', 'reporter')
        .build();

      const events = await collectEvents(engine.run({ dag, task: 'Analyze and report' }));

      // Both nodes should complete
      const agentDones = eventsOfType(events, 'agent_done');
      expect(agentDones).toHaveLength(2);

      // Analyzer should emit a tool_use event for scratchpad_set
      const toolUseEvents = eventsOfType(events, 'agent_tool_use');
      expect(toolUseEvents.length).toBeGreaterThanOrEqual(1);

      const scratchpadToolUse = toolUseEvents.find(
        (e) => e.tool === 'scratchpad_set' && e.nodeId === 'analyzer',
      );
      expect(scratchpadToolUse).toBeDefined();
      expect(scratchpadToolUse!.input).toEqual({
        key: 'analysis_result',
        value: 'Found 3 critical bugs',
      });

      // The downstream LLM reporter should see the scratchpad data in its context.
      // The ContextAssembler includes scratchpad via swarmMemory.scratchpad.toContext()
      // in a "## Shared State" section at priority 3.
      expect(llmCallLog).toHaveLength(1); // Only reporter uses LLM
      const reporterMessages = llmCallLog[0].messages;
      expect(reporterMessages).toContain('analysis_result');
      expect(reporterMessages).toContain('Found 3 critical bugs');

      // swarm_done with 2 results
      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(1);
      expect(swarmDones[0].results).toHaveLength(2);
    });

    it('scratchpad data persists across multiple downstream nodes', async () => {
      const llmCallLog: { nodeIndex: number; messages: string }[] = [];

      const engine = new SwarmEngine({
        providers: {
          llm: { type: 'custom', adapter: mockLLMProvider(llmCallLog) },
          cc: {
            type: 'custom-agentic',
            agenticAdapter: mockAgenticAdapterWithScratchpad(
              'CC',
              'shared_data',
              'important findings',
            ),
          },
        },
        defaults: { provider: 'llm', model: 'test-model' },
      });

      const dag = engine.dag()
        .agent('writer', { id: 'writer', name: 'Writer', role: 'writer', systemPrompt: 'Write', providerId: 'cc' })
        .agent('reader1', { id: 'reader1', name: 'Reader 1', role: 'reader-1', systemPrompt: 'Read 1', providerId: 'llm' })
        .agent('reader2', { id: 'reader2', name: 'Reader 2', role: 'reader-2', systemPrompt: 'Read 2', providerId: 'llm' })
        .edge('writer', 'reader1')
        .edge('writer', 'reader2')
        .build();

      const events = await collectEvents(engine.run({ dag, task: 'Share data' }));

      // All 3 nodes should complete
      const agentDones = eventsOfType(events, 'agent_done');
      expect(agentDones).toHaveLength(3);

      // Both downstream LLM nodes should see the scratchpad data
      // (Both run after writer, which wrote to scratchpad)
      expect(llmCallLog).toHaveLength(2); // reader1 and reader2

      for (const call of llmCallLog) {
        expect(call.messages).toContain('shared_data');
        expect(call.messages).toContain('important findings');
      }

      const swarmDones = eventsOfType(events, 'swarm_done');
      expect(swarmDones).toHaveLength(1);
      expect(swarmDones[0].results).toHaveLength(3);
    });
  });
});
