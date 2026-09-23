# ADR-042: Marketplace Listing Is a Subscription Entitlement

**Status:** Accepted — implemented 2026-09-23
**Date:** 2026-09-21
**Related:** ADR-038 (direct Razorpay provider), ADR-039 (provider-wired subscription lifecycle), ADR-041 (provider-cycle billing period identity), G1 hostname contract decision (2026-09-15), INV-001 (Channel = tenant identity)

> **Implementation status (2026-09-23):** Implemented as written — **slice 7 / plan §3.4** (`docs/implementation/saa9vi-comprehensive-integration-and-commercial-plan.md`). There is no separate "M0" workstream entry in `integration-gaps-worklist.md` — the earlier reference to one was inaccurate (corrected 2026-09-22). Marketplace eligibility remains a **separate** entitlement from ADR-043 L1 white-label theming and is not conflated with it.
>
> | ADR requirement | Where it landed |
> |---|---|
> | `SubscriptionPlan.marketplaceListingEnabled` (default `false`) | `src/plugins/subscription/entities/subscription-plan.entity.ts` |
> | `OrganizationSubscription.marketplaceGraceUntil` | `src/plugins/subscription/entities/organization-subscription.entity.ts` |
> | Two migrations, both via `npx vendure migrate -g` | `src/migrations/1790172415061-add-marketplace-listing-enabled-to-plan.ts` and `src/migrations/1790172546153-add-marketplace-grace-until-to-subscription.ts` (Vendure-CLI-generated, both applied) |
> | `channelMarketplaceEligible()` — one shared evaluator | `src/platform/commercial/commercial-entitlement.service.ts` (`CommercialEntitlementService`); the window is supplied **per entitlement**, and `TenantCommercialEligibilityService` now delegates its window evaluation to the same service |
> | Grace transitions owned by the local FSM | `SubscriptionRenewalService`: set on entry to `past_due`, cleared on recovery (`finalizeAfterPayment()` → `finalizeRenewalPeriod()`) and on cancellation (`markCancelledFromWebhook()` and the ADR-044 renewal-sweep completion branch) |
> | Enforcement in `indexSession()` | `MarketplaceIndexerService` — F7 gate AND `channelMarketplaceEligible(session.channelId)`; ineligible ⇒ document removed, `false` is not an error |
> | Admin schema | `subscription-admin.schema.ts` — plan **type + input**, subscription **type** |
> | INV-024 structural checker (`.clinerules` §9) | `AdrChecker.marketplaceEntitlementInvariants()`, registered in `AdrChecker.check()` |
>
> The grace length is `MARKETPLACE_GRACE_PERIOD_DAYS` (default 7). **Deliberately not added:** `marketplacePromotionEnabled` — promotion/advertising is a separate subsystem (plan §3.4 item 9).
>
> **Scope note (§5 vs §3):** §5 enumerates the webhook-facing writers; `markSubscriptionPastDue()` — the local failed-charge transition inside the same service — stamps the deadline too, because §3 defines the trigger as *the transition to `past_due`*. Without it a locally-detected failure would delist instantly, defeating the stated purpose of the grace period. The column is written **only** by `SubscriptionRenewalService`.
>
> **Known residual (deliberate, not an omission):** §4 gates **session** documents only. Instructor documents (`MarketplaceInstructorDocument`, incl. `computeInstructorAggregates()` counts) are not pruned for an ineligible channel; widening §4 to the instructor index would change this ADR's scope and needs its own decision.
>
> **Invariants:** INV-024 is recorded in `docs/architecture/invariants.md` and is now enforced by the structural checker above (`npm run verify:invariants`).

> **Runtime evidence (commit `dad099c`, 2026-09-23):** `MARKETPLACE_E2E=true` → **14/14 `marketplace.e2e-spec.ts`** against real Postgres + real Elasticsearch — flag-off plan delists an `active` channel; `past_due` inside `marketplaceGraceUntil` stays listed; past the deadline delists; NULL grace delists; a channel with no subscription row delists as `false` (not an error); PROHIBITED signals cannot change the decision; eligibility restored re-lists. **4/4 `convergence.e2e-spec.ts`** with the same seeding, **25/25** infra-free gate spec, **73/73** tenant e2e regression (real Postgres), `npm run verify:invariants` green (INV-024 sub-check under `adr-invariants`). Two e2e-only harness defects were fixed en route and are *not* product bugs: fixtures passed the GraphQL-encoded id form (`T_1`) where the queue contract delivers the raw PK, and the session `DRAFT` default required fixtures to pin `{visibility: PUBLIC, status: SCHEDULED}`.

