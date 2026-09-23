# ADR-044: Local Plan-Change and Cancellation Capability

- **Status:** Accepted
- **Date:** 2026-09-22
- **Deciders:** Platform architecture
- **Supersedes:** — (extends ADR-039)
- **Related:** ADR-037, ADR-038, ADR-039, ADR-041, ADR-042

## Context

The subscription Admin API exposes exactly three mutations — `createSubscriptionPlan`,
`updateSubscriptionPlan`, `subscribeToPlan` (`subscription-admin.schema.ts`). There is **no**
cancel, change-plan, pause or resume operation. `SubscriptionService.subscribeToPlan()` throws
whenever the channel already has **any non-cancelled subscription**
(`subscription.service.ts:131-134`).

Consequence: the Free Basic programme (auto-provisioning a `cancelled`-excludable `active`
row at registration) would **permanently disable the platform's only paid-subscribe path** for
every tenant, because the guard can never be satisfied again and no operation can clear it.

Meanwhile the provider-side primitives already exist with **zero call sites**:
`RecurringBillingProvider.cancelSubscription()` / `pauseSubscription()` / `resumeSubscription()`
are defined on the interface and implemented for Razorpay (`cancel_at_cycle_end`,
`pause_at: 'now'`, `resume_at: 'now'`). The missing layer is local, transactional, FSM-aware
wiring — not provider integration.

## Decision

1. **Supersede-in-place** is the canonical plan-change model (plan's D-4): one active
   subscription per channel is an invariant; changing plan rewrites the existing row's
   `planId`/price in a single transaction and records the change, instead of
   cancel-then-create which would strand the provider binding.
2. New Admin mutations (SuperAdmin, mirroring the existing three):
   - `changeOrganizationSubscriptionPlan(channelId: String!, planId: ID!): OrganizationSubscription!`
   - `cancelOrganizationSubscription(channelId: String!, atPeriodEnd: Boolean = true): OrganizationSubscription!`
3. `cancelOrganizationSubscription(atPeriodEnd: false)` performs **immediate** local
   cancellation *and* calls the provider `cancelSubscription()` when a binding exists —
   the local FSM transition never waits on a webhook.
   `atPeriodEnd: true` calls the provider `cancelSubscription({ cancelAtCycleEnd: true })`
   **and** sets `cancelAtPeriodEnd = true`, leaving status `active`; the renewal sweep
   completes cancellation at period end. `markCancelledFromWebhook()` remains the
   provider-confirmation bridge for provider-initiated cancellations.
   *Amendment (2026-09-23):* the provider call is mandatory on the `atPeriodEnd: true`
   path, not optional — Razorpay owns recurring execution, so a locally-flagged row with
   no provider-side cancellation is still charged at the next cycle. Correspondingly,
   `SubscriptionRenewalService.executeRenewal()` gained an explicit `cancelAtPeriodEnd`
   branch: without it the sweep would *bill* a subscription the tenant had already
   cancelled (its discovery predicate is `status IN ('active','trialing') AND
   currentPeriodEnd < now`, which a scheduled cancellation matches). Scheduled-cancel rows
   are deliberately **not** excluded from discovery, because that branch is the idempotent
   safety net for webhook loss.
4. **Provider-free rows** (`plan.providerPlanId IS NULL`) never call provider primitives;
   cancellation is local-only, and for them `atPeriodEnd` is not representable (no billing
   period exists) — both variants cancel locally and immediately.
5. `changeOrganizationSubscriptionPlan` rejects a `cancelled` current subscription
   (use `subscribeToPlan` to start fresh) and rejects `trialing` → downgrade only when the
   plan's `monthlyPriceInPaise` increases (paid-upgrade direction is always allowed).
   A change to the **same** plan short-circuits before any provider call (idempotency: a
   retry must never mint a duplicate provider subscription). When an outgoing binding
   exists, the **old** provider subscription is scheduled to cancel at its cycle end so it
   cannot double-bill while the new mandate is authorized.

## Consequences

- Unblocks Free Basic auto-provisioning: a free row can always be superseded by a paid
  `subscribeToPlan`/`changeOrganizationSubscriptionPlan`.
- ADR-039's FSM text ("only provider webhooks drive → active") is amended: provider-free
  activation and local cancellation are exceptions driven by local operations.
- No schema change: `cancelAtPeriodEnd` / `cancelledAt` columns already exist; the partial
  unique index (one non-cancelled subscription per `channelId`) is the enforcement seam the
  supersede transaction must respect.
- **Wiring detection.** `SubscriptionProviderBinding` — not `SubscriptionPlan.providerPlanId`
  — identifies a live provider subscription. `active` on the binding is a provider-mirrored
  flag, not a wiring indicator: rows created by `subscribeToPlan()` carry `active = false`
  while still holding a real provider subscription, and legacy pre-ADR-039 rows may carry
  `providerPlanId` with no binding at all. `providerPlanId IS NULL` remains the definitive
  *provider-free* test (decision 4).
- **Residual (provider-wired, scheduled cancel):** if both the provider webhook and the
  renewal sweep are lost between period end and the next run, the local row stays `active`
  with `cancelAtPeriodEnd = true` until the next sweep pass. Detection belongs to the
  existing reconciliation-incident pattern, not new machinery.

## Alternatives considered

- **Cancel-then-recreate:** rejected — strands the provider binding and breaks the partial
  unique index mid-flight.
- **Relaxing the `subscribeToPlan` guard instead of adding operations:** rejected by the
  plan's stop-and-revise trigger #6 — the missing capability is the operation, not the guard.
