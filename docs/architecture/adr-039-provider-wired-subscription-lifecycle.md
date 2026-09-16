# ADR-039: Provider-Wired Subscription Creation Lifecycle

**Status:** Accepted (2026-09-16 — approved with corrections; external-side-effect failure model and input-contract preflight applied). Implementation not yet started at acceptance; see `docs/implementation/adr-039-implementation-plan.md`.
**Date:** 2026-09-16
**Supersedes:** none
**Related:** ADR-038 (direct Razorpay provider), ADR-037 (recurring billing foundation), INV-001 (Channel = Tenant), INV-004 (persist-first webhooks), INV-018 (channel-scoped processing), INV-019 (provider-neutral bindings)

## Context

Runtime verification of C-1 (2026-09-16, see `integration-gaps-worklist.md`) proved two facts:

### Layer 1 — first-webhook bootstrap deadlock (runtime-proven)

The webhook worker resolves the channel **exclusively** from a pre-existing `SubscriptionProviderBinding` (`resolveChannelFromBinding()`), and fails closed (INV-018) when none exists. The processor's lazy `createProviderBinding()` branch is unreachable for first subscriptions because the worker never invokes the processor without a binding. Signed-webhook probe: inbox event terminal-`failed` after 3 attempts, zero binding rows created.

### Layer 2 — the provider-creation flow is unwired (code-verified)

There is no production path that creates a Razorpay subscription at all:

* `RazorpaySubscriptionProvider.createSubscription()` has **zero production call sites** (only the standalone M1.3 verification script `razorpay-subscription-verify.ts`).
* `subscribeToPlan()` — the sole runtime subscription-creation path — creates a local `OrganizationSubscription` with `status: "active"` immediately, with **no payment and no provider interaction**.
* `SubscriptionPlan` has **no provider-plan mapping** (`providerPlanId`), so no runtime mechanism can map a Saa9vi plan to a Razorpay `plan_id`.
* `CreateRecurringSubscriptionInput` requires data (`organizationId`, `customerEmail`, `customerPhone`, `amount`, `currency`, `frequency`) that no production caller supplies.

Consequence: no legitimate runtime path ever produces the `providerSubscriptionId` required for first-binding creation. The webhook pipeline (ingest → inbox → queue → processor) is fully built, but nothing upstream ever feeds it.

## Decision

1. **Subscription creation becomes provider-wired.** The production subscription-creation flow will create the Razorpay subscription synchronously and establish the `SubscriptionProviderBinding` **in the same request path — immediately after provider creation and before returning success**. A provider webhook may race the local binding commit; the worker's fail-closed + BullMQ-retry behavior makes that race recoverable (the inbox event retries until the binding exists). No webhook-trust-boundary change.
2. **Binding creation at creation time is the sole first-binding mechanism.** Webhook payloads (`notes.channelId` or otherwise) are **explicitly rejected** as a primary bootstrap mechanism for tenant identity: they would move tenant identity across the webhook trust boundary, contradicting INV-018's fail-closed rationale. The worker's fail-closed behavior is preserved unchanged.
3. **Subscription status becomes provider-driven.** `OrganizationSubscription.status` at creation time is a **pre-authorization state** (`pending_provider_auth`), not `active`. Only provider lifecycle events drive transitions to `active` (`subscription.authenticated`/`activated` webhooks), preserving Razorpay as the authoritative payment-activation source (ADR-038).
4. **Creation-time binding creation goes through the existing `createProviderBinding()`**, exercising the exact persistence path C-1-B must verify (channels[] join + scalar `channelId`), rather than introducing a second binding mechanism.

## Design details

### API surface — evolve `subscribeToPlan` (chosen) vs new mutation (rejected)

`subscribeToPlan` is extended rather than replaced: a new dedicated mutation would fork subscription-creation semantics and leave the legacy path dangling. The existing admin mutation gains provider wiring; its signature is unchanged (`channelId`, `planId`) — all provider inputs are resolved server-side from the plan and channel context. Customer contact data (`customerEmail`, `customerPhone`) comes from the channel's organization/customer records, not from caller input.

