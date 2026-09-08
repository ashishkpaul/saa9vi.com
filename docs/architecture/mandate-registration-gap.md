# Mandate-Registration Gap Analysis

> **Status:** Gap confirmed. M1.1 sandbox verification complete (2026-09-08). No code changes yet — this document establishes the contract before implementation.
> **Supersedes:** The earlier (incorrect) assumption that `subscribeToPlan()` calls `createMandate()`.

## 1. The central finding

**The renewal-execution path is fully built, but no application code creates a mandate.**

```
OrganizationSubscription   ✅ created by subscribeToPlan()
        ↓
SubscriptionRenewalService ✅ claims → attempts → charges
        ↓
JuspayBillingService       ✅ executeMandateCharge() → POST /txns
        ↓
JuspaySubscriptionMandate  ❌ NO CREATION PATH EXISTS
```

The mandate entity exists. The webhook processor updates its status. The renewal worker
reads it. **But nothing in Saa9vi's application layer ever inserts the first row.**

---

## 2. Current-state inventory

### What EXISTS and is wired

| Component | File | Role |
|---|---|---|
| `JuspaySubscriptionMandate` entity | `entities/juspay-subscription-mandate.entity.ts` | `pending → active → paused/revoked` FSM |
| `JuspaySdk.createMandate()` | `juspay/juspay-sdk.ts:192` | **Unverified** SDK method, POST `/mandates` |
| `JuspayBillingService.chargeSubscription()` | `services/juspay-billing.service.ts:34` | Executes recurring charge against existing mandate |
| `SubscriptionRenewalService` | `services/subscription-renewal.service.ts` | CLAIM→ATTEMPT→CHARGE→FINALIZE state machine |
| `JuspayWebhookProcessorService` | `services/juspay-webhook-processor.service.ts` | Processes MANDATE_ACTIVATED, MANDATE_PAUSED, MANDATE_REVOKED |
| `executeMandateCharge()` | `juspay-sdk.ts` | POST `/txns` with `mandate_id` |
| Webhook e2e tests | `__tests__/juspay-webhook.e2e-spec.ts` | Mandate FSM transitions tested (webhook-driven) |

### What does NOT exist (the gap)

| Missing piece | Impact |
|---|---|
| Any caller of `JuspaySdk.createMandate()` | SDK method is dead code |
| Any GraphQL mutation to enroll a mandate | No API seam |
| Any service method that creates `JuspaySubscriptionMandate` from a customer authorization | Mandate row never inserted |
| Any Session API integration (Juspay HyperCheckout) | No customer-facing authorization flow — **M1.1 confirmed this is the correct path** |
| Any mapping from Juspay provider status strings to internal `JuspayMandateStatus` | Webhook processor must assume alignment |

---

## 5A. M1.1 Live Sandbox Findings (2026-09-08)

The M1.1 verifier (`juspay-m1.1-verify.ts`) confirmed the following against the
live Sandbox environment:

### Session API contract (live-confirmed)

`POST /session` requires these fields (official docs confirmed by live call):
- `action`: `"paymentPage"` — required
- `return_url`: valid HTTPS URL — required
- `order_id`, `amount`, `customer_id`, `customer_email`, `customer_phone` — required
- `options.create_mandate`: `"REQUIRED"` — mandate registration flag
- `mandate.max_amount`, `mandate.frequency`, `mandate.amount_rule`, `mandate.block_funds` — mandate params

Response: `200 NEW` with `sdk_payload.payload.clientAuthToken` (the HyperCheckout
handshake token) and `payment_links.web` (the checkout URL).

### Payment methods (live-discovered)

There is **NO separate Payment Methods API**. The documented "Payment Methods
API" is the **Session API** with `options.add_emandate_payment_methods: true`.
The mandate-capable payment methods are rendered in the HyperCheckout UI, not
returned in the API response.

### Sandbox gateway limitation

The Sandbox portal shows gateway = `DUMMY`. This proves authentication + Session
API + account configuration, but does **not** prove a real PG mandate flow. A real
PG (not DUMMY) is required for the full mandate registration test.

### What this confirms

- The Session API is the correct mandate-registration path (not `POST /mandates`)
- The frontend needs `sdk_payload.payload.clientAuthToken` to open HyperCheckout
- Mandate params are echoed back in `sdk_payload.payload.mandate`
- Payment methods are rendered in HyperCheckout UI (not a separate API)
- **M1.1 proves session creation, NOT mandate registration** — a real PG (not DUMMY) and customer authorization are required

### M1.2 — Next gate

Before implementing M2 application code:

1. **M1.2** — Configure a mandate-capable Sandbox gateway/payment-method combination
2. **M1.3** — Perform one controlled HyperCheckout mandate-registration test
3. **M1.4** — Observe provider state (order_id, mandate_id, mandate_status, webhook)
4. **M1.5** — Freeze M2 application contract

**Do NOT implement M2 until M1.2–M1.4 are complete.**

---

## 3. The dead method

```ts
// juspay-sdk.ts — definition exists, NO application caller
async createMandate(opts: JuspayMandateOptions): Promise<JuspayMandateResult>
```

- Listed in `juspay-sdk.ts` contract header as **"UNVERIFIED pending live sandbox"**
- Only invoked from `juspay-contract-verify.ts` (a standalone verification script, not application code)
- The endpoint it targets (`POST /mandates`) is **not** the registration flow described in current Juspay HyperCheckout docs

