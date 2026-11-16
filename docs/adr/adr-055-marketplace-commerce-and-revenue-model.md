# ADR-055 — Marketplace Commerce, Tenant Payment Ownership, and Revenue Model

**Status:** PROPOSED — product direction agreed in discussion; engineering contract and implementation gates require review  
**Date:** 16 November 2026

## Context

Saa9vi is a multi-tenant education and commerce platform. A tenant is represented by a Vendure Channel (INV-001). The marketplace provides shared discovery and checkout experiences without becoming the recipient of tenant-client funds or charging commission on tenant-client sales.

Two payment relationships remain separate:

- **Flow A — Tenant pays Saa9vi:** tenant administrators pay Saa9vi for platform subscriptions, BBB usage, advertising, optional tenant-domain storefront hosting and platform services. Saa9vi's platform payment account is used.
- **Flow B — Customer pays tenant:** a learner/customer pays the tenant for courses, digital learning products, services, books and physical products. The tenant's payment gateway is used. Marketplace commission is 0%.

The marketplace can host product discovery and checkout while the authoritative Vendure order and payment remain tenant-channel scoped. A tenant-owned custom-domain storefront is optional, not a prerequisite for marketplace participation or marketplace checkout.

## Decisions proposed

### D1 — Zero commission on tenant-client commerce

Saa9vi commission on tenant-client transactions is 0%. Saa9vi does not deduct, withhold, split or settle a percentage of tenant-client payments. `CommissionLedger` zero-value attribution records may preserve GMV and marketplace attribution history; they are analytics facts, not payable commission.

### D2 — Shared marketplace checkout uses the tenant channel

The marketplace may provide product/course/service details, cart, checkout UI, customer details, payment-method presentation and order status. However, tenant-owned products must never be checked out through the Vendure default marketplace channel.

The server resolves the authoritative tenant Channel for every listing and creates/operates the cart and order through that tenant's Shop API context. The browser must not choose the authoritative `channelId`, payee, credential, payment purpose or order owner.

The marketplace and a tenant's optional custom-domain storefront are two experiences for the same tenant-owned catalogue and commerce lifecycle. Both use tenant-channel prices, stock, payment configuration, customer/channel rules, orders and fulfilment.

Initial contract: one tenant per cart/order. A shopper buying from multiple tenants has separate seller carts/orders. Cross-tenant checkout orchestration is deferred; do not create a default-channel order containing products owned by multiple tenants.

### D3 — Storefront, payment recipient and fulfilment are different concerns

1. **Storefront experience:** Saa9vi marketplace or tenant's optional custom-domain storefront.
2. **Payment recipient:** tenant for Flow B; Saa9vi for Flow A.
3. **Fulfilment owner:** tenant, with digital and physical fulfilment handled separately.

Marketplace attribution is signed provenance. It is not payment-routing authority or proof of product ownership.

### D4 — Product type, billing model and fulfilment model are independent

The domain model should distinguish:

| Dimension | Initial vocabulary |
|---|---|
| Product type | Digital course, recorded content, live service, consultation, workshop, physical book, physical merchandise |
| Billing model | Free, one-time, recurring subscription, fixed-term subscription, per-session, package |
| Fulfilment model | Digital entitlement/enrollment, scheduled service/booking, physical order fulfilment |

These are proposed concepts. Reuse Vendure Product/Variant custom fields and existing Saa9vi entities where appropriate. Do not introduce duplicate product/catalogue entities without an audited gap.

### D5 — Learner subscriptions are separate from tenant SaaS subscriptions

`OrganizationSubscription` remains the tenant's subscription to Saa9vi. It must not be reused for a learner's subscription to a tenant course or service.

Ongoing courses/coaching programmes should prefer recurring learner subscriptions. A fixed-term course may use an upfront term payment. Standalone downloads, workshops, per-session consultations and physical books need not be forced into recurring billing.

