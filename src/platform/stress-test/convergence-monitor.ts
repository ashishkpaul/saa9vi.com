import { ReplayResult } from "./replay-engine";

export interface ConvergenceReport {
  lifecycleName: string;
  score: number;
  violations: string[];
  passed: boolean;
  recommendation: string;
}

export class ConvergenceMonitor {
  static evaluateReplay(result: ReplayResult): ConvergenceReport {
    const score = result.convergenceScore;
    const violations = result.violations;

    let recommendation: string;
    if (score >= 95) {
      recommendation = "System resilient under this chaos profile";
    } else if (score >= 80) {
      recommendation = "Minor degradation detected — review failure paths";
    } else if (score >= 60) {
      recommendation = "Significant stress tolerance gap — investigate ordering assumptions";
    } else {
      recommendation = "Critical: system cannot tolerate this chaos pattern";
    }

    return {
      lifecycleName: result.lifecycleName,
      score,
      violations,
      passed: score >= 80,
      recommendation,
    };
  }

  static compareAcrossReplays(results: ReplayResult[]): { averageScore: number; weakestLifecycle: string; strongestLifecycle: string } {
    if (results.length === 0) {
      return { averageScore: 100, weakestLifecycle: "none", strongestLifecycle: "none" };
    }

    const scores = results.map(r => r.convergenceScore);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;

    let minIdx = 0;
    let maxIdx = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] < scores[minIdx]) minIdx = i;
      if (scores[i] > scores[maxIdx]) maxIdx = i;
    }

    return {
      averageScore: Math.round(average),
      weakestLifecycle: results[minIdx].lifecycleName,
      strongestLifecycle: results[maxIdx].lifecycleName,
    };
  }
}
