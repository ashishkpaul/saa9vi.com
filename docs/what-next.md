# What Next — Saa9vi Platform

**Updated:** 2026-09-04

---

> **Precondition — runtime environment not yet verified against real infrastructure.**
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
- **Juspay subscription billing — feature-complete** (Step 0–6): provider-contract verified against docs (ADR-037), webhook ingestion (fail-closed Basic Auth + HMAC), real recurring charge (POST /txns), Portal Admin Dashboard (Billing nav with 4 routes), production secret hardening (AES-256-GCM encryption at rest, fail-closed in production), full lifecycle e2e regression suite. **Pending: live provider-contract verification and production credential rollout.**
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
Due OrganizationSubscription
        ↓
CLAIM CAS
        ↓
JuspayPaymentAttempt (initiated)
        ↓
Juspay charge request
        ↓
Juspay webhook
        ↓
reconcile existing attempt
        ↓
CHARGE_SUCCEEDED → FINALIZE CAS
CHARGE_FAILED    → past_due
```

A successful HTTP response from the real Juspay charge request means the request was accepted/initiated; it is not terminal payment success. This distinction must remain intact.

The storefront template contract remains owned by the `nextjs-starter-vendure` repository and is intentionally not duplicated here.
