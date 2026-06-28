import { CausalityNode, CausalityEdge, CausalityNodeType, CausalityEdgeType } from "./entities/causality-node.entity";

export class CausalityGraphStore {
  private nodes: Map<string, CausalityNode> = new Map();
  private edges: Map<string, CausalityEdge> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map();

  addNode(node: CausalityNode): void {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: CausalityEdge): void {
    this.edges.set(edge.id, edge);
    const sourceEdges = this.adjacencyList.get(edge.source) || new Set();
    sourceEdges.add(edge.target);
    this.adjacencyList.set(edge.source, sourceEdges);
  }

  getNode(id: string): CausalityNode | undefined {
    return this.nodes.get(id);
  }

  getEdgesFrom(sourceId: string): CausalityEdge[] {
    const targets = this.adjacencyList.get(sourceId) || new Set();
    const result: CausalityEdge[] = [];
    for (const targetId of targets) {
      for (const edge of this.edges.values()) {
        if (edge.source === sourceId && edge.target === targetId) {
          result.push(edge);
        }
      }
    }
    return result;
  }

  getEdgesTo(targetId: string): CausalityEdge[] {
    return Array.from(this.edges.values()).filter(e => e.target === targetId);
  }

  getPredecessors(nodeId: string): CausalityNode[] {
    const incoming = this.getEdgesTo(nodeId);
    return incoming.map(e => this.nodes.get(e.source)).filter((n): n is CausalityNode => n !== undefined);
  }

  getSuccessors(nodeId: string): CausalityNode[] {
    const outgoing = this.getEdgesFrom(nodeId);
    const ids = new Set(outgoing.map(e => e.target));
    return Array.from(ids).map(id => this.nodes.get(id)).filter((n): n is CausalityNode => n !== undefined);
  }

  findPath(startId: string, endId: string, maxDepth = 20): CausalityEdge[] | null {
    const visited = new Set<string>();
    const queue: { nodeId: string; path: CausalityEdge[] }[] = [{ nodeId: startId, path: [] }];

    while (queue.length > 0 && maxDepth > 0) {
      const { nodeId, path } = queue.shift()!;
      if (nodeId === endId) return path;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const outgoing = this.getEdgesFrom(nodeId);
      for (const edge of outgoing) {
        if (!visited.has(edge.target)) {
          queue.push({ nodeId: edge.target, path: [...path, edge] });
        }
      }
      maxDepth--;
    }

    return null;
  }

  getAllNodes(): CausalityNode[] {
    return Array.from(this.nodes.values());
  }

  getAllEdges(): CausalityEdge[] {
    return Array.from(this.edges.values());
  }

  queryByLayer(layer: "static" | "inferred" | "runtime"): { nodes: CausalityNode[]; edges: CausalityEdge[] } {
    const nodes = this.getAllNodes().filter(n => n.layer === layer);
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = this.getAllEdges().filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { nodes, edges };
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.adjacencyList.clear();
  }
}
