# Causal Stress Testing System

This module provides deterministic chaos injection, lifecycle replay, and anomaly detection for the Saa9vi causality verification stack.

## Purpose

Validate **causal correctness under failure conditions**:

- Replay business lifecycles with injected chaos (reorder, duplicate, drop)
- Detect ordering violations, missing steps, and convergence degradation
- Compare system resilience across different business flows

## Scope

This is **NOT** a performance load testing system. It does not simulate:

- HTTP/GraphQL traffic
- DB concurrency or connection saturation
- CPU/memory pressure
- Worker queue saturation
- Network latency

It is a **deterministic behavioral stress system** focused on event causality and lifecycle correctness.

## Components

- `ChaosEngine` — fault injection strategies
- `LifecycleSimulator` — canonical business lifecycle definitions
- `ReplayEngine` — deterministic replay with chaos, graph ingestion, violation detection
- `ConvergenceMonitor` — convergence scoring and cross-lifecycle comparison
- `AnomalyDetector` — anomaly classification and summarization

## Usage

```ts
import { ReplayEngine, ChaosEngine, ConvergenceMonitor, AnomalyDetector, LifecycleSimulator } from './platform/stress-test';

const lifecycles = LifecycleSimulator.getAllLifecycles();
for (const name of Object.keys(lifecycles)) {
  const graphStore = new CausalityGraphStore();
  const replayEngine = new ReplayEngine(graphStore, [
    { strategy: 'reorder', probability: 0.3, params: { maxSwaps: 2 } },
    { strategy: 'duplicate', probability: 0.2, params: { maxDuplicates: 1 } },
    { strategy: 'drop', probability: 0.2, params: { maxDrops: 1 } },
  ]);

  const result = replayEngine.replay(name);
  const report = ConvergenceMonitor.evaluateReplay(result);
  const anomalies = AnomalyDetector.detectFromReplay(result);
}
```

## Relationship to Other Modules

- `tracing/` — collects real runtime traces (when wired)
- `causality/` — unified graph store and reconciliation
- `invariants/` — static and design-time checks

This module operates on the **synthetic model layer** to stress-test the causal assumptions encoded in the platform.
