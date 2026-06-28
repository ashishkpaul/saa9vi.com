import { ReplayResult } from "./replay-engine";
import { ConvergenceMonitor, ConvergenceReport } from "./convergence-monitor";

export interface Anomaly {
  type: "ordering_violation" | "missing_step" | "convergence_drop" | "duplicate_event" | "late_arrival";
  severity: "low" | "medium" | "high" | "critical";
  lifecycleName: string;
  description: string;
  affectedStep?: string;
  timestamp?: Date;
}

export class AnomalyDetector {
  static detectFromReplay(result: ReplayResult): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // Missing steps
    for (const violation of result.violations) {
      if (violation.startsWith("Missing step:")) {
        const stepName = violation.replace("Missing step: ", "").trim();
        anomalies.push({
          type: "missing_step",
          severity: "high",
          lifecycleName: result.lifecycleName,
          description: `Required step missing from replay: ${stepName}`,
          affectedStep: stepName,
        });
      }

      if (violation.startsWith("Order violation:")) {
        const parts = violation.replace("Order violation: ", "").split(" → ");
        const fromStep = parts[0]?.trim();
        const toStep = parts[1]?.split(" (")[0]?.trim();
        anomalies.push({
          type: "ordering_violation",
          severity: "high",
          lifecycleName: result.lifecycleName,
          description: `Causal order violated: ${violation}`,
          affectedStep: fromStep,
        });
      }
    }

    // Duplicate events
    const stepNames = result.replayedSteps.map(s => s.name);
    const seen = new Set<string>();
    for (const name of stepNames) {
      if (seen.has(name)) {
        anomalies.push({
          type: "duplicate_event",
          severity: "medium",
          lifecycleName: result.lifecycleName,
          description: `Duplicate step detected: ${name}`,
          affectedStep: name,
        });
      }
      seen.add(name);
    }

    // Convergence drops
    const report = ConvergenceMonitor.evaluateReplay(result);
    if (report.score < 80) {
      anomalies.push({
        type: "convergence_drop",
        severity: report.score < 60 ? "critical" : "high",
        lifecycleName: result.lifecycleName,
        description: `Convergence score dropped to ${report.score}`,
      });
    }

    return anomalies;
  }

  static summarize(anomalies: Anomaly[]): { total: number; bySeverity: Record<string, number>; criticalCount: number } {
    const bySeverity: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const anomaly of anomalies) {
      bySeverity[anomaly.severity]++;
    }

    return {
      total: anomalies.length,
      bySeverity,
      criticalCount: bySeverity.critical,
    };
  }
}
