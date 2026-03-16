import type { SwarmEvent } from './types';

export function summarizeEvent(event: SwarmEvent): string {
  switch (event.type) {
    case 'swarm_start':
      return `DAG "${event.dagId}" — ${event.nodeCount} nodes`;
    case 'swarm_progress':
      return `${event.completed}/${event.total} — running: ${event.runningNodes.join(', ')}`;
    case 'swarm_done':
      return `Done — ${event.totalCost.costCents.toFixed(2)}¢ total`;
    case 'swarm_error':
      return event.message;
    case 'swarm_cancelled':
      return `Cancelled — ${event.completedNodes.length} completed`;
    case 'agent_start':
      return `${event.agentName} (${event.agentRole})`;
    case 'agent_chunk':
      return event.content.slice(0, 80);
    case 'agent_tool_use':
      return `${event.tool}()`;
    case 'agent_done':
      return `${event.agentRole} — ${event.cost.costCents.toFixed(2)}¢`;
    case 'agent_error':
      return `${event.agentRole}: ${event.message}`;
    case 'route_decision':
      return `${event.fromNode} → ${event.toNode}: ${event.reason}`;
    case 'loop_iteration':
      return `${event.nodeId} iteration ${event.iteration}/${event.maxIterations}`;
    case 'budget_warning':
      return `${event.percentUsed.toFixed(0)}% of budget used`;
    case 'budget_exceeded':
      return `Exceeded: ${event.used}¢ / ${event.limit}¢`;
    case 'feedback_retry':
      return `${event.fromNode} → ${event.toNode} retry ${event.iteration}/${event.maxRetries}`;
    case 'feedback_escalation':
      return `${event.fromNode} → ${event.toNode} escalated (${event.policy.action})`;
    case 'guard_warning':
      return `${event.nodeId} ${event.guardType}: ${event.message}`;
    case 'guard_blocked':
      return `${event.nodeId} blocked by ${event.guardType}: ${event.message}`;
    default:
      return JSON.stringify(event);
  }
}
