# ADR-051 — Seller Payment Model and Tenant Razorpay Exposure

**Status:** ACCEPTED — Option C selected; Flow B Phase 2 code is present in `PaymentsPlugin` (see ADR-054).  
**Date:** 1 November 2026  
**Author:** Kiro CLI baseline (C-05)

## Decision

**Option C — per-tenant Razorpay integration** is the selected commercial model.

| Flow | Payer | Payee | Account | Saa9vi commission |
|------|-------|-------|---------|-------------------|
| Flow A — Platform services | Tenant admin | Saa9vi | Saa9vi's own Razorpay (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`) | N/A — this is Saa9vi revenue |
| Flow B — Tenant-client collections | Tenant client | Tenant admin | Tenant's own Razorpay (configured per tenant) | 0% — permanently enforced |

- Saa9vi collects tenant-admin service fees (subscription, BBB usage, advertising, optional storefront hosting) using Saa9vi's own Razorpay account.
- Tenant-client collections belong entirely to the tenant. Saa9vi does not collect, deduct, or withhold commission.
- Tenant Razorpay configuration is now implemented through `TenantPaymentAccount` and `TenantPaymentAdminResolver`: tenant admins can store encrypted credentials, enable/disable the account, verify credentials, and verify webhook configuration. The Shop API exposes `createTenantRazorpayCheckoutOrder`; `TenantRazorpayService` contains the server-side verification/settlement path. This implementation does not change Flow A platform credentials or the zero-commission boundary. Treat production rollout as a separate operational verification step; the presence of code alone does not prove live webhook configuration or successful end-to-end payment in the target environment.
- Marketplace commission is permanently 0% under this business model. Tenants may collect outside Saa9vi entirely; no Vendure payment record is required unless a later decision introduces one.

## Context (historical)

`TenantRegistrationService.autoProvisionChannelResources()` previously assigned the platform Razorpay-handler `PaymentMethod` from the default channel to each new tenant channel at registration time. That assignment used platform environment credentials, which conflicted with the seller-owned collection model. It has been removed — see `src/plugins/tenant-plugin/services/tenant-registration.service.ts`.

## Related

- `src/plugins/tenant-plugin/services/tenant-registration.service.ts` — `autoProvisionChannelResources()` (platform Razorpay auto-assignment removed)
- `src/plugins/payments/config/razorpay-payment-handler.ts` — Flow A one-time checkout handler; uses platform credentials only
- `src/plugins/subscription/providers/razorpay/razorpay-subscription.provider.ts` — Flow A recurring subscription provider; uses platform credentials only
- `src/platform/invariants/payment-hygiene.checker.ts` — INV-030 static checks (no platform payment method auto-assigned to tenant channels)
- `src/plugins/marketplace/services/commission-ledger.service.ts` — 0% commission enforced at boot
- Execution plan C-05 and C-20
