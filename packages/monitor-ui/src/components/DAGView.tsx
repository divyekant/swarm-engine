import { useMemo } from 'react';
import type { NodeUIState } from '../lib/types';
import { NodeCard } from './NodeCard';

interface Props {
  nodes: Map<string, NodeUIState>;
  routeDecisions: { from: string; to: string; reason: string }[];
}

/** A layer is a group of nodes at the same topological depth. */
interface Layer {
  nodes: NodeUIState[];
  depth: number;
}

/**
 * Build topological layers from route decisions.
 * Nodes with the same set of parents land in the same layer (parallel cluster).
 * Nodes with no incoming edges go in layer 0 (roots).
 */
function buildLayers(
  nodes: Map<string, NodeUIState>,
  decisions: { from: string; to: string }[],
): Layer[] {
  const nodeIds = Array.from(nodes.keys());
  if (nodeIds.length === 0) return [];

  // Build adjacency: parent -> children
  const parents = new Map<string, Set<string>>();
  for (const id of nodeIds) parents.set(id, new Set());
  for (const d of decisions) {
    if (nodes.has(d.to)) {
      parents.get(d.to)?.add(d.from);
    }
  }

  // Compute depth: max(parent depths) + 1
  const depth = new Map<string, number>();
  function getDepth(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    const p = parents.get(id);
    if (!p || p.size === 0) {
      depth.set(id, 0);
      return 0;
    }
    const d = Math.max(...Array.from(p).map(getDepth)) + 1;
    depth.set(id, d);
    return d;
  }
  for (const id of nodeIds) getDepth(id);

  // Group by depth
  const layerMap = new Map<number, NodeUIState[]>();
  for (const id of nodeIds) {
    const d = depth.get(id) ?? 0;
    if (!layerMap.has(d)) layerMap.set(d, []);
    layerMap.get(d)!.push(nodes.get(id)!);
  }

  // Sort layers by depth
  return Array.from(layerMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([d, n]) => ({ depth: d, nodes: n }));
}

export function DAGView({ nodes, routeDecisions }: Props) {
  const layers = useMemo(
    () => buildLayers(nodes, routeDecisions),
    [nodes, routeDecisions],
  );

  if (layers.length === 0) {
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
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <div className="flex flex-col items-center gap-0">
        {layers.map((layer, layerIdx) => (
          <div key={layer.depth} className="w-full">
            {/* Connector arrows from previous layer */}
            {layerIdx > 0 && (
              <LayerConnector
                fromLayer={layers[layerIdx - 1]}
                toLayer={layer}
                decisions={routeDecisions}
              />
            )}

            {/* Node row — single node full width, multiple nodes in grid */}
            {layer.nodes.length === 1 ? (
              <div className="max-w-2xl mx-auto">
                <NodeCard node={layer.nodes[0]} />
              </div>
            ) : (
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(layer.nodes.length, 4)}, 1fr)`,
                }}
              >
                {layer.nodes.map((node) => (
                  <NodeCard key={node.id} node={node} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders connector arrows between two layers.
 * For fan-out (1 -> N): shows a single stem splitting into N branches.
 * For fan-in (N -> 1): shows N branches merging into a single stem.
 * For 1-to-1: shows a simple vertical arrow with optional label.
 */
function LayerConnector({
  fromLayer,
  toLayer,
  decisions,
}: {
  fromLayer: Layer;
  toLayer: Layer;
  decisions: { from: string; to: string; reason: string }[];
}) {
  const fromCount = fromLayer.nodes.length;
  const toCount = toLayer.nodes.length;

  // Collect relevant decisions for labels
  const relevantDecisions = decisions.filter(
    (d) =>
      fromLayer.nodes.some((n) => n.id === d.from) &&
      toLayer.nodes.some((n) => n.id === d.to),
  );

  // Simple 1-to-1 connector
  if (fromCount === 1 && toCount === 1) {
    const label = relevantDecisions[0]?.reason;
    return (
      <div className="flex flex-col items-center py-1">
        <div className="w-px h-3 bg-gray-700" />
        {label && (
          <span className="text-[10px] text-gray-600 font-mono px-1.5 py-0.5 bg-gray-800/50 rounded">
            {label}
          </span>
        )}
        <Arrow />
      </div>
    );
  }

  // Fan-out: 1 source -> N targets
  if (fromCount === 1 && toCount > 1) {
    return (
      <div className="flex flex-col items-center py-1">
        <div className="w-px h-4 bg-gray-700" />
        {/* Horizontal spread bar */}
        <div className="relative w-full max-w-2xl px-8">
          <div className="h-px bg-gray-700" />
          {/* Labels on each branch */}
          <div
            className="grid mt-1"
            style={{ gridTemplateColumns: `repeat(${toCount}, 1fr)` }}
          >
            {toLayer.nodes.map((targetNode) => {
              const decision = relevantDecisions.find((d) => d.to === targetNode.id);
              return (
                <div key={targetNode.id} className="flex flex-col items-center">
                  {decision && (
                    <span className="text-[10px] text-gray-600 font-mono px-1 py-0.5 bg-gray-800/50 rounded mb-0.5 whitespace-nowrap">
                      {decision.reason}
                    </span>
                  )}
                  <Arrow />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Fan-in: N sources -> 1 target
  if (fromCount > 1 && toCount === 1) {
    return (
      <div className="flex flex-col items-center py-1">
        {/* Vertical stubs from each source */}
        <div className="relative w-full max-w-2xl px-8">
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${fromCount}, 1fr)` }}
          >
            {fromLayer.nodes.map((srcNode) => {
              const decision = relevantDecisions.find((d) => d.from === srcNode.id);
              return (
                <div key={srcNode.id} className="flex flex-col items-center">
                  <div className="w-px h-3 bg-gray-700" />
                  {decision && (
                    <span className="text-[10px] text-gray-600 font-mono px-1 py-0.5 bg-gray-800/50 rounded whitespace-nowrap">
                      {decision.reason}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* Horizontal merge bar */}
          <div className="h-px bg-gray-700 mt-1" />
        </div>
        <Arrow />
      </div>
    );
  }

  // Fallback: complex N-to-M (just show a simple divider)
  return (
    <div className="flex flex-col items-center py-1">
      <div className="w-px h-4 bg-gray-700" />
      <Arrow />
    </div>
  );
}

function Arrow() {
  return (
    <svg width="10" height="8" viewBox="0 0 10 8" className="text-gray-700 flex-shrink-0">
      <polygon points="5,8 0,0 10,0" fill="currentColor" />
    </svg>
  );
}