### Schema additions (Vendure CLI migration only)

* `SubscriptionPlan.providerPlanId: string | null` — the Razorpay `plan_id` this plan maps to. Nullable during rollout; the creation flow fails closed when unset for a provider-wired request. A separate provider discriminator column is **not** added: ADR-038 fixes the runtime provider to Razorpay, and a provider-neutral future would add it then (YAGNI).
* `OrganizationSubscription.providerStatus: string | null` and `providerShortUrl: string | null` — returned to the admin caller so the customer can be directed to Razorpay authorization.

### Lifecycle state machine

```text
subscribeToPlan
  → local OrganizationSubscription { status: 'pending_provider_auth' }
  → provider.createSubscription(...)        (Razorpay Subscriptions API)
  → createProviderBinding(provider='razorpay', providerSubscriptionId, ...)
  → return { subscription, providerShortUrl }
  → customer authorizes via Razorpay
  → subscription.authenticated / activated webhooks
  → processor updates binding + subscription → status: 'active'
```

`subscription.charged` continues to drive billing attempts (existing FSM). `subscribeToPlan`'s current unconditional `status: 'active'` is retired; existing dev/test subscriptions are not migrated.

### Idempotency and concurrency

* `subscribeToPlan` retains its existing single-active-subscription-per-channel guard.
* Binding creation reuses `createProviderBinding()`; its DB authority is the existing `UNIQUE(provider, providerSubscriptionId)` index. The C-1-C finding (pre-lookup on `providerSubscriptionId` alone vs the composite unique index) is resolved as part of C-1-C verification: the lookup is tightened to `{ provider, providerSubscriptionId }` **only if** runtime evidence shows cross-provider ID collision is a real scenario; otherwise the stricter index already covers the actual single-provider runtime.
* Provider API failure during `subscribeToPlan` → **external-side-effect failure model** (see Preflight section): the Razorpay call is NOT transactional and cannot be rolled back by PostgreSQL. Failure semantics are explicit below.
* **Preflight result (2026-09-16, verified against entities, installed razorpay SDK 2.9.8 types, and the live Create Subscription API docs):** `organizationId` derives from the Channel ↔ TenantProfile ↔ BbbOrganization 1:1 chain (all keyed by `channelId`; `TenantProfile.id` serves as the organization reference in `notes`). `customerEmail` derives from the mandatory `TenantProfile.contactEmail` — but **email/phone are not inputs to Create Subscription at all** (see notify_info correction below). **There is no Saa9vi customer-phone or Razorpay-customer source; none is needed.** `amount`/`currency`/`frequency` are carried by the Razorpay plan (`plan_id`), not the create request. Provider response supplies `subscription.id` + `short_url` ✅.

### Input-contract corrections (2026-09-16 review — REQUIRED before Step 2 wiring)

1. **`notify_info` must NOT be sent to Create Subscription.** The current API schema rejects undocumented fields with HTTP 400 ("{any extra field} is/are not required and should not be sent"); `notify_info` belongs to the separate **Create Subscription Link** API (confirmed in installed SDK 2.9.8 types: `notify_info` exists only on `RazorpaySubscriptionLinkCreateRequestBody`). The current adapter's `notify_info` block must be removed from the create call. Customer notifications are governed by the documented boolean `customer_notify` parameter; Saa9vi relies on webhooks + `short_url`, so `customer_notify` is set explicitly.
2. **`total_count` has no API default.** The API requires `total_count` unless `end_at` is passed (mutually exclusive). The `12` in the adapter (`input.totalCount || 12`) is a **Saa9vi application-level default**, not a Razorpay API default.
3. **`customerId` has no Saa9vi source and no Razorpay-customer object is created.** Correlation notes carry `channelId`, `tenantProfileId`, and `planId` instead; `customerId`/`organizationId` keys are dropped from `notes` in favor of the resolvable identifiers above.
4. **`CreateRecurringSubscriptionInput` will be slimmed** to the fields the Create Subscription call actually consumes (`planId`, `totalCount?`, `startAt?`, `expireBy?`, `channelId` for notes/correlation); the contact/pricing fields become unused and are removed from the required contract rather than fed invented values.
* `OrganizationSubscription.status` is a varchar (no DB enum) — adding `'pending_provider_auth'` to the TS union is a type-only change, no migration for the status itself.

