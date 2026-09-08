# M2 — Session API Application Contract (DRAFT)

> **Status:** ⏳ PENDING M1.5 FREEZE — This document is a preparation draft.
> Do NOT implement until M1.2–M1.5 are complete and the contract is frozen.
>
> **Last updated:** 2026-09-08 (corrected: mandate fields, rule_value, event names, merchant ID)

---

## 1. Purpose

Define the application contract for the Juspay Session API integration that
enables customer mandate registration via HyperCheckout. This is the missing
half of the subscription billing architecture (renewal execution already works).

## 2. Current state (what exists)

```
OrganizationSubscription   ✅ created by subscribeToPlan()
        ↓
SubscriptionRenewalService ✅ claims → attempts → charges
        ↓
JuspayBillingService       ✅ executeMandateCharge() → POST /txns
        ↓
JuspaySubscriptionMandate  ❌ NO CREATION PATH EXISTS
```

The mandate entity exists. The webhook processor updates its status. The renewal
worker reads it. **But nothing inserts the first row.**

## 3. Target state (M2–M5)

```
OrganizationSubscription (already exists — subscribeToPlan)
        ↓
[NEW M2] customer chooses subscription / onboarding flow
        ↓
[NEW M2] Saa9vi creates Juspay Session with create_mandate
        ↓
[NEW M2] frontend opens HyperCheckout (sdk_payload.clientAuthToken)
        ↓
customer authorizes mandate
        ↓
[NEW M3] Saa9vi receives MANDATE_CREATED webhook / Order Status
        ↓
[NEW M3] Saa9vi creates JuspaySubscriptionMandate row (pending → active)
        ↓
SubscriptionRenewalService (existing)
        ↓
executeMandateCharge() (existing)
        ↓
webhook → FINALIZE CAS (existing)
```

## 4. M2 Session API Adapter

### 4.1 SDK method (new)

```ts
// juspay-sdk.ts — NEW METHOD (pending M1.5 freeze)

export interface JuspaySessionRequest {
  order_id: string;           // unique merchant order ID (idempotency)
  amount: string;             // decimal rupees (e.g. "1.00")
  customer_id: string;        // Juspay customer ID
  customer_email: string;
  customer_phone: string;
  return_url: string;         // HTTPS URL for post-authorization redirect
  payment_page_client_id: string; // merchant ID
  // Mandate parameters use dot-notation in the actual API request:
  //   options.create_mandate = "REQUIRED"
  //   mandate.start_date    = UNIX epoch (required, must be today)
  //   mandate.end_date      = UNIX epoch (conditional)
  //   mandate.frequency     = "MONTHLY" | "WEEKLY" | etc.
  //   mandate.rule_value    = 1..31 for MONTHLY (execution day)
  //   mandate.max_amount    = decimal rupees
  //   mandate.amount_rule   = "FIXED" | "VARIABLE"
  //   mandate.block_funds   = boolean (provider-specific, conditional)
  options: {
    create_mandate: "REQUIRED";
    add_emandate_payment_methods?: boolean;
  };
  mandate: {
    start_date: number;       // UNIX epoch timestamp (required, must be today's date)
    end_date?: number;        // UNIX epoch timestamp (conditional)
    frequency: string;        // "MONTHLY" | "WEEKLY" | "BIMONTHLY" | etc.
    rule_value?: number;      // 1..31 for MONTHLY (execution day of month)
    max_amount: string;       // max debit amount (e.g. "1000.00")
    amount_rule?: "FIXED" | "VARIABLE";
    block_funds?: boolean;    // provider-specific/conditional — NOT universally required
  };
}

export interface JuspaySessionResponse {
  status: "NEW";
  id: string;                 // Juspay order ID (ordv2_...)
  order_id: string;           // merchant order ID (echoed back)
  payment_links: {
    web: string;              // HyperCheckout URL
    expiry: string;           // ISO-8601
  };
  sdk_payload: {
    requestId: string;
    service: string;          // "in.juspay.hyperpay"
    payload: {
      clientAuthToken: string; // ← frontend handshake token
      environment: string;     // "sandbox" | "production"
      action: string;          // "paymentPage"
      mandate: {               // echoed back
        frequency: string;
        max_amount: string;
        block_funds: boolean;
        amount_rule: string;
      };
    };
  };
}

async createSession(req: JuspaySessionRequest): Promise<JuspaySessionResponse>
```

