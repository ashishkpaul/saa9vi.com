# ADR-037: Juspay Provider Contract — Verified

**Status:** ✅ Accepted — Verified Against Live Juspay Documentation

**Date:** 2026-08-31

**Context:** Step 4 (real Juspay recurring billing) was implemented against the
Juspay HyperCheckout documentation, but the SDK in
`src/plugins/subscription/juspay/juspay-sdk.ts` carried an explicit
`⚠️ CONTRACT STATUS (Step 4C): DOCUMENTED-BUT-UNVERIFIED` marker. The
recurring/mandate methods were ported from the BuyLits reference
(`reference/buylits/payments-core/gateway/juspay-sdk.ts`) with net-new mandate
endpoints. The Juspay HyperCheckout documentation has now been verified —
see the matrix below.

**Decision:** The Juspay HyperCheckout documentation is the authoritative
provider contract for Saa9vi's recurring billing. All SDK methods have been
corrected to match the verified contract. The async charge model (HTTP 200 =
"accepted, terminal outcome via webhook") is confirmed correct.

**Critical correction:** `executeMandateCharge()` previously called
`POST /mandates/execute` — the verified API contract requires
`POST /txns` with dot-notation form-encoded fields
(`order.order_id`, `order.amount`, `order.customer_id`, `merchant_id`,
`mandate_id`, `format=json`). The previous path would have failed in production.

## Verified Contract Matrix

### Authentication → Environment → Routing

| Field | Value | Source |
|---|---|---|
| Auth method | HTTP Basic Auth | [Mandate List API][mandate-list] |
| Username | API Key from Juspay Dashboard | [Mandate List API][mandate-list] |
| Password | Empty string `""` | [Mandate List API][mandate-list] |
| Format | `Basic <base64(apiKey:)>` | [Mandate List API][mandate-list] |
| Merchant header | `x-merchantid: <merchantId>` | [Mandate List API][mandate-list] |
| Sandbox URL | `https://sandbox.juspay.in` | [Mandate List API][mandate-list] |
| Production URL | `https://api.juspay.in` | [Mandate List API][mandate-list] |
| `x-routing-id` | `customer_id` (same for all related calls) | [Mandate List API][mandate-list] |

✅ SDK constructor: `sandbox → sandbox.juspay.in`, `prod → api.juspay.in` — confirmed  
✅ SDK auth: `Basic base64(apiKey + ":")`, `x-merchantid` header, `x-routing-id` = customer_id — confirmed

### Charge Execution (the async contract)

| API | Verified Value |
|---|---|
| Method/Endpoint | `POST /txns` |
| Auth | Basic Auth (apiKey:empty) + `x-merchantid` + `x-routing-id` (customer_id) |
| Content-Type | `application/x-www-form-urlencoded` |
| Required body fields | `order.order_id`, `order.amount`, `order.customer_id`, `merchant_id`, `mandate_id`, `format=json` |

**Response mapping (confirmed critical):**

| Juspay Status | Saa9vi ChargeResult | Meaning |
|---|---|---|
| `PENDING_VBV` | `"initiated"` | Charge accepted; terminal outcome via webhook |
| `CHARGED` | `"succeeded"` | Terminal success (rare for mandate debits) |
| `CHARGED_FAILURE` / `FAILURE` / `JUSPAY_DECLINED` | `"failed"` | Sync terminal failure |
| HTTP non-200 | Exception → `"failed"` | Initiation call failed |

✅ **HTTP 200 ≠ debit succeeded.** The current async model is correct.

### Webhooks

| Field | Verified Value |
|---|---|
| Configuration | Dashboard → Payments → Settings → Webhook Tab |
| URL | HTTPS, reachable from Juspay servers |
| Auth | HTTP Basic Auth + optional custom headers |
| Ack | HTTP 200 = acknowledged; non-200 triggers retry |
| Duplicates | Documented possible — must handle via idempotency |

**Event names (Saa9vi actions):**

| Event | Action |
|---|---|
| `CHARGE_SUCCEEDED` | CAS success on attempt → `finalizeAfterPayment()` |
| `CHARGE_FAILED` | CAS failure on attempt → `markSubscriptionPastDue()` |
| `MANDATE_ACTIVATED` | Transition mandate FSM to `active` |
| `MANDATE_PAUSED` | Transition to `paused` |
| `MANDATE_REVOKED` | Transition to `revoked` |

✅ Saa9vi uses two-layer auth (Basic Auth + HMAC-SHA256, both fail-closed) — stronger than Juspay's single Basic Auth.

### Idempotency (all DB-enforced)

| Layer | Mechanism |
|---|---|
| Webhook ingestion | `JuspayWebhookEvent` dedupeKey unique constraint + PROCESSED status |
| Attempt terminal transition | `CASE`-guarded `UPDATE WHERE status='initiated'` (INV-019) |
| Subscription finalize | Version-guard CAS on `version` field |

### Mandate Status Values

`| CREATED \| ACTIVE \| PAUSED \| REVOKED \| FAILURE \| EXPIRED` — matches Saa9vi's JuspaySubscriptionMandate FSM. ✅

## Unimplemented Gaps (Hardening Backlog)

| Gap | Plan |
|---|---|
| Webhook IP allowlist | Defense-in-depth; current Basic Auth + HMAC sufficient |
| Order Status fallback | Manual reconciliation tool; webhook is authoritative |
| Webhook JWT/encryption | Optional Juspay feature; HMAC is current contract |
| Secret rotation (multi-secret) | `hmacSecretVersion` field exists; multi-secret verify not yet used |

## Juspay Billing (Secondary — Not Integrated)

Juspay Billing `BILLING_EXECUTION_*` events exist but are **not** in scope. Saa9vi
owns its renewal FSM (CLAIM → ATTEMPT → CHARGE → FINALIZE) per RFC-001. A future
ADR would be required to switch.

## Implementation Changes

SDK corrected: `executeMandateCharge()` → `POST /txns`; dot-notation body;
response mapping `PENDING_VBV → "initiated"`, `CHARGED → "succeeded"`, else `"failed"`.
All `UNVERIFIED` markers → `VERIFIED`.

[mandate-list]: https://juspay.io/in/docs/hyper-checkout/web/mandates-subscriptions/mandate-list-api
[mandate-exec]: https://www.juspay.io/in/docs/hyper-checkout/web/mandates-subscriptions/mandate-execution-api
[webhooks]: https://www.juspay.io/in/docs/hyper-checkout/web/base-sdk-integration/webhooks
[mandate-arch]: https://juspay.io/in/docs/hyper-checkout/web/mandates-subscriptions/mandate-integration-architecture
