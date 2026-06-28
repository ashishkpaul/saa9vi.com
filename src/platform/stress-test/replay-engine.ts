import { LifecycleSimulator, LifecycleStep } from "./lifecycle-simulator";
import { ChaosEngine, ChaosConfig } from "./chaos-engine";
import { CausalityGraphStore } from "../causality/graph-store";

export interface ReplayResult {
  lifecycleName: string;
  originalSteps: LifecycleStep[];
  replayedSteps: LifecycleStep[];
  chaosApplied: ChaosConfig[];
  violations: string[];
  convergenceScore: number;
}

export class ReplayEngine {
  private graphStore: CausalityGraphStore;
  private chaosConfigs: ChaosConfig[];

  constructor(graphStore: CausalityGraphStore, chaosConfigs: ChaosConfig[] = []) {
    this.graphStore = graphStore;
    this.chaosConfigs = chaosConfigs;
  }

  replay(lifecycleName: string): ReplayResult {
    const lifecycles = LifecycleSimulator.getAllLifecycles();
    const steps = lifecycles[lifecycleName];

    if (!steps) {
      throw new Error(`Unknown lifecycle: ${lifecycleName}`);
    }

    // Simulate deterministic replay IDs
    const replayedSteps: LifecycleStep[] = steps.map((step, idx) => ({
      ...step,
      payload: {
        ...step.payload,
        replayId: `${lifecycleName}-${idx}-${Date.now()}`,
        originalIndex: idx,
      },
    }));

    // Apply chaos to the sequence if configured
    const chaosApplied: ChaosConfig[] = [];
    let finalSteps: LifecycleStep[] = [...replayedSteps];

    if (this.chaosConfigs.length > 0) {
      const chaosResult = ChaosEngine.apply<LifecycleStep>(replayedSteps, this.chaosConfigs);
      finalSteps = chaosResult;
      chaosApplied.push(...this.chaosConfigs);
    }

    // Ingest into graph store as runtime layer
    for (const step of finalSteps) {
      const nodeId = `${step.name}-${Date.now()}-${Math.random()}`;
      this.graphStore.addNode({
        id: nodeId,
        type: "event",
        name: step.eventType,
        layer: "runtime",
        properties: { ...step.payload, lifecycleName },
      });
    }

    // Link sequential events
    const allNodes = this.graphStore.getAllNodes().filter(n => n.layer === "runtime");
    for (let i = 0; i < allNodes.length - 1; i++) {
      this.graphStore.addEdge({
        id: `replay-${allNodes[i].id}-${allNodes[i + 1].id}`,
        source: allNodes[i].id,
        target: allNodes[i + 1].id,
        type: "follows",
        layer: "runtime",
        properties: { lifecycleName },
      });
    }

    const violations = this.detectViolations(steps, finalSteps);
    const convergenceScore = this.computeConvergenceScore(violations, steps.length);

    return {
      lifecycleName,
      originalSteps: steps,
      replayedSteps: finalSteps,
      chaosApplied,
      violations,
      convergenceScore,
    };
  }

  private detectViolations(original: LifecycleStep[], replayed: LifecycleStep[]): string[] {
    const violations: string[] = [];
    const replayedNames = replayed.map(s => s.name);

    for (const step of original) {
      if (!replayedNames.includes(step.name)) {
        violations.push(`Missing step: ${step.name}`);
      }
    }

    for (let i = 0; i < replayed.length; i++) {
      const step = replayed[i];
      const originalIdx = original.findIndex(s => s.name === step.name);
      if (originalIdx !== -1 && i < original.length - 1) {
        const nextOriginal = original[originalIdx + 1];
        const nextReplayed = replayed[i + 1];
        if (nextReplayed && nextReplayed.name !== nextOriginal.name) {
          violations.push(
            `Order violation: ${step.name} → ${nextReplayed.name} (expected ${nextOriginal.name})`
          );
        }
      }
    }

    return violations;
  }

  private computeConvergenceScore(violations: string[], totalSteps: number): number {
    if (totalSteps === 0) return 100;
    const penalty = violations.length * 10;
    return Math.max(0, 100 - penalty);
  }
}
