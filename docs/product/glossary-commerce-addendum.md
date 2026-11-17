# Glossary

> **Purpose:** Define domain terms used across Saa9vi. Add new terms here before relying on them in architecture and implementation documents.

| Term | Meaning |
|---|---|
| **Channel** | Vendure tenant boundary. Tenant-scoped commerce and data are associated with a Channel. |
| **Tenant** | A business/academy represented by a Vendure Channel. It owns tenant-client relationships, catalog products, services, payment configuration and fulfilment. |
| **Flow A — platform collections** | Tenant admin pays Saa9vi for Saa9vi services using the platform payment account. One-time platform checkout is limited to server-controlled `paymentPurpose = 'platform-service'`; recurring SaaS billing is separate. |
| **Flow B — tenant-client collections** | Learner/customer pays the tenant through the tenant's own payment gateway. Marketplace commission is 0%. The G-1 PR branch adds the separate `tenant-razorpay` Vendure PaymentMethodHandler and synchronous Shop settlement. Tenant webhook recovery/reconciliation (G-3), live merchant verification and marketplace owner-channel checkout remain open. |
| **Marketplace checkout** | Marketplace-hosted cart/checkout experience whose authoritative order/payment operations execute in the owning tenant's Vendure channel. It is not a default-channel order. |
| **Tenant storefront** | Optional tenant-branded storefront on a tenant-owned verified domain. It uses the same tenant catalogue, prices, stock, payment configuration and orders as the marketplace checkout. Hosting may be monetized separately by Saa9vi. |
| **Product type** | Classification of what the tenant sells: course, recorded content, live service, consultation, workshop, book or other physical merchandise. |
| **Billing model** | How the customer pays: free, one-time, recurring subscription, fixed-term, per-session or package. Independent of product type. |
| **Fulfilment model** | How the tenant supplies what was purchased: digital enrollment/entitlement, scheduled service/booking, or physical order fulfilment. |
| **Digital fulfilment** | Post-payment or approved free-access process that activates learning enrollment, content access and/or BBB entitlements for a bounded period. |
| **Physical fulfilment** | Tenant-owned inventory, stock allocation, packing, dispatch, delivery, cancellation, returns and refund lifecycle. |
| **Learner subscription** | A customer-to-tenant recurring agreement for access to a course/service. It is separate from `OrganizationSubscription`, which represents tenant-to-Saa9vi billing. |
| **Free trial** | A no-payment, no-mandate, bounded sample-access grant. It does not automatically convert to paid subscription; learner explicitly subscribes after trial. |
| **Marketplace listing destination** | Tenant-selected visibility choice: tenant storefront, marketplace, or both. It is separate from product's Vendure channel assignment and storefront-hosting entitlement. |
| **TenantPaymentAccount** | Channel-scoped payment gateway credentials. Current provider is Razorpay; Key Secret and webhook secret are encrypted at rest and never returned in GraphQL safe views. |
| **OrganizationSubscription** | Channel-scoped subscription through which a tenant pays Saa9vi for platform plans/features. Must not be reused for learner subscriptions. |
| **AdWallet** | Tenant/advertiser prepaid advertising balance cache; ledger entries remain the source of financial truth. |
| **AdSpendLedger** | Append-only advertising spend facts. Campaign charge semantics must be based on validated/deduplicated billable events. |
| **BbbScheduledSession** | A planned live class occurrence, owned by the tenant's BBB organization and optionally linked to a product variant. |
| **BbbEntitlement** | Participant access grant for a BBB session or room. Paid and trial entitlements have distinct sources and validity policies. |
| **BbbTrialRegistration** | Record of a learner's registration for a free trial session. |
| **BbbUsageLedger / BbbMeteredUsage** | Immutable BBB usage facts for their respective grant-based and metered billing modes. Consult ADR-047; do not conflate meeting duration with learner-minute calculations. |
| **Zero commission** | Saa9vi takes no commission from tenant-client product/service payments. A zero-valued attribution ledger row is for analytics, not a payable fee. |

See [Marketplace Commerce Policy](marketplace-commerce-policy.md), [ADR-055](../adr/adr-055-marketplace-commerce-and-revenue-model.md) and [Implementation Worklist](../implementation/marketplace-commerce-revenue-worklist.md).