---

## 4. The entity expects to be created, but isn't

The `JuspaySubscriptionMandate` entity:

- Has a partial unique index enforcing **one active mandate per subscription**
- Has an FSM driven **exclusively by webhooks** (never by API callers, per entity doc)
- Assumes `mandateId` is populated when a charge is executed

But:

- `subscribeToPlan()` only inserts `OrganizationSubscription`
- No service method accepts a mandate token/ID and inserts the row
- The renewal worker reads `mandateId` — if no mandate row exists, the charge cannot execute

---

## 5. The contract mismatch

### Juspay's documented mandate-registration flow (current HyperCheckout docs)

```
Session API
   ↓
create_mandate parameters (REQUIRED/OPTIONAL)
   ↓
HyperCheckout customer-facing UI
   ↓
customer authorizes mandate/payment
   ↓
Order Status + Webhook
   ↓
mandate_id + mandate_status
```

### What the SDK currently assumes

```
POST /mandates   ← direct server-to-server call
   ↓
mandate_id + status
```

These are **not the same flow**. The documented flow requires the customer to complete
HyperCheckout; the SDK's `createMandate()` assumes a direct server call returns an
activated mandate.

## 6. Provider-status vs internal-FSM mismatch

`JuspaySubscriptionMandate.status`:

```ts
type JuspayMandateStatus = "pending" | "active" | "paused" | "revoked";
```

Juspay's documented mandate statuses:

```text
CREATED | ACTIVE | PAUSED | REVOKED | FAILURE | EXPIRED
```

These are **not identical**. The internal FSM is intentionally simpler, but the
**mapping from provider → internal is not explicit anywhere**. The webhook processor
must currently assume alignment that has not been tested.

---

## 7. What must be decided before implementation

| Decision | Options |
|---|---|
| **How is the mandate registered?** | (a) Session API + HyperCheckout customer flow; (b) direct server call (replace `createMandate()`); (c) hybrid |
| **Is `createMandate()` repurposed or removed?** | If (a): remove. If (b): verify and wire. |
| **Where does the authorization happen in Saa9vi?** | Subscription onboarding (post-`subscribeToPlan`)? Dedicated enrollment mutation? |
| **How does the mandate reach `JuspaySubscriptionMandate`?** | Webhook-driven creation? Server callback after HyperCheckout? |
| **Who maps provider status → internal FSM?** | `JuspayWebhookProcessorService` (extends existing pattern)? Dedicated mapper? |
| **Does this require a Vendure `PaymentMethodHandler`?** | **No.** Keep separate from the one-off checkout flow. This is a subscription onboarding/payment flow. |

---

## 8. The clean next path (recommended)

```
Saa9vi SubscriptionPlan
        ↓
OrganizationSubscription (already exists — subscribeToPlan)
        ↓
[NEW] customer chooses subscription / onboarding flow
        ↓
[NEW] Saa9vi creates Juspay Session with create_mandate
        ↓
[NEW] frontend opens HyperCheckout
        ↓
customer authorizes mandate
        ↓
[NEW] Saa9vi receives Order Status / Webhook
        ↓
[NEW] Saa9vi creates JuspaySubscriptionMandate row (pending → active)
        ↓
SubscriptionRenewalService (existing)
        ↓
executeMandateCharge() (existing)
        ↓
webhook → FINALIZE CAS (existing)
```

### What this DOES NOT touch

- `JuspayBillingService` (`executeMandateCharge` / POST `/txns`)
- `SubscriptionRenewalService` CLAIM→ATTEMPT→CHARGE→FINALIZE
- `JuspayWebhookProcessorService` status-transition logic
- Vendure `PaymentMethodHandler` (not registered, stays that way)

---

## 9. Why NOT to wire `createMandate()` as-is

1. It is **unverified** against live sandbox.
2. Its endpoint (`POST /mandates`) does not match the current Juspay-documented registration flow.
3. Even if it worked, a direct server call does not involve the customer authorizing the mandate — Juspay's recurring-charge model requires customer authorization via HyperCheckout.
4. The SDK's own comment says: *"createMandate() remains UNVERIFIED pending live sandbox."*

### Correct action

Do not wire it. First settle the contract (section 7), then decide whether to repurpose
or remove it.

---

## 10. Documentation status

- `juspay-sdk.ts` header: correctly marks `createMandate()` unverified.
- `juspay-subscription-mandate.entity.ts`: FSM comment is correct for webhook-driven transitions, but implies creation happens somewhere it currently doesn't.
- `plugin-map.md`: does not yet document the mandate-registration flow (because it doesn't exist yet).
- `roadmap.md`: should list mandate-registration as the next subscription gate.

---

## 11. Acceptance criteria for closing this gate

- [x] M1.1 sandbox verification complete — auth, Session API, payment methods confirmed
- [ ] Mandate-registration flow decision documented (section 7 decisions made)
- [ ] `createMandate()` either removed or verified + wired to the chosen flow
- [ ] New application seam creates `JuspaySubscriptionMandate` after customer authorization
- [ ] Provider-status → internal-FSM mapping explicit and tested
- [ ] End-to-end: subscription → mandate registration → renewal charge → webhook → finalize
- [ ] `plugin-map.md` updated
- [ ] `roadmap.md` updated

