import { Injectable } from "@nestjs/common";
import { EventBus, VendureEvent } from "@vendure/core";
import { LoadOrchestrator, LoadProfile, LoadRunResult } from "../engine/load-orchestrator";
import { LifecycleSimulator } from "../../../platform/stress-test/lifecycle-simulator";
import { DriftDetector, CausalDrift, CausalExpectation } from "../causal/drift-detector";

const CAUSAL_EXPECTATIONS: Record<string, CausalExpectation> = {
  student_purchase: { maxLatency: 800, maxErrorRate: 0.01 },
  bbb_session:      { maxLatency: 1200, maxErrorRate: 0.02 },
  subscription:     { maxLatency: 1000, maxErrorRate: 0.01 },
};

@Injectable()
export class LoadSimulationService {
  constructor(
    private eventBus: EventBus,
    private orchestrator: LoadOrchestrator,
  ) {}

  async run(profileName: string): Promise<LoadReport> {
    const id = `${profileName}-${Date.now()}`;
    this.eventBus.publish(new LoadTestStartedEvent(id, profileName));

    const lifecycles = LifecycleSimulator.getAllLifecycles();
    const lifecycleNames = Object.keys(lifecycles);
    const firstLifecycle = lifecycles[lifecycleNames[0]];

    const profile: LoadProfile = {
      name: profileName as LoadProfile["name"],
      concurrency: 5,
      durationMs: 5000,
    };

    const result = await this.orchestrator.run(firstLifecycle, profile);
    const metrics = result.metrics;

    // Drift detection
    const expectation = CAUSAL_EXPECTATIONS[lifecycleNames[0]] || { maxLatency: 1000, maxErrorRate: 0.05 };
    const detector = new DriftDetector();
    const drift = detector.detect(metrics, expectation);

    return {
      id,
      profile: profileName,
      totalRequests: result.totalRequests,
      successCount: result.successCount,
      errorCount: result.errorCount,
      duration: result.duration,
      metrics: {
        avgLatency: metrics.avgLatency,
        p95: metrics.p95,
        p99: metrics.p99,
        errorRate: metrics.errorRate,
        totalRequests: metrics.totalRequests,
      },
      drift: {
        latencyViolation: drift.latencyViolation,
        errorViolation: drift.errorViolation,
        causalBreak: drift.causalBreak,
        details: drift.details,
      },
    };
  }
}

export interface LoadReport {
  id: string;
  profile: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  duration: number;
  metrics: {
    avgLatency: number;
    p95: number;
    p99: number;
    errorRate: number;
    totalRequests: number;
  };
  drift: CausalDrift;
}

export class LoadTestStartedEvent extends VendureEvent {
  constructor(public testId: string, public profile: string) {
    super();
  }
}
