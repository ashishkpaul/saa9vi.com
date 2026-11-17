# ADR-054 — Per-Tenant Razorpay Integration (Flow B Implementation)

**Status:** ACCEPTED — Flow B Shop settlement handler is implemented on the G-1 PR branch; local verification pending and G-3 webhook recovery remains open  
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

- Flow A and Flow B share the pure signature/order/payment binding policy, while resolving their secrets from separate credential sources.
- On the G-1 PR branch, `TenantRazorpayService.verifyAndSettle()` is invoked by the registered `tenant-razorpay` PaymentMethodHandler. It checks tenant account activation, authenticated Shop customer/order/channel ownership, signature, provider IDs, receipt/notes, amount and currency. An authorized payment is captured only after all pre-capture bindings pass.
- This handler intentionally has no Admin/webhook bypass. G-3 must add tenant-specific webhook recovery separately.

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

### Shop API and PaymentMethodHandler — G-1 branch implementation

The Flow B Shop API exposes `createTenantRazorpayCheckoutOrder(orderId)`. It requires an authenticated customer, resolves credentials from `ctx.channelId`, and validates current-channel membership, customer ownership, `ArrangingPayment` state and a positive total before provider-order creation. The service reloads the order with `customer.user` and requires `order.customer.user.id === ctx.activeUserId` for explicit and active-order paths. G-2's focused regression suite was run by the user and reported 10/10 tests passing; the full backend build remains to be confirmed.

The G-1 PR branch adds and registers the separate Vendure PaymentMethodHandler code `tenant-razorpay`. It is used by `addPaymentToOrder` in an authenticated Shop API context. The handler calls `TenantRazorpayService.verifyAndSettle()` and reports `Settled` only after:
- the reloaded order belongs to the active Channel and authenticated customer;
- `paymentPurpose = 'platform-service'` is rejected;
- a valid Razorpay Checkout HMAC has been verified with the tenant Key Secret;
- the server-fetched Razorpay order ID, receipt/notes, amount and currency match the Vendure order;
- the server-fetched payment ID, provider-order association, amount and currency match;
- the tenant account is active and enabled, checked before decrypting the Key Secret;
- an already-recorded Vendure `Payment.transactionId` is rejected; and
- any authorized payment is captured only after the pre-capture provider bindings pass, then confirmed as captured before Vendure settlement.

Flow A is unchanged: the existing `razorpay` handler uses only Saa9vi's platform credentials and continues to require `paymentPurpose = 'platform-service'`. The tenant handler uses only tenant credentials from the active Channel and is not a fallback for Flow A.

G-1 regression coverage is added in `tenant-razorpay-settlement.spec.ts`; tests/build have not yet been run by the PR author. The existing transaction lookup rejects previously persisted payment IDs but does not provide an atomic reservation against two simultaneous requests racing before a Payment row exists.

The Flow B tenant webhook endpoint/inbox/worker/reconciliation is still absent (G-3). Therefore the G-1 slice wires the synchronous Shop checkout settlement lifecycle but does not make Flow B end-to-end recoverable or production-ready. No live Razorpay merchant test is claimed.

### Security boundaries and remaining gaps

1. **Order owner binding (G-2):** implemented at service level for explicit and active-order checkout paths; user-reported focused result is 10/10 passing.
2. **Tenant settlement (G-1):** handler and settlement verification added on the G-1 PR branch; local tests/build remain to be confirmed.
3. **Payment replay:** previously recorded provider payment IDs are rejected through the global Vendure Payment `transactionId` lookup. Concurrent first-use races are not claimed solved.
4. **Webhook status semantics:** `verifyTenantPaymentWebhook` checks secret presence/decryption only; do not represent it as a signed endpoint test.
5. **Webhook recovery (G-3):** the feature branch adds `POST /payments/razorpay/tenant-webhook/:channelToken`, tenant-secret HMAC verification over raw request bytes, a ChannelAware tenant inbox with Channel-scoped delivery deduplication, persist-before-enqueue recovery and a bounded `payment.captured` worker. The worker re-reads provider truth and settles through the `tenant-razorpay` handler. Admin settlement is gated by the matching persisted verified inbox event. The Channel token is routing only; HMAC is the authentication boundary. The CLI-generated migration and local/runtime validation remain pending.

