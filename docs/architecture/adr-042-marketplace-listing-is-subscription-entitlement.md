# ADR-042: Marketplace Listing Is a Subscription Entitlement

**Status:** Accepted — implementation pending
**Date:** 2026-09-21
**Related:** ADR-038 (direct Razorpay provider), ADR-039 (provider-wired subscription lifecycle), ADR-041 (provider-cycle billing period identity), G1 hostname contract decision (2026-09-15), INV-001 (Channel = tenant identity)

> **Implementation status (2026-09-21):** The architecture is accepted, but the required implementation is **not yet present in `src/`**. `SubscriptionPlan.marketplaceListingEnabled`, `OrganizationSubscription.marketplaceGraceUntil`, and `MarketplaceIndexerService.channelMarketplaceEligible()` do not exist in the codebase yet. This ADR records the decision; implementation is scheduled as **slice 7** of the Free Basic / storefront commercial programme (`docs/implementation/saa9vi-comprehensive-integration-and-commercial-plan.md` §3.4). There is no separate "M0" workstream entry in `integration-gaps-worklist.md` — the earlier reference to one was inaccurate. Marketplace eligibility is a **separate** entitlement from ADR-043 L1 white-label theming and must not be conflated with it.
>
> **Invariant tooling note (2026-09-22):** INV-024 is already recorded in `docs/architecture/invariants.md`, but no structural checker exists for it — `AdrChecker.check()` has no marketplace sub-check (contrast `tenantThemeInvariants()` for ADR-043). Implementing this ADR must add one, per `.clinerules` §9.

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
