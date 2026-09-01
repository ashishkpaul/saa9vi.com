# RFC-001: Continuous Commerce Loop (Phase 2 — Subscription Billing)

**Status:** Draft v3
**Date:** 2026-06
**Authors:** Lead Architect, Platform Engineering
**Supersedes:** RFC-001 v2 (2026-06)
**Phase 1 Reference:** `platform-adr.md` v1.6 (authoritative ground truth)

---

> **What changed in v2:** Six assessment findings from peer review incorporated. (1) Q-009 (`GrantReaderService` union gap) and Q-010 (notification transport for dunning events) formalised in Section 7. (2) ASCII FSM diagram updated to include `CANCELLED` as explicit terminal box. (3) `SubscriptionInvoice` idempotency protection specified — `UNIQUE` constraint on `(enrollmentId, periodStart)` with `status = 'paid'` guard. (4) Recovery path period-end recalculation rule committed: original-cycle-anchor semantics (see Section 4.3). (5) Phase 1 reference updated to ADR v1.5. (6) Appendix C added — Phase 3 marketplace integration points for subscription tenants.
>
> **What changed in v3:** Capacity Intelligence System integration points added. (1) Appendix C-4: `RecurringCapacityGrant` in capacity forecasts — `CapacityIntelligenceService.buildForecast()` adds trailing 4-week attendee-minute signal for subscription academies with sparse scheduled session data; reads from `BbbUsageLedger WHERE enrollmentId IS NOT NULL`. (2) Appendix C-5: `GrantReaderService` (Q-009 resolution) must expose `getRemainingMinutes(organizationId)` consumed by `CapacityIntelligenceService` to reflect subscription quota headroom in pool dashboard. Phase 1 reference updated to ADR v1.6.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Proposed Entities](#2-proposed-entities)
3. [Event Architecture](#3-event-architecture)
4. [BullMQ Job Topology](#4-bullmq-job-topology)
5. [Juspay Integration Delta](#5-juspay-integration-delta)
6. [Failure Modes & Invariants](#6-failure-modes--invariants)
7. [Open Questions](#7-open-questions)


---

## 1. Problem Statement

### 1.1 The Phase 1 Fulfillment Gap

Phase 1 (current) models commerce as a **transactional event**: a student clicks "Buy", the order reaches `PaymentSettled`, and a `BbbOrderFulfillmentListener` creates a static `Entitlement` or `Enrollment` row. This model works for:

- One-time session purchases (`bbb_session` entitlement)
- Prepaid room access (`bbb_room` entitlement, `BbbEnrollment`)
- Admin-issued capacity grants (`BbbCapacityGrant`)

**It does not work for recurring billing** because:

| Dimension | Phase 1 Model | Requirement for Subscriptions |
|---|---|---|
| Trigger | User-initiated order | System-initiated time window |
| Access duration | Static `validFrom`/`validUntil` | Continuously evaluated |
| Payment model | One-time `PaymentSettled` | Recurring on billing cycle |
| Failure handling | N/A (payment precedes access) | Dunning + grace + suspension |
| Billing truth | `OrderLine` (snapshot at purchase) | `UsageLedger` (accumulated over time) |

### 1.2 The Cron-vs-Click Distinction

The fundamental shift is:

> Phase 1: **Student clicks → system responds**
> Phase 2: **Time advances → system acts → student state evolves**

This means the platform becomes an **always-on operator** — it must:

1. Know when each subscription's billing cycle ends
2. Attempt payment automatically
3. Handle payment failure with a retry policy
4. Grant or revoke access based on payment outcome **without a student action**
5. Reconcile usage against subscription quota at billing boundaries

### 1.3 Why Not Vendure's Built-in Subscriptions

Vendure 3.x does not ship a subscription engine. Its `PaymentMethod` system assumes one-time payments. Adding recurring logic via custom `PaymentMethodHandler` extensions is fragile because:

- No native concept of a billing cycle
- No retry/dunning state machine
- No separation between subscription identity and payment attempt
- No quota-based usage tracking against a subscription plan

Therefore, subscriptions are a **first-domain construct** in the BBB plugin, with its own entities, events, and job topology.

---

## 2. Proposed Entities

### 2.1 Entity Relationship Map

```
Phase 1 (existing)              Phase 2 (new)
==================              ==============

Channel ─── 1:N ──→ SubscriptionPlan
                       │
                       │ 1:N
                       ▼
BbbOrganization ── 1:N ──→ SubscriptionEnrollment
                       │       │
                       │       │ 1:N
                       │       ▼
                       │   SubscriptionInvoice
                       │       │
                       │       ▼
                       │   UsageLedgerEntry
                       │       (Phase 1 BbbUsageLedger
                       │        is the model; this
                       │        extends to subscription
                       │        context)
                       │
BbbCapacityGrant ── 1:N ──→ RecurringCapacityGrant
                       │       (extends concept with
                       │        subscription linkage)
                       │
BbbEntitlement ────── 1:N ──→ SubscriptionEntitlement
                               (derived state, not
                                persisted separately —
                                computed at query time)
```

### 2.2 Entity Specifications

---

#### `SubscriptionPlan`

**Relationship to Phase 1:** Net-new entity. References `Channel` (existing Vendure entity) to scope plans per tenant. A `Channel` may have N plans.

**Purpose:** Defines a purchasable subscription offering — what the student pays and what they get.

```typescript
interface SubscriptionPlan {
  id: ID;
  channelId: string;               // FK → Channel.id (scalar, not ChannelAware join table)
                                   // Rationale: plans are tenant-scoped but not data-scoped
                                   // the way tenant entities are — they're catalogue entries
  name: string;                    // e.g. "Monthly Unlimited"
  slug: string;                    // unique within channel
  description: string;

  // Pricing
  amount: number;                  // in paise (₹) — integer avoids float rounding
  currency: string;                // "INR"
  billingInterval: 'weekly' | 'monthly' | 'quarterly' | 'annual';
  billingIntervalCount: number;    // e.g. 1 = every month, 3 = every 3 months

  // Quota
  includedMinutes: number;         // 0 = unlimited (subject to fair use)
  maxConcurrentMeetings: number;   // cap per meeting (not per org — per subscription)
  recordingIncluded: boolean;

  // Trial
  trialDays: number;               // 0 = no trial

  // State
  isActive: boolean;
  sortOrder: number;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}
```

**Key decision:** `SubscriptionPlan` uses a scalar `channelId` rather than `ChannelAware`. Rationale — plans are catalogue items that a tenant admin configures; they don't participate in the access-control join table. The `channelId` enables channel-scoped queries without the multi-join overhead. This follows the `InstructorProfile` pattern (DL-010).

---

#### `SubscriptionEnrollment`

**Relationship to Phase 1:** Analogous to `BbbEnrollment` but for subscriptions. References `BbbOrganization` (the tenant entity) and `Customer` (existing Vendure entity). Replaces the concept of a static `BbbCapacityGrant` for subscription customers.

**Purpose:** Records that a specific customer has subscribed to a specific plan for a specific organization. This is the **identity record** — it lives until cancelled or lapsed.

```typescript
interface SubscriptionEnrollment {
  id: ID;

  // Phase 1 references
  organizationId: string;          // FK → BbbOrganization.id
  customerId: string;              // FK → Customer.id
  planId: string;                  // FK → SubscriptionPlan.id

  channelId: string;               // denormalized from plan

  // Lifecycle
  status: SubscriptionStatus;      // see FSM in section 4.2
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelledAt: Date | null;

  // Trial
  trialEndsAt: Date | null;

  // Dunning
  dunningState: DunningState | null;  // null = not in dunning
  dunningAttempts: number;         // 0–4 (see FSM in section 4.2)
  dunningLastAttemptAt: Date | null;
  dunningResumeAt: Date | null;    // when grace period ends / next retry

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  version: number;                 // optimistic lock — prevent concurrent renewal writes
}
```

**Key decision:** `version` column for optimistic locking. Two concurrent BullMQ workers must never double-renew the same enrollment.

---

#### `SubscriptionInvoice`

**Relationship to Phase 1:** Net-new. References `SubscriptionEnrollment` and `Order` (existing Vendure entity). Each successful renewal produces one invoice and one Order (for Vendure's ledger).

**Purpose:** Immutable record of each billing event in a subscription's lifetime.

```typescript
interface SubscriptionInvoice {
  id: ID;
  enrollmentId: string;            // FK → SubscriptionEnrollment.id
  orderId: string | null;          // FK → Order.id (Vendure order for this period)
  periodStart: Date;
  periodEnd: Date;
  amount: number;                  // paise
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  paidAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
}
```

**Key decision:** `orderId` is nullable — invoices are created before payment succeeds. This separates the subscription domain from Vendure's order domain. The Order is only created when payment settles.

> **Important:** The Vendure `Order` created by `renewal-succeeded` is a **programmatic order** - it is created by the system, not by a storefront checkout. To keep reporting clean, this order should be distinguished from storefront checkout orders via a custom field (e.g., `Order.customFields.orderType: 'subscription_renewal' | 'storefront_checkout'`) or a dedicated channel-specific origin code. This prevents subscription renewal orders from being counted as new student acquisitions in analytics and avoids interference with storefront order lifecycle hooks.

---

#### `RecurringCapacityGrant`

**Relationship to Phase 1:** Extends `BbbCapacityGrant` concept. Phase 1 grants are admin-issued or one-time purchase grants. `RecurringCapacityGrant` adds subscription linkage.

**Purpose:** A grant that auto-renews with the subscription. Each billing cycle, a new grant window is created.

```typescript
interface RecurringCapacityGrant {
  id: ID;
  enrollmentId: string;            // FK → SubscriptionEnrollment.id

  // Extends BbbCapacityGrant semantics:
  grantedMinutes: number;          // from plan.includedMinutes
  consumedMinutes: number;         // updated by meeting reconciliation
  validFrom: Date;
  validUntil: Date;                // matches billing period end
  exhausted: boolean;

  // Subscription-specific:
  invoiceId: string;               // FK → SubscriptionInvoice.id
  source: 'subscription_renewal' | 'trial' | 'proration';
}
```

**Key decision:** `RecurringCapacityGrant` is a **separate entity** from `BbbCapacityGrant` rather than a discriminator on it. Rationale:
- Phase 1 grants are written by `BbbOrderFulfillmentListener` — changing that code path would violate the "Phase 1 is never modified" constraint
- The subscription grant lifecycle (auto-create on renewal, expire on cancellation) differs from manual grants
- `BbbReconciliationService.consumeGrant()` (Phase 1) reads specifically from `BbbCapacityGrant` by `meeting.grantId` — it does **not** natively union with `RecurringCapacityGrant`. This creates a load-bearing gap that must be resolved before Phase 2 ships

**⚠️ Open Seam:** Phase 2 must add a `GrantReaderService` that unions both `BbbCapacityGrant` and `RecurringCapacityGrant` tables before calling `consumeGrant()`, OR modify `consumeGrant()` to accept an abstract grant interface. The former is preferred to avoid touching Phase 1 code. See [Q-009](#q-009-consumeGrant-union-gap).

---

#### `UsageLedgerEntry` (Subscription Context)

**Relationship to Phase 1:** `BbbUsageLedger` is the Phase 1 model. Subscription usage is recorded in the **same** `BbbUsageLedger` table, with a new nullable FK `enrollmentId`.

**Decision:** Add `enrollmentId: string | null` column to `BbbUsageLedger`. Existing rows (`enrollmentId = null`) are Phase 1 consumption. New subscription rows reference the enrollment.

**Rationale for modifying BbbUsageLedger (only exception to "Phase 1 untouched"):**
- `BbbUsageLedger` is an append-only immutable ledger (INV-002, INV-005). Its schema must accommodate both modes.
- A separate `SubscriptionUsageLedger` table would force union queries for billing reports.
- The FK is nullable — existing rows are unaffected. No migration backfill needed.

```typescript
// Modified BbbUsageLedger (add one nullable column only)
interface BbbUsageLedger {
  // ... existing columns unchanged ...
  enrollmentId: string | null;     // NEW — FK → SubscriptionEnrollment.id
                                   // null = Phase 1 one-time purchase consumption
}
```

---

#### `SubscriptionEntitlement` (Derived State)

**Relationship to Phase 1:** NOT a persisted entity. It is a **runtime computation** that answers the question "does this customer currently have access?"

**Computed at query time:**

```
hasSubscriptionAccess(customerId, organizationId): boolean =
  ∃ enrollment WHERE
    enrollment.customerId = :customerId
    AND enrollment.organizationId = :organizationId
    AND enrollment.status IN ('active', 'in_grace')
    AND enrollment.currentPeriodStart <= now()
    AND enrollment.currentPeriodEnd >= now()
```

This plugs directly into `BbbEntitlementService.hasAccess()` (Phase 1) as a third check path alongside `bbb_session` and `bbb_room` entitlements.

**Rationale:** Persisting subscription entitlement would create drift between billing state and access state. Computing from the enrollment record ensures they are always consistent.


---

## 3. Event Architecture

### 3.1 New Events

```typescript
// Published when a new subscription enrollment is created
// (student completes checkout for a subscription plan)
export class SubscriptionCreatedEvent extends VendureEvent {
  constructor(
    public readonly enrollmentId: string,
    public readonly customerId: string,
    public readonly organizationId: string,
    public readonly planId: string,
    public readonly trialEndsAt: Date | null,
  ) { super(); }
}

// Published when a renewal payment succeeds
export class SubscriptionRenewedEvent extends VendureEvent {
  constructor(
    public readonly enrollmentId: string,
    public readonly invoiceId: string,
    public readonly orderId: string,
    public readonly periodStart: Date,
    public readonly periodEnd: Date,
    public readonly grantedMinutes: number,
  ) { super(); }
}

// Published when a renewal payment fails
export class SubscriptionPaymentFailedEvent extends VendureEvent {
  constructor(
    public readonly enrollmentId: string,
    public readonly invoiceId: string,
    public readonly attemptNumber: number,
    public readonly nextRetryAt: Date | null,
    public readonly failureReason: string,
  ) { super(); }
}

// Published when a subscription enters grace period (all retries exhausted)
export class SubscriptionGracePeriodStartedEvent extends VendureEvent {
  constructor(
    public readonly enrollmentId: string,
    public readonly customerId: string,
    public readonly organizationId: string,
    public readonly graceEndsAt: Date,
  ) { super(); }
}

// Published when grace period expires without payment
export class SubscriptionSuspendedEvent extends VendureEvent {
  constructor(
    public readonly enrollmentId: string,
    public readonly customerId: string,
    public readonly organizationId: string,
    public readonly reason: 'payment_failed' | 'cancelled',
  ) { super(); }
}

// Published when a previously-suspended subscription is recovered
export class SubscriptionRecoveredEvent extends VendureEvent {
  constructor(
    public readonly enrollmentId: string,
    public readonly customerId: string,
    public readonly organizationId: string,
    public readonly outstandingInvoiceId: string | null,
  ) { super(); }
}

// Published when customer cancels (at period end, not immediately)
export class SubscriptionCancelledEvent extends VendureEvent {
  constructor(
    public readonly enrollmentId: string,
    public readonly customerId: string,
    public readonly organizationId: string,
    public readonly effectiveAt: Date,
  ) { super(); }
}

// Published when subscription usage approaches quota limit
export class SubscriptionQuotaWarningEvent extends VendureEvent {
  constructor(
    public readonly enrollmentId: string,
    public readonly customerId: string,
    public readonly consumedMinutes: number,
    public readonly includedMinutes: number,
    public readonly threshold: '80_percent' | '100_percent',
  ) { super(); }
}
```

### 3.2 Reused Phase 1 Events

| Event | Reuse Decision | Rationale |
|---|---|---|
| `GrantConsumedEvent` | Reused as-is | Meeting consumption identical regardless of grant source. |
| `CapacityExhaustedEvent` | Reused as-is | Fires when subscription-period grant is exhausted mid-cycle. |
| `MeetingCompletedEvent` | Reused as-is | Usage ledger write path is identical. |

### 3.3 Extended Phase 1 Handler

`BbbOrderFulfillmentListener` gains subscription plan detection: existing path creates `BbbEntitlement` for one-time purchases; for subscription plans it creates `SubscriptionEnrollment` instead.

**Detection mechanism (required implementation decision):** The listener must determine whether a purchased `ProductVariant` belongs to a subscription plan. Three options exist:

| Option | Approach | Pros | Cons |
|---|---|---|---|
| **A (Recommended)** | `ProductVariant` custom field `isSubscription: boolean` | Simple boolean check; no extra join; fast path in listener | Requires a Phase 1 schema migration (add custom field); product admin must set the flag |
| **B** | Lookup against `SubscriptionPlan` by `productVariantId` | No schema change to Phase 1 entities | Requires a DB query per line item in the hot path; `SubscriptionPlan` needs a `productVariantId` column or join table |
| **C** | Register a separate `FulfillmentHandler` for subscription SKUs | Clean separation; no conditional logic in existing listener | Requires Vendure fulfillment handler extension; more moving parts |

**Recommendation:** Option A. Add a nullable `isSubscription` custom field to Vendure's `ProductVariant` entity via custom fields config. The `BbbOrderFulfillmentListener` checks `line.productVariant.customFields.isSubscription` — if `true`, branches to `SubscriptionService.createEnrollment()` instead of `EntitlementService.create()`. This follows the established Phase 1 pattern (session vs. room detection already uses `productVariantId`).

**Fallback:** If Phase 1 schema changes are prohibited, Option B with a cached lookup (Redis) mitigates the per-query cost.


---

## 4. BullMQ Job Topology

### 4.1 Queue Structure

```
Queue: subscription-renewal-scheduler
  └── Job: process-renewals (cron: daily at 02:00 IST)
        └── Scans: enrollment WHERE status = 'active' AND currentPeriodEnd <= now()
        └── For each: enqueue individual renewal job

Queue: subscription-renewal              (concurrency: 5)
  ├── Job: renew-{enrollmentId}
  │     └── Load enrollment + plan
  │     └── Check optimistic lock (version)
  │     └── Create SubscriptionInvoice (status: pending)
  │     └── Attempt Juspay payment
  │     └── On success: enqueue succeeded job
  │     └── On failure: enqueue failed job
  │
  ├── Job: renewal-succeeded-{enrollmentId}
  │     └── Mark invoice paid
  │     └── Create RecurringCapacityGrant
  │     └── Create Vendure Order (for accounting)
  │     └── Publish SubscriptionRenewedEvent
  │
  └── Job: renewal-failed-{enrollmentId}
        └── Increment dunningAttempts
        └── Advance dunning FSM
        └── Schedule next retry

Queue: subscription-dunning              (concurrency: 3)
  └── Job: dunning-retry-{enrollmentId}  (delayed jobs)
        └── Attempt payment on outstanding invoice
        └── On success: publish SubscriptionRecoveredEvent
        └── On failure: advance FSM, schedule next retry or enter grace

Queue: subscription-grace-expiry         (concurrency: 2)
  └── Job: grace-expired-{enrollmentId}  (delayed, scheduled when grace starts)
        └── Check if payment recovered
        └── If not: suspend enrollment
        └── Publish SubscriptionSuspendedEvent

**Idempotency across cron runs:** The job ID format renew-{enrollmentId}-{periodStart.getTime()} (INV-SUB-002) handles the edge case where the daily cron at 02:00 IST scans an enrollment whose renewal job is still queued or executing from the previous day's run (e.g., Juspay was down for 24+ hours). BullMQ's built-in deduplication by jobId prevents a duplicate renewal job from being enqueued. The idempotency key is deterministic because periodStart is derived from the enrollment's immutable currentPeriodStart — it does not drift. See INV-SUB-002.

### 4.2 Dunning FSM (States + Transitions)

```
                  ┌──────────────────────────────────────────┐
                  │                                          │
                  ▼                                          │
         ┌────────────────┐                                  │
    ────→│  ACTIVE        │  (normal billing)                │
         └───────┬────────┘                                  │
                 │                                            │
                 │ payment fails (1st attempt)                │
                 ▼                                            │
         ┌────────────────┐                                  │
         │  RETRY_1       │  D+1                             │
         │  (day 1 retry) │────────────────┐                 │
         └───────┬────────┘                │                 │
                 │                          │ payment        │
                 │ payment fails            │ succeeds       │
                 ▼                          │                 │
         ┌────────────────┐                 │                 │
         │  RETRY_2       │  D+3            ├──→ back to     │
         │  (day 3 retry) │─────┐           │    ACTIVE      │
         └───────┬────────┘     │           │                 │
                 │               │           │                 │
                 │ payment fails │           │                 │
                 ▼               │           │                 │
         ┌────────────────┐     │           │                 │
         │  RETRY_3       │  D+5│           │                 │
         │  (day 5 retry) │──┐  │           │                 │
         └───────┬────────┘  │  │           │                 │
                 │            │  │           │                 │
                 │ payment    │  │           │                 │
                 │ fails      │  │           │                 │
                 ▼            │  │           │                 │
         ┌────────────────┐  │  │           │                 │
         │  RETRY_4       │  D+7            │                 │
         │  (day 7 retry) │──┘  │           │                 │
         └───────┬────────┘     │           │                 │
                 │              │           │                 │
                 │ payment      │ payment   │                 │
                 │ fails        │ succeeds  │                 │
                 ▼              ▼           │                 │
         ┌────────────────┐        │        │                 │
         │  IN_GRACE      │  D+8   │        │                 │
         │  (grace period)│────────┘        │                 │
         │  (3 day grace) │                 │                 │
         └───────┬────────┘                 │                 │
                 │                          │                 │
                 │ grace expires            │                 │
                 ▼                          │                 │
         ┌────────────────┐                 │                 │
         │  SUSPENDED     │─────────────────┘                 │
         │  (no access)   │                                   │
         └───────┬────────┘                                   │
                 │                                            │
                 │ student pays outstanding                   │
                 ▼                                            │
         ┌────────────────┐                                   │
         │  ACTIVE        ├───────────────────────────────────┘
         │  (recovered)   │
         └────────────────┘

         ┌────────────────┐  ← TERMINAL STATE (no further transitions)
         │  CANCELLED     │    Student-initiated. Sets cancelledAt.
         │  (period end)  │    Access continues until currentPeriodEnd,
         └────────────────┘    then revoked. No dunning. No recovery.
              ↑
              │ from any of: ACTIVE, RETRY_1..4, IN_GRACE, SUSPENDED
              │ (see transition table below)
```

**States (including CANCELLED terminal state):**
- `ACTIVE` — billing normally, access granted
- `RETRY_1` — first retry attempt scheduled (D+1)
- `RETRY_2` — second retry attempt scheduled (D+3)
- `RETRY_3` — third retry attempt scheduled (D+5)
- `RETRY_4` — fourth retry attempt scheduled (D+7)
- `IN_GRACE` — all retries exhausted, grace period active (3 days), access still granted
- `SUSPENDED` — grace expired, access revoked
- `CANCELLED` — terminal state. Student requested cancellation effective at period end. No further renewal attempts, no dunning, no recovery. Access continues until `currentPeriodEnd`, then revoked.

**Transitions:**

| From | To | Trigger |
|---|---|---|
| ACTIVE | ACTIVE | Normal renewal payment succeeds |
| ACTIVE | RETRY_1 | First payment failure |
| RETRY_1 | RETRY_2 | Payment fails on D+1 retry |
| RETRY_2 | RETRY_3 | Payment fails on D+3 retry |
| RETRY_3 | RETRY_4 | Payment fails on D+5 retry |
| RETRY_4 | IN_GRACE | Payment fails on D+7 retry (all exhausted) |
| RETRY_1..4 | ACTIVE | Any retry payment succeeds |
| IN_GRACE | ACTIVE | Payment recovered during grace |
| IN_GRACE | SUSPENDED | Grace expires (3 days without payment) |
| SUSPENDED | ACTIVE | Outstanding invoice paid (recovered) |
| ACTIVE | CANCELLED | Student requests cancellation. Sets cancelledAt, preserves currentPeriodEnd |
| RETRY_1..4 | CANCELLED | Student requests cancellation during dunning. Honoured immediately; no further retries |
| IN_GRACE | CANCELLED | Student requests cancellation during grace. Grace ends, no suspension needed |
| SUSPENDED | CANCELLED | Admin cancels a suspended enrollment (cleanup) |

### 4.3 Recovery Path

When a `SUSPENDED` student pays the outstanding invoice:

1. Shop API mutation: `recoverSubscription(enrollmentId: ID!, paymentMethod: String!): SubscriptionRecoveredResult`
2. System processes payment against the existing `SubscriptionInvoice` (status: `failed`)
3. On success: publish `SubscriptionRecoveredEvent`, transition to `ACTIVE`, create a new `RecurringCapacityGrant` for the current period
4. Period-end recalculation uses **original-cycle-anchor semantics**: the next `currentPeriodEnd` is calculated from the enrollment's original `currentPeriodStart` anchor, not from the recovery date. Example: a monthly subscriber whose cycle anchors on the 1st recovers on the 22nd — their next billing date is the 1st of next month, not 22nd+30 days. This preserves the predictable billing cadence and prevents cycle drift during dunning.

```typescript
// Recovery period-end calculation
const anchorDay = enrollment.originalPeriodAnchor; // day of month (1–28)
const nextPeriodEnd = nextOccurrenceOfDay(anchorDay, after: new Date());
enrollment.currentPeriodEnd = nextPeriodEnd;
```

`originalPeriodAnchor` is a new column on `SubscriptionEnrollment` (day of month integer, set at enrollment creation, never mutated).

---

## 5. Juspay Integration Delta

### 5.1 Current Phase 1 Flow

```
Order → PaymentSettledEvent → Fulfillment → BbbEntitlement
```

### 5.2 Phase 2 Subscription Flow

```
SubscriptionRenewalJob → Juspay.createOrder({
  order_id: invoiceId,
  amount: plan.amount,
  customer_id: customerId,
  customer_email: ...,
  customer_phone: ...,
  subscription: {
    frequency: mapInterval(plan.billingInterval),
  }
})

// Juspay callbacks:
// 1. Webhook: payment_attempt_succeeded → update invoice, create grant
// 2. Webhook: payment_attempt_failed → advance dunning FSM
// 3. Juspay dashboard for manual retry fallback
```

### 5.3 Changes Required

| Component | Phase 1 | Phase 2 Addition |
|---|---|---|
| `PaymentMethodHandler` | `dummyPaymentHandler` for dev | Add `JuspayRecurringPaymentHandler` with subscription params |
| Webhook controller | (none — BBB only) | Add `JuspayWebhookController` for `payment_attempt_*` events |
| `Order` creation | Created at checkout time | Created after payment succeeds on renewal |
| Refunds | Via Vendure admin | Must handle partial-period refunds on cancellation |

### 5.4 Juspay Webhook Pipeline

```
Juspay → POST /juspay/webhook
  → JuspayWebhookController.verifySignature()
  → persist JuspayWebhookEvent { status: PENDING }
  → enqueue JuspayPaymentProcessor job
  → return 200 OK (immediately)

BullMQ: JuspayPaymentProcessor
  → Load event + invoice
  → On payment_attempt_succeeded:
      → mark invoice paid
      → create RecurringCapacityGrant
      → if enrollment is SUSPENDED: recover → ACTIVE
      → publish SubscriptionRenewedEvent
  → On payment_attempt_failed:
      → advance dunning FSM
      → publish SubscriptionPaymentFailedEvent
```

This mirrors the existing BBB webhook persist-first pattern (BUG-003 fix).



---

## 6. Failure Modes & Invariants

### 6.1 New Invariants

#### INV-SUB-001: Append-Only Subscription Invoices

`SubscriptionInvoice` rows are immutable except for `status` field transition (`pending -> paid` | `pending -> failed`). No deletes. No `amount` changes. Refunds produce a negative `SubscriptionInvoice` (type: `refund`), not a mutation. Extends INV-005 to the subscription billing domain.

#### INV-SUB-002: Idempotent Renewal Jobs

BullMQ's `jobId` is deterministic: `renew-${enrollmentId}-${periodStart.getTime()}`. Deduplication ensures the same renewal is never processed twice.

#### INV-SUB-003: No Concurrent Subscription Mutation

`SubscriptionEnrollment` has a `version` column (optimistic lock). Renewal jobs use `UPDATE ... SET version = version + 1 WHERE version = :readVersion`. If the update affects 0 rows, the job retries (max 3, then dead-letter queue).

#### INV-SUB-004: Billing Truth Is the Invoice

A `SubscriptionInvoice` with `status: paid` is the authoritative record. The webhook handler never creates an invoice -- only transitions existing ones.

**Idempotency protection:** Two concurrent `JuspayPaymentProcessor` jobs processing the same webhook (e.g., Juspay retry delivery) could both attempt to transition the same invoice from `pending → paid`. The `SubscriptionEnrollment.version` optimistic lock protects the enrollment row but not the invoice row. Therefore `SubscriptionInvoice` carries a `UNIQUE` constraint:

```sql
CREATE UNIQUE INDEX "IDX_subscription_invoice_enrollment_period_paid"
  ON "subscription_invoice" ("enrollmentId", "periodStart")
  WHERE status = 'paid';
```

This ensures that only one `paid` invoice can exist per enrollment per period. A second attempt to mark the same invoice `paid` fails with a unique constraint violation, which the job handler catches and treats as a no-op (idempotent success).

#### INV-SUB-005: Grace Period Access Is Reversible

During `IN_GRACE`, full access is retained. On expiry: status to `SUSPENDED`, access revoked, frozen grant exhausted. On recovery: status to `ACTIVE`, new prorated grant.

#### INV-SUB-006: Cancellation Is Effective at Period End

`cancelSubscription()` sets `cancelledAt` but preserves `currentPeriodEnd`. Access continues until period end.

#### INV-SUB-007: SubscriptionPlan Soft-Delete Guard

A `SubscriptionPlan` may not be hard-deleted if any `SubscriptionEnrollment` with status not in `{'cancelled', 'suspended'}` references it. The `isActive = false` flag is the soft-delete mechanism. This invariant prevents orphaned enrollments from referencing a deleted plan.

Constraint: `DELETE FROM subscription_plan WHERE id = :id AND NOT EXISTS (SELECT 1 FROM subscription_enrollment WHERE plan_id = :id AND status NOT IN ('cancelled', 'suspended'))`.

On the application layer: `SubscriptionPlanService.delete()` checks this and throws `PlanHasActiveEnrollmentsError` if any active enrollments exist.

### 6.2 Failure Mode Analysis

#### F-001: BullMQ Job Crash During Renewal
Worker crashes after creating `SubscriptionInvoice`. A reconciliation sweep (cron 03:00 IST) finds `pending` invoices older than 1 hour and re-enqueues them.

#### F-002: Juspay Webhook Lost
Juspay retries up to 3 times. If all fail, reconciliation calls `Juspay.orderStatus(invoiceId)` to check actual state.

#### F-003: Optimistic Lock Contention
One worker succeeds, the other retries (exponential backoff). On retry, finds enrollment already renewed and exits cleanly.

#### F-004: Subscription + One-Time Entitlement Overlap
`BbbEntitlementService.hasAccess()` returns `true` if any path grants access. Overlap is benign.

#### F-005: Mid-Cycle Plan Change
Deferred to Phase 2.5. Initial scope applies changes at next renewal only.

---

## 7. Open Questions

### Q-001: Mid-Cycle Plan Changes

Can an admin change a plan's price or included minutes while enrollments are active?

- If **yes**: Does the change apply at next renewal (clean) or immediately (prorated)?
- If **immediate**: Do active enrollments get a new `RecurringCapacityGrant` mid-period?
- **Recommendation for initial scope:** Plan changes apply at next renewal. Mid-cycle deferred to Phase 2.5.

### Q-002: Proration on Mid-Cycle Cancellation

When a student cancels mid-cycle, do they get a refund for unused days?

- Vendure's `Order` model doesn't support partial refunds natively.
- Juspay supports partial refunds via API.
- **Recommendation:** No proration for initial scope. Proration is Phase 2.5.

### Q-003: In-Session Suspension Policy

If a student's subscription expires (grace period ends) while in an active BBB meeting:

- **Option A:** Allow session to complete, then deny future access (graceful).
- **Option B:** Force-end the meeting via BBB API (draconian).
- **Option C:** Allow but mark as unbillable.
- **Recommendation:** Option A for initial scope. Reconciliation skips meetings with ATTENDEE_COUNT > 0.

### Q-004: Dunning During a Live Session

If a student enters dunning while enrolled in a future `BbbScheduledSession`, should they be prevented from joining?

- **Recommendation:** No. Dunning states RETRY_1 through IN_GRACE preserve access. Only SUSPENDED revokes it.

### Q-005: Multi-Subscription Per Customer

Can a single customer hold multiple subscriptions for different organizations?

- **Current decision:** Yes. Student at two academies has two subscriptions.
- **Open:** Can a customer hold two subscriptions within the same organization?
- **Recommendation:** Allow multi-subscription within an org. Access becomes additive.

### Q-006: Tax Compliance

Does the subscription plan amount include or exclude GST? Does tax rate change mid-cycle?

- **Recommendation:** Deferred -- requires domain expertise from a tax advisor. Initial scope assumes tax-inclusive pricing.

### Q-007: Downgrade / Upgrade Paths

Can a student move between plans?

- **Option A:** Cancel current at period end, subscribe to new plan.
- **Option B:** Immediate switch with prorated credit.
- **Option C:** No downgrade/upgrade.
- **Recommendation:** Option A for initial scope.

### Q-008: Admin Audit Trail

Admin actions on subscriptions must be auditable.

- **Recommendation:** Use a `SubscriptionAuditLog` entity deferred to implementation.

### Q-009: `consumeGrant()` Union Gap (⚠️ Open Seam — blocks Phase 2 ship)

`BbbReconciliationService.consumeGrant()` reads specifically from `BbbCapacityGrant` by `meeting.grantId`. It does not natively union with `RecurringCapacityGrant`. This creates a load-bearing gap: meetings provisioned under a subscription grant will fail to debit correctly unless this is resolved before Phase 2 ships.

**Resolution options:**

- **Option A (recommended):** Add a `GrantReaderService` that unions both `BbbCapacityGrant` and `RecurringCapacityGrant` tables before calling `consumeGrant()`. No Phase 1 code is modified.

- **Option B:** Modify `consumeGrant()` to accept an abstract `CapacityGrantLike` interface. Requires touching Phase 1 code.

**Decision required before Phase 2 implementation begins.**

### Q-010: Notification Transport for Dunning Events

Every dunning state transition (`SubscriptionPaymentFailedEvent`, `SubscriptionGracePeriodStartedEvent`, `SubscriptionSuspendedEvent`) implies a student notification. The RFC defines the events but the transport layer is unspecified.

**Options for India:**
- SMS via MSG91 / fast2sms (high open rate, recommended for payment alerts)
- WhatsApp Business API (highest engagement, requires WABA approval)
- Email via Vendure `EmailPlugin` (existing infrastructure, lower urgency channel)

**Recommendation:** Email for initial scope (zero new infrastructure — `EmailPlugin` already planned). SMS as Phase 3 upgrade. WhatsApp deferred until WABA approval obtained.

**Decision required before dunning job implementation begins.**

---

## Appendix A: Phase 1 Entity Reference

Every entity proposed above references one or more Phase 1 entities (from `platform-adr.md` v1.3):

| RFC Entity | References Phase 1 Entity | Relationship Type |
|---|---|---|
| `SubscriptionPlan` | `Channel` | FK `channelId` |
| `SubscriptionEnrollment` | `BbbOrganization` | FK `organizationId` |
| `SubscriptionEnrollment` | `Customer` (Vendure) | FK `customerId` |
| `SubscriptionInvoice` | `Order` (Vendure) | FK `orderId` (nullable) |
| `RecurringCapacityGrant` | `BbbCapacityGrant` (conceptually) | Separate table, same consumed-by pattern |
| `SubscriptionEntitlement` | `BbbEntitlement` | Derived state, computed at query time |
| `UsageLedgerEntry` | `BbbUsageLedger` | Same table, new nullable `enrollmentId` column |
| `SubscriptionRecoveredEvent` handler | `BbbEntitlementService.hasAccess()` | Adds subscription path to existing check |
| Renewal grant creation | `BbbReconciliationService.consumeGrant()` | Reuses grant consumption path unchanged |

## Appendix B: Phase 1 Invariants That Remain Unchanged

| Invariant | Status | Rationale |
|---|---|---|
| INV-001: ChannelAware for tenant-scoped entities | Unchanged | Subscription entities use scalar `channelId`, not new tenant ID |
| INV-002: BbbUsageLedger append-only | Extended (INV-SUB-001) | Same principle, subscription context |
| INV-003: One access-control system via Entitlement | Unchanged | `SubscriptionEntitlement` is a runtime path in `hasAccess()` |
| INV-004: no `tenantId` pattern | Unchanged | All new entities use `channelId` |
| INV-005: Append-only ledger | Extended (INV-SUB-001) | `SubscriptionInvoice` follows same pattern |
| INV-006: Compute over store for derived state | Extended | `SubscriptionEntitlement` is computed, never stored |
| INV-007: GraphQL API stability | Unchanged | New mutations/queries are additive |
| INV-008: Business logic in Vendure | Unchanged | All subscription logic is server-side |

---

## Appendix C: Phase 3 Marketplace Integration Points for Subscription Tenants

The Phase 3 marketplace (ADR-021) intersects with Phase 2 subscription billing in three specific ways. These are not Phase 2 deliverables, but the Phase 2 schema must not block them.

### C-1: Subscription Plan as a Marketplace-Discoverable Product

A `SubscriptionPlan` with `isPublic = true` should be indexable in the `saa9vi_marketplace_sessions` Elasticsearch index as a purchasable offering. The `MarketplaceIndexerPlugin` (Phase 3) reads `SubscriptionPlan.channelId`, `name`, `amount`, and `billingInterval` to create a `MarketplacePlan` document.

**Phase 2 schema requirement:** `SubscriptionPlan.isPublic: boolean` (default `false`) must be present from Phase 2 launch. This is a nullable addition — existing plans default to not indexed.

### C-2: `orderSource` Attribution on Subscription Checkout

When a student discovers a subscription plan via the marketplace and checks out, the resulting `SubscriptionEnrollment` must carry `orderSource: 'marketplace'` for Stream 2 commission attribution.

**Phase 2 schema requirement:** `SubscriptionEnrollment.orderSource: 'marketplace' | 'direct' | 'referral' | null` (nullable, set at enrollment creation from session referrer). This mirrors the `Order.customFields.orderSource` field (ADR-021). Note: the classification mechanism (who stamps `orderSource`) is an open design question in ADR-021 — the storefront must pass a raw `referrerCode`/`utm_source` and Vendure-side logic must classify, per INV-008.

### C-3: Review Aggregation on Subscription Plans

A student subscribed to an academy has verified, ongoing engagement — they are the highest-quality review source. `ReviewsPlugin` eligibility should eventually include `SubscriptionEnrollment.status IN ('active', 'cancelled')` as a valid purchase proof.

**Phase 2 requirement:** None. `ReviewsPlugin` currently checks `OrderLine` state. The subscription path is a Phase 3 extension to `ReviewEligibilityStrategyRegistry`.

---

### C-4: `RecurringCapacityGrant` in Capacity Intelligence Forecasts

`CapacityIntelligenceService` (§6A in ADR v1.6) forecasts load from `BbbScheduledSession` data. In Phase 2, subscription academies may have recurring sessions not yet entered as `BbbScheduledSession` rows (e.g., always-on rooms billed by attendee-minutes). The forecasting layer must account for historical attendee-minute patterns from `BbbUsageLedger WHERE enrollmentId IS NOT NULL` when session data is sparse.

**Phase 2 requirement:** `CapacityIntelligenceService.buildForecast()` adds a secondary signal: trailing 4-week average attendee-minutes per subscription academy, blended with scheduled session data. No schema changes needed — `BbbUsageLedger.enrollmentId` (RFC Section 2.2) provides the lookup.

### C-5: `GrantReaderService` (Q-009) Must Include Capacity Intelligence

When Q-009 (`consumeGrant()` union gap) is resolved by implementing `GrantReaderService`, that service becomes the single source of truth for all active grants. `CapacityIntelligenceService` should read pool headroom from `GrantReaderService` — specifically `SUM(grantedMinutes - consumedMinutes) WHERE exhausted = false AND validUntil > now()` across both `BbbCapacityGrant` and `RecurringCapacityGrant`. This ensures the capacity dashboard reflects subscription quota headroom alongside prepaid grant headroom.

**Phase 2 requirement:** `GrantReaderService` (Q-009 resolution) exposes a `getRemainingMinutes(organizationId)` method that `CapacityIntelligenceService` consumes.

---

*This RFC is a design artifact. It proposes interfaces, contracts, and architectural decisions for Phase 2. No code implementing these proposals exists in the repository. Phase 1 documentation (`platform-adr.md` v1.5) remains the authoritative ground truth for what is currently built.*
