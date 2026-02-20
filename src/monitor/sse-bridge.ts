import type { ServerResponse } from 'node:http';
import type { SwarmEvent, CostSummary, NodeStatus } from '../types.js';

interface NodeState {
  id: string;
  agentRole: string;
  agentName: string;
  status: NodeStatus;
  output?: string;
  error?: string;
  cost?: CostSummary;
}

export interface MonitorState {
  dagId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  nodes: Map<string, NodeState>;
  routeDecisions: { from: string; to: string; reason: string }[];
  totalCost: CostSummary;
  progress: { completed: number; total: number };
  startTime: number;
}

function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

/**
 * SSEBridge converts SwarmEvent broadcasts into Server-Sent Events
 * and maintains a state snapshot for catch-up on new client connections.
 */
export class SSEBridge {
  private clients: Set<ServerResponse> = new Set();
  private state: MonitorState = {
    dagId: '',
    status: 'idle',
    nodes: new Map(),
    routeDecisions: [],
    totalCost: emptyCost(),
    progress: { completed: 0, total: 0 },
    startTime: 0,
  };

  get clientCount(): number {
    return this.clients.size;
  }

  /** Register a new SSE client connection. */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Flush headers immediately with an SSE comment so the client
    // receives the response and can start listening for data events.
    res.write(': connected\n\n');

    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /** Broadcast a SwarmEvent to all connected clients and update state. */
  broadcast(event: SwarmEvent): void {
    this.reduceState(event);

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      client.write(data);
    }
  }

  /** Get the current state snapshot. */
  getState(): MonitorState {
    return this.state;
  }

  /** Get a JSON-serializable version of the state (for /state endpoint). */
  getStateJSON(): Record<string, unknown> {
    return {
      dagId: this.state.dagId,
      status: this.state.status,
      nodes: Object.fromEntries(this.state.nodes),
      routeDecisions: this.state.routeDecisions,
      totalCost: this.state.totalCost,
      progress: this.state.progress,
      startTime: this.state.startTime,
    };
  }

  /** Reduce an event into the state snapshot. */
  private reduceState(event: SwarmEvent): void {
    switch (event.type) {
      case 'swarm_start':
        this.state = {
          dagId: event.dagId,
          status: 'running',
          nodes: new Map(),
          routeDecisions: [],
          totalCost: emptyCost(),
          progress: { completed: 0, total: event.nodeCount },
          startTime: Date.now(),
        };
        break;

      case 'agent_start': {
        this.state.nodes.set(event.nodeId, {
          id: event.nodeId,
          agentRole: event.agentRole,
          agentName: event.agentName,
          status: 'running',
        });
        break;
      }

      case 'agent_done': {
        const node = this.state.nodes.get(event.nodeId);
        if (node) {
          node.status = 'completed';
          node.output = event.output;
          node.cost = event.cost;
        }
        break;
      }

      case 'agent_error': {
        const node = this.state.nodes.get(event.nodeId);
        if (node) {
          node.status = 'failed';
          node.error = event.message;
        }
        break;
      }

      case 'swarm_progress':
        this.state.progress = {
          completed: event.completed,
          total: event.total,
        };
        break;

      case 'swarm_done':
        this.state.status = 'completed';
        this.state.totalCost = event.totalCost;
        break;

      case 'swarm_error':
        this.state.status = 'failed';
        this.state.totalCost = event.partialCost;
        break;

      case 'swarm_cancelled':
        this.state.status = 'cancelled';
        this.state.totalCost = event.partialCost;
        break;

      case 'route_decision':
        this.state.routeDecisions.push({
          from: event.fromNode,
          to: event.toNode,
          reason: event.reason,
        });
        break;
    }
  }
}