**⚠️ IMPORTANT — Mandate field schema (corrected 2026-09-08):**
The mandate fields above reflect the **current official Juspay Web Session API
documentation** (`mandate.start_date`, `mandate.end_date`, `mandate.frequency`,
`mandate.rule_value`). The earlier draft used a simplified flat structure that
does not match the authoritative schema.

- **`mandate.start_date`** — required for Web mandate flow; UNIX epoch timestamp; must be today's date
- **`mandate.rule_value`** — maps from Saa9vi's `SubscriptionPlan` billing cadence (e.g. 1..31 for MONTHLY = execution day of month)
- **`mandate.block_funds`** — provider-specific/conditional; do NOT make it a mandatory Saa9vi domain field until M1.4 confirms it's required for your chosen payment method

**Do NOT freeze this interface until M1.4 confirms the exact field names for
your merchant/account.**

**Endpoint:** `POST /session` (JSON body, Basic Auth + x-merchantid + x-routing-id)

### 4.2 Service method (new)

```ts
// juspay-billing.service.ts — NEW METHOD (pending M1.4 freeze)

async createMandateSession(input: {
  subscriptionId: string;     // OrganizationSubscription.id (correlation)
  planId: string;             // SubscriptionPlan.id
  customerEmail: string;
  customerPhone: string;
  returnUrl: string;
}): Promise<{
  orderId: string;            // Juspay order ID (ordv2_...)
  clientAuthToken: string;    // frontend handshake
  paymentLinkWeb: string;     // HyperCheckout URL
  expiresAt: Date;
}>
```

**Correlation identity:** Uses `OrganizationSubscription.id` as the internal
correlation identity. Generates a unique Juspay `order_id` (e.g.
`sub-mandate-{subscriptionId}-{timestamp}`). Does NOT use channelId or planId
as financial transaction identifiers.

### 4.3 Integration point

```
subscribeToPlan(channelId, planId)
        ↓
OrganizationSubscription (status: "pending" — CHANGED from "active")
        ↓
[NEW] enrollToSubscription(subscriptionId)
        ↓
[NEW] createMandateSession(...)
        ↓
[NEW] returns { clientAuthToken, paymentLinkWeb, orderId }
        ↓
frontend opens HyperCheckout
```

**Subscription status change:** `subscribeToPlan()` currently sets status to
"active" immediately. With mandate registration, it should set status to
"pending" until the MANDATE_ACTIVATED webhook transitions it to "active".

## 5. M3 — Webhook-Driven Mandate Persistence

### 5.1 New webhook events (pending M1.4 verification)

```ts
// types.ts — EXTEND (pending M1.5 freeze)

export type JuspayWebhookEventName =
  | "Mandate Created"       // ← NEW: initial mandate registration complete
  | "Mandate Active"        // ← NEW: mandate activated (replaces pending)
  | "Mandate Failed"        // ← NEW: mandate registration failed
  | "MANDATE_ACTIVATED"     // existing (legacy name — verify if same as "Mandate Active")
  | "MANDATE_PAUSED"        // existing
  | "MANDATE_REVOKED"       // existing
  | "CHARGE_SUCCEEDED"      // existing
  | "CHARGE_FAILED";        // existing
```

**⚠️ IMPORTANT:** The current Juspay documentation describes mandate-specific
webhooks as **"Mandate Created"**, **"Mandate Active"**, **"Mandate Failed"**.
These exact provider event names should be used as documented, rather than
prematurely converting them to Saa9vi-internal names. The implementation should
normalize provider events internally, but the provider event constants must match
what Juspay actually sends.

**Verify in M1.4:** Are the event names exactly "Mandate Created", "Mandate Active",
"Mandate Failed"? Or does your merchant/account use different casing/format?

### 5.2 Webhook payload extension (pending M1.4 verification)

```ts
// types.ts — EXTEND (pending M1.4 freeze)

export interface JuspayWebhookPayload {
  event_name?: string;
  content?: {
    mandate?: {
      mandate_id?: string;
      mandate_token?: string;  // ← NEW: token for subsequent execution
      mandate_status?: string; // ← NEW: provider status string
      status?: string;
    };
    order?: {
      order_id?: string;
      status?: string;
      amount?: number;
      currency?: string;
      txn_id?: string;
      error_code?: string;
      error_message?: string;
    };
  };
}
```

