# Phase 3 Audit — MarketplaceIndexerPlugin (code-verified)

**Date:** 2026-08 · **Branch:** `main` · **Method:** direct code inspection of `src/plugins/marketplace/`, `src/migrations/`, `src/vendure-config.ts` — not doc-derived.

**Purpose:** resolve the contradiction between `roadmap.md` ("scaffold complete") and `plugin-map.md` ("production-ready") by establishing what is actually implemented, before Phase 3 work begins.

---

## Capability matrix

| Capability | Code | DB (migrations) | Tests | Docs | Verdict / Action |
|---|---|---|---|---|---|
| ES indices (`saa9vi_marketplace_sessions`, `saa9vi_marketplace_instructors`) | ✅ `ensureIndicesExist()` on bootstrap (non-fatal if ES down) | n/a (ES) | ❌ | ✅ | Implemented, untested — **verify** |
| BullMQ async index writes | ✅ `MarketplaceIndexQueueService` | n/a | ❌ | ✅ | Implemented, untested — **verify** |
| Event listener coverage | ✅ but **only 3 event types**: `InstructorProfileCreatedEvent`, `InstructorProfileUpdatedEvent`, `ProductVariantEvent` | n/a | ❌ | ☐ | **Gap** — no session lifecycle (published/cancelled/finished), review-aggregate, academy-profile, or sponsored-state events. **Implement** |
| `MarketplaceSearchResolver` (public Shop API, `@Allow(Permission.Public)`) | ✅ full-text + `subjectTags` terms filter + `function_score` (bayesian log1p × sponsored `weight: 3.0`) | n/a | ❌ | ☐ roadmap said pending | Implemented — **add e2e, make boost configurable** |
| `BayesianRatingService` | ✅ reads `ProductReview` aggregate per variant | n/a | ❌ | ✅ | Implemented, untested — **verify** |
| `MarketplaceSessionDocument` / `MarketplaceInstructorDocument` contracts | ✅ typed interfaces | n/a | ❌ | ☐ | **Gaps found** (below) — **codify + fix** |
| BUG-023 redirect fields | ✅ `channelToken` resolved from `Channel.token` (not raw channelId); `academySlug` from `BbbOrganization.slug` | n/a | ❌ | ✅ release note | **Verified in code — correct. But `customDomain` is absent from the document** (redirect contract incomplete) |
| `subjectTags` | ✅ field exists in schema/resolver | n/a | ❌ | ☐ | **Hardcoded `[]` at index time** — nothing populates it. **Implement** |
| `MarketplaceAdCampaign` entity | ✅ registered in plugin `entities[]` | ✅ migration `1788265440266` | ❌ | ✅ | ✅ Resolved (Gate 1.1) — schema verified against entity definition |
| `AdWallet` entity | ✅ registered | ✅ migration `1788265440266` (UNIQUE channelId) | ❌ | ✅ | ✅ Resolved (Gate 1.1) |
| `AdSpendLedger` entity | ✅ registered | ✅ migration `1788265440266` | ❌ | ✅ | ✅ Resolved (Gate 1.1) — append-only: no update/delete path in service; **service-level test still pending** |
| `AdWalletLedger` entity | ❌ does not exist | ❌ | ❌ | ☐ plugin-map listed it as owned | **Doc drift corrected** in plugin-map — planned Phase 3C |
| `MarketplaceAdService` (campaign lookup, wallet, spend) | ✅ wired into indexer (sponsored lookup per session) | ✅ tables migrated (Gate 1.1) | ❌ | ✅ | Schema ready; feature wiring + runtime verification (indexSession → adService → ES) pending Gate 1/4 |
| `Order.customFields.orderSource` | ❌ zero hits in code | ❌ | ❌ | ✅ ADR-021 | **Unimplemented** — Phase 3B, after attribution ADR |
| `CommissionLedger` | ❌ no entity | ❌ | ❌ | ✅ DL-030 | **Unimplemented** — Phase 3B, blocked on attribution ADR |
| `MarketplaceAcademyPage` | ❌ | — | — | ☐ | Unimplemented — Phase 3A |
| `MarketplaceCategoryIndex` / taxonomy entity | ❌ | — | — | ☐ | Unimplemented — Phase 3A |
| `RankingMaterializedView` | ❌ | — | — | ☐ | Unimplemented — Phase 3A/3D |

