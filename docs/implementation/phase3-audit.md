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
| `MarketplaceAdCampaign` entity | ✅ registered in plugin `entities[]` | ❌ **no migration** | ❌ | ✅ | **Latent defect** — `synchronize: false` (vendure-config.ts:126), table does not exist |
| `AdWallet` entity | ✅ registered | ❌ **no migration** | ❌ | ✅ | **Latent defect** — same |
| `AdSpendLedger` entity | ✅ registered | ❌ **no migration** | ❌ | ✅ | **Latent defect** — same |
| `AdWalletLedger` entity | ❌ does not exist | ❌ | ❌ | ☐ plugin-map listed it as owned | **Doc drift corrected** in plugin-map — planned Phase 3C |
| `MarketplaceAdService` (campaign lookup, wallet, spend) | ✅ wired into indexer (sponsored lookup per session) | depends on missing tables | ❌ | ✅ | **Dead code until migration lands** — sponsorship lookup fails per-session (caught + logged), silently disabling sponsored ranking |
| `Order.customFields.orderSource` | ❌ zero hits in code | ❌ | ❌ | ✅ ADR-021 | **Unimplemented** — Phase 3B, after attribution ADR |
| `CommissionLedger` | ❌ no entity | ❌ | ❌ | ✅ DL-030 | **Unimplemented** — Phase 3B, blocked on attribution ADR |
| `MarketplaceAcademyPage` | ❌ | — | — | ☐ | Unimplemented — Phase 3A |
| `MarketplaceCategoryIndex` / taxonomy entity | ❌ | — | — | ☐ | Unimplemented — Phase 3A |
| `RankingMaterializedView` | ❌ | — | — | ☐ | Unimplemented — Phase 3A/3D |

---

## Key findings

### F1 — Both status labels were wrong
`roadmap.md` "scaffold complete" understates the projection layer (search resolver, ranking, sponsorship are real). `plugin-map.md` "production-ready" overstates it (no tests, no event completeness, no DB tables for ad entities). **Accurate state:** projection layer implemented and untested; business layer (attribution/commission) absent; ad layer code-complete but unmigrated.

### F2 — Latent runtime defect: ad entities have no tables
`synchronize: false` and no migration in `src/migrations/` covers `marketplace_ad_campaign`, `ad_wallet`, `ad_spend_ledger`. `MarketplaceIndexerService.indexSession()` calls `adService.findActiveCampaignForSession()` on **every session index** — once ES indexing runs against a real DB, this path throws per-session (caught + logged today, silently disabling sponsorship) or fails when the ad service first queries. **Closure: generate the migration via Vendure CLI in Phase 3A (gate 1.1), before any advertising feature work.**

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
