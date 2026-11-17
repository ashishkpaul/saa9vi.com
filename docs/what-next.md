# What Next — Saa9vi

**Updated:** 17 November 2026  
**Repository baseline:** `main` at `1c0a5a7d7c3dece131ae977a5c7416e41815a8a7`

> **Purpose:** Give the team one current, ordered view of the next actions. This file summarizes priorities; detailed tasks and acceptance criteria remain in the canonical worklists linked below.

## 1. Current baseline

| Area | Current state | Main outstanding work |
|---|---|---|
| Tenant identity and storefront reachability | Channel=Tenant is the platform boundary. Generated seller subdomains (`{tenantSlug}.saa9vi.com`) are retired. `tenantSlug` is an internal identity used by the central `/sellers/{tenantSlug}` route; seller-owned verified custom domains are optional. | Reconcile the remaining storefront route/onboarding and deployed proxy checks with the retired-subdomain decision. See integration worklist B-1, B-3 and B-5. |
| Saa9vi tenant subscriptions | SubscriptionPlugin and tenant self-service plan-change/cancellation API foundations are present. | Live provider and production verification remain governed by `production-readiness.md`. |
| BBB access and usage billing | Entitlement, capacity-grant and grant/metered usage foundations exist. | Refund/reversal semantics, usage reconciliation and production evidence remain separate release gates. |
| Learning platform | LearningPlugin entities, Admin APIs and authenticated learner read APIs exist. | Learner invitation/self-enrollment, template CRUD and the complete learner/instructor storefront remain open. Learner-to-tenant recurring billing is a separate future lifecycle. |
| Tenant-client payments (Flow B) | Tenant Razorpay account configuration/encryption and tenant-channel provider-order creation exist. | No tenant PaymentMethodHandler is registered; settlement is not wired through Vendure's payment lifecycle; tenant webhook inbox/reconciliation and order-owner proof remain open. |
| Marketplace | Cross-tenant search projections, signed attribution and zero-commission ledger foundations exist. | Marketplace-hosted tenant-channel checkout is a target, not an implemented capability. It depends on Flow B settlement/webhooks and customer/channel isolation. |
| Advertising | AdWallet, AdSpendLedger, campaigns, sponsored ranking and banner-scope foundations exist. | Expand approved inventory, define billable impression/click events and complete measurement/reporting. |
| Physical commerce | Tenant-channel commerce foundations can support seller-owned products. | Marketplace physical-listing readiness and full stock/shipping/returns/refund acceptance need implementation and verification. |

## 2. Next execution order

### P0 — Complete tenant-client payment collection

