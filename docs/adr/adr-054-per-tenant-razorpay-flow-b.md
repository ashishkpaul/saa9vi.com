# ADR-054 — Per-Tenant Razorpay Integration (Flow B Implementation)

**Status:** ACCEPTED — backend implementation partial; Flow B settlement is not yet wired  
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

A `TenantPaymentAccount` row starts in `pending` status. The tenant admin triggers `verifyTenantPaymentAccount`; the current client performs `GET /payments?count=1` against the Razorpay API using the supplied Key ID/Secret. Success transitions the account to `active` and stamps `lastVerifiedAt`; failure leaves it pending. This is a credential/API-access probe: it does not create a ₹1 order, capture a payment, or validate the webhook secret.

An `active` account can be toggled `isEnabled: false` to disable order creation without deleting credentials. The checkout-order service requires both `status === 'active'` and `isEnabled === true`.

The separate `verifyTenantPaymentWebhook` mutation currently checks that an encrypted webhook secret exists and can be decrypted, then returns `webhookVerified: true`. It does **not** perform a signed test delivery or establish that Razorpay is configured to call a tenant-specific endpoint. Treat that result as a presence/decryption check, not webhook verification.

**Rationale:** Storing invalid credentials silently and failing at checkout is a poor user experience. A synchronous verification step at configuration time surfaces errors before any learner attempts to pay.

**Consequences:**

- `TenantRazorpayService.createCheckoutOrder()` fails closed if the account is not `active` or `isEnabled` is false.
- `verifyTenantPaymentAccount` and `verifyTenantPaymentWebhook` are Admin API mutations on `TenantPaymentAdminResolver`; the Shop API resolver exposes only `createTenantRazorpayCheckoutOrder`.
- The actual probe is a read-only `GET /payments?count=1`; no test order is created and no payment is attempted.

---

### D3 — `TenantRazorpayService` reuses `razorpay-checkout.policy.ts` signature verification logic

Flow B checkout uses the same HMAC signature verification helpers (`computeCheckoutSignature`, `assertOrderBinding`, `assertPaymentBinding`) as Flow A. The difference is that Flow B resolves keys from `TenantPaymentAccount` via `TenantPaymentAccountService.getDecryptedCredentials()` rather than from environment variables.

**Rationale:** Duplicating the signature policy creates a second implementation that can drift. The policy functions are pure and keyed by the secret passed to them; they are agnostic to whether that secret is a platform or per-tenant credential.

**Consequences:**

- Flow A and the future Flow B handler are intended to share the same pure signature/binding policy. The Flow B `verifyAndSettle()` call path is currently unwired, so do not claim equivalent end-to-end protection until its PaymentMethodHandler integration and regression tests exist.
`TenantRazorpayService.verifyAndSettle()` contains the common signature/order/payment checks, but at the reviewed commit it has no registered tenant `PaymentMethodHandler` or call site. Therefore the existence of the shared helpers is not evidence of a working Flow B settlement path.

---

### D4 — `ManageTenantPaymentAccount` is a custom permission; tenant admins receive it at registration

A new `ManageTenantPaymentAccount` CRUD permission controls access to the per-tenant Razorpay configuration endpoints. It is added to `TENANT_ADMIN_ROLE_PERMISSIONS` in `tenant-plugin/constants.ts` so that all newly registered tenants receive it automatically.

Existing tenant roles that pre-date this permission may lack it. `tenant:roles:check` is a read-only report. The current `tenant:roles:repair` CLI path writes Role records directly through `TransactionalConnection`/repository save; it therefore conflicts with the repository's operational rule that data mutations are performed through GraphQL APIs. Do not run the repair mode without an explicitly approved exception. Provide a SuperAdmin-authorized Admin GraphQL repair mutation (or another approved API path) before operationally repairing existing roles.

**Rationale:** Flow B configuration is a tenant-admin concern, not a platform-infrastructure concern. Separating it into its own permission prevents SuperAdmin-only operations from blocking tenant self-service.

**Consequences:**

- `TenantPaymentAdminResolver` decorates mutations with `@Allow(ManageTenantPaymentAccount.Permission)`.
- New tenants get the permission at registration. Existing tenants may need permission reconciliation, but the current CLI apply path is not allowed under the GraphQL-only mutation rule; an approved Admin GraphQL repair operation is still required.

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


---

## As-built API and implementation boundary — 16 November 2026

### Admin API

The current Admin SDL exposes:

- Queries: `tenantPaymentAccount` (current channel) and `allTenantPaymentAccounts` (SuperAdmin only).
- Mutations: `upsertTenantPaymentAccount`, `setTenantPaymentAccountEnabled`, `deleteTenantPaymentAccount`, `verifyTenantPaymentAccount`, and `verifyTenantPaymentWebhook`.