---

## Key findings

### F1 — Both status labels were wrong
`roadmap.md` "scaffold complete" understates the projection layer (search resolver, ranking, sponsorship are real). `plugin-map.md` "production-ready" overstates it (no tests, no event completeness, no DB tables for ad entities). **Accurate state:** projection layer implemented and untested; business layer (attribution/commission) absent; ad layer code-complete but unmigrated.

### F2 — Ad-entity schema: resolved via governed migration (was: untraceable out-of-band DDL)
Initial audit finding revised after direct PostgreSQL inspection: the three tables **did exist** in the dev database (empty, 0 rows) with schemas matching the entity definitions exactly — but no migration file covered them, meaning the DDL was created out-of-band (most likely a dev run before `synchronize: false` was set). That is a `.clinerules` §7 governance violation (schema not traceable to CLI migration), not a runtime defect. The `vendure migrate -g` command reported "No changes" because the DB already matched — the same pattern as the FEAT-002 case.

**Resolution (Gate 1.1):** dropped the three empty out-of-band tables → generated `1788265440266-MarketplaceAdEntities` via Vendure CLI (covers exactly the 3 tables + 3 indexes, nothing unrelated) → inspected the generated SQL → applied via `vendure migrate -r` → verified tables, indexes (`channelId` btree on campaign, **UNIQUE** `channelId` on wallet, `campaignId` btree on ledger), PKs, and the `migrations` bookkeeping row. Schema is now fully traceable.

### F3 — BUG-023 verified in code, contract still incomplete
`channelToken`/`academySlug` are correctly resolved at index time (marketplace-indexer.service.ts:141–155). However the document lacks `customDomain` — the storefront cannot complete the redirect contract (academySlug + channelToken + customDomain) from the ES document alone. **Action: add `customDomain` (from `TenantProfile`) to both document types.**

### F4 — `subjectTags` is plumbed but never populated
Indexer writes `subjectTags: []` unconditionally; the search resolver filters on it. Any `subjectTags` filter today returns nothing. **Action: populate from session/academy taxonomy (Phase 3A, alongside `MarketplaceCategoryIndex`).**

### F5 — Event coverage fails the projection-completeness criterion
The acceptance criterion — *every field that can affect marketplace visibility, routing, filtering, or ranking has a deterministic projection update path* — is currently met only for instructor CRUD and ProductVariant changes. Missing: session published/cancelled/finished, review aggregate changes, academy profile (name/domain) changes, campaign start/stop. **Action: extend `MarketplaceEventListener`; write the field→event matrix as part of the canonical document contract.**

### F6 — Plugin ownership corrected
`domain-model.md` attributed `CommissionLedger` to a non-existent `MarketplacePlugin`. Corrected to `MarketplaceIndexerPlugin` (`src/plugins/marketplace`). No new plugin will be created — the existing bounded context stands.

---

## Sequencing (drives `roadmap.md` / `what-next.md`)

```text
DOCUMENTATION TRUTH   ✅ done (this sync)
        ↓
CODE/DB TRUTH         Gate 1.1 — ad-entity migration via Vendure CLI
        ↓
DISCOVERY CONTRACT    Gate 1   — document contract, customDomain/subjectTags,
                                 event completeness, e2e
        ↓
ATTRIBUTION CONTRACT  Gate 2   — ADR addendum to ADR-021 (8 open questions)
        ↓
COMMISSION            Gate 3   — orderSource custom field + CommissionLedger ($0-row)
        ↓
ADVERTISING           Gate 4   — wire MarketplaceAdService on existing tables
        ↓
RETENTION             Gate 5   — review→ranking pipeline, academy page,
                                 category taxonomy, ranking view
        ↓
PHASE 3 RELEASE GATE  — exit criteria in roadmap.md
```

**Reference only (not a dependency):** Vendure's example `multivendor-plugin` — consulted for seller/channel-assignment patterns; **not installed**, per ADR-019 (no cross-vendor carts; marketplace is discovery-only).
