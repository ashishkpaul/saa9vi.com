# What Next — Saa9vi Platform

**Updated:** 2026-09-09

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
| **R1 — Provider-neutral boundary** | 🟡 IN PROGRESS | Interface added, Juspay still on critical path |
| **R2 — Razorpay Test Plan** | ⏳ PENDING | Create ₹1/month test plan |
| **R3 — Razorpay Test Subscription** | ⏳ PENDING | Create test subscription |
| **R4 — Webhook lifecycle capture** | ⏳ PENDING | Capture all webhook events |
| **R5 — Contract freeze (ADR-038)** | ⏳ PENDING | Only after R2-R4 evidence |
| **I1-I3 — Implementation** | 🔒 LOCKED | After R1 complete |
| **V1 — Production hardening** | 🔒 LOCKED | After I1-I3 complete |

---

## R2: Razorpay Subscription Contract Verification

| Gate | Status | Notes |
|------|--------|-------|
| **R2-A** Test Plan | ✅ DONE | `plan_TaMGQbDDQn7Tir` (₹10/month) |
| **R2-B** Webhook Config | ✅ DONE | 11 events, `webhook.saa9vi.com`, Test mode |
| **R2-C** Webhook Ingress | ✅ Proven | HMAC-SHA256, idempotency, persist-first, 2xx |
| **R2-D** Create Subscription | ✅ DONE | `sub_TabaZJZTQzNfWy` via API |
| **R2-E** Authorization | ✅ DONE | Customer authorized, payment captured |
| **R2-F** Durable Processing | 🟡 In Progress | BullMQ inbox worker, single processing path |
| **R2-F** Channel Resolution | ✅ Proven | Resolved from provider binding (INV-001) |
| **R2-F** Inbox Idempotency | ✅ Proven | UNIQUE(provider, providerEventId) |
| **R2-F** Processing Idempotency | ✅ Proven | Double-send → single billing attempt |
| **R2-G** Failure Semantics | 🟡 Code Complete | pending → retry → failed (terminal), `failedAt` |
| **R2-G** Channel Isolation | ✅ Proven | Cross-tenant events stay isolated |
| **R3** ADR-038 Freeze | ⏳ Ready | All R2 evidence captured |

---

## Current Gate: R2-F/R2-G — Durable Processing & Failure Semantics

The webhook ingress is proven (R2-C). The inbox worker is implemented with:
- Single processing path (legacy `processWebhook()` removed)
- `attemptCount` tracking with proper state lifecycle
- `processedAt` (success) and `failedAt` (terminal failure) timestamps
- Channel resolution BEFORE business processing (INV-001)
- DB errors thrown (not silently converted to "no binding")
- Unified retry semantics: `MAX_ATTEMPTS=3`, `BULLMQ_RETRIES=2`

Remaining verification:
- [ ] Failure path tested (pending → retry → failed with `failedAt` populated)
- [ ] Idempotency under concurrent workers (DB-level constraint)

### What still needs to happen for R1

- [x] `ProviderWebhookEvent` entity (immutable inbox) — done
- [x] Migration for `ProviderWebhookEvent` — done (1789141516883, 1789180117889)
- [ ] `SubscriptionRenewalService` depends on `RecurringBillingProvider` (not `JuspayBillingService`)
- [ ] Juspay code moved to `providers/juspay/` (not deleted)
- [ ] `SubscriptionPlugin` registers provider conditionally

### Do NOT

- ❌ Mark ADR-038 as Accepted yet (waiting for failure path verification)
- ❌ Delete Juspay code yet (still referenced by `providers/juspay/`)
- ❌ Call Juspay "legacy" yet (still a valid provider implementation)

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

## Precondition — Runtime Environment

> **Precondition — runtime environment not yet verified against real infrastructure.**

The application was started with `DB_HOST=localhost`/`DB_PORT=5435` and `REDIS_HOST=localhost`/`REDIS_PORT=6385`, intended to reach Cloudflare Access TCP tunnels (`db.saa9vi.com`, `redis.saa9vi.com`). The tunnels reported local listeners, but the application still fell back to pg-mem (in-memory Postgres) and `DefaultJobQueuePlugin` (in-memory job queue). The startup log proves the fallback path works; it does **not** prove connectivity to the intended public PostgreSQL/Redis services.

**Nothing in the "Current State" section below can be trusted until this is confirmed resolved** — CAS locking, idempotent grants, the payment-attempt ledger, and the webhook queue all depend on a real Postgres and Redis connection to mean anything.

---

## Current State (v1.18 — 2026-09-09)

### Verified complete

