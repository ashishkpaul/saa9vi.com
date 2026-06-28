# BUG-006: Vendure Load Testing + Observability Module

## Status

Implemented (production-hardened specification)

## Context

BUG-006 was initiated to address the gap between causal simulation (BUG-005) and real Vendure runtime behavior under load. The system requires a mechanism to validate that causal correctness holds not just in theory, but under production-like traffic pressure.

## Problem Statement

The Saa9vi platform possesses:

- A static invariant verification system (BUG-001)
- An event-chain inference layer (BUG-002)
- A runtime tracing system (BUG-003)
- A unified causality graph engine (BUG-004)
- A causal stress testing system (BUG-005)

However, none of these components execute real Vendure runtime paths. The platform could not answer:

- Does causal correctness hold under real GraphQL traffic?
- What is the actual latency distribution of business lifecycles?
- Where do causal assumptions break under concurrent load?
- What is the error rate and failure mode under stress?

## Solution

BUG-006 introduces a Vendure-native load testing and observability subsystem with four layers:

### Layer 1: Execution Layer

- `VendureHttpClient` — real HTTP transport to shop/admin APIs
- `GraphQLExecutor` — wraps HTTP client with latency measurement and success/failure capture

### Layer 2: Load Orchestration Layer

- `LoadOrchestrator` — concurrency management, lifecycle execution, throttling, worker coordination
- `LoadProfile` — baseline/stress/spike/soak profiles with concurrency, duration, and ramp-up

### Layer 3: Observability Layer

- `MetricsCollector` — totalRequests, errorRate, avgLatency, p95, p99
- `LoadStepCompletedEvent` — EventBus emission per step for correlation

### Layer 4: Causal Drift Layer

- `DriftDetector` — compares runtime metrics against causal expectations from BUG-005
- `CausalExpectation` — maxLatency, maxErrorRate thresholds

## Architecture

```
GraphQL Request (runLoadTest)
        ↓
LoadSimulationService
        ↓
LoadOrchestrator
        ↓
CausalMapper (BUG-005 mapping)
        ↓
GraphQLExecutor (REAL HTTP CALL)
        ↓
Vendure Core (Resolvers → DB → EventBus → Workers)
        ↓
MetricsCollector
        ↓
DriftDetector
        ↓
LoadReport
```

## Key Design Principles

1. **Real Execution Only** — All load testing MUST use actual Shop/Admin APIs via HTTP transport. No simulation in production mode.
2. **System Under Test is Vendure Core** — GraphQL resolvers, TypeORM transactions, EventBus, BullMQ workers, DB performance.
3. **Observability First** — Every execution emits latency, success/failure, correlationId, execution context, lifecycle step mapping.
4. **Causality is a First-Class Metric** — System correctness = function(static + runtime + load execution consistency).

## Module Structure

```
src/plugins/load-simulation-plugin/
├── load-simulation.plugin.ts
├── api/
│   ├── load-simulation.service.ts
│   └── load-simulation.resolver.ts
├── engine/
│   ├── causal-mapper.ts
│   └── load-orchestrator.ts
├── executor/
│   ├── vendure-http.client.ts
│   └── graphql.executor.ts
├── observability/
│   └── metrics.collector.ts
├── causal/
│   └── drift-detector.ts
```

## Integration Points (Allowed)

- Shop API GraphQL
- Admin API GraphQL
- EventBus
- Job Queue system (BullMQ)
- TypeORM transaction layer

## Integration Points (Forbidden)

- Direct DB manipulation
- Mock execution
- Bypassing GraphQL layer
- Bypassing EventBus

## Load Profiles

| Profile  | Behavior                  |
|----------|---------------------------|
| baseline | normal traffic simulation |
| stress   | sustained high load       |
| spike    | sudden burst traffic      |
| soak     | long-duration stability   |

## Metrics Model

### Latency

- avg latency
- p95 latency
- p99 latency

### Reliability

- error rate
- failure distribution

### Throughput

- requests per second
- worker throughput

### Causal Drift

- latency violations vs expectation
- error threshold violations
- causal mismatch signals

## Load Report Output

```ts
interface LoadReport {
  profile: LoadProfile;
  metrics: LoadMetrics;
  drift: CausalDrift;
  duration: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
}
```

## System Guarantees

- **Execution validity** — Real Vendure execution is always used
- **Observability completeness** — Every request is measured
- **Causal consistency validation** — BUG-005 vs BUG-006 comparison enforced
- **Reproducibility** — Same lifecycle + profile = comparable results

## Relationship to Other Bugs

```
BUG-001 → Structural correctness (ADRs)
BUG-002 → Intent causality model (events)
BUG-003 → Runtime tracing (interceptors)
BUG-004 → Unified causality graph (reconciliation)
BUG-005 → Chaos + simulation correctness (replay)
BUG-006 → Real system load + drift validation (THIS)
```

## Future Extensions

- DB query pressure monitoring
- EventBus delay measurement
- Job queue lag tracking
- Real-time causal drift streaming
- Multi-tenant load isolation validation
