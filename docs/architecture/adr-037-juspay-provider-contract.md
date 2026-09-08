# ADR-037: Juspay Provider Contract — Verified
**Status:** ✅ Accepted — Documentation Contract Verified; Live Sandbox M1.1 Verified

**Status Semantics:**
- Documentation contract: ✅ Verified (HyperCheckout docs cross-checked)
- Live sandbox M1.1: ✅ Verified (auth, session, payment methods discovered)
- Application integration: ⚠️ Mandate-registration gap identified (see §8)
- Full mandate flow E2E: ⏳ Pending (requires real PG + HyperCheckout UI)

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

## M1.1 — Live Sandbox Observation Addendum (2026-09-08)

Authentication with fresh sandbox credentials **succeeded**. The M1.1 verifier
(`juspay-m1.1-verify.ts`) reached `sandbox.juspay.in` and confirmed:

### Authentication

| Probe | Result | Meaning |
|---|---|---|
| `GET /orders/{nonexistent}` | 400 RESOURCE_NOT_FOUND | ✅ Authenticated (not 401) |
| `POST /session` | 200 NEW | ✅ Session created |
| `GET /orders/{id}` | 400 RESOURCE_NOT_FOUND | ✅ Authenticated |

400 = authenticated, order simply doesn't exist. This is the expected shape.

### Session API contract (live)

`POST /session` with required fields (`action`, `return_url`, `order_id`,
`amount`, `customer_id`, `customer_email`, `customer_phone`) returns:

```json
{
  "status": "NEW",
  "id": "ordv2_...",
  "order_id": "<merchant-order-id>",
  "payment_links": {
    "web": "https://sandbox.assets.juspay.in/payment-page/order/ordv2_...",
    "expiry": "<ISO-8601>"
  },
  "sdk_payload": {
    "service": "in.juspay.hyperpay",
    "payload": {
      "clientAuthToken": "tkn_jz-...",
      "environment": "sandbox"
    }
  }
}
```

**Integration contract:** The frontend needs `sdk_payload.payload.clientAuthToken`
to initialize HyperCheckout. This is the actual handshake, not a server-side
mandate creation.

### Payment Methods (live discovery)

| Attempt | Result |
|---|---|
| `POST /payment_methods` | 404 (does not exist) |
| `POST /orders/payment_methods` | 400 (order_id mismatch — endpoint exists but wrong path) |
| `POST /orders/{order_id}/payment_methods` | 404 (does not exist) |
| `GET /orders/{order_id}/payment_methods` | 404 (does not exist) |
| **`POST /session` with `options.add_emandate_payment_methods: true`** | **200 NEW** ✅ |

**Key finding:** There is NO separate Payment Methods API. The documented
"Payment Methods API" is the **Session API** with
`options.add_emandate_payment_methods: true`. The mandate-capable payment
methods are rendered in the HyperCheckout UI (via `payment_links.web` or
`sdk_payload`), not returned in the API response.

The `sdk_payload.payload` echoes back:
- `options.add_emandate_payment_methods: true` — confirmed
- `mandate: { frequency, max_amount, block_funds, amount_rule }` — confirmed

### Merchant capability (confirmed)

- Merchant ID: `saa9vi` (Juspay merchant identifier)
- Environment: `sandbox`
- Service: `in.juspay.hyperpay`
- Session creation: ✅ Working
- Mandate params in Session API: ✅ Echoed back in sdk_payload
- Payment methods: ✅ Rendered in HyperCheckout UI (not a separate API)

### Status update

- Documentation contract: ✅ Verified
- Live sandbox authentication: ✅ Verified (M1.1)
- Merchant capability: ✅ Confirmed (session + mandate params)
- Payment methods: ✅ Discovered (via Session API, not separate endpoint)
- Mandate registration flow: ⏳ Not yet tested (requires HyperCheckout UI + real PG)
- Webhook events: ⏳ Not yet observed

### Sandbox gateway note

The Sandbox portal shows gateway = `DUMMY`. This means a successful Session
API call proves authentication + Session API + account configuration, but does
**not** yet prove a real PG mandate flow. A real PG (not DUMMY) is required for
the full mandate registration test.

## Implementation Changes

SDK corrected: `executeMandateCharge()` → `POST /txns`; dot-notation body;
response mapping `PENDING_VBV → "initiated"`, `CHARGED → "succeeded"`, else `"failed"`.
All `UNVERIFIED` markers → `VERIFIED`.

[mandate-list]: https://juspay.io/in/docs/hyper-checkout/web/mandates-subscriptions/mandate-list-api
[mandate-exec]: https://www.juspay.io/in/docs/hyper-checkout/web/mandates-subscriptions/mandate-execution-api
[webhooks]: https://www.juspay.io/in/docs/hyper-checkout/web/base-sdk-integration/webhooks
[mandate-arch]: https://juspay.io/in/docs/hyper-checkout/web/mandates-subscriptions/mandate-integration-architecture
