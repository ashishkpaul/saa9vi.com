# What Next — Saa9vi Platform

**Updated:** 2026-09-12

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
| **R1 — Provider-neutral boundary** | ✅ Complete | Interface + both providers (Razorpay + Juspay) |
| **R2 — Razorpay Contract Verification** | ✅ Complete | All sub-gates proven (see below) |
| **R3 — ADR-038 Freeze** | ✅ Complete | ADR-038 ACCEPTED 2026-09-12 (R2-F + R2-G evidence, INV-018 channel-scoped worker ctx) |
| **I1-I3 — Implementation** | ✅ Complete | Razorpay live on `main` |
| **V1 — Production hardening** | ⏳ Next | Baseline: `71dc27e` (ADR-038 acceptance). Checklist below — **first action: rotate exposed Razorpay secrets** |

---

## R2: Razorpay Subscription Contract Verification

| Gate | Status | Notes |
|------|--------|-------|
| **R2-A** Test Plan | ✅ DONE | `plan_TaMGQbDDQn7Tir` (₹10/month) |
| **R2-B** Webhook Config | ✅ DONE | 11 events, `webhook.saa9vi.com`, Test mode |
| **R2-C** Webhook Ingress | ✅ Proven | HMAC-SHA256, idempotency, persist-first, 2xx |
| **R2-D** Create Subscription | ✅ DONE | `sub_TabaZJZTQzNfWy` via API |
| **R2-E** Authorization | ✅ DONE | Customer authorized, payment captured |
| **R2-F** Durable Processing | ✅ Proven | BullMQ inbox worker, single processing path |
| **R2-F** Channel Resolution | ✅ Proven | Resolved from provider binding (INV-001) |
| **R2-F** Inbox Idempotency | ✅ Proven | UNIQUE(provider, providerEventId) |
| **R2-F** Processing Idempotency | ✅ Proven | Double-send → single billing attempt |
| **R2-F** Concurrent Idempotency | ✅ Proven | DB UNIQUE constraint blocks duplicates |
| **R2-G** Failure Semantics | ✅ Proven | pending → retry → failed (terminal), `failedAt` |
| **R2-G** Channel Isolation | ✅ Proven | Cross-tenant events stay isolated |
| **R3** ADR-038 Freeze | ✅ Complete | Accepted 2026-09-12 |

---

## Gate: R3 — ADR-038 Freeze ✅ COMPLETE

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
- ❌ Delete Juspay code yet (still referenced by `providers/juspay/`)
- ❌ Call Juspay "legacy" yet (still a valid provider implementation)

---

## V1 — Production Hardening

**Baseline: `71dc27e` (ADR-038 acceptance, 2026-09-12).** From here the goal is proving the accepted design remains safe under production failure, retries, credentials, and operational conditions — no further architectural redesign.

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

### Explicitly out of scope for V1

- Refactoring remaining `setImmediate()` hits (BBB subsystem / `reference/` material — unrelated)
- Removing Juspay classes (provider-neutral boundary intentionally preserves them; see ADR-038)

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

| Component | Status |
|-----------|--------|
| `JuspaySdk` | Current (not legacy) |
| `JuspayBillingService` | Current (not legacy) |
| `JuspayPaymentAttempt` | Current entity |
| `JuspaySubscriptionMandate` | Current entity |
| `RazorpaySubscriptionProvider` | ✅ Integrated (live on `main`) |
| `RazorpayWebhookProcessor` | ✅ Integrated (live on `main`) |
| `RazorpayWebhookController` | ✅ Integrated (live on `main`) |
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
npm run build
```

A tool-generated summary is NOT evidence that a commit exists.

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

[x] SubscriptionPlan / OrganizationSubscription
[x] BbbPlatformCapacityPolicy
[x] Starter / Growth / Enterprise capacity tiers
[x] Plan-based BBB room capacity enforcement
[x] Portal Admin capacity policy surface
[x] Subscription capacity-grant integration
[x] Juspay Steps 0–6 implementation (Dashboard, secret hardening, e2e)

[x] NavigationMenu entity in CMS
[ ] Juspay provider-contract verification (live sandbox)
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
Provider webhook (Razorpay/Juspay)
        ↓
Immutable inbox (ProviderWebhookEvent)
        ↓
BullMQ worker
        ↓
Provider processor (RazorpayWebhookProcessor / JuspayWebhookProcessor)
        ↓
SubscriptionProviderBinding → channel resolution (INV-001)
        ↓
SubscriptionBillingAttempt (side effect)
        ↓
OrganizationSubscription status update
```

A successful HTTP response from the provider means the request was accepted/initiated; it is not terminal payment success. This distinction must remain intact.

The storefront template contract remains owned by the `nextjs-starter-vendure` repository and is intentionally not duplicated here.
