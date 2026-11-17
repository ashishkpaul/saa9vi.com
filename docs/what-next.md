# What Next — Saa9vi

**Updated:** 17 November 2026  
**Repository baseline:** `main` at `5dddb939c5d21f3830d305e5b8b094dd3ed87e84`

> **Purpose:** Give the team one current, ordered view of the next actions. This file summarizes priorities; detailed tasks and acceptance criteria remain in the canonical worklists linked below.

## 1. Current baseline

| Area | Current state | Main outstanding work |
|---|---|---|
| Tenant identity and storefront reachability | Channel=Tenant is the platform boundary. Generated seller subdomains (`{tenantSlug}.saa9vi.com`) are retired. `tenantSlug` is an internal identity used by the central `/sellers/{tenantSlug}` route; seller-owned verified custom domains are optional. | Reconcile the remaining storefront route/onboarding and deployed proxy checks with the retired-subdomain decision. See integration worklist B-1, B-3 and B-5. |
| Saa9vi tenant subscriptions | SubscriptionPlugin and tenant self-service plan-change/cancellation API foundations are present. | Live provider and production verification remain governed by `production-readiness.md`. |
| BBB access and usage billing | Entitlement, capacity-grant and grant/metered usage foundations exist. | Refund/reversal semantics, usage reconciliation and production evidence remain separate release gates. |
| Learning platform | LearningPlugin entities, Admin APIs and authenticated learner read APIs exist. | Learner invitation/self-enrollment, template CRUD and the complete learner/instructor storefront remain open. Learner-to-tenant recurring billing is a separate future lifecycle. |
| Tenant-client payments (Flow B) | Tenant account configuration, G-1 `tenant-razorpay` PaymentMethodHandler and settlement, G-2 order/customer ownership, and G-3 tenant webhook controller/inbox/worker are present in source. User-reported focused regression evidence: 55/55 tests passed; build output showed no TypeScript diagnostics. | CLI-generated migration for `TenantPaymentWebhookEvent` and Channel join table; real Razorpay Test Mode checkout and signed webhook delivery/recovery verification remain open. |
| Marketplace | Cross-tenant search, signed provenance and zero-commission ledger exist. MCR-0.1/MCR-0.3/MCR-1.3 first backend session-checkout slice is on feature branch `feat/marketplace-tenant-channel-checkout`. | Pull-request local verification, generated Shop schema, same-email/two-tenant and full Shop API E2E, storefront checkout integration and provider-level verification remain open. |
| Advertising | AdWallet, AdSpendLedger, campaigns, sponsored ranking and banner-scope foundations exist. | Expand approved inventory, define billable impression/click events and complete measurement/reporting. |
| Physical commerce | Tenant-channel commerce foundations can support seller-owned products. | Marketplace physical-listing readiness and full stock/shipping/returns/refund acceptance need implementation and verification. |

## 2. Next execution order

### P0 — Complete tenant-client payment collection and release prerequisites

1. **G-3 schema/release gate:** generate and verify the `TenantPaymentWebhookEvent` + Channel join-table migration using `npx vendure migrate --generate`, then apply it through the Vendure CLI in the target environment. Do not hand-write SQL or mark G-3 production-ready before provider-level verification.
2. **Flow B provider evidence:** run Razorpay Test Mode checkout, real signed tenant webhook delivery, retry/replay and recovery tests after migration. G-1/G-2/G-3 source foundations and the reported focused tests do not replace these runtime checks.
3. **Role repair policy:** resolve the existing tenant-role permission repair conflict through an approved Admin GraphQL path before operating repair tooling. See [G-4](implementation/integration-gaps-worklist.md#G-4--bring-tenant-role-permission-repair-into-the-graphql-mutation-policy).

Do not treat provider-order creation, passing unit tests or source registration alone as production checkout evidence.

### P0 — Marketplace tenant-channel checkout contract

4. **MCR local verification:** pull `feat/marketplace-tenant-channel-checkout`, run its focused Vitest test, `npm run codegen`, `npm run build`, and commission E2E; report failures before merging.
5. **MCR two-tenant E2E and storefront integration:** verify target Channel switch, Customer association, cart separation, exact tenant PaymentMethod eligibility, order owner and zero-commission attribution. Then wire the Next.js flow to continue through tenant Shop API checkout. See [MCR-0.1 to MCR-0.3 and MCR-1.3](implementation/marketplace-commerce-revenue-worklist.md).

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
