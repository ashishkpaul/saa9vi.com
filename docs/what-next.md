# What Next — Saa9vi Platform

**Updated:** 2026-09-24

---

## Provider Decision Status

| Gate | Status | Notes |
|------|--------|-------|
| **Provider decision** | ✅ COMPLETE | Razorpay direct selected |
| Juspay audit | ✅ Complete | M1.1 verified, M1.2 blocked by provider policy |
| Juspay → Razorpay routing | ❌ REJECTED | Razorpay ticket #20876157 |
| Direct Razorpay | ✅ SELECTED | Native Subscriptions + UPI Autopay |

---

## Implementation Gates

| Gate | Status | Notes |
|------|--------|-------|
| **R1 — Provider-neutral boundary** | ✅ Complete | `RecurringBillingProvider` interface retained. **Razorpay is the sole runtime provider** (per ADR-038; provider factory resolves `razorpay` only, with an omitted provider defaulting to Razorpay). **Razorpay is the sole active recurring-billing provider.** The Juspay runtime implementation and legacy Juspay entities were removed (`9a31beb`), and the legacy `juspay_*` tables were dropped (`466a4ef`, **ADR-040**). Historical Juspay migration files remain as immutable migration history. All active source, checked-in GraphQL schemas (`schema.graphql`, `schema-shop.graphql`), and BBB `generated-*-types.ts` have been regenerated/verified Juspay-free; the only remaining `src/` mentions are historical migration files and an ADR historical note in `vendure-config.ts`. |
| **R2 — Razorpay Contract Verification** | ⚠️ R2-A/E/F Verified / R2-G Open | R2-A/E/F runtime-verified 2026-09-20 (sub `sub_TeJjWjzzC0dU4W`, payment `pay_TeJk63hHNo32gI`, provider-cycle identity confirmed, no drift, BUG B + BUG C fixed and verified). R2-G failure lifecycle still open. See `production-readiness.md`. |
| **ADR-038 — Provider Freeze** | ✅ Complete | ADR-038 ACCEPTED 2026-09-12 (R2-F + R2-G evidence, INV-018 channel-scoped worker ctx). **Not to be confused with the R3 gate** below — "R3" is reserved for one-time commerce (`production-readiness.md`: `dummyPaymentHandler` still registered, OPEN) |
| **I1-I3 — Implementation** | ✅ Complete | Razorpay live on `main` |
| **V1 — Production hardening** | ⏳ Next | Baseline: `c198199` (G3 tenant-isolation evidence; supersedes the `954cd40` Gate-3 baseline for current work). Checklist below — **first action: rotate exposed Razorpay secrets (V1.1)** |

---

## Free Basic plan + storefront commercial integration (programme) — ⏳ IN PROGRESS (plan §4 slices 1–5, 7, 8 done; **next: slice 9**; slice 6 still open, now unblocked)

**Canonical plan:** `docs/implementation/saa9vi-comprehensive-integration-and-commercial-plan.md` (v3, evidence-verified at `4f3a9cf`, header + §3.5 reconciled to `ec866fe` on 2026-09-24; its §6 preflight was executed 2026-09-22 and recorded in §6.1). Worklist entry: `integration-gaps-worklist.md` **FREE-1**.

Decision: every tenant lands on a permanent **Free Basic** plan at registration — no card, no trial clock. Paid plans add capacity (live rooms/day minutes/participants) and entitlements (hosted academy / custom domain, white-label theming, marketplace listing per ADR-042).

**Blocking prerequisite — ✅ RESOLVED 2026-09-23 (recorded for traceability):** the subscription Admin API exposed only `createSubscriptionPlan`/`updateSubscriptionPlan`/`subscribeToPlan` (no cancel, no change-plan), and `subscribeToPlan()` rejects any channel whose existing row is not `cancelled`. Auto-provisioning a subscription at registration would therefore **block the paid-upgrade path** for that tenant. ADR-044 + a plan-change/cancel capability ship first — the provider adapters' `cancelSubscription`/`pauseSubscription`/`resumeSubscription` already exist with zero call sites.

