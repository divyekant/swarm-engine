import type { NodeUIState } from '../lib/types';
import { NodeCard } from './NodeCard';

interface Props {
  nodes: Map<string, NodeUIState>;
  routeDecisions: { from: string; to: string; reason: string }[];
}

export function DAGView({ nodes, routeDecisions }: Props) {
  const nodeList = Array.from(nodes.values());

  if (nodeList.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600">
        <div className="text-center">
          <div className="text-4xl mb-3">⏳</div>
          <p className="text-sm">Waiting for swarm to start...</p>
          <p className="text-xs text-gray-700 mt-1">Connect your SwarmEngine to port 4820</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-1">
      <div className="flex flex-col gap-2">
        {nodeList.map((node, idx) => (
          <div key={node.id}>
            {/* Route decision arrow from previous node */}
            {idx > 0 && (
              <div className="flex items-center justify-center py-1">
                <RouteArrow
                  from={nodeList[idx - 1].id}
                  to={node.id}
                  decisions={routeDecisions}
                />
              </div>
            )}
            <NodeCard node={node} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RouteArrow({
  from,
  to,
  decisions,
}: {
  from: string;
  to: string;
  decisions: { from: string; to: string; reason: string }[];
}) {
  const decision = decisions.find((d) => d.from === from && d.to === to);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="w-px h-3 bg-gray-700" />
      {decision && (
        <span className="text-[10px] text-gray-600 font-mono px-1.5 py-0.5 bg-gray-800/50 rounded">
          {decision.reason}
        </span>
      )}
      <svg width="10" height="8" viewBox="0 0 10 8" className="text-gray-700">
        <polygon points="5,8 0,0 10,0" fill="currentColor" />
      </svg>
    </div>
  );
}
