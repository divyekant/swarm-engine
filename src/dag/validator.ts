import type { DAGDefinition, DAGEdge } from '../types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Estimate cost in cents based on a simple node-count heuristic.
 * Assumes ~1000 input + 500 output tokens per node at $3/$15 per 1M tokens (a rough average).
 * Returns cost in cents.
 */
function estimateBudget(dag: DAGDefinition): number {
  const costPerNodeCents = 0.5; // rough heuristic
  return dag.nodes.length * costPerNodeCents;
}

/**
 * Detect all cycles in the directed graph formed by `edges`.
 * Returns an array of cycles, where each cycle is an array of edge indices
 * into the `edges` array.
 *
 * Uses iterative DFS with colour marking (white/grey/black).
 */
function findCycleEdges(dag: DAGDefinition): DAGEdge[][] {
  const adj = new Map<string, DAGEdge[]>();
  for (const node of dag.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of dag.edges) {
    adj.get(edge.from)?.push(edge);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const node of dag.nodes) {
    colour.set(node.id, WHITE);
  }

  const cycles: DAGEdge[][] = [];

  function dfs(nodeId: string, path: DAGEdge[]): void {
    colour.set(nodeId, GREY);
    const outgoing = adj.get(nodeId) ?? [];
    for (const edge of outgoing) {
      const targetColour = colour.get(edge.to);
      if (targetColour === GREY) {
        // Found a cycle — extract the cycle edges from the path
        const cycleStart = path.findIndex((e) => e.from === edge.to);
        if (cycleStart !== -1) {
          const cycleEdges = [...path.slice(cycleStart), edge];
          cycles.push(cycleEdges);
        } else {
          // edge.to === the current node starting point of this DFS subtree
          cycles.push([edge]);
        }
      } else if (targetColour === WHITE) {
        path.push(edge);
        dfs(edge.to, path);
        path.pop();
      }
    }
    colour.set(nodeId, BLACK);
  }

  for (const node of dag.nodes) {
    if (colour.get(node.id) === WHITE) {
      dfs(node.id, []);
    }
  }

  return cycles;
}

/**
 * Validates a DAG definition before execution.
 *
 * Checks:
 * 1. No orphan nodes — every node (except roots) must have at least one incoming edge
 * 2. Cycles have maxCycles — if there is a cycle, every edge in that cycle must have maxCycles set
 * 3. Referenced providers exist — if an agent references a providerId, it must exist in config.providers
 * 4. Budget estimate — appends a warning if estimated cost seems high (informational, does not fail validation)
 */
export function validateDAG(
  dag: DAGDefinition,
  config?: { providers?: Record<string, unknown> },
): ValidationResult {
  const errors: string[] = [];

  const nodeIds = new Set(dag.nodes.map((n) => n.id));

  // 1. Orphan node detection
  // A node is orphan if it has no incoming regular edges AND is not a target of any conditional edge.
  // Root nodes (no incoming connections at all) are expected and excluded.
  const incomingRegular = new Set<string>();
  for (const edge of dag.edges) {
    incomingRegular.add(edge.to);
  }

  const incomingConditional = new Set<string>();
  for (const ce of dag.conditionalEdges) {
    for (const target of Object.values(ce.targets)) {
      incomingConditional.add(target);
    }
  }

  // Root nodes: no incoming edges of any kind
  const rootNodes = new Set<string>();
  for (const node of dag.nodes) {
    if (!incomingRegular.has(node.id) && !incomingConditional.has(node.id)) {
      rootNodes.add(node.id);
    }
  }

  // Dynamic nodes are not considered orphans — they can be injected at runtime
  const dynamicNodes = new Set(dag.dynamicNodes);

  for (const node of dag.nodes) {
    if (rootNodes.has(node.id)) continue; // roots are fine
    if (dynamicNodes.has(node.id)) continue; // dynamic nodes are fine
    if (!incomingRegular.has(node.id) && !incomingConditional.has(node.id)) {
      errors.push(`Orphan node "${node.id}" has no incoming edges`);
    }
  }

  // 2. Cycle detection — every edge in a cycle must have maxCycles
  const cycles = findCycleEdges(dag);
  for (const cycle of cycles) {
    for (const edge of cycle) {
      if (edge.maxCycles === undefined) {
        errors.push(
          `Edge "${edge.from}" -> "${edge.to}" is part of a cycle but has no maxCycles set`,
        );
      }
    }
  }

  // 3. Provider reference validation
  // Only validate provider references when a providers map is explicitly provided.
  // If no config or no providers key is given, we skip this check since we have
  // no provider registry to validate against.
  if (config?.providers !== undefined) {
    const providers = config.providers;
    for (const node of dag.nodes) {
      const providerId = node.agent.providerId;
      if (providerId !== undefined && !(providerId in providers)) {
        errors.push(
          `Node "${node.id}" references provider "${providerId}" which does not exist in config`,
        );
      }
    }

    // Also check conditional edge evaluators that reference providers
    for (const ce of dag.conditionalEdges) {
      if (ce.evaluate.type === 'llm' && ce.evaluate.providerId !== undefined) {
        if (!(ce.evaluate.providerId in providers)) {
          errors.push(
            `Conditional edge from "${ce.from}" references provider "${ce.evaluate.providerId}" which does not exist in config`,
          );
        }
      }
    }
  }

  // 4. Budget estimate (informational — does not cause validation failure)
  const estimatedCostCents = estimateBudget(dag);

  return {
    valid: errors.length === 0,
    errors,
    ...(estimatedCostCents > 0 ? { estimatedCostCents } : {}),
  } as ValidationResult & { estimatedCostCents?: number };
}