### Invariants preserved

* **INV-001** (Channel = Tenant): binding + subscription both assigned to the target channel via `assignToCurrentChannel` (existing pattern in both `subscribeToPlan` and `createProviderBinding`).
* **INV-004** (persist-first webhooks): unchanged; webhooks remain the sole driver of payment lifecycle.
* **INV-018** (channel-scoped processing): worker unchanged — still resolves from the persisted binding, still fails closed.
* **INV-019** (provider-neutral bindings): binding creation remains through the provider-neutral `createProviderBinding()`.

## Failure semantics — external-side-effect model (required correction, 2026-09-16)

Razorpay is an external system: a PostgreSQL rollback cannot undo a Razorpay subscription creation, and vice versa. The sequence is ordered to minimize and surface orphans rather than pretend atomicity:

```text
1. Validate all local prerequisites (channel, plan, providerPlanId, tenant
   profile/contact, active-subscription guard)  — no side effects yet
2. Create Razorpay subscription                — EXTERNAL, non-rollbackable
3. Persist local subscription + binding        — in the existing mutation transaction
4. If (3) fails:
   → the local transaction rolls back
   → the provider subscription sub_XXX REMAINS (orphan, pre-authorization)
   → the mutation error MUST surface providerSubscriptionId + correlation notes
     for ops reconciliation (Razorpay dashboard; orphan subs never activate
     without customer authorization and expire per plan settings)
```

Idempotency/correlation on retry: Razorpay offers no create-time idempotency key for subscriptions, so the local partial-unique index (`channelId` WHERE status != 'cancelled') remains the authoritative anti-duplicate guard for **local** rows, and `notes` (`channelId`, `tenantProfileId`, `planId`) tag every created provider subscription for correlation. **The local guard cannot prevent multiple provider-side subscriptions across an external-success/local-persistence failure boundary**: if local persistence fails after `sub_A` was created and the flow retries, `sub_B` is created while `sub_A` persists provider-side. `sub_A` is *expected* to be abandoned (pre-auth, expires per plan settings), but expiry is not impossibility — if its `short_url` is completed before expiry, `sub_A` can become authenticated. Residual-risk handling: orphan reconciliation via the dashboard correlation notes (cancel abandoned pre-auth subs), and C-1-C verification must confirm that a late webhook for an orphan `providerSubscriptionId` cannot corrupt the channel's local subscription state (the binding unique index admits a second binding for a different provider subscription ID — this scenario is explicitly part of C-1-C/D evidence).

The provider HTTP call must not sit inside an open DB transaction longer than necessary — validation first, provider call second, persistence third (the resolver's `@Transaction()` wrapper governs step 3).

## Consequences

* A fresh install's first Razorpay subscription can complete its full lifecycle: creation → binding → authorization webhook → active — closing C-1-A at the design level and giving C-1-B/C/D legitimate exercise paths.
* One-time commerce (`PaymentMethodHandler`) remains untouched (ADR-038 separation).
* `subscribeToPlan` behavior changes (provider-required); callers that relied on free local subscriptions must configure `providerPlanId` — accepted, since no production caller exists yet.
* Rejected alternative recorded: webhook-side `notes.channelId` bootstrap (trust-boundary violation; would mask Layer 2).

## Acceptance criteria

1. GraphQL-only runtime test: `subscribeToPlan` on a plan with `providerPlanId` → exactly one binding, correct `channels[]` join + scalar `channelId` (C-1-B).
2. Repeated/retry creation → still exactly one binding (idempotency, C-1-C).
3. Channel-scoped reads from another tenant cannot see the binding (C-1-D).
4. First real webhook (`subscription.authenticated`) → worker resolves channel from the pre-created binding → `processed`, no fail-closed error (C-1-A regression, C-1-E).
5. No manual SQL mutation; migration generated via `npx vendure migrate`.

