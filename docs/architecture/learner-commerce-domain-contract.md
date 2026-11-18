# Learner Commerce Domain Contract — MCR-2.1 / MCR-2.2

**Status:** PROPOSED — corrected business sequence; architecture and policy review before implementation  
**Scope:** MCR-2.1 Learner-to-tenant recurring lifecycle and MCR-2.2 Course enrollment / entitlement convergence  
**Baseline:** `main` at `840a7a4240348f23ea5c61829c8686d37a59fe7a` (the `saa9vi_com` branch tree at `9c3942eb1bedbc7a5fa3490d1a73eddca5422180` was identical at review time)  
**Canonical worklist:** [Marketplace Commerce & Revenue](../implementation/marketplace-commerce-revenue-worklist.md)  
**As-built learning contract:** [Learning Domain Mini-Spec](learning-domain.md)  
**Related payment contract:** [ADR-054 — Per-Tenant Razorpay Flow B](../adr/adr-054-per-tenant-razorpay-flow-b.md)

> This document proposes boundaries and acceptance contracts. It deliberately does not add entities, GraphQL fields, migrations, provider calls, or database changes. It supersedes the payment-first interpretation of initial learner enrollment in PR #24. The decisions in §13 must be reviewed before implementation begins.

---

## 1. Purpose and outcome

Saa9vi needs a learner-to-tenant commercial lifecycle that is separate from the existing tenant-to-Saa9vi subscription lifecycle. The tenant controls whether, when and how learners are charged. **Initial learner admission/enrollment is an academic/tenant decision and is not payment-gated by default.** A tenant may admit learners at a zero-cost stage, let them begin or continue the course, and later offer a paid continuation, paid period, or other commercial option. Once the learner accepts a paid offer, verified payment or confirmed third-party collection can create or extend a bounded commercial access period according to the tenant's policy.

The programme has two connected but distinct responsibilities:

- **MCR-2.1 — Commercial lifecycle:** learner offer/plan, tenant-owned recurring subscription, provider binding, billing attempts, renewal, failure, dunning, grace, cancellation, expiry and reconciliation.
- **MCR-2.2 — Enrollment and access convergence:** preserve tenant-controlled zero-cost/manual admission, and independently apply optional paid-continuation entitlements when the tenant offers a commercial term. Never turn payment state into academic enrollment state.

The outcome is a tenant-scoped learner journey with two independently managed concerns: (1) academic admission/enrollment, which can exist before any payment; and (2) optional commercial collection/access periods, which begin only when the tenant offers a paid continuation and the learner accepts it.

## 2. Current source baseline — existing capabilities and gaps

The following are source observations at the baseline above. They are not claims of production/provider verification.

### 2.1 LearningPlugin

Existing source:

- `LearningCourse` is tenant-scoped by scalar `channelId`, with a per-channel slug and `DRAFT / PUBLISHED / CLOSED / ARCHIVED` lifecycle.
- `CourseEnrollment` records `courseId`, `customerId`, `channelId`, role and academic status: `INVITED / ENROLLED / SUSPENDED / COMPLETED / WITHDRAWN`.
- `CourseEnrollmentService.enroll()` verifies the course belongs to the current Channel and requires ACTIVE academy admission through `LearnerAdmissionPort`. It does not itself verify a payment.
- The current Admin API can create an ENROLLED enrollment. This supports staff-managed/manual admission and must not be silently redefined as a paid-only operation.
- The Shop API exposes learner course reads, not self-enrollment or invite acceptance. Its current course-read checks require an ENROLLED row and ACTIVE academy admission.
- The current Shop course-read path does not establish a time-bounded paid entitlement check.

Relevant sources:
- `src/plugins/learning-plugin/entities/learning-course.entity.ts`
- `src/plugins/learning-plugin/entities/course-enrollment.entity.ts`
- `src/plugins/learning-plugin/services/course-enrollment.service.ts`
- `src/plugins/learning-plugin/api/learning-shop.resolver.ts`
- `src/platform/learner-admission.port.ts`
- `docs/architecture/learning-domain.md`

### 2.2 Existing billing and payment code

The existing subscription domain is explicitly for tenant-to-Saa9vi billing:

