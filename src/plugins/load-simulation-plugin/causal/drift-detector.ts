export interface CausalDrift {
  latencyViolation: boolean;
  errorViolation: boolean;
  causalBreak: boolean;
  details: string[];
}

export interface CausalExpectation {
  maxLatency: number;
  maxErrorRate: number;
}

export class DriftDetector {
  detect(metrics: { p95: number; errorRate: number }, expectation: CausalExpectation): CausalDrift {
    const latencyViolation = metrics.p95 > expectation.maxLatency;
    const errorViolation = metrics.errorRate > expectation.maxErrorRate;
    const details: string[] = [];

    if (latencyViolation) {
      details.push(`p95 latency ${metrics.p95.toFixed(1)}ms exceeds threshold ${expectation.maxLatency}ms`);
    }

    if (errorViolation) {
      details.push(`error rate ${(metrics.errorRate * 100).toFixed(1)}% exceeds threshold ${(expectation.maxErrorRate * 100).toFixed(1)}%`);
    }

    return {
      latencyViolation,
      errorViolation,
      causalBreak: latencyViolation || errorViolation,
      details,
    };
  }
}