1. **Flow B settlement:** register the tenant-aware Vendure `PaymentMethodHandler`, resolve credentials only from the trusted tenant Channel, bind customer/order/amount/currency/provider payment and settle through Vendure's normal payment lifecycle. See [G-1](implementation/integration-gaps-worklist.md#G-1--complete-tenant-razorpay-flow-b-settlement).
2. **Order ownership:** prove or explicitly enforce same-channel customer ownership for the active-order and explicit-order paths. Add adversarial cross-customer tests. See [G-2](implementation/integration-gaps-worklist.md#G-2--prove-or-enforce-tenant-checkout-order-ownership).
3. **Tenant webhook recovery:** implement tenant-specific signed webhook ingress, persist-first inbox, idempotent processing, provider-truth reconciliation and recovery. See [G-3](implementation/integration-gaps-worklist.md#G-3--implement-tenant-flow-b-webhookrecovery-lifecycle).

Do not enable tenant-client checkout or start marketplace checkout UI on the basis of provider-order creation alone.

### P0 — Marketplace tenant-channel checkout contract

4. Resolve product ownership and customer identity server-side. Implement marketplace cart/order/payment operations in the owning tenant Channel, with channel-eligible payment methods and a one-tenant-per-cart/order initial rule. Preserve signed `marketplaceRef` as attribution only. See [MCR-0.1 to MCR-0.3 and MCR-1.3](implementation/marketplace-commerce-revenue-worklist.md).

### P0/P1 — Learner subscription and digital fulfilment

5. Design learner-to-tenant recurring subscriptions separately from tenant-to-Saa9vi `OrganizationSubscription`.
6. Define how verified payments and subscription periods activate `CourseEnrollment` and time-bounded digital/BBB entitlements, including renewal, grace, expiry, cancellation, refund and chargeback rules.
7. Harden free-trial registration so it cannot report success if its bounded trial entitlement was not created. Keep trial no-payment/no-mandate by default; require an explicit learner choice to convert to a paid plan.
8. Complete learner enrollment/invitation decisions and the Next.js learner/instructor experience. See [G-5](implementation/integration-gaps-worklist.md#G-5--complete-learningplugin-learnerinstructor-product-workflow) and [MCR Phase 2](implementation/marketplace-commerce-revenue-worklist.md).

### P1 — Storefront reachability and physical fulfilment

9. Reconcile tenant onboarding and storefront route implementation to the current contract: no generated seller subdomains; use the central seller route or a verified seller-owned custom domain. Verify proxy trust and channel isolation against the deployed configuration. See [integration Tracks A/B](implementation/integration-gaps-worklist.md) and [G1 hostname decision](implementation/g1-hostname-contract-decision.md).
10. Allow a tenant to list a physical product on marketplace, tenant storefront, or both. Gate marketplace publication on tenant opt-in, payment readiness, inventory, shipping/delivery, tax and returns/refund information. Verify the full tenant-owned physical order lifecycle. See [MCR Phase 3](implementation/marketplace-commerce-revenue-worklist.md).

### P1/P2 — Monetization and operational controls

11. Expand homepage, collection/sub-collection, sponsored listing and product/course detail advertising inventory; define deduplicated, fraud-resistant impressions/clicks before usage-based ad billing.
12. Package optional tenant-domain storefront hosting and BBB included/prepaid/metered capacity without coupling hosting eligibility to marketplace participation.
13. Resolve the tenant role-repair operational-policy conflict through an approved Admin GraphQL path; do not run the current repository-write repair mode. See [G-4](implementation/integration-gaps-worklist.md#G-4--bring-tenant-role-permission-repair-into-the-graphql-mutation-policy).

## 3. Production-readiness is a separate release gate

The production-readiness record currently reports **NOT READY**. Implementation progress must not be used to infer release readiness.

At the latest documented evidence baseline:
- R2 recurring subscription work has code/test coverage and earlier runtime evidence, but post-refactor/live-provider closure remains open.
- R3 one-time commerce has a code/test foundation; a real Razorpay Test Mode payment, provider webhook lifecycle and failure/refund evidence are not yet established in that record.
- R4 BBB paid-access/usage has recorded end-to-end evidence from 25 September 2026, while refund/reversal and reconciliation remain outstanding.
- Production safety items (including fail-fast PostgreSQL/Redis behavior, secrets, CORS/GraphiQL, asset storage, email mode, rate limiting and backup/restore) remain governed by their individual evidence states in `production-readiness.md`.

Use [Production Readiness](implementation/production-readiness.md) as the sole release-evidence checklist. Re-check it against the current source and deployed environment before changing any status.

## 4. Worklist ownership — avoid duplicate task tracking

| Workstream | Canonical detail |
|---|---|
| Tenant routing, marketplace deep links, existing integration gaps, Flow B G-1/G-2/G-3, role repair and LearningPlugin API gaps | [Integration gaps worklist](implementation/integration-gaps-worklist.md) |
| Marketplace commerce, learner subscription, digital/physical fulfilment and Saa9vi revenue work | [Marketplace Commerce & Revenue worklist](implementation/marketplace-commerce-revenue-worklist.md) |
| Strategic programmes and phase sequencing | [Roadmap](implementation/roadmap.md) |
| Release gates and operational verification | [Production readiness](implementation/production-readiness.md) |
| Product actor journeys | [Platform story](product/platform-story.md) |

Completed work should be recorded in [release notes](implementation/release-notes.md) and its canonical worklist. Do not maintain separate copies of the same task status in this document.

## 5. Historical snapshots

The long chronological execution notes previously contained in this file are preserved in [the 16 November 2026 What Next archive](implementation/archive/what-next-2026-11-16.md). That archive is historical evidence, not the current next-action list.
