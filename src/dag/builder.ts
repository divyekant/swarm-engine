import type {
  AgentDescriptor,
  DAGDefinition,
  DAGNode,
  DAGEdge,
  ConditionalEdge,
  Evaluator,
} from '../types.js';

export interface ConditionalEdgeConfig {
  evaluate: Evaluator;
  targets: Record<string, string>;
}

export interface EdgeOptions {
  maxCycles?: number;
}

/**
 * Fluent builder for constructing DAG definitions.
 *
 * Usage:
 * ```ts
 * const dag = new DAGBuilder()
 *   .agent('pm', { id: 'pm', name: 'PM', role: 'pm', systemPrompt: '...' })
 *   .agent('arch', { id: 'arch', name: 'Architect', role: 'architect', systemPrompt: '...' })
 *   .edge('pm', 'arch')
 *   .build();
 * ```
 */
export class DAGBuilder {
  private nodes: Map<string, DAGNode> = new Map();
  private edges: DAGEdge[] = [];
  private conditionalEdges: ConditionalEdge[] = [];
  private dynamicNodeIds: Set<string> = new Set();

  /** Add an agent node. Throws if a node with the same ID already exists. */
  agent(nodeId: string, descriptor: AgentDescriptor): this {
    if (this.nodes.has(nodeId)) {
      throw new Error(`Duplicate node ID: "${nodeId}"`);
    }
    this.nodes.set(nodeId, { id: nodeId, agent: descriptor });
    return this;
  }

  /** Add a directed edge between two nodes. */
  edge(from: string, to: string, options?: EdgeOptions): this {
    const edge: DAGEdge = { from, to };
    if (options?.maxCycles !== undefined) {
      edge.maxCycles = options.maxCycles;
    }
    this.edges.push(edge);
    return this;
  }

  /** Add a conditional edge from a node with an evaluator and target map. */
  conditionalEdge(from: string, config: ConditionalEdgeConfig): this {
    this.conditionalEdges.push({
      from,
      evaluate: config.evaluate,
      targets: config.targets,
    });
    return this;
  }

  /** Mark a node as capable of dynamic sub-DAG expansion at runtime. */
  dynamicExpansion(nodeId: string): this {
    this.dynamicNodeIds.add(nodeId);
    return this;
  }

  /**
   * Validate and produce the final DAGDefinition.
   * Throws if any edge references a node that does not exist.
   */
  build(): DAGDefinition {
    // Validate regular edges
    for (const edge of this.edges) {
      if (!this.nodes.has(edge.from)) {
        throw new Error(`Edge references non-existent source node: "${edge.from}"`);
      }
      if (!this.nodes.has(edge.to)) {
        throw new Error(`Edge references non-existent target node: "${edge.to}"`);
      }
    }

    // Validate conditional edges
    for (const ce of this.conditionalEdges) {
      if (!this.nodes.has(ce.from)) {
        throw new Error(`Conditional edge references non-existent source node: "${ce.from}"`);
      }
      for (const [label, target] of Object.entries(ce.targets)) {
        if (!this.nodes.has(target)) {
          throw new Error(
            `Conditional edge target "${label}" references non-existent node: "${target}"`,
          );
        }
      }
    }

    // Validate dynamic expansion node references
    for (const nodeId of this.dynamicNodeIds) {
      if (!this.nodes.has(nodeId)) {
        throw new Error(`Dynamic expansion references non-existent node: "${nodeId}"`);
      }
    }

    // Mark dynamic nodes with canEmitDAG flag
    for (const nodeId of this.dynamicNodeIds) {
      const node = this.nodes.get(nodeId)!;
      node.canEmitDAG = true;
    }

    const id = `dag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      nodes: Array.from(this.nodes.values()),
      edges: [...this.edges],
      conditionalEdges: [...this.conditionalEdges],
      dynamicNodes: Array.from(this.dynamicNodeIds),
    };
  }
}
