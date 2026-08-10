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

## Current State (v1.12 — 2026-08-10)

Recent completions (see `release-notes.md`):

- BUG-022 (entitlement/enrollment read mismatch) — fixed
- BUG-023 (marketplace indexer redirect fields) — fixed
- BUG-024 (auto-provision shipping/payment/stock) — fixed
- BUG-025 / BUG-026 (role & administrator visibility) — fixed
- BUG-027 (pendingReviewRequests `undefined` options) — fixed
- BUG-028 (Academy Console permission names) — fixed
- BUG-029 (BBB platform infrastructure boundary) — fixed
- `myLearningDashboard` Shop API query — complete
- `GrantReaderService` — implemented
- Capacity Intelligence System (CI-001 to CI-006) — implemented
- Tenant role reconciliation tooling (`tenant:roles:check` / `tenant:roles:repair`) — added
- E2E suite: 39 tests passing

---

## Priority Order (current roadmap)

```
PHASE 1.5 REMAINING BLOCKERS
  FEAT-002 schema migration                  [ADR §8A OP-005]
  Next.js public instructor/CMS pages        [Phase 1.5]
  Email verification for tenant admins       [Phase 1.5]
  End-to-end customer deletion test          [INV-013]
  Load estimation ratios tuning              [CI-001]

PHASE 2 — SUBSCRIPTION BILLING & CAPACITY POLICY
  SubscriptionPlan / OrganizationSubscription entities
  BbbPlatformCapacityPolicy entity + Portal Admin dashboard
  Plan-based capacity tiers
  Juspay recurring billing integration

PHASE 3 — MARKETPLACE & RETENTION
  CommissionLedger $0-row pattern            [DL-030]
  MarketplaceSearchResolver (Shop API)
  Order.customFields.orderSource attribution
  Advertising stream (AdWallet, AdSpendLedger)

PHASE 4 — SCALE & PREMIUM
  White-label theming, TimescaleDB, AI features
```

See `docs/implementation/roadmap.md` for full details and per-phase task lists.
