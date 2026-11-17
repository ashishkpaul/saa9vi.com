# Platform Story

> **Purpose:** Explain Saa9vi through the journeys of the people and businesses using it. This is the product-level narrative; implementation details, state machines and infrastructure flows belong in `docs/architecture/` and the implementation worklists.

## What Saa9vi is

Saa9vi is a multi-tenant education business and commerce platform for coaching institutes, tutors, trainers and academies. A tenant manages its own learners, instructors, courses, live teaching, services and physical learning products. Saa9vi provides shared discovery, optional tenant-branded storefront hosting, learning/live-class infrastructure and platform services.

The platform follows a zero-commission model: tenants receive payments from their own customers. Saa9vi earns from platform subscriptions, marketplace advertising, optional storefront hosting, BigBlueButton usage and optional platform services.

## The people and their journeys

### 1. Tenant owner — start and operate an academy

An academy owner registers with Saa9vi. The platform provisions the academy's tenant workspace and administrator. The owner completes the academy profile, sets up instructors and staff, configures teaching and learner-admission policies, and chooses how the academy will reach customers.

The owner can:
- Publish courses, scheduled live sessions, recorded learning material, workshops and services.
- Create or connect product records for books and other physical learning materials.
- Configure the tenant's own payment gateway for customer collections.
- Choose whether each eligible product appears on the Saa9vi marketplace, the academy's own storefront, or both.
- Optionally connect a verified seller-owned custom domain and use a tenant-branded storefront hosted by Saa9vi.

A custom-domain storefront is optional. A tenant can participate in the central marketplace without buying storefront hosting. Saa9vi no longer provisions generated seller storefronts such as `{tenantSlug}.saa9vi.com`; `tenantSlug` is an internal marketplace identity, with a central seller route such as `/sellers/{tenantSlug}`. A verified seller-owned custom domain is an alternative storefront address.

### 2. Tenant administrator — manage the academy

The tenant administrator manages the academy's catalogue, collections and learning content; admits learners; assigns instructors; schedules sessions; communicates with learners; and reviews orders, payments and fulfilment. Staff permissions and tenant data remain isolated to that academy.

Products and services have three separate business dimensions:

| Dimension | Examples |
|---|---|
| Product type | Live course, recorded content, consultation, workshop, book, physical merchandise |
| Billing model | Free, one-time, recurring subscription, fixed-term subscription, per-session, package |
| Fulfilment model | Digital enrollment/entitlement, scheduled service/booking, physical order fulfilment |

The tenant chooses the appropriate billing model. Ongoing coaching and courses should normally offer subscriptions, while a defined-term course may charge upfront and a standalone download, workshop, consultation or book may use a one-time or package price.

### 3. Instructor — teach and support learners

Instructors create or contribute to course content, prepare live sessions, manage their teaching schedule, conduct classes through BigBlueButton, and follow learner participation and attendance. Academy administrators retain control of course publication, learner admission and staff permissions.

### 4. Learner — discover, try, subscribe and learn

A learner discovers an academy, instructor, course or scheduled class through the central marketplace or an academy storefront. They can review the academy, teaching format, schedule, product information and available commercial options.

**Free trial:** Where an academy offers a trial, the learner registers without paying and receives a limited trial access grant. The trial is separate from paid enrollment: no paid order, payment mandate or automatic subscription conversion is created by default. The learner explicitly chooses a paid plan or term after the trial.

**Paid learning:** The learner chooses the tenant's subscription, fixed-term or other permitted price model. Payment is collected by the tenant through its own configured payment gateway. After payment is verified, Saa9vi provisions the relevant digital access: course enrollment, recorded content access and/or time-bounded BigBlueButton entitlements. Renewal extends the paid access period; expiry, grace and cancellation follow the tenant's published policy.

**Live learning:** The learner joins an eligible scheduled session or room. Access is determined by the relevant enrollment, entitlement and academy-admission rules. Meeting infrastructure usage is tracked separately from the learner's course price.

### 5. Marketplace customer — buy from a tenant

The Saa9vi marketplace is both a shared discovery surface and the target shared commerce storefront. It can present product pages, cart and checkout while the tenant remains the seller and payment recipient.

The intended checkout contract is:

1. The server resolves the tenant that owns the selected product.
2. The cart and Vendure order are created in that tenant's Channel, not the default marketplace Channel.
3. The marketplace displays payment methods eligible for that tenant's checkout context.
4. The tenant's own payment gateway collects the payment.
5. The tenant fulfils the order; Saa9vi charges no marketplace commission.

The initial checkout scope is one tenant per cart/order. Items from different tenants are handled as separate seller orders. Marketplace attribution records where a sale originated; it does not determine the payee or override tenant ownership.

