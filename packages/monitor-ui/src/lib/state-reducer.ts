import type { UIState, SwarmEvent, CostSummary } from './types';

const MAX_EVENTS = 200;

function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

export function initialState(): UIState {
  return {
    connected: false,
    dagId: '',
    status: 'idle',
    nodes: new Map(),
    routeDecisions: [],
    totalCost: emptyCost(),
    progress: { completed: 0, total: 0 },
    startTime: 0,
    events: [],
  };
}

export type ReducerAction =
  | { type: 'event'; event: SwarmEvent }
  | { type: 'connected'; connected: boolean }
  | { type: 'hydrate'; state: Partial<UIState> & { nodes?: Record<string, UIState['nodes'] extends Map<string, infer V> ? V : never> } };

export function reducer(state: UIState, action: ReducerAction): UIState {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: action.connected };

    case 'hydrate': {
      const { nodes: rawNodes, ...rest } = action.state;
      const nodes = rawNodes
        ? new Map(Object.entries(rawNodes))
        : state.nodes;
      return { ...state, ...rest, nodes };
    }

    case 'event':
      return reduceEvent(state, action.event);
  }
}

function reduceEvent(state: UIState, event: SwarmEvent): UIState {
  // Append to event log (capped)
  const events = [
    { timestamp: Date.now(), event },
    ...state.events,
  ].slice(0, MAX_EVENTS);

  switch (event.type) {
    case 'swarm_start':
      return {
        ...state,
        dagId: event.dagId,
        status: 'running',
        nodes: new Map(),
        routeDecisions: [],
        totalCost: emptyCost(),
        progress: { completed: 0, total: event.nodeCount },
        startTime: Date.now(),
        events,
      };

    case 'agent_start': {
      const nodes = new Map(state.nodes);
      nodes.set(event.nodeId, {
        id: event.nodeId,
        agentRole: event.agentRole,
        agentName: event.agentName,
        status: 'running',
      });
      return { ...state, nodes, events };
    }

    case 'agent_done': {
      const nodes = new Map(state.nodes);
      const existing = nodes.get(event.nodeId);
      if (existing) {
        nodes.set(event.nodeId, {
          ...existing,
          status: 'completed',
          output: event.output,
          cost: event.cost,
        });
      }
      return { ...state, nodes, events };
    }

    case 'agent_error': {
      const nodes = new Map(state.nodes);
      const existing = nodes.get(event.nodeId);
      if (existing) {
        nodes.set(event.nodeId, {
          ...existing,
          status: 'failed',
          error: event.message,
        });
      }
      return { ...state, nodes, events };
    }

    case 'swarm_progress':
      return {
        ...state,
        progress: { completed: event.completed, total: event.total },
        events,
      };

    case 'swarm_done':
      return {
        ...state,
        status: 'completed',
        totalCost: event.totalCost,
        events,
      };

    case 'swarm_error':
      return {
        ...state,
        status: 'failed',
        totalCost: event.partialCost,
        events,
      };

    case 'swarm_cancelled':
      return {
        ...state,
        status: 'cancelled',
        totalCost: event.partialCost,
        events,
      };

    case 'route_decision':
      return {
        ...state,
        routeDecisions: [
          ...state.routeDecisions,
          { from: event.fromNode, to: event.toNode, reason: event.reason },
        ],
        events,
      };

    default:
      return { ...state, events };
  }
}