Then, in **plan §4 order** (slice numbers are the plan's canonical ones; the FREE-1 list in `integration-gaps-worklist.md` uses the same order): ✅ 1 commercial-matrix freeze → ✅ 2 doc-drift sweep → ✅ 3 ADR-044 + plan-change/cancel (`66e6cd4`; acceptance harness repaired `5d3d2d9`) → ✅ 4 provider-free Free Basic activation at registration (`d45b0a5`; runtime-verified 19 passed / 0 failed / 3 skipped) → ✅ 5 grant-selection correctness (BUG-036 fixed `d711940`; BUG-035 dead seam removed `ab274bf`; BUG-037 isolation harness repaired `30d245a`) → 6 daily live allowance (**open — unblocked now that 5 is done**) → ✅ 7 ADR-042 marketplace entitlement (`dad099c`; indexer e2e matrix **14/14 against real Postgres + Elasticsearch**, convergence **4/4**, tenant regression 73/73, INV-024 green) → ✅ 8 Shop read contract (`ec866fe`; 12/12 `subscription-shop.e2e-spec.ts`, locked permission model) → **9 `edu-frontend` theme + dashboard (next — Admin-authenticated business session → Shop reads only; upgrade/cancel mutations stay deferred with UI-1/ADR-044)** → 10 R4 runtime evidence → 11 R3 payment handler. **R3 (`dummyPaymentHandler` is still the only registered handler) is a separate launch gate**, unaffected by this programme. Outstanding product decisions: the free-tier limits themselves. Detail, gates and evidence in §Remaining backlog below.

---

## Remaining backlog — plan §4 build order

**Verified against HEAD `ec866fe` (2026-09-24): `HEAD == origin/main`, working tree clean.** Slice numbers are the plan's canonical ones (§4 table); the `integration-gaps-worklist.md` FREE-1 list uses the same order. This is the recommended execution order.

| Plan §4 # | Workstream | State at `ec866fe` | Blocker / dependency |
|---|---|---|---|
| 5 | **Grant-selection correctness** (§3.3 prerequisites) — BUG-036 | ✅ **DONE** — fixed `d711940` (BUG-036) + `ab274bf` (BUG-035 dead seam `findEarliestValidGrant` removed); runtime-reproduced 2026-09-23/24; downstream isolation harness repaired `30d245a` (BUG-037); `known-bugs.md` Active = None | Closed — `grant-selection.policy.ts` positive `IN` list is now the single home, shared by the provisioning gate and slice 8's `myLiveUsage` |
| 6 | **Daily live allowance** (§3.3) | Open — **unblocked** (5 done; matrix itself already frozen in slice 1) | None — slice 8 already reports period usage read-side; the §3.3 provisioning-side daily grant remains to build |
| 8 | **Shop read contract** (§3.5) | ✅ **DONE 2026-09-24** (`ec866fe`) — `availableSubscriptionPlans` (Public), `mySubscription`/`myLiveUsage` (Authenticated + `assertBusinessAccount`); no `channelId` argument; provider internals absent from the Shop SDL; **12/12** shop e2e + full regression battery green | Closed — feeds 9 |
| 9 | **Frontend: the `edu-frontend` theme + plan/usage dashboard** (§3.8) | **NEXT** (separate repo) | 8's schema is shipped — regenerate frontend types from `schema-shop.graphql`; authenticate business accounts on the **Admin API** and present the session token to Shop reads (slice-8 platform finding); **no mutations** (stay deferred with UI-1/ADR-044); zero commercial/business-rule logic in the client |
| 10 | **R4 runtime evidence** (§3.10) | Open — verification only, R4 is implemented | Scripts now exist (`scripts/verify/`) |
| 11 | **R3 payment handler** (§3.9) | Open — `dummyPaymentHandler` is still the only handler in `vendure-config.ts` | Independent launch gate |

### Slice 5 — grant-selection correctness (BUG-036) — ✅ DONE (2026-09-23/24)

**Closed:** BUG-036 fixed in `d711940` (never serve tenant sessions from `internal_overhead` capacity; `isUnbounded` honoured at the provisioning gate), BUG-035's dead seam (`findEarliestValidGrant`, ignored `_sourceTypes` + validity window) removed in `ab274bf`, and the downstream channel-isolation harness repaired in `30d245a` (BUG-037 — **harness-only**: the production `TenantRegisteredEvent → BbbTenantProvisioningListener → tenant-scoped ctx → assignToCurrentChannel()` path was never changed, and no product code should be "fixed" on the basis of the former failing test). Runtime-reproduced 2026-09-23/24; acceptance evidence: meeting-concurrency **4/4** (`MEETING_CONCURRENCY_E2E=true`), usage-ledger **5/5** (`BBB_USAGE_LEDGER_E2E=true`), isolation **13/13**. `known-bugs.md` Active = None. The analysis below is retained as the pre-fix record (verified at `6c86a0a`).

Pre-fix record re-verified at `6c86a0a` (it **confirmed** the then-open `known-bugs.md:11` entry; runtime reproduction was subsequently completed):

- `bbb-provisioning-worker.service.ts:166-177` selects `exhausted = false`, in-window, ordered `validUntil ASC, createdAt ASC`.
- `:185-188` then rejects when `grantedMinutes - consumedMinutes <= 0` with `"No minutes remaining on plan"` — **it never reads `isUnbounded`**, while `grant-reader.service.ts:96` (`getRemainingMinutes()`) treats unbounded grants as `Infinity`. The two disagree.
- Consequence, both directions: an org whose only valid grant is the auto-created unbounded overhead grant (`bbb-organization.service.ts:~234`, `grantedMinutes: -1`) **can never provision**; and once a commercial grant is flagged `exhausted` it is dropped from selection, so the resolver falls through to the overhead grant and reports an exhausted allowance as a *missing* one.
- `grant-reader.service.ts:74-83` `findEarliestValidGrant()` ignores both its `_sourceTypes` parameter and its declared validity window. **Confirmed zero callers** (`grep -rn findEarliestValidGrant src/` → the definition only) — a dead seam: fix it in the same pass or delete it.

Acceptance: honour `isUnbounded` at the provisioning gate (Infinity semantics, matching `getRemainingMinutes()`); make `internal_overhead` explicitly non-selectable for tenant sessions; an exhausted commercial allowance must refuse with a domain-accurate outcome, not a generic error; unit + BBB e2e green (`bbb-meeting-concurrency.e2e-spec.ts` covers provisioning); close BUG-036 in `known-bugs.md` with the commit hash. — **all criteria met: `d711940` (+ `ab274bf`), `known-bugs.md` updated, Active = None.**

### Slice 8 — Shop read contract — ✅ DONE (2026-09-24, `ec866fe`)

- **Shipped 2026-09-24 (`ec866fe`):** `src/plugins/subscription/api/` now holds `subscription-shop.schema.ts` + `subscription-shop.resolver.ts` wired into `subscription.plugin.ts` alongside the Admin surface; `schema-shop.graphql` regenerated (+85 lines, 0 provider internals — a probe query for `providerStatus`/`providerShortUrl` fails GraphQL validation). Evidence: `subscription-shop.e2e-spec.ts` **12/12** real Postgres, plus the full battery — `tsc`/`build`/`codegen` 0, invariants 3 passed / convergence 100-100, BBB isolation **13/13**, concurrency **4/4**, ledger **5/5**, tenant **73/73**. Spec-as-shipped below.
- Queries: `mySubscription` (plan, status, period dates, marketplace eligibility), `myLiveUsage` (included / consumed / remaining), `availableSubscriptionPlans`.
- Tenant comes from `ctx.channelId` **only** — no `channelId` argument anywhere in the new surface.
- Eligibility must come from the existing platform evaluator `src/platform/commercial/commercial-entitlement.service.ts` — **do not add a second evaluator**. (Naming note: no `marketplace-eligibility.evaluator.ts` exists in this tree; an earlier prose reference used that name in error.)
- Permission decision (recorded as shipped): `availableSubscriptionPlans` → `Permission.Public`; `mySubscription`/`myLiveUsage` → `Permission.Authenticated` **plus** `TenantBusinessAccountService.assertBusinessAccount(ctx)` — `Authenticated` alone is **not** ownership (every role carries it, and `TenantRegistrationService` assigns the Customer role to every tenant channel, so any logged-in learner would otherwise pass the guard). Business accounts authenticate on the **Admin API** (this Vendure's Shop `login` resolves through the `customer` table — administrators get `INVALID_CREDENTIALS_ERROR` on Shop); sessions are not api-type-scoped, so the Admin session token serves the Shop reads. The `myTenantTheme` `Permission.Public` precedent (`tenant-shop.resolver.ts:108-110`) applies only to non-subscription reads.
- `marketplaceEligible` is read from the shared platform evaluator `src/platform/commercial/commercial-entitlement.service.ts` (wired via `commercial-entitlement.module.ts`) — **no second evaluator**. Remaining cross-plugin reads follow the repository/`rawConnection` pattern noted by `TenantCommercialEligibilityService`.
- **No mutations** — UI-1 defers tenant self-serve upgrade pending its own ADR.
- In-tree patterns to follow: `bigbluebutton-plugin/api/schema/bbb-shop.schema.ts`, `cms/api/api-extensions.ts`, `marketplace/api/marketplace-schema.ts`.
- After the GraphQL change: `npx vendure schema --api shop` → `npm run codegen` → `npm run build`.
- Keep the period fields stable now, so that if slice 6 later adds daily-grant fields to `myLiveUsage` the contract does not churn.
- Gate: A/B isolation (A's token on B's hostname never returns B's data), unknown hostname fails closed, no-subscription channel → `mySubscription: null`.

### Housekeeping (non-blocking, any spare cycle)

Tracked-but-junk files that future audits trip over: `_edit_script.js` and `_fix_script.js` (ad-hoc Node scripts that rewrote `docs/adr/rfc-001-…` in place), the 1.2 MB `src/plugins/tenant-plugin/e2e/__data__/tenant-plugin.e2e-spec.ts.sqlite` test cache, and 7 preview screenshots under `static/assets/`. `git check-ignore` reports **none** of them as ignored, so cleanup is `git rm --cached` plus `.gitignore` entries.

---

## R2: Razorpay Subscription Contract Verification

| Gate | Status | Notes |
|------|--------|-------|
| **R2-A** Test Plan | ✅ DONE | `plan_TaMGQbDDQn7Tir` (₹10/month) |
| **R2-B** Webhook Config | ✅ DONE | 11 events, `webhook.saa9vi.com`, Test mode |
| **R2-C** Webhook Ingress | ✅ Proven | HMAC-SHA256, idempotency, persist-first, 2xx |
| **R2-D** Create Subscription | ✅ DONE | `sub_TabaZJZTQzNfWy` via API |
| **R2-E** Authorization | ✅ VERIFIED (2026-09-20) | Fresh Test-mode subscription `sub_TeJjWjzzC0dU4W`, payment `pay_TeJk63hHNo32gI` (UPI ₹100). Provider-cycle identity confirmed: `billingPeriodStart=2026-09-20`, `billingPeriodEnd=2026-10-19` matching Razorpay `current_start/end`. No +1 month drift. BUG C also found and fixed (NULL initial period). `OrganizationSubscription.status=active`, `version=2`. |
| **R2-F** Durable Processing | ✅ VERIFIED (2026-09-20) | 3 real webhooks processed (1 attempt each, all `processingStatus=processed`). Billing attempt 15 `status=succeeded`. Cycle-monotonic CAS advanced period exactly once (`version=2`). Exactly 1 billing attempt (idempotency confirmed). Replay path tested. |
| **R2-F** Channel Resolution | ✅ Proven | Resolved from `SubscriptionProviderBinding` (INV-001). C-1 all sub-gates runtime-verified. |
| **R2-F** Inbox Idempotency | ✅ Proven | UNIQUE(provider, providerEventId) — inbox-level. |
| **R2-F** Processing Idempotency | ✅ VERIFIED (2026-09-20) | Exactly 1 billing attempt for subscription 7. CAS replay-safe confirmed. |
| **R2-F** Concurrent Idempotency | ✅ VERIFIED (2026-09-20) | Single attempt created; duplicate event replay handled by `reconcileTerminalAttempt`. |
| **R2-G** Failure Semantics | ⚠️ PARTIALLY VERIFIED (2026-09-20) | `subscription.pending` → `past_due` evidenced: event 34, `TeZ7o2h0smBz5B`, providerCycle `2026-10-19 → 2026-11-19` (FRESH vs local `2026-09-20`), `status=past_due`, `version=3`, no spurious attempt. Still open: `subscription.halted` runtime evidence; stale-cycle no-op test; duplicate replay; halted recovery (capability exists via successful-charge CAS — runtime evidence pending). |
| **R2-G** Channel Isolation | ✅ Proven | Cross-tenant events stay isolated |
| **ADR-038** Provider Freeze | ✅ Complete | Accepted 2026-09-12. (Gate id "R3" is reserved for one-time commerce — see `production-readiness.md` evidence ledger) |

---

## Gate: ADR-038 — Provider Freeze ✅ COMPLETE

> **Naming note:** this completed gate was previously labelled "R3 — ADR-038
> Freeze". "R3" now refers exclusively to **one-time commerce** (Razorpay
> `PaymentMethodHandler`), per the evidence ledger in
> `production-readiness.md`. This section covers only the ADR-038 acceptance,
> which is distinct from and a prerequisite to R3.

ADR-038 was formally **ACCEPTED on 2026-09-12** after all R2 evidence was captured:
- **Failure path**: `pending` → `pending` → `failed` (3 attempts, `failedAt` populated)
- **Concurrent idempotency**: UNIQUE(provider, providerEventId) blocks duplicate billing attempts
- **Channel resolution**: Resolved from `SubscriptionProviderBinding` (INV-001), then a channel-scoped `RequestContext` is built from the Channel entity before processing (INV-018)
- **Infrastructure**: PostgreSQL + Redis (Docker) + BullMQ confirmed — real infrastructure, not fallbacks

The inbox worker is implemented with:
- Single processing path (legacy `processWebhook()` removed)
- `attemptCount` tracking with proper state lifecycle
- `processedAt` (success) and `failedAt` (terminal failure) timestamps
- Channel resolution BEFORE business processing
- DB errors thrown (not silently converted to "no binding")
- Unified retry semantics: `MAX_ATTEMPTS=3`, `BULLMQ_RETRIES=2`

### What still needs to happen for R1

- [x] `ProviderWebhookEvent` entity (immutable inbox) — done
- [x] Migration for `ProviderWebhookEvent` — done (1789141516883, 1789180117889, 1789180807072)
- [x] `SubscriptionRenewalService` depends on `RecurringBillingProvider` — done
- [x] Juspay code moved to `providers/juspay/` — done
- [x] `SubscriptionPlugin` registers provider conditionally — done

### Do NOT

- [x] ADR-038 formally accepted (2026-09-12) — see `docs/architecture/adr-038-direct-razorpay-provider.md`
- [x] Juspay code removal — **completed** in `9a31beb`; legacy `juspay_*` tables dropped in `466a4ef` (**ADR-040**). ADR-038's "retain Juspay as reference" clause is **superseded by ADR-040**.
- ✅ Razorpay is the sole recurring-billing provider; the `SubscriptionPlugin` factory resolves only `razorpay` (an omitted provider defaults to Razorpay). Do not reintroduce a second provider path or a second payment-attempt model.

---

## Gate: BBB meeting-ended → immutable usage ledger ✅ COMPLETE (2026-09-15, `954cd40`)

**Closed.** The core education-commerce loop is proven end-to-end against real PostgreSQL:

```text
SCHEDULED → LIVE → learner joins → BBB ends → FINISHED
    → immutable BbbUsageLedger fact → grant consumedMinutes
```

Acceptance criteria (idempotency mirrors the Razorpay webhook gates) — **all 8 proven**:

1. ✅ BBB `MEETING_ENDED` received → `BbbWebhookEvent` persisted **first** (INV-004)
2. ✅ BullMQ → `BbbWebhookProcessor` → meeting reaches terminal state
3. ✅ `BbbScheduledSession` → FINISHED (via `MeetingCompletedEvent`)
4. ✅ Exactly one immutable `BbbUsageLedger` row (INV-002); billing uses the meeting's **persisted `grantId`** (immutable linkage), never a recomputed "current" grant
5. ✅ `consumedMinutes` increases exactly once
6. ✅ Duplicate webhook / worker retry / concurrent processing are all harmless. **The ledger idempotency decision is made by the database write (`INSERT ... ON CONFLICT DO NOTHING` + `RETURNING` — winning insert ⇒ grant increment), never by check-then-insert.** `GrantConsumedEvent.remainingMinutes` derives from committed post-increment values (`UPDATE ... RETURNING`). Billing failure after `COMPLETED` is recovered by `reconcilePendingBilling()` (COMPLETED + no ledger row + persisted grantId → replay).
7. ✅ Channel isolation holds throughout
8. ✅ Reconciliation path is idempotent

### Evidence

- **`8670eed`** — database-native billing idempotency and pending-billing recovery (`consumeGrantHours` ON CONFLICT winner-only billing; atomic grant increment with RETURNING; `reconcilePendingBilling()` + reconciliation task scan; INV-002 extended: check-then-insert prohibited for billing facts)
- **`954cd40`** — Gate 3 E2E (`src/plugins/bigbluebutton-plugin/e2e/bbb-usage-ledger.e2e-spec.ts`), **5/5 passed** against real PostgreSQL:
  - **G3-A** happy path: one ledger row, grant incremented, session LIVE → FINISHED
  - **G3-B** duplicate completion = no-op (no second ledger row / increment)
  - **G3-C** `reconcilePendingBilling()` recovery + idempotent second scan
  - **G3-D** 6-way concurrent `consumeGrantHours()` → ONE ledger row, ONE increment
  - **G3-E** persisted grant A billed; org B's grant (own Vendure channel) untouched — cross-channel isolation
- Existing BBB concurrency regression spec: **1/1 passed**
- `npm run build` passed; `HEAD == origin/main == 954cd40`, working tree clean
- **Do not reopen for redesign.** `MeetingCompletedEvent.consumedHours` (0) vs authoritative `GrantConsumedEvent` semantics is documented in code comments and intentionally unchanged.

---

## V1 — Production Hardening ⏳ SOLE IMMEDIATE MILESTONE

**Baseline: `c198199` (G3 tenant-isolation evidence, `fa86f88` hostname chain + `c198199` isolation record).** From here the goal is proving the accepted design remains safe under production failure, retries, credentials, and operational conditions — no further architectural redesign. (The `954cd40` baseline below refers to the earlier Gate-3 record and is retained as history.)

Order matters: secrets first, then perimeter + observability, then failure-boundary tests, then live mode.

### V1.1 — Secret rotation (FIRST — manual, Razorpay Dashboard)

- [ ] Rotate exposed Razorpay **test API key secret** (was exposed in screenshots/conversation)
- [ ] Rotate exposed Razorpay **test webhook secret** (independently of the API secret)
- [ ] Move new secrets into the environment/secret store; never into `.env`-in-repo or chat
- [ ] Verify old-secret handling: per Razorpay docs, outstanding webhook retries generated with the old secret must remain validatable — retain the old webhook secret only until outstanding deliveries drain, then destroy it
- [ ] Run one fresh signed webhook lifecycle test using ONLY the new webhook secret

### V1.2 — Webhook perimeter (CONFIG AUDIT FIRST — before adding middleware)

- [x] ~~Controller depends only on ingress concerns~~ — done (`7630c5b` batch): unused `RazorpayWebhookProcessor`/`ChannelService`/`EventBus` deps removed; controller = verify → persist → enqueue → 2xx only
- [ ] HTTPS-only at `webhook.saa9vi.com` (Cloudflare → origin)
- [ ] Exact route exposure: only `POST /payments/razorpay/webhook`
- [ ] No accidental GraphQL/auth middleware on the webhook route
- [ ] Raw body preserved byte-for-byte through Cloudflare/any proxy (HMAC depends on it)
- [ ] Request-size limit on the webhook route
- [ ] Rate limiting on the webhook route
- [ ] Review Cloudflare exposure rules (no debug/admin surfaces exposed)
- [ ] Decide Razorpay source-IP allowlisting policy — **supplementary only; HMAC remains the primary control** (Razorpay recommends signature verification even with IP whitelisting)
- [ ] Webhook secret never appears in logs or error messages

### V1.3 — Inbox/queue failure recovery ✅ DONE (2026-09-12)

The persist-first + async-queue architecture had one reliability hole: if the inbox row persists but BullMQ enqueue fails, Razorpay sees non-2xx and retries — but the old duplicate path returned 2xx WITHOUT re-enqueueing, leaving the event permanently pending with no active job.

- [x] Duplicate path now checks `processingStatus === 'pending'` and re-enqueues (worker idempotency guards make a redundant job a safe no-op)
- [x] Terminal (`processed`/`failed`) events are never re-enqueued on duplicate delivery
- [x] Regression test: `webhook-enqueue-failure-recovery.e2e-spec.ts` (persist ✅ / enqueue ❌ / retry → re-enqueue → single inbox row)

### V1.4 — Observability (structured events over `ProviderWebhookEvent` fields)

Events to emit: `webhook.received`, `webhook.duplicate`, `webhook.verified`, `webhook.enqueued`, `webhook.processing`, `webhook.processed`, `webhook.retry`, `webhook.failed`, `billing_attempt.created`, `billing_attempt.duplicate`, `channel_resolution.failed`.

- [ ] Structured logging for the lifecycle events above
- [ ] Failed-webhook operational alert (terminal `failed` events, `failedAt` populated)
- [ ] Queue backlog / worker-health alert, including **pending-event age** (`pending > 5 min / 30 min / 1 hr`) — a pending inbox event with no active BullMQ job is otherwise indistinguishable from a silently dead worker
- [ ] Log-hygiene review: never log API secrets, webhook secrets, auth credentials, raw payment data, or raw payloads

Log fields: only safe identifiers — `provider`, `providerEventId`, `eventType`, `inboxEventId`, `attemptCount`, `channelId` (once resolved). Never the raw payload or secrets.

Operators must be able to answer: Did Razorpay send it? Did we verify it? Did it enter the queue? How many attempts? Why did it fail? Was the billing attempt recorded?

### V1.5 — Retry-domain awareness (design fact, no code change)

Two independent retry domains: (a) Saa9vi processing — `MAX_ATTEMPTS=3` local, terminal `failed`; (b) Razorpay delivery retry — non-2xx → exponential retry up to 24h → possible webhook disablement. Duplicate Razorpay deliveries are absorbed by `UNIQUE(provider, providerEventId)` on the same `x-razorpay-event-id`. Local terminal failure must surface to operators before Razorpay retries exhaust and the webhook is disabled.

### V1.6 — Production failure-boundary tests

- [ ] **Test A — app unavailable:** Razorpay delivery gets 503/timeout → retries → app returns → same event ID → inbox deduplication absorbs it
- [ ] **Test B — 2xx then worker failure:** event persisted, BullMQ fails → 3 local attempts → terminal `failed` → operator visibility (already proven by R2-G; re-verify in production-like env)
- [ ] **Test C — duplicate delivery:** same `x-razorpay-event-id` re-POSTed → UNIQUE constraint → no second billing attempt

### V1.7 — Out-of-order webhook safety

Razorpay events may arrive out of order. Regression test: `subscription.activated` before/after `subscription.charged` (both orders). Required property: **an out-of-order webhook must never cause an unsafe entitlement or billing transition.**

### V1.8 — Credential separation (before live mode)

- [ ] Separate TEST vs PRODUCTION credential sets (API keys, webhook secrets, webhook configs, subscriptions)
- [ ] Never reuse test secrets in production because the code path is identical
- [ ] Verify the production deployment **fails closed** when required secrets are absent

### V1.9 — Final live-mode smoke test (last)

Full chain on production Razorpay: subscription create/authorize → recurring lifecycle → HTTPS webhook → HMAC → `ProviderWebhookEvent` → BullMQ → `RazorpayWebhookProcessor` → `SubscriptionBillingAttempt` → `OrganizationSubscription` → Entitlement — with corresponding DB facts verified. Then final regression suite, production deploy, post-deployment webhook observation.

### V1.10 — Production fail-fast on missing PostgreSQL/Redis (P0-K)

Not part of the V1.1→V1.9 ordering — it is a boot-time safety property that can be done in parallel — but it must close **before V1.9**, otherwise the smoke test can pass against a process that silently degraded.

- [ ] Gate the `src/index.ts` emergency fallbacks on environment: in production, PostgreSQL unreachable → **fail startup**; Redis unreachable → **fail startup**
- [ ] Keep the pg-mem and `DefaultJobQueuePlugin` fallbacks for development/test only — an explicit condition rather than the unqualified default
- [ ] Re-capture the P0-A/P0-B startup evidence, showing the production branch refuses to boot without both dependencies

Rationale: R2-A established that the fallbacks *did not activate* during the verified runtime; it did not establish that they *cannot* activate. For a platform holding recurring-billing state, immutable ledgers, provider webhook inboxes, and BullMQ processing, an in-memory database with `synchronize: true` is not a safe degradation mode. Full detail: `production-readiness.md` **P0-K**.

### Explicitly out of scope for V1

- Refactoring remaining `setImmediate()` hits (BBB subsystem / `reference/` material — unrelated)
- *(The previously-listed "Removing Juspay classes" item is **complete** — `9a31beb` + `466a4ef`, ADR-040 — and is no longer outstanding.)*

---


## Source of Truth

| State | Authority |
|-------|-----------|
| Saa9vi organization subscription | Saa9vi DB |
| Saa9vi entitlement | Saa9vi DB |
| Razorpay subscription status | Razorpay API/webhooks |
| Payment success | Verified Razorpay event/API |
| Webhook receipt | Saa9vi immutable inbox |
| Provider retry | Razorpay |
| Access/dunning policy | Saa9vi |

---

## Runtime Precondition — ✅ VERIFIED (2026-09-12)

The runtime environment is **verified against real infrastructure**:

- **PostgreSQL**: real Postgres via Docker (`localhost:5435`) — no pg-mem fallback.
- **Redis**: real Redis via Docker (`localhost:6385`) — `BullMQJobQueuePlugin` connected, no in-memory `DefaultJobQueuePlugin` fallback.
- **BullMQ worker**: provider webhook queue (`provider-webhook-processing`) initialized and processing through the BullMQ worker process (`index-worker.js`).
- **Webhook ingress**: `webhook.saa9vi.com` (Cloudflare tunnel → localhost:3000) delivering signed Razorpay test events.

Startup log evidence:
```
[BullMQJobQueuePlugin] Connected to Redis ✔
[ProviderWebhookQueueService] Provider webhook processing queue initialized
Vendure server (v3.6.5) now running on port 3000
```

CAS locking, idempotent grants, the payment-attempt ledger, and the webhook queue are all operating against real Postgres/Redis.

---

## Historical Snapshots

> **The sections below this line (Current State v1.18, phase plans, older boundaries) are retained for traceability and are NOT current status.** The current status is defined at the top of this document (Implementation Gates + V1 checklist). The authoritative completed-work record lives in `release-notes.md`; future work lives in `roadmap.md`.

## Current State (v1.18 — 2026-09-09)

### Verified complete

- **Phase 3B — Attribution & Commission** — complete: `CommissionListener` (server-side classification, INV-008), `CommissionLedger` $0-row pattern (DL-030), governed migration with UNIQUE constraints, 6-case E2E passing.
- TypeScript build succeeds (`npm run build`).
- Vendure runs successfully on v3.6.5 against real PostgreSQL + Redis (Docker) with BullMQ — verified 2026-09-12 (see Runtime Precondition above).
- SubscriptionPlan / OrganizationSubscription foundation is implemented.
- BbbPlatformCapacityPolicy and plan-based capacity enforcement are implemented.
- Capacity policy Portal Admin API/dashboard is implemented.
- **Juspay M1.1 Session API verified** — auth + Session API creation confirmed. Does NOT prove mandate registration.

- **Juspay → Razorpay routing REJECTED** — Razorpay does not accept Juspay for third-party routing (ticket #20876157).
- **Direct Razorpay pivot selected** — commit 9c5478d adds provider-neutral boundary + Razorpay adapter.

### Current provider implementation

> **Status (2026-09-19, post-ADR-040):** Razorpay is the **sole runtime provider**.
> The Juspay implementation was **deleted** in `9a31beb` and its legacy `juspay_*` tables were
> **dropped** in `466a4ef` (**ADR-040**). No Juspay code, entity, migration seam or schema remains
> in the active runtime. ADR-038's "retain Juspay as reference" clause is **superseded by ADR-040**.

| Component | Status |
|-----------|--------|
| `JuspaySdk` | ❌ Removed (`9a31beb`) |
| `JuspayBillingService` |  Removed (`9a31beb`) |
| `JuspayPaymentAttempt` | ❌ Removed entity + legacy table dropped (`466a4ef`) |
| `JuspaySubscriptionMandate` | ❌ Removed entity + legacy table dropped (`466a4ef`) |
| `RazorpaySubscriptionProvider` | ✅ Active — sole runtime provider (per ADR-038) |
| `RazorpayWebhookProcessor` | ✅ Active |
| `RazorpayWebhookController` | ✅ Active |
| `ProviderWebhookEvent` | ✅ Immutable inbox (shared by all providers) |
| `SubscriptionBillingAttempt` | ✅ Provider-neutral billing attempt |
| `SubscriptionProviderBinding` | ✅ Provider-neutral binding |

---

## Important Architectural Boundary

### One-time commerce (Vendure checkout)

```
Customer → Vendure Checkout → PaymentMethodHandler → Razorpay Orders/Checkout/Refund
```

### Recurring subscriptions (Saa9vi domain)

```
Razorpay scheduled charge → Webhook → Saa9vi ProviderWebhookInbox → Queue → Processor
                                    ↓
                         SubscriptionBillingAttempt
                                    ↓
                         CAS transition → Entitlement
```

### Do NOT

- Create a second billing engine or second payment-attempt model
- Let Saa9vi become a recurring-charge scheduler (Razorpay owns this)
- Mirror Razorpay's state enum 1:1 inside Saa9vi
- Put Razorpay-specific columns in provider-neutral entities

---

## Repository Truth Rule

Before claiming any implementation is complete:

```bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git log --oneline -5
git status --short
npm run build:all
```

**`npm run build:all` (not `npm run build`) is the mandatory truth-rule build.** Proven 2026-09-12: `npm run build` (tsc only) reported green while the production Dashboard was NOT buildable — because the Dashboard Vite plugin executes `vendure-config.ts` at build time, and the then-active SubscriptionPlugin config eagerly resolved Juspay credentials, tripping the production `JUSPAY_SANDBOX` fail-closed guard. Fix: the active config now explicitly selects `provider: 'razorpay'` and never resolves Juspay config (the legacy Juspay implementation has since been **fully removed** in `9a31beb` and its legacy tables dropped in `466a4ef`, **ADR-040** superseding ADR-038's retention clause).

## S0–S3 Verification Gates (post-ADR-038 UX audit)

- **S0 — Full application build** ✅ DONE (2026-09-12, `b7337a5`+): `npm run build:all` → tsc ✅ + dashboard `vite build` ✅ → real `dist/dashboard/` artifact (6.7M, `index.html` + assets). Guard was NOT disabled — the obsolete Juspay config path was removed.
- **S1 — Admin Portal UX** ⏳ Next: `/dashboard` login → authenticated admin → tenant/academy → instructor → sessions → subscription → capacity
- **S2 — Storefront UX** ⏳: visitor → academy → course/session → trial/purchase → entitlement → My Learning → join live class
- **S3 — Story compliance** ⏳: does the storefront obey the Saa9vi product story (admin-created reality → Shop API → storefront → learner)?

---

## Documentation Architecture

| Directory | Document | Purpose |
|---|---|---|
| `docs/architecture/` | `platform-adr.md` | Enduring architectural decisions |
| `docs/architecture/` | `domain-model.md` | Aggregates, lifecycles, relationships |
| `docs/architecture/` | `plugin-map.md` | Plugin ownership and API surfaces |
| `docs/architecture/` | `runtime-flow.md` | Event-driven flows and queues |
| `docs/architecture/` | `invariants.md` | Non-negotiable platform rules |
| `docs/product/` | `platform-story.md` | Actor/capability lifecycles |
| `docs/product/` | `glossary.md` | Domain terminology |
| `docs/implementation/` | `roadmap.md` | Future work only |
| `docs/implementation/` | `known-bugs.md` | Active and fixed bugs |
| `docs/implementation/` | `release-notes.md` | Completed work |

## Phase 2 — Remaining Work

```text
PHASE 2 — SUBSCRIPTION BILLING & CAPACITY POLICY
> Historical Phase 2 checklist — superseded by ADR-038 and the current
> implementation-gaps worklist. Unchecked items below are not current tasks
> unless explicitly reintroduced into the canonical worklist.

[x] SubscriptionPlan / OrganizationSubscription
[x] BbbPlatformCapacityPolicy
[x] Starter / Growth / Enterprise capacity tiers
[x] Plan-based BBB room capacity enforcement
[x] Portal Admin capacity policy surface
[x] Subscription capacity-grant integration
[x] Juspay Steps 0–6 implementation (Dashboard, secret hardening, e2e)

[x] NavigationMenu entity in CMS
[~] Juspay provider-contract verification (live sandbox)
    — moot: Juspay implementation fully removed (`9a31beb`), legacy tables dropped (`466a4ef`, ADR-040)
[ ] Production credential rollout and fail-closed verification
[ ] E2e coverage gaps (sandbox round-trip, mandate lifecycle)

[ ] Tenant onboarding flow in storefront
[ ] Custom-domain routing via Caddy
```

## Phase 3 — Marketplace & Retention

Execution queue (verified state in `docs/implementation/phase3-audit.md`; detailed checklist in `docs/implementation/roadmap.md`):

**Phase 3A — Discovery correctness ✅ COMPLETE** — all gates closed on `main`; verified in `docs/implementation/phase3-audit.md` and `roadmap.md`.
- [x] **1.** Latent defect closure — ad-entity schema provenance / governed migration (`marketplace_ad_campaign`, `ad_wallet`, `ad_spend_ledger`) now in DB via Vendure CLI (Gate 1.1.
- [x] **2.** Canonical marketplace document contract codified; `customDomain` redirect projection closed (F3) and `subjectTags` authoritative source + projection closed (F4.
- [x] **3.** Projection event-coverage completed (F5): every field affecting marketplace visibility, routing, filtering, or ranking has a deterministic projection update path. Organization-slag and campaign-lifecycle surfaces explicitly deferred.

- [x] **4.** E2E suite — marketplace E2E implementation is complete and the suite contains **7 cases** covering multi-channel indexing, channel-free `marketplaceSearch`, sponsored/bayesian ordering, F7 removal transitions, and tenant isolation. **Production-infrastructure verification remains gated on a confirmed real PostgreSQL + Redis + Elasticsearch environment (see P0 above).**
- [ ] **5.** `MarketplaceAcademyPage`, `MarketplaceCategoryIndex`, `RankingMaterializedView` — **deferred** (not 3A gates; tracked in roadmap Phase 3A follow-on items once the discovery contract stabilizes).

**Phase 3B — Attribution & Commission** ✅ COMPLETE (2026-09-04)
- [x] **6.** Attribution ADR-021 — ✅ **done**: contract settled (resource, validity 30-min TTL, navigation persistence, precedence, replay, multi-line orders, order-vs-line scope, HMAC verification without secret exposure); signed `marketplaceRef` mechanism shipped (`750da49`).
- [x] **7.** `Order.customFields.orderSource` + `CommissionLedger` $0-row pattern (DL-030) — ✅ **done**: server-stamped `orderSource` (INV-008), `CommissionLedger` entity/service/listener, governed migration with UNIQUE constraints, 6-case E2E passing.
- [ ] **8.** Commission reconciliation/admin reporting.

**Phase 3C — Advertising (Stream 3)** ✅ COMPLETE (2026-09-05)
- [x] **9.** Wire `MarketplaceAdService` end-to-end: campaign lifecycle → wallet debit → `AdSpendLedger` (INV-010).
- [x] **10.** `AdWalletLedger` entity + append-only pattern; bounded bid-boost; self-serve campaign dashboard (React `.tsx`).

**Phase 3D — Engagement & Retention**
- [x] **11a.** Review → marketplace ranking propagation — already implemented (review events → session reindex → Bayesian score → ES).
- [ ] **11b.** Ranking materialization — `RankingMaterializedView` deferred pending Bayesian scope + invalidation contract.
- [ ] **11c.** Instructor/course search refinement; attendance analytics; certificates; CMS event indexing.

## Phase 4 — Scale & Premium

Planned work remains white-label theming, TimescaleDB analytics, AI features, multi-BBB-server routing, Student Corner, placement network and CRM/telephony integration.

## Important architectural boundary

Do not create a second billing engine or second payment-attempt model. The current recurring-billing architecture is:

```text
Provider webhook (Razorpay — sole provider per ADR-038/ADR-040)
        ↓
Immutable inbox (ProviderWebhookEvent)
        ↓
BullMQ worker
        ↓
Provider processor (RazorpayWebhookProcessor)
        ↓
SubscriptionProviderBinding → channel resolution (INV-001)
        ↓
SubscriptionBillingAttempt (side effect)
        ↓
OrganizationSubscription status update
```

A successful HTTP response from the provider means the request was accepted/initiated; it is not terminal payment success. This distinction must remain intact.

The storefront template contract remains owned by the `nextjs-starter-vendure` repository and is intentionally not duplicated here.
