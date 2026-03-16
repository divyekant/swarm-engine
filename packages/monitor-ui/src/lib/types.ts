// Pure type definitions mirrored from @swarmengine/core src/types.ts
// No runtime dependency on core — just interfaces

export interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  calls: number;
}

export type NodeStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';

export interface NodeResult {
  nodeId: string;
  agentRole: string;
  output: string;
  cost: CostSummary;
  durationMs: number;
}

export interface ArtifactRequest {
  type: string;
  title: string;
  content: string;
  entityType?: string;
  entityId?: string;
  parentArtifactId?: string;
  metadata?: Record<string, unknown>;
}

export interface EscalationPolicy {
  action: 'skip' | 'fail' | 'reroute';
  reroute?: string;
  message?: string;
}

// SwarmEvent union — mirrors core's SwarmEvent surface
export type SwarmEvent =
  | { type: 'agent_start'; nodeId: string; agentRole: string; agentName: string }
  | { type: 'agent_chunk'; nodeId: string; agentRole: string; content: string }
  | { type: 'agent_tool_use'; nodeId: string; tool: string; input: Record<string, unknown> }
  | { type: 'agent_done'; nodeId: string; agentRole: string; output: string; artifactRequest?: ArtifactRequest; cost: CostSummary }
  | { type: 'agent_error'; nodeId: string; agentRole: string; message: string; errorType: string }
  | { type: 'swarm_start'; dagId: string; nodeCount: number; estimatedCost?: number }
  | { type: 'swarm_progress'; completed: number; total: number; runningNodes: string[] }
  | { type: 'swarm_done'; results: NodeResult[]; totalCost: CostSummary }
  | { type: 'swarm_error'; message: string; completedNodes: string[]; partialCost: CostSummary }
  | { type: 'swarm_cancelled'; completedNodes: string[]; partialCost: CostSummary }
  | { type: 'route_decision'; fromNode: string; toNode: string; reason: string }
  | { type: 'loop_iteration'; nodeId: string; iteration: number; maxIterations: number }
  | { type: 'budget_warning'; used: number; limit: number; percentUsed: number }
  | { type: 'budget_exceeded'; used: number; limit: number }
  | { type: 'feedback_retry'; fromNode: string; toNode: string; iteration: number; maxRetries: number }
  | { type: 'feedback_escalation'; fromNode: string; toNode: string; policy: EscalationPolicy; iteration: number }
  | { type: 'guard_warning'; nodeId: string; guardId: string; guardType: string; message: string }
  | { type: 'guard_blocked'; nodeId: string; guardId: string; guardType: string; message: string };

// UI state — client-side mirror of MonitorState
export interface NodeUIState {
  id: string;
  agentRole: string;
  agentName: string;
  status: NodeStatus;
  output?: string;
  error?: string;
  cost?: CostSummary;
  warnings?: string[];
}

export interface FeedbackEventSummary {
  type: 'retry' | 'escalation';
  from: string;
  to: string;
  iteration: number;
  maxRetries?: number;
  action: string;
  detail?: string;
}

export interface UIState {
  connected: boolean;
  dagId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  nodes: Map<string, NodeUIState>;
  routeDecisions: { from: string; to: string; reason: string }[];
  totalCost: CostSummary;
  progress: { completed: number; total: number };
  startTime: number;
  feedbackEvents: FeedbackEventSummary[];
  events: Array<{ timestamp: number; event: SwarmEvent }>;
}