Tenant mutations use `ManageTenantPaymentAccount`. Newly registered tenant-admin roles receive this permission through `TENANT_ADMIN_ROLE_PERMISSIONS`; existing roles may lack it. The safe GraphQL view exposes the public Key ID and configuration metadata, never decrypted secrets. The existing repair CLI is not approved under the current GraphQL-only data-mutation rule because its apply path saves Role entities directly; use the read-only `tenant:roles:check` for diagnosis and add an approved Admin API repair path before changing existing role records.

### Shop API currently exposed

The only Flow B Shop mutation is `createTenantRazorpayCheckoutOrder(orderId)`. It requires an authenticated customer, resolves credentials from `ctx.channelId`, and validates channel membership, customer ownership, `ArrangingPayment` state and a positive total before it reads/decrypts tenant credentials or calls Razorpay. For an explicit `orderId`, the service reloads the order with `customer.user` and requires `order.customer.user.id === ctx.activeUserId`. For the implicit path it calls Vendure's `OrderService.getActiveOrderForUser(ctx, activeUserId)` and applies the same service-level ownership check to the reloaded order. Missing/foreign orders fail with the same `Order not found` response. Focused regression tests are added in `tenant-razorpay-order-ownership.spec.ts`; test execution is still pending.

There is no `verifyTenantPayment` Shop mutation in the current SDL. More importantly, `PaymentsPlugin` registers only the platform `razorpayPaymentHandler` (Flow A); it does not register a tenant-specific `PaymentMethodHandler`. `TenantRazorpayService.verifyAndSettle()` exists but is not wired to Vendure's `addPaymentToOrder` lifecycle. Accordingly, Flow B can currently create a provider order but cannot complete the intended tenant-funded Vendure payment/settlement lifecycle through this plugin. Do not describe Flow B as end-to-end implemented or production-ready.

The current one-time webhook controller and `PaymentWebhookEvent`/queue belong to Flow A at `POST /payments/razorpay/checkout-webhook`; the recurring subscription webhook belongs to SubscriptionPlugin at `POST /payments/razorpay/webhook`. There is no tenant-specific Flow B webhook endpoint or tenant webhook reconciliation worker in the current PaymentsPlugin.

### Security items that remain open

1. **Order owner binding:** when an explicit `orderId` is passed to `createTenantRazorpayCheckoutOrder`, the service verifies channel membership but does not visibly compare `order.customer.user.id` with `ctx.activeUserId`. The resolver is decorated with `@Allow(Permission.Owner)`, but add an adversarial cross-customer test and an explicit service-level owner assertion unless Vendure's resolver permission semantics are proven to bind this argument to the order resource. Flow A performs an explicit owner comparison in its resolver.
2. **Webhook status semantics:** rename/rework the current `verifyTenantPaymentWebhook` behavior before it is relied on operationally; it only checks secret presence/decryption.
3. **Settlement guard:** when wiring `verifyAndSettle()`, ensure the account is rechecked as active and enabled at settlement time, not only when the checkout order is created.
4. **Webhook design:** decide and implement the tenant webhook route, tenant/channel resolution, signature verification, durable inbox, idempotency and reconciliation semantics before claiming webhook-backed recovery.

### Credential operations

`TENANT_PAYMENT_ENCRYPTION_KEY` must be a 64-character hex string (32 bytes) and is mandatory when `APP_ENV !== 'dev'`. Generate with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`TENANT_PAYMENT_ENCRYPTION_KEY_PREVIOUS` is an optional prior key used as a decrypt fallback during rotation. The reviewed service does not provide an automatic bulk re-encryption command; retain the old key until all ciphertext has been deliberately re-encrypted and verified. This key is distinct from `VENDURE_ENCRYPTION_KEY`, which is configured as Vendure's `DefaultEncryptionStrategy` for the Stripe plugin's `encryptSecrets: true` setting. Back up both keys independently of the database.

**Verification boundary:** code and GraphQL SDL were reviewed at commit `3c245952d57b9ddeb27b9cbd6ee01de5bae0ba71`. No live Razorpay merchant checkout, webhook delivery, or production key-rotation test is claimed.

---

## Marketplace checkout clarification — ADR-055 (proposed, 2026-11-16)

Flow B's tenant payee model can be used by two storefront surfaces: the tenant's optional custom-domain storefront and the Saa9vi marketplace storefront. In either case, the active Vendure RequestContext must resolve to the owning tenant's Channel. The marketplace browser must not supply authoritative channel/payee/credential values.

At the reviewed baseline, this ADR's existing gaps remain: no registered tenant PaymentMethodHandler, no settlement call wired through Vendure's payment lifecycle, no tenant-specific webhook inbox/worker/reconciliation, and no live merchant checkout evidence. Do not begin a marketplace checkout launch based only on the existing provider-order creation mutation.

The marketplace checkout target contract, one-tenant-per-order rule, customer identity requirements and separate digital/physical fulfilment workflows are proposed in [ADR-055](adr-055-marketplace-commerce-and-revenue-model.md) and decomposed into [MCR work items](../implementation/marketplace-commerce-revenue-worklist.md). ADR-055 does not supersede or mark complete the Flow B implementation tasks in this ADR.