---

## Context

The Saa9vi marketplace (`marketplace.saa9vi.com`) surfaces tenant academies and their sessions to learners. A tenant can reach learners through two surfaces:

1. **Tenant storefront** — `{tenantSlug}.saa9vi.com` or their `customDomain`
2. **Marketplace listing** — the shared discovery surface at `marketplace.saa9vi.com`

These are independent capabilities. A tenant can have a working storefront without a marketplace listing and vice versa.

As of 2026-09-21, `SubscriptionPlan` already carries `customDomainEnabled` and `whitelabelEnabled` as plan-tier capability flags. Neither of these currently controls marketplace listing eligibility. The `MarketplaceIndexerService.indexSession()` currently gates on `visibility === PUBLIC AND status IN (SCHEDULED, LIVE)` — there is no subscription-tier check.

The key question this ADR resolves is: **what is the correct eligibility gate for marketplace listing?**

### Candidate approaches considered

**Option A — Hostname-derived:** marketplace listing eligibility depends on the tenant's subdomain or custom domain configuration. Rejected — the hostname is a routing/reachability contract (G1), not a commercial entitlement. A tenant's hostname can change without affecting their commercial standing.

**Option B — Plan flag:** a new `SubscriptionPlan.marketplaceListingEnabled` flag controls eligibility. Accepted — this is consistent with the existing pattern of `customDomainEnabled` and `whitelabelEnabled` on the plan entity.

**Option C — Subscription status only:** any active subscriber can list. Partially accepted as a corollary — commercial eligibility requires an active (or grace-period) subscription AND the plan must permit marketplace listing.

---

## Decision

### 1. Marketplace eligibility is a subscription entitlement, not a hostname property

A tenant channel is eligible for marketplace listing if and only if:

```
plan.marketplaceListingEnabled = true
AND commercialEligibilityWindow(subscription)
```

where:

```
commercialEligibilityWindow(subscription) =
    subscription.status = 'active'
    OR (subscription.status = 'past_due' AND now() < subscription.marketplaceGraceUntil)
```

Hostname configuration (`tenantSlug`, `customDomain`) has no bearing on marketplace eligibility. A tenant that has configured a custom domain does not automatically gain marketplace listing, and a tenant without a custom domain is not excluded.

### 2. `SubscriptionPlan` gains `marketplaceListingEnabled`

A new boolean column `marketplaceListingEnabled` is added to `SubscriptionPlan` (default `false`). It is set by Portal Admin when configuring plan tiers.

This is the correct home because:
- It follows the existing pattern of `customDomainEnabled` / `whitelabelEnabled`
- Plan-tier capability flags belong to the plan entity, not the subscription or channel
- A plan change immediately affects all subscriptions on that plan

### 3. `OrganizationSubscription` gains `marketplaceGraceUntil`

A new nullable column `marketplaceGraceUntil: Date | null` is added to `OrganizationSubscription`.

**Semantics:**
- Set to `now() + MARKETPLACE_GRACE_PERIOD` (default: 7 days, configurable via env) when the subscription transitions to `past_due`
- Cleared (`null`) when the subscription recovers to `active`
- Cleared when the subscription transitions to `cancelled`
- Not set by Razorpay `providerStatus` — it is a Saa9vi business-state field, not a provider-state mirror
- Evaluated using the Saa9vi server clock only

The grace period exists so that a brief payment failure does not immediately remove a tenant's academy from marketplace discovery, giving the dunning process time to recover the subscription before the listing disappears.

### 4. `MarketplaceIndexerService.indexSession()` gains a subscription eligibility check

The current eligibility rule:

```
visibility === PUBLIC AND status IN (SCHEDULED, LIVE)
```

becomes:

