// --- Agent Types ---

export interface AgentDescriptor {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  providerId?: string;
  persona?: PersonaConfig;
}

export interface PersonaConfig {
  name: string;
  role: string;
  traits: string[];
  constraints: string[];
  communicationStyle?: string;
  expertise?: string[];
}

// --- Message Types ---

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// --- Cost Types ---

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  calls: number;
}

// --- Event Types ---

export type SwarmEvent =
  | { type: 'agent_start'; nodeId: string; agentRole: string; agentName: string }
  | { type: 'agent_chunk'; nodeId: string; agentRole: string; content: string }
  | { type: 'agent_tool_use'; nodeId: string; tool: string; input: Record<string, unknown> }
  | { type: 'agent_done'; nodeId: string; agentRole: string; output: string; artifactRequest?: ArtifactRequest; cost: CostSummary }
  | { type: 'agent_error'; nodeId: string; agentRole: string; message: string; errorType: AgentErrorType }
  | { type: 'swarm_start'; dagId: string; nodeCount: number; estimatedCost?: number }
  | { type: 'swarm_progress'; completed: number; total: number; runningNodes: string[] }
  | { type: 'swarm_done'; results: NodeResult[]; totalCost: CostSummary }
  | { type: 'swarm_error'; message: string; completedNodes: string[]; partialCost: CostSummary }
  | { type: 'swarm_cancelled'; completedNodes: string[]; partialCost: CostSummary }
  | { type: 'route_decision'; fromNode: string; toNode: string; reason: string }
  | { type: 'loop_iteration'; nodeId: string; iteration: number; maxIterations: number }
  | { type: 'budget_warning'; used: number; limit: number; percentUsed: number }
  | { type: 'budget_exceeded'; used: number; limit: number };

export type AgentErrorType =
  | 'timeout'
  | 'rate_limit'
  | 'auth_error'
  | 'network_error'
  | 'content_filter'
  | 'budget_exceeded'
  | 'unknown';

// --- Node/Result Types ---

export interface NodeResult {
  nodeId: string;
  agentRole: string;
  output: string;
  artifactRequest?: ArtifactRequest;
  cost: CostSummary;
  durationMs: number;
}

export type NodeStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';

// --- Artifact Types ---

export interface ArtifactRequest {
  type: string;
  title: string;
  content: string;
  entityType?: string;
  entityId?: string;
  parentArtifactId?: string;
  metadata?: Record<string, unknown>;
}

// --- DAG Types ---

export interface DAGNode {
  id: string;
  agent: AgentDescriptor;
  task?: string;
  canEmitDAG?: boolean;
}

export interface DAGEdge {
  from: string;
  to: string;
  maxCycles?: number;
}

export interface ConditionalEdge {
  from: string;
  evaluate: Evaluator;
  targets: Record<string, string>;
}

export type Evaluator =
  | { type: 'rule'; fn: (output: string) => string }
  | { type: 'regex'; pattern: string; matchTarget: string; elseTarget: string }
  | { type: 'llm'; prompt: string; model?: string; providerId?: string };

// --- Provider Types ---

export type ProviderEvent =
  | { type: 'chunk'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

export interface StreamParams {
  model: string;
  messages: Message[];
  temperature: number;
  maxTokens: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

// --- Config Types ---

export interface SwarmEngineConfig {
  providers: Record<string, ProviderConfig>;
  persistence?: PersistenceAdapter;
  context?: ContextProvider;
  memory?: MemoryProvider;
  codebase?: CodebaseProvider;
  persona?: PersonaProvider;
  lifecycle?: LifecycleHooks;
  defaults?: EngineDefaults;
  limits?: EngineLimits;
  logging?: LoggingConfig;
}

export interface EngineDefaults {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  provider?: string;
}

export interface EngineLimits {
  maxSwarmBudgetCents?: number;
  maxPerAgentBudgetCents?: number;
  maxConcurrentAgents?: number;
  maxSwarmDurationMs?: number;
  maxScratchpadSizeBytes?: number;
  maxCycleIterations?: number;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  structured?: boolean;
}

export interface ProviderConfig {
  type: 'anthropic' | 'anthropic-oauth' | 'openai' | 'google' | 'ollama' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  adapter?: ProviderAdapter;
}

// --- Adapter Interfaces ---

export interface ProviderAdapter {
  stream(params: StreamParams): AsyncGenerator<ProviderEvent>;
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
  getModelLimits(model: string): { contextWindow: number; maxOutput: number };
}

export interface PersistenceAdapter {
  createRun(params: CreateRunParams): Promise<string>;
  updateRun(runId: string, updates: Record<string, unknown>): Promise<void>;
  createArtifact(params: ArtifactRequest): Promise<string>;
  saveMessage(threadId: string, role: string, content: string): Promise<void>;
  loadThreadHistory(threadId: string): Promise<Message[]>;
  logActivity(params: ActivityParams): Promise<void>;
}

export interface ContextProvider {
  getContext(entityType: string, entityId: string): Promise<string>;
}

export interface MemoryProvider {
  search(query: string, k?: number): Promise<MemoryResult[]>;
  store(text: string, metadata?: Record<string, unknown>): Promise<void>;
}

export interface CodebaseProvider {
  query(repoId: string, query: string, tier: 'mini' | 'standard' | 'full'): Promise<string>;
}

export interface PersonaProvider {
  getPersona(role: string): Promise<PersonaConfig | null>;
}

export interface LifecycleHooks {
  onRunStart?(runId: string, agentId: string): void | Promise<void>;
  onRunComplete?(runId: string, agentId: string, output: string, artifact?: ArtifactRequest): void | Promise<void>;
  onRunFailed?(runId: string, agentId: string, error: string, errorType: AgentErrorType): void | Promise<void>;
  onSwarmComplete?(swarmId: string, results: NodeResult[]): void | Promise<void>;
}

// --- Supporting Types ---

export interface CreateRunParams {
  agentId: string;
  agentRole: string;
  swarmId?: string;
  nodeId?: string;
  task: string;
}

export interface ActivityParams {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryResult {
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// --- Execution Types ---

export interface RunOptions {
  dag: DAGDefinition;
  task: string;
  signal?: AbortSignal;
  threadId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface DAGDefinition {
  id: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
  conditionalEdges: ConditionalEdge[];
  dynamicNodes: string[];
}

// --- Scratchpad Types ---

export interface ScratchpadEntry {
  key: string;
  value: unknown;
  writtenBy: string;
  timestamp: number;
  operation: 'set' | 'append';
}

export interface ChannelMessage {
  from: string;
  to: string | '*';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
