import { CausalityGraphStore } from "./graph-store";
import type { CausalityNode, CausalityEdge } from "./entities/causality-node.entity";

export interface LayerMismatch {
  rule: string;
  staticExpected?: string[];
  inferredFound?: string[];
  runtimeFound?: string[];
  severity: "error" | "warning" | "info";
  message: string;
}

export class LayerReconciler {
  private graphStore: CausalityGraphStore;

  constructor(graphStore: CausalityGraphStore) {
    this.graphStore = graphStore;
  }

  reconcile(): LayerMismatch[] {
    const mismatches: LayerMismatch[] = [];
    const staticLayer = this.graphStore.queryByLayer("static");
    const inferredLayer = this.graphStore.queryByLayer("inferred");
    const runtimeLayer = this.graphStore.queryByLayer("runtime");

    // Compare static expectations against inferred chains
    for (const staticNode of staticLayer.nodes) {
      const staticEdges = staticLayer.edges.filter(e => e.source === staticNode.id);
      const expectedTargets = staticEdges.map(e => e.target);

      const inferredNode = inferredLayer.nodes.find(n => n.name === staticNode.name);
      if (inferredNode) {
        const inferredEdges = inferredLayer.edges.filter(e => e.source === inferredNode.id);
        const inferredTargets = inferredEdges.map(e => e.target);

        const missing = expectedTargets.filter(t => !inferredTargets.includes(t));
        if (missing.length > 0) {
          mismatches.push({
            rule: staticNode.name,
            staticExpected: expectedTargets,
            inferredFound: inferredTargets,
            severity: "warning",
            message: `Static expectation ${staticNode.name} → [${expectedTargets.join(", ")}] not fully matched in inferred layer. Missing: [${missing.join(", ")}]`,
          });
        }
      } else {
        mismatches.push({
          rule: staticNode.name,
          staticExpected: expectedTargets,
          severity: "info",
          message: `Static rule ${staticNode.name} has no inferred counterpart — likely Phase 2/3 feature`,
        });
      }
    }

    // Compare inferred expectations against runtime traces
    for (const inferredNode of inferredLayer.nodes) {
      const runtimeNode = runtimeLayer.nodes.find(n => n.name === inferredNode.name);
      if (!runtimeNode) {
        mismatches.push({
          rule: inferredNode.name,
          inferredFound: inferredLayer.edges.filter(e => e.source === inferredNode.id).map(e => e.target),
          severity: "info",
          message: `Inferred chain for ${inferredNode.name} has no runtime trace — not yet executed in captured runtime`,
        });
      }
    }

    return mismatches;
  }

  getConvergenceScore(): number {
    const mismatches = this.reconcile();
    const errors = mismatches.filter(m => m.severity === "error").length;
    const warnings = mismatches.filter(m => m.severity === "warning").length;

    const totalRules = this.graphStore.getAllNodes().filter(n => n.layer === "static").length;
    if (totalRules === 0) return 100;

    const penalty = errors * 10 + warnings * 5;
    return Math.max(0, 100 - penalty);
  }
}