```
visibility === PUBLIC
AND status IN (SCHEDULED, LIVE)
AND channelMarketplaceEligible(session.channelId)
```

where `channelMarketplaceEligible(channelId)` evaluates:

```
subscription = findActiveSubscriptionForChannel(channelId)
if (!subscription) → false
plan = subscription.plan
if (!plan.marketplaceListingEnabled) → false
if (subscription.status === 'active') → true
if (subscription.status === 'past_due' && now() < subscription.marketplaceGraceUntil) → true
→ false
```

A missing subscription or a plan without `marketplaceListingEnabled` produces `false` (not an error). Sessions for ineligible channels are removed from the index by the F7 guard in `indexSession()`.

### 5. Grace period transitions are driven by Saa9vi FSM events, not provider webhooks

`marketplaceGraceUntil` is written by `SubscriptionRenewalService`:
- On `markPastDueFromWebhook()`: set `marketplaceGraceUntil = now() + grace`
- On `finalizeAfterPayment()` (successful recovery): clear `marketplaceGraceUntil = null`
- On `markCancelledFromWebhook()`: clear `marketplaceGraceUntil = null`

It is **not** derived from Razorpay `providerStatus`. The Saa9vi subscription FSM owns this field.

### 6. Explicit prohibition

The following are prohibited as marketplace eligibility signals:

```
❌ hostname / tenantSlug presence
❌ customDomain configuration
❌ Razorpay providerStatus
❌ provider subscription ID existence
❌ BillingAttempt count
```

---

## Consequences

### Required code changes

| Component | Change |
|---|---|
| `SubscriptionPlan` entity | Add `marketplaceListingEnabled: boolean` (default `false`) |
| `OrganizationSubscription` entity | Add `marketplaceGraceUntil: Date \| null` |
| `SubscriptionRenewalService.markPastDueFromWebhook()` | Set `marketplaceGraceUntil` |
| `SubscriptionRenewalService.finalizeAfterPayment()` | Clear `marketplaceGraceUntil` |
| `SubscriptionRenewalService.markCancelledFromWebhook()` | Clear `marketplaceGraceUntil` |
| `MarketplaceIndexerService.indexSession()` | Add `channelMarketplaceEligible()` check |
| Admin GraphQL schema | Expose `marketplaceListingEnabled` on plan type and input |
| Admin GraphQL schema | Expose `marketplaceGraceUntil` on subscription type |
| Migrations | 2 migrations via `npx vendure migrate -g` |

### Consumers of eligibility

| Consumer | Uses eligibility | Notes |
|---|---|---|
| `MarketplaceIndexerService` | ✅ | Primary enforcement point |
| `MarketplaceSearchResolver` | Indirect | Via indexed documents only |
| `TenantAdminResolver` | ✅ | Should surface plan capability to tenant dashboard |
| `SubscriptionRenewalService` | ✅ | Owns grace period transitions |
| Storefront routing | ❌ | Hostname routing is independent (G1) |
| `BbbChannelAccessService` | ❌ | Session access is entitlement-based, not plan-gated |

### Invariant additions (to `invariants.md`)

> **INV-024 — Marketplace listing eligibility is a subscription entitlement**
>
> A tenant channel's marketplace listing eligibility is determined solely by:
> (a) `SubscriptionPlan.marketplaceListingEnabled = true` AND
> (b) `OrganizationSubscription.status = 'active'` OR (`past_due` AND within grace period).
> Hostname configuration, `providerStatus`, and provider subscription existence
> are not eligibility signals.

---

## Migration note

Two schema migrations are required, both generated via Vendure CLI:

1. `npx vendure migrate -g add-marketplace-listing-enabled-to-plan` — adds `marketplaceListingEnabled BOOLEAN NOT NULL DEFAULT false` to `subscription_plan`
2. `npx vendure migrate -g add-marketplace-grace-until-to-subscription` — adds `marketplaceGraceUntil TIMESTAMP NULL` to `organization_subscription`

Existing plan rows default to `marketplaceListingEnabled = false` (opt-in, not opt-out). Portal Admin must explicitly enable marketplace listing per plan tier.

No data migration required for existing subscriptions — `marketplaceGraceUntil = null` is the correct initial value (no grace period in progress).