- `SubscriptionPlan` is a platform-global catalogue of SaaS tiers.
- `OrganizationSubscription` represents a tenant's subscription to Saa9vi and is unique per Channel for non-cancelled rows.
- `SubscriptionBillingAttempt` is tied to `OrganizationSubscription`; it is not a generic learner billing ledger.
- `RazorpaySubscriptionProvider` currently obtains platform credentials from `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.

Flow B has separate tenant-owned one-time payment foundations:

- `TenantPaymentAccount` stores one provider account per Channel/provider, with tenant Key Secret and webhook secret encrypted at rest.
- `tenant-razorpay` is the tenant one-time `PaymentMethodHandler`.
- `TenantPaymentWebhookEvent` is the Channel-aware, persist-first tenant webhook inbox. The current Flow B worker handles `payment.captured`; subscription event dispatch is not yet implemented.

Relevant sources:
- `src/plugins/subscription/entities/subscription-plan.entity.ts`
- `src/plugins/subscription/entities/organization-subscription.entity.ts`
- `src/plugins/subscription/entities/subscription-billing-attempt.entity.ts`
- `src/plugins/subscription/providers/razorpay/razorpay-subscription.provider.ts`
- `src/plugins/payments/entities/tenant-payment-account.entity.ts`
- `src/plugins/payments/entities/tenant-payment-webhook-event.entity.ts`
- `src/plugins/payments/config/tenant-razorpay-payment-handler.ts`
- `src/plugins/payments/services/tenant-razorpay.service.ts`

### 2.3 Consequence

Do not reuse `OrganizationSubscription`, platform `SubscriptionPlan`, `SubscriptionBillingAttempt`, or the current platform-credential `RazorpaySubscriptionProvider` as the learner subscription implementation. Their ownership and credential assumptions are different.

The learner recurring domain must resolve provider credentials from the owning tenant's `TenantPaymentAccount` and must keep Flow A and Flow B separate.

## 3. Non-negotiable invariants

1. **INV-001 — Channel = Tenant.** Every learner offer, learner subscription, provider binding, billing attempt and course access grant is owned by exactly one tenant Channel. Do not introduce a redundant `tenantId`.
2. **Flow A / Flow B separation.**
   - Flow A: tenant administrator → Saa9vi; platform credentials; `OrganizationSubscription`.
   - Flow B: learner/customer → tenant; tenant credentials; learner commercial domain.
3. **INV-002 — Immutable billing facts.** A completed billing attempt is an auditable fact. Retries create new attempts. Do not overwrite a succeeded/failed financial result to make the current state look correct.
4. **INV-004 — Persist before process.** Verify the webhook signature over the exact raw bytes, durably persist the receipt, then enqueue/process it. Do not acknowledge a webhook as safely accepted if persistence failed.
5. **Provider is authoritative for money.** Browser redirects, client callbacks, a local “success” flag, `subscription.activated` by itself, or an order being created are not proof of a paid period.
6. **Tenant account authority.** Provider account and credentials are resolved from server-side Channel context and the matching tenant account. Never accept a client-supplied payee, Channel ID, Key Secret, provider plan ID or amount as authority.
7. **No cross-tenant order/cart.** Keep each Vendure order within one non-default tenant Channel.
8. **Admission-first, tenant-controlled charging.** A tenant may create an invitation/enrollment and grant initial zero-cost course participation without payment, mandate or payment gateway setup. No learner payment is required to create the initial academic enrollment unless the tenant explicitly configures a paid-first offer for that course/cohort.
9. **Academic and commercial state remain separate.** Payment does not automatically create academic admission; lack of a payment does not automatically block an already admitted learner. Academic statuses such as `COMPLETED` or `WITHDRAWN` are not payment statuses.
10. **Tenant chooses collection method.** For a paid continuation, the tenant may request collection through its configured online gateway (including its own Razorpay account) or record an approved external method such as bank transfer, UPI/GPay, cash or another tenant-supported method. Saa9vi must distinguish provider-verified collections from tenant-attested/offline collections; never represent a manual attestation as a provider webhook/payment verification.
11. **Access is policy-bounded.** Free/manual admission is governed by the tenant's academic policy. Paid continuation is governed by the purchased/recorded commercial term. One payment must not silently create indefinite paid access.
10. **No direct business-data SQL mutations.** Runtime business mutations use the Shop/Admin GraphQL APIs or approved application services invoked by those APIs. Schema changes use `npx vendure migrate`.

## 4. Proposed bounded-context split

| Context | Owns | Must not own |
|---|---|---|
| Tenant SaaS subscriptions (existing SubscriptionPlugin) | Tenant plan, `OrganizationSubscription`, platform Razorpay provider lifecycle | Learner course subscriptions or tenant merchant credentials |
| Tenant one-time commerce (existing PaymentsPlugin / Vendure order) | One-time order payment using `tenant-razorpay`, tenant account and Flow B settlement | Recurring learner subscription state |
| Learner commerce (new bounded context; plugin/module placement to confirm) | Learner offer, learner subscription, provider binding, billing attempts, renewal and cancellation policy | Saa9vi's `OrganizationSubscription` |
| Learning domain (existing LearningPlugin) | Course catalogue, academic enrollment, learning-page authorization | Provider credentials or raw payment processing |
| BBB access (existing BBB entitlement domain) | BBB meeting/session entitlement and join authorization | Inferring access from a course page or client-side purchase state |

**Placement proposal:** keep learner commercial state out of `SubscriptionPlugin`. A dedicated learner-commerce module/plugin may coordinate with LearningPlugin through narrow ports and with PaymentsPlugin's tenant-account service through an explicit provider/account port. Final plugin placement is an implementation design decision; avoid circular plugin imports and cross-plugin repository access.

## 5. Commercial model proposal (conceptual, not entity DDL)

Names below are provisional. They describe the information the domain must own, not an approved schema.

### 5.1 Tenant learner offer / plan

A tenant-managed offer should contain. Offers are optional and need not exist when a learner is first admitted:

- owning `channelId`;
- stable tenant-scoped code/name and publication/availability status;
- target resource (MVP proposal: exactly one `LearningCourse`);
- billing mode: `RECURRING` or `FIXED_TERM`;
- price in integer minor units and ISO currency code;
- for recurring mode: provider-compatible billing interval and billing-cycle limit/renewal policy;
- for fixed-term mode: explicit access duration or fixed end-date rule;
- tenant/provider mapping, if the provider requires a plan object;
- effective dates and audit metadata.

A plan price or billing interval change must not silently rewrite an existing learner's purchased terms. Snapshot the accepted commercial terms onto the subscription/purchase record.

**MVP scope proposal:** course-specific paid-continuation offers only. A course may start with no offer/price and no payment collection. General services, bundles, multi-course packs and physical goods remain outside MCR-2.1/2.2 until the product taxonomy in MCR-0.2 defines their fulfilment contract.

### 5.2 Learner subscription

The learner subscription aggregate should bind:

- one owning Channel;
- the tenant Channel's Vendure Customer / learner identity;
- one learner offer/plan and its target course;
- a provider binding to the tenant's Razorpay account and provider subscription ID;
- an immutable snapshot of price, currency, interval/term and purchased policy;
- local business status, cancellation policy, paid-through period and bounded grace deadline;
- created/updated actor and correlation/idempotency references.

Do not use the learner's email, provider customer ID or a browser-provided tenant identifier as a substitute for authenticated Customer + Channel ownership.

### 5.3 Provider binding

The binding must retain the provider/account relationship needed to prove that the provider subscription belongs to the tenant:

- `channelId`;
- provider key/name;
- reference to the tenant payment-account configuration/version or another stable account identity;
- provider subscription ID and provider plan ID;
- provider-reported status snapshot and last reconciliation time;
- only non-secret provider metadata needed for reconciliation.

Provider plan IDs are merchant-account scoped. Do not reuse the global `SubscriptionPlan.providerPlanId` for tenant learner plans.

### 5.4 Billing attempts

A learner billing-attempt record must be independent of `SubscriptionBillingAttempt`, whose parent is `OrganizationSubscription`, unless a later design explicitly generalizes billing attempts without weakening ownership guarantees.

Each attempt should record:

- tenant Channel and learner subscription;
- provider and provider event/payment/invoice identifiers;
- amount in minor units and currency;
- provider-confirmed billing period start/end, when supplied;
- attempt time and terminal result;
- typed failure/reconciliation information;
- idempotency identity.

Provider event/payment uniqueness must be scoped so one tenant's event or payment cannot settle another tenant's learner subscription. Terminal financial facts are not edited in place; retries and compensating facts are recorded separately.

## 6. Proposed recurring lifecycle

The local state machine is a Saa9vi business contract; provider status strings are evidence inputs, not values to copy blindly.

| Local state | Meaning | Allowed outcomes |
|---|---|---|
| `pending_authorization` | Subscription created; learner authorization / first qualifying payment not yet confirmed | `active`, `cancelled`, terminal failure |
| `active` | Provider-backed subscription is active and a qualifying paid period is recorded | `past_due`, `cancelled`, `completed` |
| `past_due` | A renewal/charge failed or provider reports pending; dunning/retry in progress | `active` after verified recovery, `halted`, `cancelled` |
| `halted` | Provider exhausted retries or stopped collection | `active` after verified recovery, `cancelled` |
| `cancelled` | Provider/local cancellation is confirmed | terminal; access follows the cancellation/refund policy |
| `completed` | Provider subscription reached its configured billing-cycle completion | terminal billing state; access remains only through the last paid-through boundary |
| `expired` | No current paid/grace entitlement remains | terminal for this subscription |

Additional state is represented separately:

- `cancelAtPeriodEnd` is a cancellation instruction, not a paid-period extension.
- `paidThrough` is derived only from qualifying provider-confirmed payment periods.
- `graceUntil` is an explicit bounded Saa9vi policy deadline; it does not rewrite the paid-through date.
- Pause/resume and plan-change/proration are deferred until explicit policies are approved.

### 6.1 Provider event interpretation

Razorpay documents subscription webhook events including `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.completed`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.paused` and `subscription.resumed`.

