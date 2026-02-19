import type { DAGDefinition, DAGNode, DAGEdge, ConditionalEdge } from '../types.js';

/**
 * Runtime wrapper around a DAGDefinition providing traversal helpers.
 */
export class DAGGraph {
  nodes: DAGNode[];
  edges: DAGEdge[];
  readonly conditionalEdges: ConditionalEdge[];
  readonly dynamicNodes: string[];
  readonly id: string;

  constructor(definition: DAGDefinition) {
    this.id = definition.id;
    this.nodes = definition.nodes;
    this.edges = definition.edges;
    this.conditionalEdges = definition.conditionalEdges;
    this.dynamicNodes = definition.dynamicNodes;
  }

  /** Return a node by ID, or undefined if not found. */
  getNode(id: string): DAGNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  /** Return all edges pointing *to* the given node. */
  getIncomingEdges(nodeId: string): DAGEdge[] {
    return this.edges.filter((e) => e.to === nodeId);
  }

  /** Return all edges originating *from* the given node. */
  getOutgoingEdges(nodeId: string): DAGEdge[] {
    return this.edges.filter((e) => e.from === nodeId);
  }

  /** Return all conditional edges originating from the given node. */
  getConditionalEdges(nodeId: string): ConditionalEdge[] {
    return this.conditionalEdges.filter((e) => e.from === nodeId);
  }

  /** Return root nodes -- nodes with no incoming edges. */
  getRootNodes(): DAGNode[] {
    const targets = new Set(this.edges.map((e) => e.to));
    return this.nodes.filter((n) => !targets.has(n.id));
  }

  /** Return leaf nodes -- nodes with no outgoing edges and no conditional outgoing edges. */
  getLeafNodes(): DAGNode[] {
    const sources = new Set(this.edges.map((e) => e.from));
    const conditionalSources = new Set(this.conditionalEdges.map((e) => e.from));
    return this.nodes.filter((n) => !sources.has(n.id) && !conditionalSources.has(n.id));
  }

  /** Add a node dynamically at runtime. */
  addNode(node: DAGNode): void {
    this.nodes.push(node);
  }

  /** Add an edge dynamically at runtime. */
  addEdge(edge: DAGEdge): void {
    this.edges.push(edge);
  }
}