- **Phase 3B — Attribution & Commission** — complete: `CommissionListener` (server-side classification, INV-008), `CommissionLedger` $0-row pattern (DL-030), governed migration with UNIQUE constraints, 6-case E2E passing.
- TypeScript build succeeds (`npm run build`).
- Vendure starts successfully on v3.6.5 (against fallback pg-mem/DefaultJobQueue — see precondition above).
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
| `RazorpaySubscriptionProvider` | Proposed (not yet integrated) |
| `RazorpayWebhookProcessor` | Proposed (not yet integrated) |

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
>
> The application was started with `DB_HOST=localhost`/`DB_PORT=5435` and `REDIS_HOST=localhost`/`REDIS_PORT=6385`, intended to reach Cloudflare Access TCP tunnels (`db.saa9vi.com`, `redis.saa9vi.com`). The tunnels reported local listeners, but the application still fell back to pg-mem (in-memory Postgres) and `DefaultJobQueuePlugin` (in-memory job queue). The startup log proves the fallback path works; it does **not** prove connectivity to the intended public PostgreSQL/Redis services.
>
> **Nothing in the "Current State" section below can be trusted until this is confirmed resolved** — CAS locking, idempotent grants, the payment-attempt ledger, and the webhook queue all depend on a real Postgres and Redis connection to mean anything.
>
> **Next verification:** use `127.0.0.1` rather than `localhost` in `.env`, then independently verify the tunnels with `pg_isready`/`psql` and `redis-cli` before starting Vendure.

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

---

## Current State (v1.17 — 2026-09-04)

### Verified complete

- **Phase 3B — Attribution & Commission** — complete: `CommissionListener` (server-side classification, INV-008), `CommissionLedger` $0-row pattern (DL-030), governed migration with UNIQUE constraints, 6-case E2E passing.

- TypeScript build succeeds (`npm run build`).
- Vendure starts successfully on v3.6.5 (against fallback pg-mem/DefaultJobQueue — see precondition above).
- SubscriptionPlan / OrganizationSubscription foundation is implemented.
- BbbPlatformCapacityPolicy and plan-based capacity enforcement are implemented.
- Capacity policy Portal Admin API/dashboard is implemented.
- **Juspay subscription billing — M1.1 Session API verified; M1.2 gateway configuration next** (Step 0–6): provider-contract verified against docs (ADR-037), webhook ingestion (fail-closed Basic Auth + HMAC), real recurring charge (POST /txns), Portal Admin Dashboard (Billing nav with 4 routes), production secret hardening (AES-256-GCM encryption at rest, fail-closed in production), full lifecycle e2e regression suite. **M1.1 live sandbox verification complete (2026-09-08): authentication ✅, Session API creation ✅ (does NOT prove mandate registration), payment methods discovered (via Session API, not separate endpoint), mandate params echoed in sdk_payload ✅. Next: M1.2 configure mandate-capable Sandbox gateway (current = DUMMY). Do NOT implement M2 until M1.2–M1.4 are complete.**
- **Phase 1.5 blockers resolved** — all five remaining blockers closed:
  - FEAT-002 schema migration — verified already applied (Vendure CLI: no schema changes; `sourceType` + `isUnbounded` confirmed in DB)
  - Next.js public instructor/CMS pages — CMS page route (`/[locale]/page/[slug]`) added; instructor page already existed
  - Email verification for tenant admins — `verifyTenantAdmin` Shop API mutation + unverified admin creation
  - End-to-end customer deletion test — `customer-deletion.e2e-spec.ts` covering Flow A + Flow B across BBB/Tenant/Reviews
  - Load estimation ratios tuning — PILOS ratios configurable via `BigBlueButtonPluginOptions` + env vars
- BUG-022 (entitlement/enrollment read mismatch) — fixed
- BUG-023 (marketplace indexer redirect fields) — fixed
- BUG-024 (auto-provision shipping/payment/stock) — fixed
- BUG-025 / BUG-026 (role & administrator visibility) — fixed
- BUG-027 (pendingReviewRequests `undefined` options) — fixed
- BUG-028 (Academy Console permission names) — fixed
- BUG-029 (BBB platform infrastructure boundary) — fixed
- BUG-030 (tenant admin role channel relations) — fixed
- BUG-031 (CMS channel ownership leak) — fixed
- `myLearningDashboard` Shop API query — complete
- `GrantReaderService` — implemented
- Capacity Intelligence System (CI-001 to CI-006) — implemented
- Tenant role reconciliation tooling (`tenant:roles:check` / `tenant:roles:repair`) — added
- Dunning flow (RFC-001 §4.2) — scheduled retry + auto-cancellation task implemented
- NavigationMenu entity in CMS — entity, service, migration applied
- E2E suite: 44 tests passing

### Still pending before calling Juspay production-ready

1. **Provider-contract verification** — verify the exact sandbox/live Juspay mandate, charge, webhook, signature, idempotency, retry, order-ID and transaction-ID contracts against the live Juspay sandbox API. The implementation seam is ready; provider verification is still a release gate.
2. **Production credential rollout** — provision real production Juspay API keys and webhook credentials, configure `JUSPAY_WEBHOOK_*` env vars, and confirm the fail-closed guards behave correctly in a `NODE_ENV=production` deployment.
3. **E2e coverage gaps** — the existing 552-line `juspay-webhook.e2e-spec.ts` covers auth, dedupe, concurrency, and queue-failure semantics. Not yet covered: live sandbox charge round-trip, mandate pause/revoke lifecycle, and dunning (past_due → retry → cancellation) flow.

---

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