A learner subscription lifecycle must be tenant/channel scoped and model customer, course/service, plan amount/currency, billing interval or fixed term, provider references, paid periods, status, payment attempts, renewal, grace, cancellation, expiry and reconciliation. Billing facts remain append-only; webhooks remain persist-first and idempotent.

Payment settlement is not permanent course access. Entitlement validity follows the paid period and explicit grace/expiry policy.

### D6 — Free trial is separate no-payment access

A zero-stage trial session or sample period is free by default. Registration does not create a paid order, charge, recurring mandate or automatic subscription. Trial scope is bounded by the session or trial period. The learner explicitly selects a paid subscription/term after the trial.

The existing `BbbTrialRegistration` and trial-origin `BbbEntitlement` path is the starting point. It must be made reliable: registration must not silently succeed when entitlement creation fails; use a transaction or durable retry/reconciliation contract.

Optional auto-conversion may only be considered later with explicit consent and valid payment authorization; it is out of initial scope.

### D7 — Physical goods may be sold on both storefronts

A physical product may be tenant-storefront only, marketplace only, or listed on both. Tenant custom-domain hosting is not required for marketplace physical sales.

Marketplace physical listing readiness requires tenant opt-in, published/available product, enabled tenant payment method, inventory policy, shipping/delivery coverage, tax and returns/refund policy, and tenant responsibility for fulfilment and support. The marketplace is a storefront surface; it is not the merchant or fulfilment operator.

### D8 — Digital and physical fulfilment are separate

**Digital fulfilment** after verified payment or an approved free/admission policy may activate `CourseEnrollment`, grant/update time-bounded `BbbEntitlement`, unlock recorded content, associate scheduled sessions and apply subscription access rules.

**Physical fulfilment** after verified payment and order checks may reserve stock, create fulfilment, and track packing, dispatch, delivery, cancellation, return and refund.

Do not use digital entitlement revocation semantics to manage shipped goods. A later subscription payment failure must not reverse a completed physical delivery.

### D9 — Advertising is a principal marketplace revenue stream

Proposed inventory:
- Homepage banners.
- Collection and sub-collection banners.
- Sponsored product/course/instructor listings.
- Product/course detail-page placements.

Campaign pricing may support fixed periods first and later CPC/CPM. Sponsored placements must be labelled and governed by relevance, moderation, quality, frequency caps and page-level ad density.

`AdWallet` and immutable `AdSpendLedger` are the foundation. Charge against defined, deduplicated, fraud-resistant impression/click events, not merely because an ad was returned in an API response.

### D10 — Saa9vi revenue streams remain separate

| Revenue stream | Payer | Payee | Basis |
|---|---|---|---|
| SaaS subscription | Tenant admin | Saa9vi | Recurring plan |
| BBB usage/capacity | Tenant admin | Saa9vi | Included quota, prepaid or metered usage |
| Marketplace advertising | Tenant/advertiser | Saa9vi | Campaign fee, CPC/CPM or fixed placement |
| Tenant-domain storefront hosting | Tenant admin | Saa9vi | Recurring hosting plan |
| Optional platform services | Tenant admin | Saa9vi | Contracted service fee |

No stream introduces commission on tenant-client commerce. BBB usage remains separate from learner course pricing and tenant SaaS subscription billing.

## Target flows

### Marketplace digital purchase

```text
Marketplace discovery
  -> server resolves owning tenant
  -> tenant-channel cart/order
  -> eligible payment method for that channel
  -> tenant gateway checkout
  -> provider payment verified and order settled
  -> digital fulfilment
  -> course enrollment / time-bounded entitlement
  -> learner access
  -> renewal or expiry updates entitlement
```

### Free trial to paid course

```text
Discover course
  -> register free trial (no payment/mandate)
  -> grant limited trial entitlement
  -> attend sample session / access sample content
  -> learner explicitly selects a tenant plan
  -> tenant recurring authorization/payment
  -> provider-confirmed state
  -> activate enrollment and paid-period entitlement
  -> renew / grace / expire / cancel
```

### Marketplace physical purchase

