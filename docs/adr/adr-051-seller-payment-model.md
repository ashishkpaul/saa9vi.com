# ADR-051 — Seller Payment Model and Tenant Razorpay Exposure

**Status:** OPEN — decision required before Phase 3 course-sales work  
**Date:** 1 November 2026  
**Author:** Kiro CLI baseline (C-05)

---

## Context

`TenantRegistrationService.autoProvisionChannelResources()` assigns every
Razorpay-handler `PaymentMethod` from the default channel to each new tenant
channel at registration time. The assigned method uses platform environment
credentials (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`) — not the tenant's
own merchant account.

The previously agreed seller-owned collection model states: the academy
collects its own course fees; Saa9vi does not hold seller funds.

These two facts are in tension. If the platform-credentialed Razorpay
`PaymentMethod` is visible in a tenant channel's Shop API
`eligiblePaymentMethods`, buyers of tenant courses would be charged through
Saa9vi's Razorpay account — not the academy's.

---

## Decision required

### D2 — Seller payment ownership

Choose one:

**Option A — External collection (seller-owned, Vendure records offline)**  
The academy collects course fees through its own Razorpay account or other
payment gateway, entirely outside Vendure's checkout. Vendure records the
purchase as an offline/manual payment after the tenant confirms it. The
platform Razorpay `PaymentMethod` must NOT be assigned to tenant channels.

**Option B — Platform-mediated collection (Saa9vi holds and remits)**  
Saa9vi collects course fees through the platform Razorpay account and remits
to the academy. The assigned `PaymentMethod` is intentional. This requires
explicit merchant-of-record and settlement documentation.

**Option C — Per-tenant Razorpay integration**  
Each academy configures its own Razorpay merchant account. Requires an
encrypted `TenantPaymentAccount` entity and per-account webhook routing.
Secrets must never be stored in handler args (Vendure `ConfigArgType` has no
password type). See execution plan task C-20 for implementation details.

---

## Current exposure finding

**To be verified:** Query `eligiblePaymentMethods` on a tenant channel via the
Shop API. If the platform Razorpay method appears, Option A or C is the
correct resolution; the exposure must be removed or explicitly authorized.

```graphql
# Run against a tenant channel token (not the default channel)
query {
  eligiblePaymentMethods {
    id
    name
    code
    isEligible
  }
}
```

---

## Phase 3 gate

**C-21 and all course-sales work in Phase 3 must not start while this ADR
is OPEN and the Shop API exposure is unconfirmed.**

If Option A is chosen: stop assigning the platform `PaymentMethod` to tenant
channels in `autoProvisionChannelResources()`. Remove any existing assignments
via an Admin API operation (not direct SQL).

If Option B or C is chosen: document the chosen model in this ADR, implement
the required safeguards, and close the ADR before Phase 3.

---

## Related

- `src/plugins/tenant-plugin/services/tenant-registration.service.ts` —
  `autoProvisionChannelResources()` (line ~460)
- `src/plugins/payments/config/razorpay-payment-handler.ts` — `args: {}`
- `src/platform/invariants/payment-hygiene.checker.ts` — INV-030 static checks
- Execution plan C-05 and C-20
