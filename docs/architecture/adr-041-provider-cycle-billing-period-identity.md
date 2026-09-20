# ADR-041: Provider-Cycle Billing Period Identity

**Status:** Accepted  
**Date:** 2026-09-20  
**Supersedes:** The period-arithmetic assumption implicit in the pre-G2 implementation of `finalizeAfterPayment()`.  
**Related:** ADR-038 (direct Razorpay provider), ADR-039 (provider-wired subscription lifecycle), INV-019 (single lifecycle write), R2-E probe findings (2026-09-20)

---

## Context

The R2-E probe (2026-09-20) demonstrated a concrete billing defect:

```
Razorpay provider cycle:  2026-09-20 → 2026-10-20
Saa9vi local result:      2026-11-16 → 2026-12-16
```

One real ₹100 payment produced a local subscription period two months in the future.
The root cause was that `finalizeAfterPayment()` computed the new period as:

```ts
const newPeriodEnd = new Date(oldPeriodEnd);
newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
```

This arithmetic derives the next period from the *local* `currentPeriodEnd`, not from the
provider's authoritative billing cycle. When the local `currentPeriodEnd` has drifted from
the provider cycle — which is normal during initial authorization — the result is wrong.

The same defect makes replay non-idempotent: a replayed webhook recomputes `oldPeriodEnd + 1`
against the now-advanced local period, producing a second period advancement for the same
provider charge.

The out-of-order failure guard in `markPastDueFromWebhook()` had the same root problem —
it compared `currentPeriodEnd > new Date()` (wall clock) rather than comparing the
provider's failure cycle against the locally finalized cycle.

---

## Decision

### 1. A Razorpay billing cycle is the identity of a paid period

For a **charge-bearing** `subscription.charged` or `subscription.activated` webhook event
(i.e. when the payload carries a payment entity with a valid payment ID and amount),
Razorpay's subscription entity carries:

```
current_start   (Unix timestamp, seconds)
current_end     (Unix timestamp, seconds)
```

These represent the provider billing cycle that the payment belongs to. They are the
**authoritative source of truth** for the billing period. No local arithmetic may substitute
for them when finalizing a provider-originated charge.

Razorpay distinguishes authorization-only activations (future-start subscriptions that
first produce `authenticated`, then later `activated` without an immediate charge) from
immediately charged activations. The cycle guard and finalization only apply when the
event carries payment details — a non-charge `subscription.activated` updates the binding
state but does not attempt period finalization.

### 2. Local mapping

```
Razorpay cycle C  (current_start → current_end, Unix seconds)
        ↓  normalised to UTC calendar-date granularity (YYYY-MM-DD)
SubscriptionBillingAttempt.billingPeriodStart  = C.start date (YYYY-MM-DD, UTC)
SubscriptionBillingAttempt.billingPeriodEnd    = C.end date   (YYYY-MM-DD, UTC)
        ↓
OrganizationSubscription.currentPeriodStart   = C.start (Date)
OrganizationSubscription.currentPeriodEnd     = C.end   (Date)
```

**UTC date granularity:** Saa9vi models recurring billing cycles at UTC calendar-date
granularity. Provider Unix timestamps (which carry sub-second precision) are normalised
to `YYYY-MM-DD` via `toISOString().split('T')[0]` before storage. This is an explicit
design choice for monthly plans; any provider cycle that starts and ends within the same
UTC day would be ambiguous, but Razorpay monthly plan cycles never have this property in
practice. This assumption should be re-evaluated if daily or hourly billing plans are
introduced.

### 3. Idempotency invariant

For the **same provider cycle C**:

| Situation | Result |
|---|---|
| First success | Advance local period to C |
| Replay (same event ID) | No-op — cycle already reached |
| Duplicate event (same payment, different event ID) | No-op — cycle already reached |
| Concurrent worker | Exactly one winner; loser sees CAS fail → idempotent no-op |

For a **later cycle C+1** (where `C+1.start > C.start`):

| Situation | Result |
|---|---|
| C+1 success arrives | Advance local period to C+1 |

### 4. Monotonic cycle progression — the finalization CAS

The period advancement SQL must be:

```sql
UPDATE organization_subscription
SET
    version          = :guardVersion + 1,
    currentPeriodStart = :targetStart,
    currentPeriodEnd   = :targetEnd,
    status           = 'active'
WHERE
    id      = :id
AND version = :guardVersion
AND (
    currentPeriodStart IS NULL
    OR currentPeriodStart < :targetStart
)
```

The `currentPeriodStart < :targetStart` clause enforces **monotonic progression**: only a
strictly newer provider cycle can advance the local state. A stale or duplicate cycle
(same or earlier `current_start`) loses the CAS silently, which is the correct idempotent
behavior.

This is distinct from `IS DISTINCT FROM :targetStart` (mere inequality), which would
incorrectly allow a *backwards* provider cycle to qualify as "different."

### 5. Stale failure rule

A failure event (pending / halted) for provider cycle C must not downgrade a local
subscription that has already finalized cycle C or a later cycle.

The guard compares **provider cycle identity**, not wall-clock time:

```
providerCycleStart <= localCurrentPeriodStart  →  stale failure, no-op
providerCycleStart >  localCurrentPeriodStart  →  newer unpaid cycle, eligible for past_due
```

