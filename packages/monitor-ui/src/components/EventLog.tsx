import type { SwarmEvent } from '../lib/types';

const TYPE_COLORS: Record<string, string> = {
  swarm_start: 'bg-purple-900 text-purple-300',
  swarm_progress: 'bg-blue-900 text-blue-300',
  swarm_done: 'bg-emerald-900 text-emerald-300',
  swarm_error: 'bg-red-900 text-red-300',
  swarm_cancelled: 'bg-amber-900 text-amber-300',
  agent_start: 'bg-sky-900 text-sky-300',
  agent_chunk: 'bg-gray-800 text-gray-400',
  agent_tool_use: 'bg-indigo-900 text-indigo-300',
  agent_done: 'bg-emerald-900/70 text-emerald-300',
  agent_error: 'bg-red-900/70 text-red-300',
  route_decision: 'bg-violet-900 text-violet-300',
  loop_iteration: 'bg-orange-900 text-orange-300',
  budget_warning: 'bg-yellow-900 text-yellow-300',
  budget_exceeded: 'bg-red-900 text-red-200',
};

interface Props {
  events: Array<{ timestamp: number; event: SwarmEvent }>;
}

export function EventLog({ events }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-800">
        Event Log ({events.length})
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-700">
            No events yet
          </div>
        ) : (
          events.map((entry, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 px-3 py-1.5 border-b border-gray-900/50 hover:bg-gray-800/30"
            >
              {/* Time */}
              <span className="text-gray-600 flex-shrink-0 w-16">
                {formatTime(entry.timestamp)}
              </span>

              {/* Type badge */}
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${
                  TYPE_COLORS[entry.event.type] ?? 'bg-gray-800 text-gray-400'
                }`}
              >
                {entry.event.type}
              </span>

              {/* Summary */}
              <span className="text-gray-400 truncate">
                {summarizeEvent(entry.event)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function summarizeEvent(event: SwarmEvent): string {
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
    default:
      return JSON.stringify(event);
  }
}