### Tenant webhook recovery — G-3 branch implementation

The G-3 PR branch adds a tenant-specific webhook ingress and durable reconciliation path:

- Razorpay callback URL: `POST /payments/razorpay/tenant-webhook/:channelToken`.
- The Channel token selects the tenant's account only; it does not authenticate the request. The endpoint retrieves that Channel's encrypted webhook secret and validates the `X-Razorpay-Signature` HMAC against the exact `req.rawBody` bytes before parsing JSON.
- `x-razorpay-event-id` is mandatory. The new ChannelAware `TenantPaymentWebhookEvent` belongs to exactly one Channel; the unique dedupe key hashes provider + Channel ID + Razorpay event ID.
- The controller persists the receipt before queueing only the inbox ID. Duplicate pending events are re-enqueued to recover a prior persist-success/enqueue-failure case; reusing an event ID with a different raw-payload hash/event type is rejected. DB or queue errors are non-2xx so Razorpay retries.
- The worker processes `payment.captured` only. It resolves the event's owning Channel, uses that Channel's Admin RequestContext, fetches the Razorpay Order/Payment with that tenant's credentials, verifies provider IDs, receipt/notes, order association, amount, currency and captured state, then calls `OrderService.addPaymentToOrder` using `tenant-razorpay`.
- The internal Admin settlement route inside `TenantRazorpayService.verifyAndSettle()` requires the matching verified, pending, same-Channel inbox event and the same provider order/payment identifiers. It is not a general Admin bypass.
- Webhook reconciliation can still use tenant key credentials after new checkout has been disabled, because it is recovering a payment that Razorpay has already captured. It does not permit new checkouts.
- A conditional event claim moves `pending` to `processing` before reconciliation; concurrent copies of the same inbox event cannot both run. A two-minute `processingStartedAt` lease allows a later duplicate delivery to requeue a crashed worker's stale event.
- A captured payment that cannot be attached to the expected tenant order, is already attached elsewhere, or cannot reach a settled Vendure order is terminally flagged for manual review through `PaymentOpsAlertService`. Transient provider failures retry up to three attempts, then alert.

**Migration rule:** the new ChannelAware entity and Channel join table require a schema migration. The PR does not include a hand-authored migration. Generate it locally using `npx vendure migrate --generate`, inspect it and commit it before merging. Do not merge/deploy without this CLI-generated migration.

**Dashboard setup:** the tenant Payment Gateways page displays the callback URL and the required `payment.captured` event. If the Dashboard and API use different public origins, configure `VITE_VENDURE_API_BASE_URL` to the public API origin before building the Dashboard.

**Verification boundary:** the G-3 tests and backend/dashboard builds have not yet been run by the PR author. Real Razorpay HTTP delivery, retry/replay and tenant isolation validation are also pending. The existing `verifyTenantPaymentWebhook` Admin mutation remains a presence/decryption check and is not a signed test delivery.

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

The G-1 branch wires synchronous tenant Shop settlement through the registered tenant PaymentMethodHandler. The remaining blockers still include tenant-specific webhook inbox/worker/reconciliation, marketplace owner-channel checkout and live merchant verification. Do not begin a marketplace checkout launch based only on provider-order creation or the G-1 handler.

The marketplace checkout target contract, one-tenant-per-order rule, customer identity requirements and separate digital/physical fulfilment workflows are proposed in [ADR-055](adr-055-marketplace-commerce-and-revenue-model.md) and decomposed into [MCR work items](../implementation/marketplace-commerce-revenue-worklist.md). ADR-055 does not supersede or mark complete the Flow B implementation tasks in this ADR.
