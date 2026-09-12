# ADR-038: Direct Razorpay Subscription Provider
**Status:** ✅ ACCEPTED — 2026-09-12

**Date:** 2026-09-09

## Evidence Summary

All acceptance criteria are verified:

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | M1.3 — Razorpay Test Plan + Test Subscription | ✅ | `plan_TaMGQbDDQn7Tir`, `sub_TabaZJZTQzNfWy` |
| 2 | M1.4 — Webhook lifecycle captured | ✅ | HMAC-SHA256, persist-first, 2xx |
| 3 | R1 — Provider-neutral boundary complete | ✅ | `RecurringBillingProvider` interface, both providers |
| 4 | R2-F — Durable processing | ✅ | BullMQ inbox worker, single path |
| 5 | R2-G — Failure semantics | ✅ | pending → retry → failed, `failedAt` |
| 6 | R2-G — Concurrent idempotency | ✅ | UNIQUE(provider, providerEventId) |

## Acceptance Criteria

1. ✅ M1.3 — Razorpay Test Plan + Test Subscription created
2. ✅ M1.4 — Webhook lifecycle captured (subscription.authenticated/activated/charged/halted)
3. ✅ R1 — Provider-neutral boundary complete (SubscriptionRenewalService depends on interface)
4. ✅ R2-F — Durable processing verified (BullMQ inbox worker, failure semantics)
5. ✅ R2-G — Concurrent idempotency verified (DB UNIQUE constraint)
6. ✅ Evidence documented in this ADR

**Accepted:** 2026-09-12 after R2-G integration tests passed (failure path + concurrent idempotency).

## Context

Razorpay explicitly rejected Juspay third-party routing (ticket #20876157):

> "we will discontinue support for third-party routers. We strongly encourage you to integrate directly with Razorpay... we do not accept Juspay for third-party routing."

This makes the Juspay → Razorpay route a poor foundation for production, regardless of whether the gateway can technically be configured.

## Decision

Saa9vi integrates directly with Razorpay for subscription billing, using Razorpay's native Subscriptions product.

### Scope

- Razorpay Subscriptions (plans, subscriptions, automated charging)
- UPI AutoPay / Emandate for recurring debit
- Razorpay Standard Checkout for customer authorization
- Webhook-driven subscription lifecycle

### Domain Ownership

| Razorpay owns | Saa9vi owns |
|---------------|-------------|
| Plan creation | OrganizationSubscription |
| Subscription creation | Entitlement grants |
| Mandate registration | Business state machine |
| Recurring debit execution | Platform dunning rules |
| Payment retries | Tenant notification |
| Webhook emission | Grace period management |
| Token storage (provider) | Subscription analytics |

### Architecture

```text
One-time commerce (Vendure)
    → PaymentMethodHandler
    → Razorpay Orders/Checkout/Refund

Recurring subscriptions (Saa9vi SubscriptionPlugin)
    → RecurringBillingProvider (interface)
    → RazorpaySubscriptionProvider
    → Razorpay Subscriptions API
    → Webhooks → ProviderWebhookInbox → Processor → Entitlement
```

### Provider-Neutral Boundary

```typescript
interface RecurringBillingProvider {
    createSubscription(input: CreateRecurringSubscriptionInput): Promise<ProviderSubscription>;
    getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription>;
    cancelSubscription(providerSubscriptionId: string, options?: CancelSubscriptionOptions): Promise<void>;
    pauseSubscription?(providerSubscriptionId: string): Promise<void>;
    resumeSubscription?(providerSubscriptionId: string): Promise<void>;
}
```

### Webhook Flow

```
Razorpay webhook
    ↓
Verify HMAC-SHA256 signature (raw body bytes)
    ↓
Persist to ProviderWebhookEvent (immutable inbox)
    ↓
Return 200 immediately
    ↓
Queue for async processing
    ↓
Normalize event → SubscriptionBillingAttempt
    ↓
CAS transition → Entitlement update
```

### Explicitly Rejected

- Juspay as production router (Razorpay policy)
- Duplicate recurring billing engine (Razorpay owns scheduling)
- Subscription as Vendure PaymentMethodHandler (wrong abstraction)
- Mirroring Razorpay state enum 1:1 in Saa9vi domain

## Consequences

- Juspay code retained as current implementation (not legacy until Razorpay is production)
- New provider-neutral entities: SubscriptionProviderBinding, SubscriptionBillingAttempt
- Razorpay adapter: RazorpaySubscriptionProvider, RazorpayWebhookProcessor
- Migration required for new entities

## References

- Razorpay Subscriptions: https://razorpay.com/docs/payments/subscriptions
- Razorpay Webhooks: https://razorpay.com/docs/webhooks/subscriptions
- Razorpay Best Practices: https://razorpay.com/docs/webhooks/best-practices
- Vendure Stripe Plugin: https://docs.vendure.io/current/community-plugins/stripe-plugin
- Commits: `9c5478d` through `56cba8d` (provider-neutral boundary + Razorpay adapter + R2-G tests + docs)
- Tests: `webhook-failure-path.e2e-spec.ts`, `webhook-concurrent-idempotency.e2e-spec.ts`