### 5.3 Mandate creation flow (M3)

```
"Mandate Created" webhook received
        ↓
extract order_id from payload
        ↓
locate OrganizationSubscription by correlation (order_id → subscriptionId)
        ↓
create JuspaySubscriptionMandate row:
  - subscription: OrganizationSubscription
  - juspayCustomerId: from webhook
  - mandateId: from webhook (content.mandate.mandate_id)
  - mandateToken: from webhook (content.mandate.mandate_token) ← NEW FIELD
  - status: "pending"
        ↓
"Mandate Active" webhook → status: "pending" → "active"
        ↓
transition OrganizationSubscription: "pending" → "active"
```

### 5.4 Terminal policy for EXPIRED (domain decision needed)

The current Juspay documentation says a mandate moves to `EXPIRED` after its
end date and recurring execution is no longer allowed. Saa9vi cannot simply
ignore `EXPIRED`.

**Domain decision pending M1.4:**

```
EXPIRED
    ↓
OrganizationSubscription = past_due?
                         = cancelled?
                         = expired? (new status?)
```

This is a domain decision that affects the subscription FSM.

## 6. Data-Model Considerations (pending M1.4)

### 6.1 `mandate_token` field

**Current state:** `JuspaySubscriptionMandate` has `mandateId` (comment says
"mandate token") but no separate `mandate_token` field.

**Juspay docs say:** Merchants receive **both `mandate_id` and `mandate_token`**
after registration and should store both for subsequent recurring execution.

**Decision pending M1.4:** Verify the actual webhook response to determine if:
- (a) `mandateId` stores the token and a new `mandate_id` field is needed
- (b) Both fields exist and `mandate_token` must be added
- (c) The naming is just confusing and the current field is correct

### 6.2 Subscription status flow

**Current:** `subscribeToPlan()` → status = "active"
**Proposed:** `subscribeToPlan()` → status = "pending" → MANDATE_ACTIVATED → "active"

This ensures the subscription is not billed until the mandate is authorized.

## 7. What this DOES NOT touch

- `JuspayBillingService.executeMandateCharge()` (POST /txns) — existing, works
- `SubscriptionRenewalService` CLAIM→ATTEMPT→CHARGE→FINALIZE — existing, works
- `JuspayWebhookProcessorService` status-transition logic — extend only
- Vendure `PaymentMethodHandler` — not registered, stays that way
- `createMandate()` SDK method — remains unverified dead code (remove in M2?)

## 8. Vendure alignment

This follows Vendure's extension model: the SubscriptionPlugin adds its own
Shop API schema/resolvers, providers, entities, and integration logic without
turning the subscription flow into a core `PaymentMethodHandler`.

The Session API seam is a **subscription onboarding flow**, not a checkout
payment. It belongs in the SubscriptionPlugin, not in Vendure's payment system.

## 9. Freeze criteria

This contract will be frozen after:
- [ ] M1.2: Mandate-capable Sandbox gateway configured (not DUMMY)
- [ ] M1.3: One controlled HyperCheckout mandate-registration test
- [ ] M1.4: Provider state observed (mandate_id, mandate_token, mandate_status, webhook event names, webhook payload)
- [ ] M1.5: Contract reviewed and adjusted based on M1.4 evidence — **this document frozen**

## 10. Open questions (resolve in M1.4)

1. Does the webhook contain `mandate_token`? What's the exact field name?
2. What's the exact `mandate_status` value for a successfully registered mandate?
3. Are the webhook event names exactly "Mandate Created", "Mandate Active", "Mandate Failed"? Or different casing/format?
4. Does the initial registration include a first payment (charge) or just the mandate?
5. What's the Order Status API response shape after mandate registration?
6. What's the exact mandate field schema for your merchant/account? (start_date, end_date, rule_value, block_funds)
7. **Merchant ID discrepancy:** ADR-037 says `saa9vi`, portal screenshot showed `Saa9viOnlineServices`. Resolve before production.
8. **EXPIRED terminal policy:** When a mandate expires, what happens to the OrganizationSubscription? (past_due? cancelled? new expired status?)
9. **`mandate.rule_value` mapping:** How does Saa9vi's SubscriptionPlan billing cadence map to Juspay's rule_value (1..31 for MONTHLY)?