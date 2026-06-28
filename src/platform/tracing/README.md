# Runtime Tracing System

Event capture and causality validation layer for the Saa9vi platform.

## Components

- `EventLog` — append-only event record (entity + migration)
- `CorrelationContext` — async-local correlation ID stack
- `EventBusInterceptor` — Vendure EventBus publish hook
- `BullMQTracer` — job lifecycle wrapper
- `WebhookRecorder` — webhook receive/process recorder
- `RuntimeTraceStore` — in-memory trace aggregation
- `RuntimeCausalityValidator` — validates execution order against rules

## Design Notes

- All persistence methods are no-ops by default so production code paths remain non-blocking.
- Production wiring should inject repository dependencies at composition root.
- This is a structural scaffold for true runtime observation; event capture hooks must be wired into actual Vendure/BullMQ/webhook lifecycle events to collect real traces.
