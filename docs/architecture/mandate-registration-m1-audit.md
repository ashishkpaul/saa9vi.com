# M1 — Mandate Registration Contract Audit (read-only)

**Status:** Audit complete. **Implementation contract:** NOT frozen — see §6.
**Scope:** Compare current Saa9vi subscription code against official Juspay HyperCheckout documentation and Vendure 3.x conventions.
**Method:** Source inspection only. No API calls. No code changes.

---

## 1. Confirmed fact: Saa9vi has a mandate-registration gap

| Component | State | Evidence |
|---|---|---|
| `OrganizationSubscription` creation | ✅ Implemented | `subscription.service.ts` `subscribeToPlan()` — inserts row from channel+plan |
| `JuspaySubscriptionMandate` entity | ✅ Exists | `juspay-subscription-mandate.entity.ts` — FSM: pending → active → paused/revoked |
| Recurring charge execution (`POST /txns`) | ✅ Implemented | `juspay-billing.service.ts` → `juspay-sdk.ts` `executeMandateCharge()` |
| Renewal scheduler | ✅ Implemented | `subscription-renewal.service.ts` — 10-min `ScheduledTask` |
| Webhook ingestion | ✅ Implemented | `juspay-webhook-processor.service.ts` — auth, persist, dedup, queue, process |
| First `JuspaySubscriptionMandate` insertion | ❌ Missing | No application code inserts the initial mandate row |
| `JuspaySdk.createMandate()` | ⚠️ Dead code | Only referenced by SDK definition and `juspay-contract-verify.ts`; no application caller |

**Verdict:** Renewal-execution path is complete and correctly separated from normal checkout. Registration onboarding is the missing half and should be the sole focus of M2–M5.

---

## 2. Documented provider contract candidates (NOT frozen)

Official Juspay HyperCheckout documentation describes a **Mandates (Subscriptions)** lifecycle and a Session API + HyperCheckout frontend flow for mandate registration. The following are **documented candidates**, not confirmed Saa9vi constants — they must be validated against the actual `Saa9viOnlineServices` merchant account in sandbox.

| Parameter | Documented candidate | Status |
|---|---|---|
| API | Session API → `create_mandate` parameters → HyperCheckout | ⚠️ Requires merchant confirmation |
| `mandate_type` | `RECURRING` | ⚠️ Candidate only |
| `max_amount` | Merchant-configured | ⚠️ Must be confirmed |
| `frequency` | `MONTHLY` / `WEEKLY` / etc. | ⚠️ Must be confirmed |
| `start_date` | Merchant-configured | ⚠️ Must be confirmed |
| `end_date` | Merchant-configured | ⚠️ Must be confirmed |
| Payment method | Specific to account | ⚠️ Must be confirmed |
| Customer authorization | HyperCheckout hosted/SDK flow | ⚠️ Requires payload verification |
| `mandate_id` source | Order Status response | ⚠️ Requires payload verification |
| Registration event | Webhook event | ⚠️ Requires payload verification |

**Critical:** Juspay's official docs distinguish **HyperCheckout Mandates**, **Juspay Billing**, and **NACH Mandates** as separate recurring-billing products. The exact product enabled for `Saa9viOnlineServices` determines the registration flow. Do not implement until M1.1 confirms this.

---

## 3. Internal mandate FSM — mapping needs business decision on terminals

Current entity:

```ts
type JuspayMandateStatus = "pending" | "active" | "paused" | "revoked";
```

| Juspay provider status | Proposed internal status | Confirmed? |
|---|---|---|
| `CREATED` | `pending` | ✅ Reasonable |
| `ACTIVE` | `active` | ✅ Reasonable |
| `PAUSED` | `paused` | ✅ Reasonable |
| `REVOKED` | `revoked` | ✅ Reasonable |
| `FAILURE` | **undefined** | ❌ Business decision required |
| `EXPIRED` | **undefined** | ❌ Business decision required |

`FAILURE` and `EXPIRED` must be resolved before implementing the status mapper, because the renewal worker currently requires an active mandate before charging. Terminal semantics affect subscription lifecycle (past_due? cancelled? history retained?).

---

## 4. Proposed registration sequence (sandbox-verified before code)

```text
Subscription onboarding (API)
        ↓
Create Juspay Session
        ↓
Return session/checkout data to frontend
        ↓
HyperCheckout customer authorization
        ↓
Provider Order Status / Webhook
        ↓
Idempotent upsert by provider mandate ID
        ↓
JuspaySubscriptionMandate row created
        ↓
Existing renewal worker picks up active mandate
        ↓
POST /txns (unchanged)
```

**Source-of-truth arbitration:** The exact authoritative source for initial mandate registration (Order Status poll vs. webhook ingestion) will be documented after sandbox observation. Do not declare webhook as sole source yet.

---

## 5. Data-model: do NOT auto-add `sessionId` to `JuspaySubscriptionMandate`

The M1 report previously suggested adding `sessionId` and `providerStatusRaw` to the mandate entity. **Defer this.**

The Juspay session ID is likely a transient checkout artifact, not a durable mandate identifier. If correlation is needed, a separate enrollment/session record is cleaner than permanently coupling the mandate entity to the checkout session. Establish the actual provider payload and identifier lifecycle in M1.1 before deciding.

---

## 6. What must NOT be changed during M1

| File | Reason |
|---|---|
| `juspay-billing.service.ts` | Recurring-charge execution is correct and separate |
| `subscription-renewal.service.ts` | Renewal scheduler is correct |
| `juspay-webhook-processor.service.ts` | Webhook ingestion is correct |
| `juspay-sdk.ts` `executeMandateCharge()` | Implemented and verified |
| `subscription.service.ts` `subscribeToPlan()` | Correctly associates channel+plan |
| Vendure `PaymentMethodHandler` | Not used for subscription onboarding; correct separation |