Important distinctions for the implementation:

- `subscription.authenticated` indicates a first payment, which may be an authorisation amount, upfront amount, plan amount or a combination. The payment object and amount must be verified before deciding what access period it purchases.
- `subscription.activated` is a provider lifecycle transition; it is not by itself proof that a new invoice/period has been paid.
- `subscription.charged` is the recurring successful-charge signal and must be bound to the provider payment, subscription, tenant account, expected amount/currency and billing period.
- `subscription.pending` represents failed collection/retry state; `subscription.halted` indicates retries are exhausted. Neither extends paid access.
- `subscription.cancelled` ends future billing according to the confirmed provider cancellation semantics. It does not automatically imply a refund.

Use an explicit event allow-list and typed dispatcher. Unknown or unsupported event types are durably recorded and safely ignored/parked with observability; they must never accidentally activate a subscription.

Razorpay references:
- [Subscription webhook events and sample payloads](https://github.com/razorpay/markdown-docs/blob/master/webhooks/subscriptions.md)
- [Razorpay subscription webhook event list](https://d6xcmfyh68wv8.cloudfront.net/docs/payments/subscriptions/notifications/)

### 6.2 Credentials and webhook boundary

The existing `RazorpaySubscriptionProvider` uses platform environment credentials and is therefore not suitable unchanged for learner-to-tenant recurring subscriptions. A tenant recurring provider adapter must resolve credentials from the owning Channel's `TenantPaymentAccount`, use the tenant's provider plan/subscription references, and fail closed when the account is missing, disabled, inactive or not approved for recurring capability.

The existing `TenantPaymentWebhookEvent` inbox is a candidate shared durable ingress for tenant Razorpay payment and subscription events. The current Flow B worker handles `payment.captured`; it does not yet process subscription lifecycle events. Before implementation, verify whether the existing inbox/route can safely dispatch both event families. Prefer reusing the persist-first tenant inbox with separate typed processors over creating a second inbox, provided the unique key, payload retention, event claim/lease and account binding satisfy recurring-event requirements. If they do not, document the specific gap before adding a new entity.

A webhook worker must:
1. identify the tenant account from trusted server-side routing/binding;
2. verify the signature against the exact raw request bytes;
3. persist the event before queueing/processing;
4. deduplicate by provider + tenant + provider event identity;
5. bind the event's provider subscription/payment IDs to the learner provider binding;
6. fetch provider facts where needed and verify account, subscription, amount, currency and billing period;
7. apply guarded, idempotent state transitions and record billing facts;
8. expose retry/dead-letter/reconciliation outcomes to tenant/platform operators without exposing secrets.

Disabling a tenant account for new checkout must not prevent recovery/reconciliation of a payment already captured by that tenant.

## 7. Tenant-directed collection methods and purchase distinction

The commercial contract must not force every learner through a purchase or recurring subscription. Enrollment may precede any commercial offer. When a tenant decides to charge for continuation, the learner may accept a recurring plan, a fixed-term/one-time offer, or a collection request using an approved external method.

| Purchase mode | Payment source of truth | Access period |
|---|---|---|
| Recurring course plan | Tenant Razorpay subscription; qualifying provider-confirmed charge per cycle | Provider-confirmed paid cycle, plus only an explicitly configured grace window |
| Fixed-term course offer | Tenant Flow B Vendure order settled through `tenant-razorpay` | Explicit term purchased in the offer/order snapshot |
| Zero-cost initial admission | Tenant-admin invitation/enrollment or approved free admission; no payment transaction required | Access follows the tenant's initial-course/cohort policy; no paid term is inferred |
| Manual/offline collection | Tenant staff records bank transfer, UPI/GPay, cash or other configured external collection with reference/evidence and actor/time attribution | Paid continuation begins only after the tenant's authorized collection-confirmation policy is satisfied; record source as manual/offline, not provider-verified |
| Gateway collection | Tenant's own configured gateway; for Razorpay, resolve the correct tenant account and verified provider facts | Paid continuation begins only after confirmed settlement/collection according to the provider contract |

For ordinary one-time orders, use Vendure's normal order/payment lifecycle and the existing tenant handler. Vendure's `addPaymentToOrder` / `PaymentMethodHandler` contract is distinct from the recurring subscription lifecycle. Do not create a fake Vendure order/payment for a recurring charge unless a separate invoicing/accounting decision requires one.

References:
- [Vendure OrderService — addPaymentToOrder](https://docs.vendure.io/current/framework/reference/typescript-api/services/order-service)
- [Vendure PaymentMethodHandler](https://docs.vendure.io/current/framework/reference/typescript-api/payment/payment-method-handler)

## 8. MCR-2.2 — Course enrollment and access convergence

### 8.1 Admission and enrollment are not payment-gated by default

The initial learner journey is admission-first:

```text
Tenant admin creates invitation / enrolls learner
                 |
                 v
     Learner joins the course (zero stage)
                 |
                 v
       Initial learning participation
                 |
                 v
 Tenant decides whether to offer paid continuation
                 |
                 v
 Learner accepts an offer or collection request
                 |
       +---------+----------------------+
       |                                |
       v                                v
Online tenant payment             External collection
(Razorpay / other PG)             (bank transfer / UPI-GPay / cash)
       |                                |
       v                                v
Provider-verified fact          Tenant-attested receipt fact
       +---------------+----------------+
                       |
                       v
        Commercial period / continuation access
```

The tenant may choose not to charge, may charge later, or may offer a paid continuation to selected learners/cohorts. The initial admission must not automatically create a mandate or subscription. The tenant's decision to charge is explicit and separate from initial enrollment.

### 8.2 Preserve the academic enrollment state machine

Keep the existing academic states and their meanings:

`INVITED → ENROLLED | WITHDRAWN`  
`ENROLLED → SUSPENDED | COMPLETED | WITHDRAWN`  
`SUSPENDED → ENROLLED | COMPLETED | WITHDRAWN`

Do not add payment states such as `PAID`, `PAST_DUE` or `EXPIRED` to `CourseEnrollment`. An academy can enroll a learner manually, scholarship/free admission can exist, and payment failure must not rewrite academic completion/withdrawal history.

MCR-2.2 adds a commercial-access eligibility check alongside academic admission/enrollment; it does not replace the existing FSM.

### 8.3 Proposed course access grant

A conceptual `CourseAccessGrant` (name provisional) represents a time-bounded right to access one tenant course. It should contain:

- `channelId`, `customerId`, `courseId`;
- source type: `LEARNER_SUBSCRIPTION`, `SETTLED_ORDER`, or an explicitly approved `FREE / MANUAL` source;
- immutable source reference and idempotency key;
- `validFrom` and `validUntil` in UTC, with `validUntil` exclusive;
- policy/version metadata sufficient to explain why the grant exists.

A successful renewal adds the next confirmed period; it does not mutate the earlier billing attempt. Overlapping valid grants may coexist (for example, scholarship plus paid term). A cancellation/refund/chargeback adjustment must be auditable and must not erase the original payment or grant fact.

Do not create a second generic BBB entitlement system. Course-level access and BBB session/meeting access remain separate checks. MCR-2.2 must explicitly map a course access grant to the existing BBB entitlement contract and preserve the existing BBB join authorization path.

### 8.4 Access predicate

For a paid course page, lesson or course-scoped tool, access should require all applicable conditions:

1. authenticated Shop user resolves to a Customer in the active Channel;
2. active Channel is the owning non-default tenant Channel;
3. Customer has ACTIVE academy admission, unless a separately approved self-admission policy says otherwise;
4. course belongs to that Channel and is currently published/available;
5. an academic `CourseEnrollment` exists in `ENROLLED` state;
6. at least one valid course access grant covers the current server time, unless the course is explicitly free/manual under tenant policy;
7. for a BBB meeting, the separate BBB session entitlement and meeting-specific authorization also pass.

The browser cannot supply or extend the access period. Every Shop resolver and BBB join boundary must enforce the server-side predicate; hiding a button or tool is not authorization.

### 8.5 Enrollment and commercial convergence triggers

Two separate triggers exist and must not be conflated:

**A. Initial admission/enrollment (zero stage):**
- A tenant administrator may invite/enroll a learner using the existing LearningPlugin academic workflow, subject to the current ACTIVE academy-admission requirement and tenant permissions.
- This action does not require a learner offer, payment method, provider account, mandate or payment transaction.
- The resulting initial learning access follows an explicitly defined tenant course/cohort policy. It must not be mislabeled as paid access.

**B. Paid continuation / commercial access:**
- A tenant administrator publishes/offers a paid continuation or requests collection from an already admitted learner.
- The learner accepts the offer/collection request and chooses one of the methods enabled by that tenant.
- For an online PG, the provider-confirmed transaction creates the durable collection fact. For offline/external collection, an authorized tenant actor records a manual collection fact with method, amount, currency, reference/evidence, actor and timestamp; it must be marked `MANUAL_CONFIRMED` (or equivalent), never `PROVIDER_VERIFIED`.
- A separate idempotent convergence operation applies the paid term to the learner's commercial access period and updates/creates the relevant course continuation entitlement. It does not create the initial academic admission retroactively.
- If collection is pending/unverified, preserve the request/attempt but do not mark the paid continuation as collected. Tenant policy may leave existing zero-stage/current access unchanged until its configured boundary; an unverified payment must not extend a paid term.

The provider/manual collection fact and access convergence may not be one database transaction. Design for retry/reconciliation and idempotent convergence rather than assuming distributed atomicity.

## 9. Collection, continuation, cancellation, refund and recovery contract

| Situation | Commercial result | Access result |
|---|---|---|
| Learner admitted at zero stage; no payment request exists | No commercial subscription/collection record required | Initial access follows tenant course/cohort policy |
| Paid continuation offered but not yet accepted | Offer/collection request remains pending | Existing zero-stage/current access is not silently converted to paid access |
| Authorization started, no qualifying collection | Pending authorization | No new paid period; existing permitted access is not retroactively revoked solely because an offer is pending |
| Provider-verified qualifying gateway payment | Active subscription / successful attempt or paid collection | Grant/extend only the verified purchased period |
| Tenant confirms an external/offline payment | Append a manual collection fact with method and actor attribution | Grant/extend only the term authorized by the tenant's offline-collection policy; label its provenance accurately |
| Renewal payment succeeds | New immutable successful attempt | Append/extend by the confirmed provider period |
| Renewal payment fails | Past due / pending | Do not extend paid-through; apply only an explicitly approved bounded grace policy |
| Provider halts after retries | Halted | No new paid period; grace handling follows approved policy |
| Cancel at period end | Cancellation scheduled | Existing paid period remains valid; no future period after its end |
| Immediate cancellation | Cancellation confirmed | Revoke future access according to policy; do not infer refund |
| Full/partial refund | Append refund/adjustment fact | Recompute/revoke affected remaining access by approved policy |
| Chargeback/dispute | Append dispute/chargeback fact and alert | Apply explicit dispute policy; preserve original payment facts |
| Duplicate/out-of-order webhook | Idempotent no-op or safe replay | No duplicate grant or duplicate billing attempt |
| Provider/API/queue outage | Pending reconciliation with retries/alert | Fail closed for new access; do not lose verified incoming facts |

Policy values that must not be invented in code include grace duration, dunning schedule, refund/proration behavior, immediate-cancellation treatment and chargeback access behavior.

## 10. Proposed GraphQL actor contract

The API shapes below are capability-level contracts, not final SDL names.

### Shop API — learner

- List published offers available in the current Channel and course.
- Start a recurring subscription authorization or initiate a fixed-term checkout.
- Read the learner's own subscription and access status in the current Channel.
- Request cancellation (default proposal: cancel at period end).
- Read course access and paid-through information without receiving provider secrets or internal provider payloads.

Trust boundary:
- Do not accept `channelId`, `customerId`, amount/currency, provider plan ID, provider subscription ID or entitlement period as authority from the caller.
- Resolve Customer from `ctx.activeUserId` and active Channel, and verify Customer/Channel association.
- Only return a provider authorization URL/public checkout data intended for that learner and that invocation.

### Admin API — tenant staff

- Create/update/archive tenant learner offers and plan prices.
- Inspect subscriptions, billing attempts, paid-through/grace status and reconciliation outcomes for the current Channel.
- Perform explicitly authorized reconciliation/retry/cancel operations with actor attribution.
- Do not expose encrypted/raw Key Secret, webhook secret, provider credentials or another tenant's subscription.

Permission names and role grants should be decided in implementation review and added to tenant registration defaults through the approved permission contract.

## 11. Test and acceptance matrix

### MCR-2.1 — recurring lifecycle

- Same-channel learner can start only their own offer; another learner's subscription/order ID is not usable.
- Cross-tenant Channel, Customer, plan, provider account and provider subscription references are rejected.
- Disabled, inactive, missing or non-recurring-capable tenant payment account fails closed for new subscription creation.
- Platform Razorpay credentials and Flow A `OrganizationSubscription` are never used for learner billing.
- Authorization without a qualifying paid amount grants no paid period.
- A verified charge with wrong subscription, merchant/account, amount, currency or period is rejected and alerted.
- Duplicate, delayed and out-of-order webhooks create no duplicate attempt or period.
- Renewal success, pending/failure, recovery, halted, cancel-at-period-end, immediate cancel, completion and expiry follow the local FSM.
- Billing attempts and provider event receipts remain auditable; retries append rather than rewrite terminal facts.
- Tenant account disablement blocks new subscriptions but does not block valid in-flight webhook recovery.

### MCR-2.2 — enrollment and entitlement

- Tenant admin can invite/enroll a learner at the zero stage without creating a payment, mandate or provider subscription.
- An admitted learner can participate in the initial course period according to the tenant's zero-stage/course policy.
- Offering or requesting payment for continuation does not require the learner's initial enrollment to be recreated.
- Provider-verified and tenant-attested/offline collection facts remain distinguishable and auditable.
- An ENROLLED row without a paid continuation grant may still access the tenant-approved zero-stage/current initial course scope; it cannot access an additional paid continuation period unless a qualifying provider or authorized manual collection fact exists.
- A valid grant without ENROLLED academic status cannot bypass academic suspension/withdrawal.
- Expired grant is denied at the exclusive `validUntil` boundary.
- Confirmed renewal creates the next period exactly once.
- Past-due or halted state does not extend paid access.
- Refund/chargeback adjustment follows policy without deleting the original billing fact.
- Same-email customers, channel switching, default Channel and cross-tenant IDs do not cross grant boundaries.
- BBB meeting join still requires its independent BBB entitlement and meeting authorization.
- Manual/free admission paths remain explicit, authorized and auditable.

### Required environments/evidence

- Unit tests for pure policy/state transitions.
- PostgreSQL-backed integration tests for unique/idempotency/concurrency boundaries.
- Redis/BullMQ tests for persist-before-process, retry, stale lease and recovery.
- Razorpay Test Mode for tenant subscription creation, authentication, successful charge, failed charge, renewal, cancellation and signed webhook delivery.
- Two-tenant E2E across Shop API and Admin API.
- TypeScript build and GraphQL codegen.
- No test may require direct manual SQL business-data mutation.

## 12. Decisions required before implementation

The following are proposed defaults for review. An unchecked decision is a stop condition for the dependent implementation; do not silently invent policy.

| ID | Decision | Proposed default | Review required |
|---|---|---|---|
| LC-01 | Initial admission | Tenant admin can invite/enroll at zero stage without a payment or PG. Preserve existing ACTIVE `TenantLearnerMembership` requirement unless a separate admission policy is approved. Initial admission and commercial continuation are separate operations. | Yes |
| LC-02 | Initial target | One `LearningCourse` per offer/subscription; service offers and bundles deferred until MCR-0.2 taxonomy is accepted | Yes |
| LC-03 | Billing modes | Recurring via tenant Razorpay Subscriptions; fixed-term via one-time tenant Flow B Vendure order; no lifetime access in MVP | Yes |
| LC-04 | Provider scope | Razorpay only for MVP; use the tenant's own `TenantPaymentAccount`; verify recurring capability separately from the existing one-time credential probe | Yes |
| LC-05 | Zero-stage and continuation | Initial tenant-approved enrollment/access is available without payment. A later paid continuation is activated only after provider-verified gateway collection or an authorized tenant-attested external collection under explicit policy. | Yes |
| LC-06 | Grace/dunning | No implicit grace; tenant/plan policy must specify bounded grace and retry schedule before activation | Yes |
| LC-07 | Cancellation | Cancel-at-period-end as default; immediate cancellation is explicit and does not imply automatic refund | Yes |
| LC-08 | Refund/chargeback | Preserve payment facts; create adjustment/revocation facts; access treatment must be defined before live launch | Yes |
| LC-09 | Recurring accounting | Decide whether each recurring charge needs a Vendure Order/invoice; proposal is learner billing attempt as recurring billing fact, with Vendure Order used for fixed-term/one-time commerce | Yes |
| LC-10 | Webhook inbox | First assess extending `TenantPaymentWebhookEvent` with a separate subscription event processor; add a new inbox only if the existing contract cannot safely support it | Yes |
| LC-11 | Zero-stage and offline collection | Support tenant-authorized zero-stage admission without payment and separate audited external collection methods (bank transfer, UPI/GPay, cash, etc.). Never represent manual confirmation as provider verification. | Yes |
| LC-12 | Plan changes/proration/pause | Defer from MVP; support only clearly defined next-cycle or cancellation behavior initially | Yes |

## 13. Delivery slices after this contract is accepted

1. **MCR-2.1A — learner commercial-offer and collection-request foundation:** tenant-admin configurable paid continuation offers/requests, collection-method policy and audit facts. Initial zero-stage admission remains in the existing LearningPlugin workflow and requires no payment subscription.
2. **MCR-2.1B — tenant recurring provider adapter:** tenant credential resolution, provider plan/subscription binding, authorization flow and reconciliation.
3. **MCR-2.1C — recurring webhook and billing attempts:** extend the tenant persist-first inbox/typed processor, idempotent attempts, state machine, renewal/failure/cancellation tests.
4. **MCR-2.2A — course access grant and eligibility service:** explicit grant source, period boundaries, LearningPlugin integration and Shop authorization.
5. **MCR-2.2B — payment-to-enrollment convergence:** idempotent activation, membership/academic admission policy, BBB entitlement mapping and recovery.
6. **Storefront integration:** learner offer selection, authorization/checkout, subscription status, renewal/cancellation and access messaging.
7. **Provider/runtime release gate:** real tenant Razorpay Test Mode and two-tenant evidence; keep it separate from source-level completion.

Every schema change is generated and applied through the Vendure CLI migration workflow. Each implementation slice is a separate reviewable PR and must include the focused tests and evidence boundary.

## 14. Out of scope

- Changes to tenant-to-Saa9vi `OrganizationSubscription` or Flow A.
- Replacing the existing `CourseEnrollment` academic FSM with payment states.
- Marketplace cross-tenant carts or cross-tenant orders.
- General service, bundle or physical-product fulfilment.
- MCR-2.3 free trial/sample access (tracked separately).
- MCR-2.4 general digital fulfilment beyond the course-access convergence contract.
- UI-only access gating.
- Direct PostgreSQL business-data edits or hand-authored migrations.

---

## Sources

- [MCR implementation worklist](../implementation/marketplace-commerce-revenue-worklist.md)
- [Learning domain mini-spec](learning-domain.md)
- [Integration gaps worklist](../implementation/integration-gaps-worklist.md)
- [ADR-054 — tenant Razorpay Flow B](../adr/adr-054-per-tenant-razorpay-flow-b.md)
- [Vendure OrderService](https://docs.vendure.io/current/framework/reference/typescript-api/services/order-service)
- [Vendure PaymentMethodHandler](https://docs.vendure.io/current/framework/reference/typescript-api/payment/payment-method-handler)
- [Razorpay subscription webhook events](https://github.com/razorpay/markdown-docs/blob/master/webhooks/subscriptions.md)


## Business-model correction — admission first, tenant-directed collection

This section supersedes any wording elsewhere in this contract or prior PR #24 that implies a verified payment is a precondition for initial learner admission/enrollment.

- **Zero stage:** a tenant administrator may enroll/admit a learner so the learner can begin the course. No payment, mandate, subscription, payment gateway or collection method is required at this stage.
- **Tenant decides when to charge:** after the learner has enrolled and is ready to continue, the tenant may offer a paid continuation/term or request payment. The tenant may also choose not to charge.
- **Tenant chooses the collection rail:** the tenant may use its own configured payment gateway (for example, its own Razorpay account) or an external method such as bank transfer, UPI/GPay, cash or another method the tenant supports.
- **Provenance is mandatory:** gateway-confirmed collection and tenant-attested offline collection are different fact types. Store method, amount/currency, reference/evidence, confirmer and time for offline collection; never label it as provider-verified.
- **No implicit downgrade of initial learning:** a pending or failed paid-continuation request must not retroactively convert the zero-stage admission into an unpaid/invalid enrollment. The tenant's stated course/cohort policy governs the initial access boundary and any later paid continuation boundary.
- **Recurring subscription is optional:** recurring Razorpay subscription is one possible tenant collection choice, not a universal prerequisite for learner admission or all paid continuations.

Required user journey:

```text
Tenant admin admits learner (zero stage; no payment)
                  |
                  v
         Learner starts course
                  |
                  v
       Tenant offers paid continuation
                  |
                  v
       Learner accepts / payment requested
                  |
          +-------+--------+
          |                |
          v                v
  Tenant online PG    External collection
  (tenant account)    (bank / UPI-GPay / cash)
          |                |
          v                v
 Provider-confirmed   Tenant-attested
 collection fact      collection fact
          +-------+--------+
                  |
                  v
     Paid continuation period/access
```
