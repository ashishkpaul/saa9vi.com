# Marketplace Commerce & Revenue — Implementation Worklist

**Status:** Proposed worklist based on ADR-055  
**Baseline:** repository `main` at `5dddb939c5d21f3830d305e5b8b094dd3ed87e84`; MCR checkout implementation branch based on that commit  
**Purpose:** Sequence future engineering work without reimplementing existing foundations. Re-inspect source and the active branch before every implementation slice.

## Mandatory rules

1. Inspect current Git branch, worktree, source and canonical documentation before coding. Confirm each task is still open.
2. Maintain INV-001: Channel = Tenant. Do not add a redundant `tenantId`.
3. Business data mutations use Vendure Shop/Admin GraphQL APIs; no direct SQL `INSERT`/`UPDATE`/`DELETE`.
4. Schema changes only through Vendure CLI migrations (`npx vendure migrate`).
5. Preserve INV-002 immutable billing facts and INV-004 persist-before-process webhook handling.
6. Keep Flow A and Flow B separate.
7. Do not use the Vendure default channel as checkout channel for tenant-owned products.
8. Initial cart/order is restricted to one tenant; do not add cross-tenant line items to one Vendure Order.
9. Do not claim a task complete without tests and a clearly stated runtime evidence boundary.

## Phase 0 — Contract and security design

### MCR-0.1 — Payment ownership and order provenance (P0)
- [x] Implement server-side owner resolution from persisted `BbbScheduledSession` → owning organization → Vendure Channel; reject the default Channel.
- [x] Verify Product and ProductVariant Channel assignments and the Product `bbbSessionId` back-reference.
- [x] Keep signed `marketplaceRef` as provenance only; checkout verifies it against the persisted Channel ID and exact session variant, never as payee authority.
- [x] Implement the initial provider scope as tenant Razorpay only; intersect Vendure's eligible payment-method quote with an enabled PaymentMethod assigned to the owner Channel and using `tenant-razorpay`.
- [x] Enforce one non-default tenant Channel per order; Flow A `platform-service` carts are rejected and Flow B `paymentPurpose=tenant-client` is stamped server-side.
- [ ] Reconcile/accept ADR-051, ADR-054 and ADR-055 across the full product/glossary/platform-story contract.
- [ ] Local focused tests, build and two-tenant Shop API E2E evidence pending.

### MCR-0.2 — Product and commercial taxonomy (P0)
- [ ] Audit Product/ProductVariant custom fields, `BbbScheduledSession.productVariantId`, `LearningCourse`, `CourseEnrollment`, `BbbProductAccess` and fulfilment handlers.
- [ ] Specify product type, billing model and fulfilment model independently.
- [ ] Define product variant mappings to course, session, service and physical fulfilment.
- [ ] Define compatibility rules: physical goods need inventory/shipping readiness; digital session access needs a valid session/resource link.
- [ ] Reuse existing fields/entities where sufficient; add fields only after proof of a gap and a CLI migration plan.
- [ ] Acceptance: every sellable product is classifiable without conflicting payment or fulfilment behavior.

### MCR-0.3 — Customer identity and channel handoff (P0)
- [x] Reject guest checkout in the service even though the entry resolver is reachable on the public Shop API.
- [x] Re-scope the authenticated context using the server-resolved Channel and require an existing Customer assigned to that Channel through `CustomerService.findOneByUserId(ctx, userId, true)`.
- [x] Do not rely on `TenantChannelAssignmentStrategy` as API authorization; do not auto-create a Customer or learner membership.
- [x] Verify the loaded active Order belongs to the authenticated user and exactly one non-default tenant Channel; reject foreign-tenant line items.
- [x] Keep payment purchase separate from academic admission/enrollment/entitlements; this checkout mutation grants no learning access.
- [ ] Same-email multi-Channel, suspension/leave/revoke and channel-switching tests plus storefront login/admission UX E2E remain pending.

## Phase 1 — Complete one-time tenant payments (Flow B)

### MCR-1.1 — Complete tenant one-time payment settlement (Flow B) (P0)

