import { Injectable } from "@nestjs/common";
import { EventBus, VendureEvent } from "@vendure/core";
import { LifecycleStep } from "../../../platform/stress-test/lifecycle-simulator";
import { CausalMapper, GraphQLRequest } from "./causal-mapper";
import { GraphQLExecutor } from "../executor/graphql.executor";
import { MetricsCollector, LoadMetrics } from "../observability/metrics.collector";

@Injectable()
export class LoadOrchestrator {
  constructor(
    private eventBus: EventBus,
    private executor: GraphQLExecutor,
  ) {}

  async run(lifecycle: LifecycleStep[], profile: LoadProfile): Promise<LoadRunResult> {
    const startTime = Date.now();
    const results: ExecutionResult[] = [];
    const collector = new MetricsCollector();

    const workers: Promise<void>[] = [];

    for (let i = 0; i < profile.concurrency; i++) {
      workers.push(this.executeWorker(i, lifecycle, profile, results, collector));
    }

    await Promise.all(workers);

    const duration = Date.now() - startTime;
    const metrics = collector.report();

    return {
      profile: profile.name,
      duration,
      metrics,
      totalRequests: metrics.totalRequests,
      successCount: metrics.totalRequests - Math.round(metrics.errorRate * metrics.totalRequests),
      errorCount: Math.round(metrics.errorRate * metrics.totalRequests),
      errorRate: metrics.errorRate,
      results,
    };
  }

  private async executeWorker(
    workerId: number,
    lifecycle: LifecycleStep[],
    profile: LoadProfile,
    results: ExecutionResult[],
    collector: MetricsCollector,
  ): Promise<void> {
    const workerStart = Date.now();

    while (Date.now() - workerStart < profile.durationMs) {
      for (const step of lifecycle) {
        const request = CausalMapper.map(step);
        // Skip Phase 2 pending steps gracefully
        if (request.isPending || request.mutation === null) {
          const skipResult: ExecutionResult = {
            step: step.name,
            success: true,
            latencyMs: 0,
            error: null,
          };
          results.push(skipResult);
          collector.record({ latencyMs: 0, success: true });
          this.eventBus.publish(new LoadStepCompletedEvent(workerId, step.name, true));
          continue;
        }
        const result = await this.executeRequest(request);
        results.push(result);
        collector.record({ latencyMs: result.latencyMs, success: result.success });

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

  private async executeRequest(request: GraphQLRequest): Promise<ExecutionResult> {
    if (!request.mutation) {
      return { step: request.context, success: true, latencyMs: 0, error: null };
    }
    const start = Date.now();
    try {
      const result = await this.executor.execute(
        request.mutation,
        request.variables ?? {},
        request.context,
      );
      return {
        step: request.context,
        success: result.success,
        latencyMs: result.latencyMs,
        error: result.errors?.[0]?.message ?? null,
      };
    } catch (err) {
      return {
        step: request.context,
        success: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
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
  requiresMultipleInstances?: boolean;
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
  metrics: LoadMetrics;
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
