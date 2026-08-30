# What Next — Saa9vi Platform: Cline Development Prompt

**Generated:** 2026-08-10
**Based on:** All plugin codebases, Vendure live docs, current release state (v1.12)

---

## Documentation Architecture

The documentation has been refactored into focused documents:

| Directory | Document | Purpose |
|---|---|---|
| `docs/architecture/` | `platform-adr.md` | Enduring architectural decisions only |
| `docs/architecture/` | `domain-model.md` | Every aggregate, its purpose, lifecycle, relationships |
| `docs/architecture/` | `plugin-map.md` | Plugin ownership, entities, events, API surfaces |
| `docs/architecture/` | `runtime-flow.md` | Event-driven flows, service interactions, queues |
| `docs/architecture/` | `invariants.md` | Non-negotiable rules (INV-001 through INV-015) |
| `docs/product/` | `platform-story.md` | Capability-based actor lifecycles |
| `docs/product/` | `glossary.md` | Domain term definitions |
| `docs/implementation/` | `roadmap.md` | Future work only, by phase |
| `docs/implementation/` | `known-bugs.md` | Active and fixed bugs |
| `docs/implementation/` | `release-notes.md` | Completed work, chronologically |

---

## Current State (v1.14 — 2026-08-30)

Recent completions (see `release-notes.md`):

- **Juspay recurring billing foundation** — Step 0–2 complete: mandate/payment-attempt/webhook entities + migrations, renewal claim/finalize state model, INV-019 registered, BuyLits reference analyzed (`reference/buylits/`). Remaining: Step 3 webhook ingestion, Step 4 real charge, Step 5 admin surface.
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
- E2E suite: 44 tests passing

---

## Priority Order (current roadmap)

```
PHASE 2 — SUBSCRIPTION BILLING & CAPACITY POLICY
  [x] SubscriptionPlan / OrganizationSubscription entities (SubscriptionPlugin, migration 1787547472479)
  [x] BbbPlatformCapacityPolicy entity + Portal Admin dashboard
  [x] Plan-based capacity tiers (Starter 50 / Growth 200 / Enterprise 500)

  Juspay recurring billing — foundation complete, integration in progress:
  [x] Step 0 — BuyLits reference analysis (reference/buylits/; port pattern, not files)
  [x] Step 1 — vestigial Juspay surface inventory (initiateJuspaySession,
      cancelJuspaySession, JuspaySessionResult, juspayOrderStatus — order-checkout
      shaped; implement for real with subscription-aware variants, no removal, INV-007)
  [x] Step 2 — entities: JuspaySubscriptionMandate (FSM pending→active→paused/revoked),
      JuspayPaymentAttempt (INV-019), JuspayWebhookEvent (INV-004 PENDING→PROCESSED
      + period-aware dedupeKey); migrations 1788058421475 + 1788059200478
  [x] Step 2 — renewal claim/finalize state model (CLAIM CAS → attempt → charge →
      FINALIZE CAS; period advancement only on payment success)
  [x] Step 2 — mandate cardinality (partial unique index, one current mandate)
  [x] Step 2 — payment-attempt channel isolation (scalar channelId)
  [ ] Step 3 — Juspay webhook ingestion (fail-closed Basic Auth + HMAC; raw-body
      middleware; persist PENDING → BullMQ → processor; webhook reconciles the
      existing attempt — never a second payment engine)
  [ ] Step 4 — real Juspay recurring charge (SDK mandate extension; failure-path
      tests FIRST; finalize-conflict reconciliation state must be operator-visible,
      not hidden under generic CAS_CONFLICT)
  [ ] Step 5 — Portal Admin mandate + payment-attempt ledger surface (read-only)
  [ ] Step 6 — docs/production hardening closeout

PHASE 3 — MARKETPLACE & RETENTION
  CommissionLedger $0-row pattern            [DL-030]
  MarketplaceSearchResolver (Shop API)
  Order.customFields.orderSource attribution
  Advertising stream (AdWallet, AdSpendLedger)

PHASE 4 — SCALE & PREMIUM
  White-label theming, TimescaleDB, AI features
```

See `docs/implementation/roadmap.md` for full details and per-phase task lists.

---

**Storefront template contract (cross-repo pointer):** the Storefront Template Contract — governing what template code may do in the `nextjs-starter-vendure` storefront repo — lives in that repo's own docs tree:

> `docs/adr/storefront-template-contract.md` (in the `nextjs-starter-vendure` repository)

It is a frontend-governing contract and deliberately lives with the component/template enforcement it describes, not in this backend ADR tree. See that repo for details.