### 6. Terminal-state protection

`cancelled` is terminal in Saa9vi (RFC-001). A late `subscription.charged` or
`subscription.activated` event arriving after local cancellation must not resurrect
the subscription. The finalization path checks `sub.status === 'cancelled'` before
the CAS and returns SUCCESS (not an error) — the charge landed but the subscription
is already terminated; the operator WARN log is the signal for refund review.

### 7. Explicit prohibition

The following pattern is **prohibited** as the source of truth for provider-originated
charge finalization:

```ts
// PROHIBITED — derives period from local state, not provider cycle
const newPeriodEnd = new Date(sub.currentPeriodEnd);
newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
```

This is the exact mechanism behind the demonstrated two-month drift error.

The renewal worker's `executeRenewal()` creates an `initiated` attempt with **`NULL` in both
period fields** — the authoritative provider cycle is unknown until Razorpay fires the charge
webhook. The terminal CAS in `recordAttemptSuccess()` then writes `billingPeriodStart` and
`billingPeriodEnd` from the webhook's `current_start`/`current_end`. A provisional local date
is explicitly prohibited on the initiation path (INV-020 corollary — durable cycle carrier).

---

## Consequences

### Required code changes (phases G2–G7)

| Phase | Change |
|---|---|
| G2 | `NormalizedBillingEvent` carries `providerPeriodStart`, `providerPeriodEnd`, `providerPaidCount`; `normalizeEvent()` extracts `current_start`/`current_end` from subscription entity; charge events without these fields **throw `MissingProviderCycleError`** so the queue retry machinery activates (not a silent return) |
| G3 | `SubscriptionBillingAttempt` gains nullable `billingPeriodEnd` column (YYYY-MM-DD, UTC); `billingPeriodStart` made nullable (separate migration); **uniform NULL semantics** across all attempt states: `NULL` = cycle identity unknown/not applicable; the three cases are: (1) **initiated rows** — both fields are `NULL` because the renewal worker creates the attempt before Razorpay fires the charge; a provisional local date is explicitly prohibited on the initiation path; (2) **terminal succeeded rows** — both fields carry the authoritative provider cycle from the webhook (`current_start` → `billingPeriodStart`, `current_end` → `billingPeriodEnd`, YYYY-MM-DD UTC); (3) **terminal failed rows without a provider cycle** — both fields are `NULL`; `billingPeriodStart` is therefore `YYYY-MM-DD` if and only if it originates from an authoritative provider cycle (INV-020) |
| G6 | `markPastDueFromWebhook()` accepts optional provider cycle start; `subscription.pending` / `subscription.halted` processor branches call `requireProviderCycleForFailure()` which throws before any binding mutation if `current_start` is absent; **only `current_start` is required for G6** — the freshness guard compares cycle ordering (`providerCycleStart <= localCurrentPeriodStart` → stale) and does not need `current_end`; contrast with G2/assertProviderCyclePresent which requires both fields to establish a billing period |
| G4 | `finalizeAfterPayment()` reads `billingPeriodStart`/`billingPeriodEnd` from the attempt row (no re-parsing of original payload); absent `billingPeriodEnd` records a reconciliation incident — the `+1 month` arithmetic fallback is explicitly removed; `finalizeRenewalPeriod()` uses the cycle-monotonic CAS above |
| G5 | Replay idempotency check uses `reloaded.currentPeriodStart >= targetStart` (cycle-identity); bounded retry (max 3) handles normal version-race concurrency — version changed but cycle not yet advanced → retry with fresh version → prevents false reconciliation incidents on normal concurrent writes |
| G7 | `updateBinding()` wraps binding save + subscription `providerStatus` save in one application-level transaction (`connection.withTransaction`) — atomic, not "logical"; binding lookup is provider-qualified (`provider + providerSubscriptionId`) |

### Required migrations

Two schema changes, both generated via Vendure CLI and applied via `npx vendure migrate -r`:

1. `1789883158253-add-billing-period-end-to-attempt.ts`
   — adds nullable `billingPeriodEnd VARCHAR(10)` column.

2. `1789885988242-make-billing-period-start-nullable.ts`
   — makes `billingPeriodStart` nullable (`DROP NOT NULL`), consistent with the
   uniform NULL semantics decided in G3: a `NULL` value means cycle identity is
   unknown or not applicable (initiated rows; failed rows without provider cycle).

No data migration required for existing rows — `billingPeriodEnd = NULL` causes
`finalizeAfterPayment()` to record a reconciliation incident rather than silently
auto-finalizing with wrong arithmetic. The operator can re-deliver the original
webhook to supply the correct provider cycle.

### No new migration required for `OrganizationSubscription`

`currentPeriodStart` and `currentPeriodEnd` already exist. The CAS SQL gains the
`currentPeriodStart < :targetStart` clause — this is a query change, not a schema change.

---

## Invariant record

This decision introduces the following invariant (to be added to `invariants.md`):

> **INV-020 — Provider-cycle period identity**
>
> A provider-originated successful billing event MUST finalize the exact provider
> billing cycle represented by the event (`current_start` → `current_end`).
> Local period arithmetic (`currentPeriodEnd + 1 month`) MUST NOT be used as the
> source of truth for period advancement on the provider-driven path.
> The local billing period MUST be monotonically non-decreasing in provider-cycle order.
