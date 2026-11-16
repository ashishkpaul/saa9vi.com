# Saa9vi Marketplace Commerce Policy

**Status:** Product policy proposal aligned with ADR-055  
**Updated:** 16 November 2026

## Commercial boundary

Saa9vi is a zero-commission discovery and commerce platform. The tenant owns the relationship with its customers and receives tenant-client payments for courses, classes, services, digital content and physical products. Saa9vi earns from tenant platform subscriptions, marketplace advertising, optional tenant-domain storefront hosting, BBB usage and optional platform services.

The marketplace can host checkout UI and product pages. The order, payment method, merchant account and fulfilment remain tenant-channel scoped. A tenant custom-domain storefront is optional and not required for marketplace listings or sales.

## Three independent dimensions

| Dimension | Meaning | Examples |
|---|---|---|
| Product type | What is being sold | Live course, recorded course, consultation, workshop, book, physical merchandise |
| Billing model | How the tenant charges | Free, one-time, recurring, fixed-term, per-session, package |
| Fulfilment model | What happens after registration/payment | Digital enrollment/entitlement, scheduled service, physical shipment |

Do not infer billing or fulfilment solely from product type.

## Digital products, courses and services

Ongoing courses, coaching programmes and recurring services should normally offer a learner subscription. A fixed-term programme may instead charge an upfront term fee. Standalone content, one-time workshops, per-session consultation and downloads can retain one-time or package pricing.

A free trial is separate from paid enrollment: no payment, no mandate and no automatic conversion by default. It grants tightly scoped access that expires at the session/trial boundary. The learner explicitly chooses a paid subscription or term after the trial.

Paid access is time-bounded by verified paid periods and the defined grace/expiry policy. A payment event does not itself grant indefinite access.

## Physical products

A tenant may list physical goods on the tenant storefront, the Saa9vi marketplace, or both. Custom-domain hosting is not required for marketplace physical sales.

Marketplace physical listings require tenant opt-in, published/available product, active tenant payment configuration, inventory policy, shipping/delivery coverage, tax and return/refund information. The tenant remains responsible for payment, stock, fulfilment, shipping, customer support and returns.

## Marketplace checkout

The marketplace may provide discovery, product pages, cart and checkout UI. The server resolves the owning tenant and all cart/order/payment operations use that tenant's Vendure Channel. Never create a marketplace/default-channel order for tenant-owned products. Initial checkout supports one tenant per cart/order; different sellers require separate orders/carts.

The storefront browser does not choose the payee, channel authority or payment credentials. The server validates product ownership, order/customer binding, amount, currency, provider account and payment result. Signed marketplace attribution proves origin only; it does not switch channel or payee.

## Separate fulfilment

**Digital:** after verified payment or a permitted free trial/admission, activate enrollment, issue/update relevant entitlements and unlock the appropriate content or scheduled services. Renewals extend access; expiry/cancellation applies the stated access policy.

**Physical:** after verified payment and stock/order checks, reserve/allocate stock and progress through packing, dispatch, delivery, cancellation, return and refund. Physical delivery is not governed by digital entitlement expiry.

## Saa9vi revenue streams

| Stream | Who pays Saa9vi | Charging basis |
|---|---|---|
| Tenant SaaS subscription | Tenant admin | Recurring plan |
| BBB usage/capacity | Tenant admin | Included quota, prepaid or metered usage |
| Marketplace advertising | Tenant/advertiser | Fixed placement/campaign, later CPC/CPM |
| Optional tenant-domain storefront hosting | Tenant admin | Recurring hosting plan |
| Optional platform services | Tenant admin | Contracted fees |

Advertising placements may include homepage banners, collection/sub-collection banners, sponsored listings and product/course detail-page ads. Impressions/clicks must have explicit, deduplicated, fraud-resistant billing semantics; merely returning an ad in an API response is not a billable impression.

## Required safeguards

- INV-001: Channel = Tenant; no redundant `tenantId`.
- Keep Flow A (tenant-to-Saa9vi) separate from Flow B (customer-to-tenant).
- Default channel is discovery catalogue only, never the tenant product checkout channel.
- Vendure channel-specific prices must be checked; marketplace catalogue prices are not automatically authoritative tenant checkout prices.
- Keep learner subscription lifecycle separate from `OrganizationSubscription`.
- Use persist-first, idempotent webhooks and append-only billing facts.
- Application business mutations use GraphQL APIs; schema changes use Vendure CLI migrations.

## Implementation source

See [ADR-055 — Marketplace Commerce and Revenue Model](../adr/adr-055-marketplace-commerce-and-revenue-model.md) and [Marketplace Commerce & Revenue Worklist](../implementation/marketplace-commerce-revenue-worklist.md).
