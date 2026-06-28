export interface LoadMetrics {
  totalRequests: number;
  errorRate: number;
  p95: number;
  p99: number;
  avgLatency: number;
}

export class MetricsCollector {
  private latencies: number[] = [];
  private errors = 0;
  private total = 0;

  record(result: { latencyMs: number; success: boolean }): void {
    this.total++;
    this.latencies.push(result.latencyMs);

    if (!result.success) this.errors++;
  }

  report(): LoadMetrics {
    if (this.total === 0) {
      return {
        totalRequests: 0,
        errorRate: 0,
        p95: 0,
        p99: 0,
        avgLatency: 0,
      };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p95Idx = Math.floor(0.95 * sorted.length);
    const p99Idx = Math.floor(0.99 * sorted.length);

    return {
      totalRequests: this.total,
      errorRate: this.errors / this.total,
      p95: sorted[p95Idx] || 0,
      p99: sorted[p99Idx] || 0,
      avgLatency: this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length,
    };
  }

  reset(): void {
    this.latencies = [];
    this.errors = 0;
    this.total = 0;
  }
}
