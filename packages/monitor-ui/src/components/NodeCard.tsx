import type { NodeUIState } from '../lib/types';

const STATUS_BORDER: Record<string, string> = {
  pending: 'border-l-gray-600',
  ready: 'border-l-gray-500',
  running: 'border-l-blue-500',
  completed: 'border-l-emerald-500',
  failed: 'border-l-red-500',
  skipped: 'border-l-amber-500',
};

const STATUS_BG: Record<string, string> = {
  pending: 'bg-gray-800/50',
  ready: 'bg-gray-800/60',
  running: 'bg-blue-950/40',
  completed: 'bg-emerald-950/30',
  failed: 'bg-red-950/30',
  skipped: 'bg-amber-950/30',
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-gray-500',
  ready: 'bg-gray-400',
  running: 'bg-blue-400 animate-pulse-fast',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  skipped: 'bg-amber-400',
};

interface Props {
  node: NodeUIState;
}

export function NodeCard({ node }: Props) {
  const truncatedOutput = node.output
    ? node.output.length > 120
      ? node.output.slice(0, 120) + '...'
      : node.output
    : null;

  return (
    <div
      className={`border-l-4 rounded-r-lg px-4 py-3 transition-all duration-300 ${STATUS_BORDER[node.status]} ${STATUS_BG[node.status]}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[node.status]}`} />

        {/* Agent name */}
        <span className="text-sm font-semibold text-gray-100 truncate">
          {node.agentName}
        </span>

        {/* Role badge */}
        <span className="text-xs text-gray-500 font-mono">
          {node.agentRole}
        </span>

        {/* Cost */}
        {node.cost && (
          <span className="ml-auto text-xs text-gray-400 font-mono">
            {node.cost.costCents.toFixed(2)}¢
          </span>
        )}
      </div>

      {/* Error message */}
      {node.error && (
        <p className="text-xs text-red-400 mt-1 font-mono">{node.error}</p>
      )}

      {/* Output preview */}
      {truncatedOutput && (
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">{truncatedOutput}</p>
      )}
    </div>
  );
}
