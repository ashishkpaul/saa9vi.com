import { CausalityGraphStore } from "./graph-store";
import type { CausalityNode } from "./entities/causality-node.entity";

export interface QueryOptions {
  startNode?: string;
  endNode?: string;
  layer?: "static" | "inferred" | "runtime";
  maxDepth?: number;
}

export interface QueryResult {
  path: Array<{ node: CausalityNode; edge?: any }>;
  exists: boolean;
  layersTraversed: string[];
}

export class CausalityQueryAPI {
  private graphStore: CausalityGraphStore;

  constructor(graphStore: CausalityGraphStore) {
    this.graphStore = graphStore;
  }

  trace(startId: string, endId: string, maxDepth = 20): CausalityNode[] | null {
    const path = this.graphStore.findPath(startId, endId, maxDepth);
    if (!path) return null;

    const nodes: CausalityNode[] = [];
    let currentId = startId;
    const rootNode = this.graphStore.getNode(currentId);
    if (rootNode) nodes.push(rootNode);

    for (const edge of path) {
      const nextNode = this.graphStore.getNode(edge.target);
      if (nextNode) nodes.push(nextNode);
      currentId = edge.target;
    }

    return nodes;
  }

  explain(nodeId: string): { node: CausalityNode; predecessors: CausalityNode[]; successors: CausalityNode[] } | null {
    const node = this.graphStore.getNode(nodeId);
    if (!node) return null;

    return {
      node,
      predecessors: this.graphStore.getPredecessors(nodeId),
      successors: this.graphStore.getSuccessors(nodeId),
    };
  }

  verify(ruleName: string): { exists: boolean; violations: string[] } {
    const nodes = this.graphStore.getAllNodes();
    const ruleNode = nodes.find(n => n.name === ruleName && n.layer === "static");
    if (!ruleNode) {
      return { exists: false, violations: [`Static rule "${ruleName}" not found`] };
    }

    const edges = this.graphStore.getEdgesFrom(ruleNode.id);
    const violations: string[] = [];

    for (const edge of edges) {
      const targetNode = this.graphStore.getNode(edge.target);
      if (!targetNode) {
        violations.push(`Missing target node: ${edge.target}`);
      } else {
        const inferredEdges = this.graphStore.getEdgesFrom(ruleNode.id).filter(e => e.layer === "inferred");
        const runtimeEdges = this.graphStore.getEdgesFrom(ruleNode.id).filter(e => e.layer === "runtime");

        if (inferredEdges.length === 0) {
          violations.push(`No inferred chain found for ${ruleName}`);
        }
        if (runtimeEdges.length === 0) {
          violations.push(`No runtime trace found for ${ruleName}`);
        }
      }
    }

    return { exists: true, violations };
  }

  getConvergenceReport(): { score: number; mismatches: any[] } {
    const { LayerReconciler } = require("./layer-reconciler");
    const reconciler = new LayerReconciler(this.graphStore);
    const mismatches = reconciler.reconcile();
    const score = reconciler.getConvergenceScore();

    return { score, mismatches };
  }
}