**Current implementation boundary:** cross-tenant marketplace search, attribution and zero-commission ledger foundations exist. Marketplace-hosted tenant-channel checkout is the target described by ADR-055, not a completed feature in the reviewed baseline. Flow B tenant Razorpay configuration and provider-order creation exist, but the tenant PaymentMethodHandler settlement and tenant webhook/reconciliation lifecycle remain incomplete.

### 6. Physical-product buyer — receive goods from the tenant

Books and other physical products may be sold through the Saa9vi marketplace, the tenant's own storefront, or both. The tenant does not need a custom domain to list physical goods on the marketplace.

Before a physical listing is made available, the tenant must opt in and have the operational prerequisites appropriate to the sale: product availability, payment readiness, inventory/stock policy, shipping or delivery coverage, tax handling, and returns/refund information.

After payment is verified, the tenant is responsible for stock allocation, packing, shipping, delivery, customer support, cancellation, returns and refunds. This physical fulfilment lifecycle is distinct from digital access: expiry of a learner subscription does not undo a delivered book order.

### 7. Advertiser — acquire relevant customers

Tenants and other approved advertisers can purchase visibility through:
- Homepage banner placements.
- Collection and sub-collection banners.
- Sponsored product, course and instructor listings.
- Product/course detail-page placements.

Campaigns have approved placements, a defined period and budget, visible sponsored labels and reporting. Any impression/click-based charging must use explicit, deduplicated and fraud-resistant billable events; an ad being returned by a search API is not by itself a billable impression.

### 8. Saa9vi platform operator — provide and monetize infrastructure

Saa9vi operates the shared marketplace, tenant platform, hosting, payment integration boundaries, advertising controls and live-class infrastructure. The platform team manages tenant plans, capacity, support, moderation, billing reconciliation and operational readiness without taking ownership of tenant-client revenue.

## Revenue model

| Revenue stream | Payer | Payee | Commercial basis |
|---|---|---|---|
| Tenant SaaS subscription | Tenant admin | Saa9vi | Recurring plan for platform capabilities |
| BigBlueButton usage/capacity | Tenant admin | Saa9vi | Included quota, prepaid capacity or metered usage |
| Marketplace advertising | Tenant/advertiser | Saa9vi | Campaign fee, fixed placement and later validated CPC/CPM |
| Optional tenant-domain storefront hosting | Tenant admin | Saa9vi | Recurring hosting plan |
| Optional platform services | Tenant admin | Saa9vi | Agreed service fee |
| Tenant-client course, service and product sales | Learner/customer | Tenant | Tenant's own pricing and gateway; 0% Saa9vi commission |

Tenant SaaS subscription, learner-to-tenant payment, advertising spend and BBB usage are separate commercial lifecycles and must not be mixed into one ledger or payment purpose.

## Product and architecture guardrails

- **Channel = Tenant (INV-001):** tenant-owned products, carts, orders, payment methods and fulfilment are handled in the owning tenant Channel. Do not create tenant-owned marketplace orders in the default Channel.
- **Zero commission:** Saa9vi does not deduct or withhold a share of tenant-client payments. A zero-value attribution record is analytics history, not a payable commission.
- **Optional storefront:** custom-domain hosting is an optional Saa9vi service, not a requirement for marketplace listing, checkout or physical-product sales.
- **Digital vs physical fulfilment:** learning access is provisioned through enrollment and time-bounded entitlements; physical goods use stock and shipping fulfilment.
- **Separate subscriptions:** the tenant's subscription to Saa9vi (`OrganizationSubscription`) is not the learner's subscription to a tenant course or service.
- **Trusted payment routing:** the server resolves the tenant and its payment configuration. A browser-provided channel or payee value is never authoritative.

## Where to find implementation detail

| Topic | Canonical document |
|---|---|
| Marketplace commerce and revenue decisions | [ADR-055](../adr/adr-055-marketplace-commerce-and-revenue-model.md) and [Marketplace Commerce Policy](marketplace-commerce-policy.md) |
| Detailed marketplace commerce tasks | [MCR implementation worklist](../implementation/marketplace-commerce-revenue-worklist.md) |
| Plugin ownership and responsibilities | [Plugin map](../architecture/plugin-map.md) |
| Event-driven backend flows | [Runtime flow](../architecture/runtime-flow.md) |
| Learning domain | [Learning architecture](../architecture/learning-domain.md) and [ADR-053](../adr/adr-053-learning-plugin-course-domain.md) |
| Tenant hostname and storefront routing | [G1 hostname decision](../implementation/g1-hostname-contract-decision.md) and [integration gaps](../implementation/integration-gaps-worklist.md) |
| Production release evidence | [Production readiness](../implementation/production-readiness.md) |
