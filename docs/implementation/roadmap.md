# Saa9vi Product & Engineering Roadmap

**Updated:** 17 November 2026  
**Baseline:** `main` at `1c0a5a7d7c3dece131ae977a5c7416e41815a8a7`

> **Purpose:** Show the strategic programmes, their current state and their exit outcomes. This file is not a task tracker and does not repeat detailed implementation checklists.

## How to read this roadmap

- **Implemented foundation** means the repository contains the relevant backend/UI capability; it does not imply production readiness.
- **Open** means a known implementation or verification gap remains.
- **Proposed** means an agreed product direction or target architecture has not yet been implemented.
- Detailed work and acceptance criteria belong in the linked worklists. Production evidence belongs only in `production-readiness.md`.

## Programme roadmap

| Programme | Target outcome | Current state | Canonical execution source |
|---|---|---|---|
| **1. Tenant foundation and reachability** | A tenant can register, configure its academy and be reached through the central marketplace route or its verified custom domain. | Registration, Channel=Tenant and custom-domain mapping foundations exist. Storefront onboarding, route contract and deployed proxy verification remain open. Generated `*.saa9vi.com` seller storefront subdomains are retired. | [Integration gaps — Tracks A/B](integration-gaps-worklist.md), [G1 hostname decision](g1-hostname-contract-decision.md) |
| **2. Saa9vi subscriptions and BBB operations** | Tenants subscribe to Saa9vi plans and receive capacity/services; BBB usage is measured and billed according to the tenant plan. | Subscription and BBB capacity/usage foundations exist. Provider/runtime and production release evidence remains separately gated. | [Production readiness](production-readiness.md), [ADR-047](../architecture/adr-047-bbb-attendee-hour-billing.md), [RFC-001](../adr/rfc-001-continuous-commerce-loop.md) |
| **3. Learning and digital delivery** | Tenants manage courses and services; learners trial, subscribe/enroll, attend classes and access content for the valid period. | LearningPlugin backend entities, Admin APIs and authenticated learner reads exist. Learner invitation/self-enrollment, the complete learner storefront, and learner-to-tenant recurring subscriptions remain open. | [ADR-053](../adr/adr-053-learning-plugin-course-domain.md), [Learning domain](../architecture/learning-domain.md), [MCR worklist](marketplace-commerce-revenue-worklist.md) |
| **4. Zero-commission marketplace commerce** | Learners and customers discover tenant products and can check out on the marketplace while orders and payments remain in the owning tenant Channel. | Search, attribution and zero-commission ledger foundations exist. Marketplace-hosted tenant-channel checkout is a proposed target; Flow B tenant payment settlement/webhooks are incomplete. | [ADR-055](../adr/adr-055-marketplace-commerce-and-revenue-model.md), [MCR worklist](marketplace-commerce-revenue-worklist.md), [Integration Track G](integration-gaps-worklist.md#track-g--current-code-audit-follow-ups-baseline-2026-11-16) |
| **5. Marketplace advertising** | Tenants/advertisers buy homepage, collection, sub-collection, sponsored listing and product/course detail placements with auditable spend. | AdWallet, AdSpendLedger, campaign spend, banner scope, sponsored boost and Admin/dashboard foundations are present. Remaining placement inventory, impression/click semantics and reporting are tracked separately. | [Phase 3 audit](phase3-audit.md), [MCR worklist](marketplace-commerce-revenue-worklist.md) |
| **6. Physical commerce and fulfilment** | Tenants can sell books and physical goods on the marketplace, their own storefront, or both, while fulfilling orders themselves. | Product discovery and Vendure commerce foundations exist; marketplace listing-readiness policy and complete physical fulfilment acceptance need implementation/verification. Custom-domain hosting is not a prerequisite for marketplace sales. | [ADR-055](../adr/adr-055-marketplace-commerce-and-revenue-model.md), [MCR worklist](marketplace-commerce-revenue-worklist.md) |
| **7. Premium services and scale** | Saa9vi monetizes optional tenant-domain storefront hosting, premium capacity/support and future platform capabilities. | Some theming and capacity foundations exist. Commercial packaging, operational limits and scale features remain staged work. | [Subscription/hosting ADRs](../architecture/), [MCR worklist](marketplace-commerce-revenue-worklist.md) |

## Delivery order

1. **Establish reliable tenant reachability and onboarding.** Keep the retired generated-subdomain model retired. The central `/sellers/{tenantSlug}` route is the fallback storefront identity; a seller-owned verified custom domain is optional.
2. **Complete tenant-client payment collection (Flow B).** Finish the tenant PaymentMethodHandler, settlement, order-customer ownership proof and tenant webhook/reconciliation path before enabling real tenant checkout.
3. **Implement marketplace tenant-channel checkout.** Marketplace UI may host checkout, but each initial cart/order belongs to one tenant Channel. Do not create tenant-owned orders in the default marketplace Channel.
4. **Build the learner subscription and digital fulfilment lifecycle.** Keep learner subscriptions separate from tenant-to-Saa9vi `OrganizationSubscription`; retain free trials as no-payment, bounded access by default.
5. **Complete physical listing readiness and fulfilment.** Allow marketplace, tenant storefront or both, gated by tenant opt-in, payment readiness, inventory, shipping, tax and returns policy.
6. **Expand advertising inventory and measurement.** Define valid billable impressions/clicks before enabling CPC/CPM charging.
7. **Package optional hosting and BBB commercial plans.** Keep tenant-domain hosting optional; preserve separate BBB usage facts and billing modes.

## Release and completion rules

- A roadmap programme may be implementation-complete while its live-provider or production-readiness gates remain open.
- Do not treat code presence, schema presence or unit tests as production evidence.
- Keep cross-tenant marketplace purchases out of the initial scope until independent tenant orders, payment attempts, refunds and fulfilment are designed.
- Keep tenant-client commission at 0%. Saa9vi revenue streams are tenant SaaS subscriptions, advertising, optional tenant-domain storefront hosting, BBB usage/capacity and optional platform services.

## Source-of-truth documents

| Question | Document |
|---|---|
| What does the product do? | [Platform story](../product/platform-story.md) |
| What is the marketplace commerce policy? | [ADR-055](../adr/adr-055-marketplace-commerce-and-revenue-model.md) and [policy](../product/marketplace-commerce-policy.md) |
| What should engineering implement next in commerce? | [MCR implementation worklist](marketplace-commerce-revenue-worklist.md) |
| What are the broader integration gaps? | [Integration gaps worklist](integration-gaps-worklist.md) |
| Is the system ready to release? | [Production readiness](production-readiness.md) |
| What has shipped? | [Release notes](release-notes.md) |

## Historical detail

The detailed build-order checklists and status narrative formerly embedded in this roadmap are preserved in [the 16 November 2026 roadmap archive](archive/roadmap-2026-11-16.md). That snapshot is historical and must not be used as the current task list.