**Canonical source-level implementation tasks:** [Integration G-1 — tenant Razorpay settlement](integration-gaps-worklist.md#G-1--complete-tenant-razorpay-flow-b-settlement) and [G-2 — order-customer ownership](integration-gaps-worklist.md#G-2--prove-or-enforce-tenant-checkout-order-ownership). Keep detailed handler/security acceptance criteria in those tasks; do not maintain a second checklist here.

Commerce-programme outcome:
- Tenant checkout resolves credentials only from the trusted owning Channel.
- Vendure's normal PaymentMethodHandler / payment lifecycle verifies and settles the tenant order.
- Flow A platform-service payments and Flow B customer-to-tenant payments remain separate.
- Tests prove correct customer, order, amount, currency, channel and merchant account binding.

**Acceptance:** a real tenant one-time checkout settles the correct tenant-channel Vendure order through the supported Shop API. Provider-order creation alone is not completion.

### MCR-1.2 — Complete Flow B webhook and recovery lifecycle (P0)

**Canonical source-level implementation task:** [Integration G-3 — tenant Flow B webhook/recovery](integration-gaps-worklist.md#G-3--implement-tenant-flow-b-webhookrecovery-lifecycle). The detailed signature, inbox, idempotency and reconciliation criteria live there; do not duplicate them here.

Commerce-programme outcome:
- Tenant payment state converges from verified provider facts, not browser return state.
- Tenant webhook events are durably recorded before processing and are reconciled idempotently.
- Failures, delayed events and retries do not settle another tenant's order.

**Acceptance:** the tenant payment lifecycle recovers correctly from valid, invalid, duplicate, delayed and replayed provider events, with operator-visible reconciliation.

### MCR-1.3 — Marketplace tenant-channel checkout (P0)
- [x] Add `createMarketplaceSessionCheckout(sessionId, marketplaceRef?)` backed by a dedicated Checkout service/resolver; this first cut intentionally supports only public BBB sessions with a valid variant mapping.
- [x] Retrieve/validate seller, current listing state, Commercial Entitlement, Channel and Product/Variant mapping from persisted data; ignore any browser-supplied seller/channel/variant claim.
- [x] Use `RequestContext.copy(ownerChannel)`, target-Channel Customer validation and Vendure `ActiveOrderService.getActiveOrder` to establish/retrieve the authenticated buyer's target-Channel cart.
- [x] Reprice with Vendure `OrderService.addItemToOrder`; do not use the Elasticsearch price snapshot as checkout authority.
- [x] Return only eligible tenant Razorpay PaymentMethod codes and the public Channel token needed for subsequent Shop API routing; no secrets are returned.
- [x] Preserve valid attribution and set `paymentPurpose=tenant-client`; this mutation prepares the cart and does not itself create/capture a provider payment.
- [ ] Complete the storefront sequence (shipping/address as applicable, tenant Razorpay provider order, `addPaymentToOrder`, confirmation) and real two-tenant Shop API E2E verification.
- [ ] Local Vitest/build/codegen and commission E2E verification pending.

### MCR-1.4 — Tenant custom-domain storefront parity (P1)
- [ ] Ensure marketplace and custom-domain storefront share the same product/variant, price, stock, tenant order and payment source of truth.
- [ ] Verify tenant gateway resolution from channel context.
- [ ] Verify channel-aware auth/session/cache tags.
- [ ] Ensure custom-domain hosting is not required for marketplace listing or checkout.
- [ ] Acceptance: orders from either surface reconcile against the same tenant commerce domain, without duplicate catalogue records.

## Phase 2 — Learner subscriptions and digital fulfilment

### MCR-2.1 — Learner-to-tenant recurring lifecycle (P0)
- [ ] Keep `OrganizationSubscription` for tenant-to-Saa9vi only.
- [ ] Design a separate channel-scoped learner subscription bounded context.
- [ ] Model customer, course/service, plan, amount/currency, billing interval or fixed term, provider refs, paid period and status.
- [ ] Support initial authorization, provider-confirmed activation, renewals, payment attempts, failure, dunning, grace, cancellation and expiry.
- [ ] Keep billing attempt facts append-only and webhook inbox unique/persist-first.
- [ ] Define provider account ownership and tenant admin reconciliation controls.
- [ ] Acceptance: tests cover tenant isolation, duplicate/out-of-order webhooks, renewal, failure, recovery, cancellation and expiry.

### MCR-2.2 — Course enrollment and entitlement convergence (P0)
- [ ] Audit CourseEnrollment FSM, TenantLearnerMembership admission and BbbEntitlement contracts.
- [ ] Define verified subscription/order -> enrollment and entitlement activation.
- [ ] Define paid-period boundaries and past_due, grace, cancellation-at-period-end, immediate cancellation, refund/chargeback semantics.
- [ ] Extend entitlement on confirmed renewal; never issue indefinite access from a single payment.
- [ ] Ensure course access and BBB join authorization use server-side eligibility and tenant assertions.
- [ ] Acceptance: no paid access before verified payment/authorization; only relevant tenant resources extend; expiry revokes at policy boundary.

### MCR-2.3 — Free trial and sample access (P1)
- [ ] Preserve trial as no-payment/no-mandate by default.
- [ ] Define eligibility, one-trial-per-customer/session/course, duration, capacity, sample-content scope and abuse limits.
- [ ] Fix current failure path: trial registration may succeed even if entitlement creation fails. Use transactional or durable retry/reconciliation semantics.
- [ ] Ensure trial entitlement expires at the trial/session boundary and is distinct from paid subscription access.
- [ ] Require explicit post-trial subscription selection; no automatic charge/mandate.
- [ ] Acceptance: trial creates no payment records and only bounded access; conversion requires explicit checkout and verified tenant payment.

### MCR-2.4 — Digital fulfilment (P1)
- [ ] Define an idempotent digital fulfilment boundary after verified tenant order settlement.
- [ ] Map variants to course enrollment, recorded content, BBB session/room or service booking.
- [ ] Make fulfilment idempotent per order line/resource.
- [ ] Define cancellation, refund, expiry and chargeback behavior without rewriting immutable financial facts.
- [ ] Keep digital fulfilment separate from physical shipment workflows.
- [ ] Acceptance: paid and approved free paths grant only intended digital access and can be retried safely.

## Phase 3 — Physical listing and fulfilment

### MCR-3.1 — Marketplace physical listing readiness (P1)
- [ ] Support listing destination: tenant storefront, marketplace, or both.
- [ ] Do not require a tenant custom domain for marketplace physical-product listing.
- [ ] Gate marketplace listing on opt-in, published product, active payment method, inventory policy, shipping coverage/methods, tax and return/refund information.
- [ ] Keep marketplace visibility separate from Vendure default-channel product assignment.
- [ ] Acceptance: eligible physical products appear; unready products remain hidden/unavailable without mutating tenant source products.

### MCR-3.2 — Physical order lifecycle (P1)
- [ ] Verify tenant stock locations, stock allocation, tax, shipping methods, address validation and order transitions.
- [ ] Implement/verify tenant-owned picking, packing, dispatch, delivery, cancellation, return and refund.
- [ ] Ensure marketplace and tenant storefront checkout use the same tenant order/fulfilment source of truth.
- [ ] Keep physical delivery independent of digital entitlement expiry.
- [ ] Acceptance: marketplace-originated physical orders are fulfilled by the correct tenant and traceable end to end.

### MCR-3.3 — Multi-tenant shopping behavior (P2)
- [ ] Enforce one tenant per cart/order in initial release.
- [ ] Design seller-cart UX for another tenant's product.
- [ ] Defer parent checkout/orchestration until separate orders, payment attempts, refunds, shipment and status rollups are designed.
- [ ] Acceptance: no cross-tenant line items or payment ownership in a Vendure order.

## Phase 4 — Marketplace advertising

### MCR-4.1 — Inventory and placement model (P1)
- [ ] Audit existing campaign/banner scopes and sponsored ranking before adding entities.
- [ ] Define homepage, collection, sub-collection, sponsored listing and product/course detail placements.
- [ ] Set sponsored labels, relevance, moderation, quality, max density and frequency caps.
- [ ] Define campaign period, category/geography targeting and booking rules.
- [ ] Acceptance: every visible placement maps to an approved campaign and auditable inventory slot.

### MCR-4.2 — Impression/click metering (P1)
- [ ] Define impression eligibility (e.g. viewport-visible), dedupe keys, bot filtering and click validation.
- [ ] Deduplicate/validate impression and click events before charging.
- [ ] Reconcile event charges with AdWallet and immutable AdSpendLedger.
- [ ] Start with fixed campaign periods; add CPC/CPM only after event semantics are reliable.
- [ ] Report budget, spend, impressions, clicks, CTR, conversions and balance.
- [ ] Acceptance: no charge solely because an ad was returned in an API response; ledger facts reproduce campaign spend.

### MCR-4.3 — Ads UX and platform controls (P2)
- [ ] Tenant advertiser campaign setup, creative preview, approval and spend controls.
- [ ] Platform moderation, pause/resume, creative review and slot management.
- [ ] Advertiser reporting and invoice/receipt view.
- [ ] Acceptance: campaign lifecycle from creation to final auditable spend.

## Phase 5 — Saa9vi platform monetization

### MCR-5.1 — Optional tenant-domain storefront hosting (P1)
- [ ] Keep custom-domain hosting as an optional paid capability.
- [ ] Define plan limits, domain verification, SSL, hosting/deployment, support, resource quotas and suspension/deprovisioning.
- [ ] Keep hosting entitlement separate from marketplace listing eligibility.
- [ ] Acceptance: tenants can sell through marketplace without buying custom-domain hosting; hosted domains require an eligible Saa9vi plan.

### MCR-5.2 — BBB usage and capacity packaging (P1)
- [ ] Preserve ADR-047 grant-based and metered modes; do not conflate meeting-duration and learner-minute semantics.
- [ ] Define included quota, prepaid packages, monthly plan allowance and metered overage.
- [ ] Define rates, billing period, spend limits, suspension, reconciliation and tenant reporting.
- [ ] Treat recording storage/processing and premium support as separate specified add-ons, not assumed existing charges.
- [ ] Acceptance: every amount traces to immutable usage facts and a published rate/policy.

### MCR-5.3 — Flow A platform billing and invoicing (P2)
- [ ] Itemize SaaS, ad spend, storefront hosting and BBB usage with Saa9vi as payee and correct tax/invoice treatment.
- [ ] Keep one-time and recurring Flow A lifecycles separate where provider semantics differ.
- [ ] Acceptance: tenant billing view distinguishes Saa9vi invoices from tenant-client orders.

## Phase 6 — Release gates and operations

### MCR-6.1 — End-to-end tenant commerce matrix (P0)
- [ ] Two-tenant isolation: products, customers, carts, orders, payment methods, credentials, webhooks, stock and entitlements.
- [ ] Digital: marketplace and tenant storefront checkout, one-time, recurring, fixed-term, renewal failure and expiry.
- [ ] Trial: free, bounded entitlement, no mandate, explicit conversion.
- [ ] Physical: marketplace and tenant storefront checkout, inventory, shipping, cancellation, return and refund.
- [ ] Payment: wrong merchant, amount/currency mismatch, duplicate/replayed/delayed webhook, tenant disabled after order creation.
- [ ] Ads: placement eligibility, sponsored labels, event dedupe, spend limits and immutable ledger.
- [ ] Acceptance: tests run with real PostgreSQL, Redis/BullMQ, Elasticsearch and provider test accounts where required; fallback runtime is not production evidence.

### MCR-6.2 — Production playbooks and observability (P1)
- [ ] Tenant Razorpay onboarding, webhook setup, key rotation/revocation and compromised-key response.
- [ ] Refund/chargeback, learner dunning, entitlement recovery and shipping-return playbooks.
- [ ] Payment/webhook reconciliation dashboard, retry/dead-letter handling and alerting.
- [ ] Acceptance: operator can investigate failures without direct DB mutation or secret disclosure.

## Suggested delivery order

1. MCR-0 contract/security and customer identity.
2. MCR-1 complete Flow B one-time settlement, webhooks and marketplace tenant-channel checkout.
3. MCR-2 learner subscription, digital fulfilment and trial reliability.
4. MCR-3 physical listing readiness and fulfilment.
5. MCR-4 advertising inventory and measurement.
6. MCR-5 storefront hosting and BBB commercial packaging.
7. MCR-6 end-to-end release gates and operating playbooks.

Do not start marketplace checkout UI before MCR-1.1/MCR-1.2 establishes a valid tenant-channel settlement contract. Do not ship recurring learner checkout before MCR-2.1 defines subscription and entitlement-period semantics.


## MCR checkout implementation snapshot — 17 November 2026

The feature branch `feat/marketplace-tenant-channel-checkout` adds a source-level first slice for MCR-0.1, MCR-0.3 and MCR-1.3. It does **not** change ADR-055's `PROPOSED` status and does not claim the whole marketplace checkout journey is complete.

The GraphQL mutation is `createMarketplaceSessionCheckout(sessionId, marketplaceRef)`. The response establishes the owning Channel's active cart, tenant-calculated total and eligible `tenant-razorpay` PaymentMethod codes. The storefront then continues through the normal tenant Shop API lifecycle. This mutation does not place/settle the order, grant a learner membership, create a course enrollment or issue a BBB entitlement.

No new entity/table or database migration is introduced by this slice. Generated Shop schema/codegen output and local verification must be refreshed after pulling. The G-3 `TenantPaymentWebhookEvent` CLI migration remains an independent Flow B release prerequisite.
