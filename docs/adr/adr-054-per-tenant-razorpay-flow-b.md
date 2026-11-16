# ADR-054 — Per-Tenant Razorpay Integration (Flow B Implementation)

**Status:** ACCEPTED — implementation phase active  
**Date:** 16 November 2026  
**Author:** Kiro CLI baseline (C-05 follow-up)

---

## Context

ADR-051 (Option C) established that tenant-client collections belong entirely to the tenant using the tenant's own Razorpay account. It deferred the actual implementation. That implementation is now in progress in `PaymentsPlugin`. This ADR records the concrete design decisions made during that implementation.

The two payment flows remain distinct:

| Flow | Payer | Account | Scope |
|------|-------|---------|-------|
| Flow A — Platform services | Tenant admin → Saa9vi | Saa9vi's Razorpay (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`) | Subscription, BBB usage billing |
| Flow B — Tenant-client collections | Tenant client → Tenant admin | Tenant's own Razorpay (per-tenant config) | Course fees, session fees, any tenant-to-learner commerce |

---

## Decisions

### D1 — Tenant Razorpay credentials are stored encrypted in a `TenantPaymentAccount` entity

Each tenant channel that wishes to collect payments configures a `TenantPaymentAccount` row (`tenant_payment_account` table). The Razorpay `keyId` is stored in plaintext; the `keySecret` is AES-256-GCM encrypted at rest via `TenantPaymentEncryptionService` using an application-level secret (`TENANT_PAYMENT_ENCRYPTION_KEY`). The raw secret is never logged and never returned from the API.

**Rationale:** Razorpay credentials are equivalent to private keys. Storing them in plaintext in the database is a data breach risk. AES-256-GCM with a per-row IV provides confidentiality at rest without requiring a hardware key management service (which would be appropriate for a future hardening pass but adds operational overhead now). The pattern follows the existing `TenantPaymentEncryptionService` already in the codebase.

**Alternatives rejected:**

- Plaintext storage (unacceptable credential exposure).
- KMS-backed encryption (correct long-term, but deferred — operational overhead is disproportionate for the current scale).

**Consequences:**

- `TenantPaymentEncryptionService.encrypt()` / `.decrypt()` are the only permitted access paths to the raw secret.
- The GraphQL API never returns `keySecret`. `TenantPaymentAdminResolver` returns only `keyId`, `status`, `isEnabled`, and audit timestamps.
- Rotation requires a re-encrypt pass against all active rows; the rotation procedure is a documented operational step, not an automated API (gap, deferred).

---

### D2 — Tenant credentials are verified before activation via a live Razorpay API probe

A `TenantPaymentAccount` row starts in `pending` status. The tenant admin triggers a `verifyTenantRazorpayCredentials` mutation, which calls the Razorpay `/orders` endpoint with a minimal test order (₹1, never captured). Success transitions the account to `active`; failure keeps it in `pending` and returns the error.

An `active` account can be toggled `isEnabled: false` to disable checkout without deleting credentials.

**Rationale:** Storing invalid credentials silently and failing at checkout is a poor user experience. A synchronous verification step at configuration time surfaces errors before any learner attempts to pay.

**Consequences:**

- `TenantRazorpayService.createCheckoutOrder()` fails closed if the account is not `active` or `isEnabled` is false.
- The test-order probe creates a Razorpay Order object; it is never captured and expires in 15 minutes. No funds are moved.

---

### D3 — `TenantRazorpayService` reuses `razorpay-checkout.policy.ts` signature verification logic

Flow B checkout uses the same HMAC signature verification helpers (`computeCheckoutSignature`, `assertOrderBinding`, `assertPaymentBinding`) as Flow A. The difference is that Flow B resolves keys from `TenantPaymentAccount` via `TenantPaymentAccountService.getDecryptedCredentials()` rather than from environment variables.

**Rationale:** Duplicating the signature policy creates a second implementation that can drift. The policy functions are pure and keyed by the secret passed to them; they are agnostic to whether that secret is a platform or per-tenant credential.

**Consequences:**

- Flow A and Flow B share one signature verification path. Any security fix to `razorpay-checkout.policy.ts` applies to both.
- `TenantRazorpayShopResolver` is a thin wrapper that resolves tenant credentials and delegates to `TenantRazorpayService`, which calls the policy functions.

---

### D4 — `ManageTenantPaymentAccount` is a custom permission; tenant admins receive it at registration

A new `ManageTenantPaymentAccount` CRUD permission controls access to the per-tenant Razorpay configuration endpoints. It is added to `TENANT_ADMIN_ROLE_PERMISSIONS` in `tenant-plugin/constants.ts` so that all newly registered tenants receive it automatically.

Existing tenant roles that pre-date this permission must be repaired via the existing `tenant:roles:repair` tooling (the same mechanism used for `BBBPlatformInfrastructure` exclusions — ADR-033).

**Rationale:** Flow B configuration is a tenant-admin concern, not a platform-infrastructure concern. Separating it into its own permission prevents SuperAdmin-only operations from blocking tenant self-service.

**Consequences:**

- `TenantPaymentAdminResolver` decorates mutations with `@Allow(ManageTenantPaymentAccount.Permission)`.
- Existing tenants need a one-time role repair to gain the permission; new tenants get it at registration.

---

## Related

- `src/plugins/payments/entities/tenant-payment-account.entity.ts`
- `src/plugins/payments/services/tenant-payment-encryption.service.ts`
- `src/plugins/payments/services/tenant-payment-account.service.ts`
- `src/plugins/payments/services/tenant-razorpay.service.ts`
- `src/plugins/payments/services/tenant-razorpay-orders.client.ts`
- `src/plugins/payments/api/tenant-payment-admin.resolver.ts`
- `src/plugins/payments/api/tenant-razorpay-shop.resolver.ts`
- `src/plugins/payments/razorpay-checkout.policy.ts`
- `src/plugins/payments/constants.ts` — `ManageTenantPaymentAccount`
- `src/plugins/tenant-plugin/constants.ts` — `TENANT_ADMIN_ROLE_PERMISSIONS`
- ADR-051 — seller payment model; established Option C and deferred this implementation
- ADR-038 — direct Razorpay provider (Flow A — platform subscriptions; remains unchanged)
