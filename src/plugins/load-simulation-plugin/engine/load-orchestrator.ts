import { Injectable } from "@nestjs/common";
import { EventBus, VendureEvent } from "@vendure/core";
import { LifecycleStep } from "../../../platform/stress-test/lifecycle-simulator";
import { CausalMapper, GraphQLRequest } from "./causal-mapper";

@Injectable()
export class LoadOrchestrator {
  constructor(private eventBus: EventBus) {}

  async run(lifecycle: LifecycleStep[], profile: LoadProfile): Promise<LoadRunResult> {
    const startTime = Date.now();
    const results: ExecutionResult[] = [];

    const workers: Promise<void>[] = [];

    for (let i = 0; i < profile.concurrency; i++) {
      workers.push(this.executeWorker(i, lifecycle, profile, results));
    }

    await Promise.all(workers);

    const duration = Date.now() - startTime;
    const errors = results.filter(r => !r.success);
    const successCount = results.filter(r => r.success).length;

    return {
      profile: profile.name,
      duration,
      totalRequests: results.length,
      successCount,
      errorCount: errors.length,
      errorRate: results.length > 0 ? errors.length / results.length : 0,
      results,
    };
  }

  private async executeWorker(
    workerId: number,
    lifecycle: LifecycleStep[],
    profile: LoadProfile,
    results: ExecutionResult[],
  ): Promise<void> {
    const workerStart = Date.now();

    while (Date.now() - workerStart < profile.durationMs) {
      for (const step of lifecycle) {
        const request = CausalMapper.map(step);
        const result = await this.executeRequest(request, step);
        results.push(result);

        // Emit event for observability
        this.eventBus.publish(new LoadStepCompletedEvent(workerId, step.name, result.success));

        // Throttle if needed
        if (profile.requestsPerSecond) {
          const delay = 1000 / profile.requestsPerSecond;
          await this.sleep(delay);
        }
      }
    }
  }

  private async executeRequest(request: GraphQLRequest, step: LifecycleStep): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      // Placeholder — in production this would use Vendure's GraphQL client
      await this.simulateExecution(request);
      return {
        step: step.name,
        success: true,
        latencyMs: Date.now() - start,
        error: null,
      };
    } catch (err) {
      return {
        step: step.name,
        success: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async simulateExecution(_request: GraphQLRequest): Promise<void> {
    // Simulate variable latency: 10-100ms
    const latency = 10 + Math.random() * 90;
    await this.sleep(latency);

    // Simulate occasional failures (2% error rate)
    if (Math.random() < 0.02) {
      throw new Error("Simulated execution failure");
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface LoadProfile {
  name: "baseline" | "stress" | "spike" | "soak";
  concurrency: number;
  durationMs: number;
  rampUpMs?: number;
  requestsPerSecond?: number;
}

export interface ExecutionResult {
  step: string;
  success: boolean;
  latencyMs: number;
  error: string | null;
}

export interface LoadRunResult {
  profile: string;
  duration: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  results: ExecutionResult[];
}

export class LoadStepCompletedEvent extends VendureEvent {
  constructor(public workerId: number, public stepName: string, public success: boolean) {
    super();
  }
}