```text
Marketplace or tenant storefront
  -> tenant-channel cart/order
  -> tenant stock, shipping, tax and returns checks
  -> tenant payment gateway
  -> verified payment and order settlement
  -> tenant-owned physical fulfilment
  -> dispatch / delivery / returns / refund
```

## Vendure and Saa9vi constraints

- INV-001 remains binding: Channel = Tenant; do not add a redundant `tenantId`.
- Default channel may serve a shared discovery catalogue, but it is not the checkout/merchant channel for tenant-owned goods.
- Default-channel product assignment does not imply marketplace publication; apply separate listing policy.
- Vendure product variants have channel-specific prices. A shared catalogue price is not automatically the tenant checkout price.
- Resolve and verify tenant ownership server-side on cart/order/payment mutations.
- Never select tenant credentials from browser-supplied channel/payee values.
- Preserve signed marketplace attribution; it is provenance, not payment authority.
- Customer registration/authentication and cross-channel assignment need explicit design and tests. Never expose customer data across tenants.
- Initial carts/orders contain one tenant only.
- Business data mutations use Vendure Shop/Admin GraphQL APIs; schema changes use Vendure CLI migrations.
- Webhook inboxes are persist-first and idempotent; billing facts are append-only.

## Current baseline and known gaps

Source/doc baseline reviewed: `main` at `cc374cd` and dated review `docs/architecture/plugin-code-review-2026-11-16.md`. This is not a live provider or production test.

Confirmed foundations:
- Flow A platform one-time payments and a separate tenant SaaS recurring lifecycle exist.
- `TenantPaymentAccount` and encrypted per-tenant Razorpay credentials exist.
- `createTenantRazorpayCheckoutOrder` creates a provider order using credentials resolved from `ctx.channelId`.
- `TenantRazorpayService.verifyAndSettle()` contains checks but is not wired to a tenant `PaymentMethodHandler`/Vendure `addPaymentToOrder`.
- Tenant-specific Flow B webhook inbox/worker/reconciliation are absent in the reviewed baseline.
- Course/enrollment entities, Admin management and learner read APIs exist.
- `TrialRegistrationService` creates a free trial registration and trial entitlement; entitlement creation failure is currently caught/logged while registration still succeeds.
- `AdWallet`, `AdSpendLedger`, campaigns and sponsored ranking have foundations; exact placement and charge semantics need verification.
- BBB grant and metered usage facts are separate. ADR-047 governs the metered usage definition; do not conflate it with grant-based billing.

Not claimed:
- No production tenant merchant checkout or webhook has been exercised by this ADR.
- No complete learner recurring subscription lifecycle is claimed.
- No marketplace shared checkout or multi-seller orchestration is claimed complete.
- No physical shipping/return production lifecycle is claimed complete.

## Consequences

- Marketplace checkout is tenant-channel commerce, not a default-channel payment flow.
- Custom-domain storefront hosting is optional and separately billable.
- The same product may appear on both storefronts without duplicate product records.
- Flow B requires a complete handler, webhook/reconciliation path, storefront integration and security tests.
- Learner subscriptions require a separate bounded context from tenant SaaS subscriptions.
- Digital and physical fulfilment require separate workflows and acceptance criteria.

## Review gates before acceptance

1. Confirm initial Flow B provider scope (Razorpay-only or provider-neutral tenant gateway abstraction).
2. Confirm learner recurring terms, grace window, dunning and access policy.
3. Confirm customer identity strategy for marketplace checkout across tenant channels.
4. Confirm initial inventory, shipping, tax, cancellation, return and refund workflow.
5. Confirm advertising placement, pricing-event and anti-fraud rules.
6. Update status after technical review; documentation is not implementation evidence.

## Related

- ADR-051 — seller payment model and tenant Razorpay exposure
- ADR-054 — per-tenant Razorpay Flow B implementation boundary
- ADR-042 — marketplace listing eligibility
- ADR-047 — BBB usage billing
- ADR-053 — LearningPlugin course domain
- `docs/product/platform-story.md`
- `docs/implementation/marketplace-commerce-revenue-worklist.md`
