# Runtime Tracing System

Event capture and causality validation layer for the Saa9vi platform.

## Components (actual wiring — 2026-10-20, execution-plan Phase 3)

- `EventLog` — append-only event record (entity). **Currently has no live
  writers** (the scaffolding that would have written it was deleted; see
  below). The table is retained pending a separate removal decision; it is
  still registered by `BigBlueButtonPlugin` and consumed (type-level) by
  `TraceReconstructionService`.
- `CorrelationContext` — async-local correlation ID stack.
- `CorrelationInterceptor` — request-scoped correlation-ID propagation,
  registered globally as `APP_INTERCEPTOR` by `PlatformTracingModule`
  (imported by `BigBlueButtonPlugin`). This is the only active runtime
  tracing component.
- `RuntimeTraceStore` — in-memory trace aggregation; exposes
  `getAllTraces()` for the validator.
- `RuntimeCausalityValidator` — validates execution order against rules.
  An **empty store reports an explicit no-data warning** ("causality NOT
  verified"), never a pass. Only rules whose event names are actually
  published are configured (currently the Vendure-core
  `PaymentSettledEvent → OrderStateTransitionEvent` chain); speculative
  rules referencing never-emitted event names were removed with the audit.

## Deleted scaffolding (2026-10-20)

`WebhookRecorder`, `BullMQTracer` and `EventBusInterceptor` were provided /
exported but had **zero call sites** and were never wired into any webhook,
job, or EventBus lifecycle. They were deleted rather than wired, per the
execution plan's "default to deleting unused scaffold" rule. The durable
business audit records they would have duplicated (`BbbWebhookEvent`,
`TenantRegistrationLog`, `SubscriptionBillingAttempt`, revocation stamps)
remain the authoritative audit trail and are unaffected.

## Design Notes

- `EventLog` persistence had no live writers even before the deletion (the
  old README's "no-ops by default" description applied). If a real
  EventLog-backed writer is introduced later, wire it and re-evaluate the
  `RuntimeTraceStore` (whose in-memory nature makes the causality checker
  a no-data warning in production until a persisted data source feeds it).
- BBB API call spans (`tracer.startActiveSpan` in `bbb-api.service.ts`)
  use `@opentelemetry/api` directly and are unaffected by this module.
- `@vendure/telemetry-plugin` is NOT installed; adding it is a separate,
  explicitly-approved decision.
