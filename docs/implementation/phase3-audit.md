# Phase 3 Audit — MarketplaceIndexerPlugin (code-verified)

**Date:** 2026-08 · **Branch:** `main` · **Method:** direct code inspection of `src/plugins/marketplace/`, `src/migrations/`, `src/vendure-config.ts` — not doc-derived.

**Purpose:** resolve the contradiction between `roadmap.md` ("scaffold complete") and `plugin-map.md` ("production-ready") by establishing what is actually implemented, before Phase 3 work begins.

---

## Capability matrix

| Capability | Code | DB (migrations) | Tests | Docs | Verdict / Action |
|---|---|---|---|---|---|
| ES indices (`saa9vi_marketplace_sessions`, `saa9vi_marketplace_instructors`) | ✅ `ensureIndicesExist()` on bootstrap (non-fatal if ES down) | n/a (ES) | ❌ | ✅ | Implemented, untested — **verify** |
| BullMQ async index writes | ✅ `MarketplaceIndexQueueService` | n/a | ❌ | ✅ | Implemented, untested — **verify** |
| Event listener coverage | ✅ Gate 1.4: session lifecycle (×4), `TenantProfileUpdatedEvent`, review aggregate transitions (×3), instructor (×2), `ProductVariantEvent` | n/a | ❌ (Gate 1.5) | ☐ | **Correction (2026-09-04):** `ProductVariantEvent` handler was previously a logging-only stub despite being recorded here as implemented — F5/Gate 1.4 completion claim re-opened and now genuinely implemented via the canonical `indexSession()` path. Two deferred surfaces tracked in the matrix below |
| `MarketplaceSearchResolver` (public Shop API, `@Allow(Permission.Public)`) | ✅ full-text + `subjectTags` terms filter + `function_score` (bayesian log1p × sponsored `weight: 3.0`) | n/a | ❌ | ☐ roadmap said pending | Implemented — **add e2e, make boost configurable** |
| `BayesianRatingService` | ✅ reads `ProductReview` aggregate per variant | n/a | ❌ | ✅ | Implemented, untested — **verify** |
| `MarketplaceSessionDocument` / `MarketplaceInstructorDocument` contracts | ✅ typed interfaces + `customDomain` | n/a | ❌ | ☐ | Codified in code; canonical field→event matrix still pending (Gate 1.4) |
| Session visibility/status filter (new finding **F7**) | ✅ `indexSession()` now removes non-public / FINISHED / CANCELLED sessions from the index | n/a | ❌ | ☐ | ✅ **Gate 1.2 fix** — previously *all* sessions with a `productVariantId` were indexed regardless of `visibility`/`status` (public-index leak risk). Event-listener side still pending (Gate 1.4) |
| BUG-023 redirect fields | ✅ `channelToken` resolved from `Channel.token` (not raw channelId); `academySlug` from `BbbOrganization.slug` | n/a | ❌ | ✅ release note | ✅ **Gate 1.2 complete** — `customDomain` now projected from `TenantProfile` into both documents + ES mappings (authored 2026-09-01) |
| `subjectTags` (sessions) | ✅ new `BbbScheduledSession.subjectTags` column (simple-array) + create-API wiring (`CreateBbbScheduledSessionInput.subjectTags`) | ✅ migration `1788266256055-SessionSubjectTags` | ❌ | ☐ | ✅ **Gate 1.3 complete (source established)** — authoritative source is the session's own tenant-controlled tags; `MarketplaceCategory` entity **deferred** until category-browsing UI exists, to avoid a second taxonomy truth |
| `subjectTags` (instructors) | ✅ populated from `InstructorProfile.expertiseAreas` (pre-existing) | n/a | ❌ | ✅ | OK — no change needed |
| `MarketplaceAdCampaign` entity | ✅ registered in plugin `entities[]` | ✅ migration `1788265440266` | ❌ | ✅ | ✅ Resolved (Gate 1.1) — schema verified against entity definition |
| `AdWallet` entity | ✅ registered | ✅ migration `1788265440266` (UNIQUE channelId) | ❌ | ✅ | ✅ Resolved (Gate 1.1) |
| `AdSpendLedger` entity | ✅ registered | ✅ migration `1788265440266` | ❌ | ✅ | ✅ Resolved (Gate 1.1) — append-only: no update/delete path in service; **service-level test still pending** |
| `AdWalletLedger` entity | ❌ does not exist | ❌ | ❌ | ☐ plugin-map listed it as owned | **Doc drift corrected** in plugin-map — planned Phase 3C |
| `MarketplaceAdService` (campaign lookup, wallet, spend) | ✅ wired into indexer (sponsored lookup per session) | ✅ tables migrated (Gate 1.1) | ❌ | ✅ | Schema ready; feature wiring + runtime verification (indexSession → adService → ES) pending Gate 1/4 |
| `Order.customFields.orderSource` | ✅ server-only custom field + `applyMarketplaceReference` Shop mutation (`d6926a9`, `683b2f7`) | ✅ migration `1788176966312-AddOrderSourceCustomField` | ✅ commission e2e | ✅ ADR-021 | ✅ **Gate 2+3 complete** — client-supplied `orderSource` ignored (INV-008 enforced in resolver; e2e case 3 verifies reclassification to `direct`) |
| `CommissionLedger` | ✅ entity + immutable subscriber (`584530b`); `recordMarketplaceOrder` service with `UNIQUE(marketplaceRef)` atomic single-use arbiter (`f534872`); `OrderPlacedEvent` listener (`ca06b86`) | ✅ migrations `1788497028332-AddCommissionLedgerUniqueConstraints` + attribution migration | ✅ **6/6 commission e2e** (`1bcf5e2`): positive, DL-030 $0-row, INV-008 forge, replay, no-ref, single-use concurrency | ✅ DL-030 | ✅ **Gate 3 complete** — strictly-greater atomic replay protection; reconciliation-required log on non-duplicate persistence failure (durable reconciliation record deferred to later phase, per 3B.3 review) |
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

### F3 — BUG-023 redirect contract: resolved
`channelToken` and `academySlug` were already correctly resolved at index time. Gate 1.2 added `customDomain` from the authoritative `TenantProfile` to both marketplace document types and ES mappings. The marketplace projection now contains the complete redirect contract. Status: ✅ Resolved.

### F4 — subjectTags: resolved
The resolver was previously filtering on `subjectTags` while the indexer emitted `[]`. Gate 1.3 established `BbbScheduledSession.subjectTags` as the authoritative source (tenant-controlled, via `CreateBbbScheduledSessionInput.subjectTags` and governed migration `1788266256055`), and projects real tags into the marketplace session document. `MarketplaceCategory` remains intentionally deferred until category browsing requires a first-class taxonomy. Status: ✅ Resolved.

### F5 — Event coverage: resolved for current mutation surfaces
Gate 1.4 added deterministic projection triggers for session lifecycle (`SessionCreated/Updated/Started/CancelledEvent`), tenant profile changes (`TenantProfileUpdatedEvent` → bulk channel reindex), instructor changes, and aggregate-affecting review transitions (`ReviewApproved/Rejected/HiddenEvent` — the marketplace consumes the derived Bayesian value, recomputed at index time). All session mutation paths funnel through the F7 eligibility guard. **Correction (2026-09-04):** the `ProductVariantEvent` handler was found to be a logging-only stub despite being recorded as implemented in this audit — the completion claim was incorrect. It has now been implemented: variant create/update/delete resolves affected sessions via `productVariantId` and funnels them through the canonical `indexSession()` gate (no second indexing path; dangling-variant sessions are re-checked the same way). Two deferred surfaces remain explicitly tracked: `BbbOrganization` slug changes (immutable through the API — see matrix) and `MarketplaceAdCampaign` lifecycle (Phase 3C; target-session-only reindex rule pre-committed). Status: ✅ Gate 1.4 scope complete (incl. `ProductVariantEvent` and `ProductVariantPriceEvent`, corrected 2026-09-04); deferred surfaces tracked. **Second correction (2026-09-04):** the session document's `instructorName` was populated with `BbbOrganizationMember.id` (a numeric PK), violating the document contract; now resolved via the authoritative `BbbInstructorAssignment` → `InstructorProfile.fullName` mapping (primary role preferred), and `InstructorProfileUpdatedEvent` also reindexes every session document embedding that instructor's name.

### F7 — Public-index leak: sessions indexed regardless of visibility/status
`indexSession()` and `fullReindex()` originally indexed **every** session with a `productVariantId` — including `PRIVATE` visibility and `FINISHED`/`CANCELLED` sessions — so ended or private sessions could remain searchable in the public marketplace. **Resolved in Gate 1.2:** `indexSession()` now gates on `visibility === 'PUBLIC' && status IN ('SCHEDULED','LIVE')` and removes non-conforming documents from the index. Note: the event-listener path must preserve this guarantee when extended (Gate 1.4) — every mutation path funnels through `indexSession()`, which now owns the rule.

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

---

## Gate 1.4 — Canonical field→event matrix

The contract: **any mutation that changes marketplace eligibility, routing, filtering, or ranking produces a deterministic projection update.** Triggers are state transitions, not specific internal event-class names. All session paths funnel through the guarded `indexSession()` (F7 rule); the Index behavior column distinguishes REINDEX / REMOVE / NO-OP.

| Marketplace field | Authoritative source | Trigger (state transition) | Index behavior | Implemented via |
|---|---|---|---|---|
| `title`, `startTime/endTime`, `subjectTags` | `BbbScheduledSession` | session updated (`updateBbbScheduledSession`) | REINDEX | `SessionUpdatedEvent` → `indexSession()` |
| `visibility` | `BbbScheduledSession` | PUBLIC↔PRIVATE | REINDEX / REMOVE | `SessionUpdatedEvent` → guarded `indexSession()` |
| `status` | `BbbScheduledSession` | SCHEDULED→LIVE | REINDEX | `SessionStartedEvent` → `indexSession()` |
| `status` | `BbbScheduledSession` | →CANCELLED / →FINISHED | REMOVE | `SessionCancelledEvent` / finish paths → guarded `indexSession()` |
| session created | `BbbScheduledSession` | — | REINDEX (if eligible) | `SessionCreatedEvent` → `indexSession()` |
| whole session document | `BbbScheduledSession` | deleted | REMOVE | **No deletion path exists** — sessions are cancel-only by domain design (`cancelBbbScheduledSession` → CANCELLED → REMOVE). If session deletion is ever introduced, a `SessionDeletedEvent` → `deleteSession()` row becomes **mandatory** before it ships |
| `price`, `stock` | `ProductVariant` | variant created/updated/deleted | REINDEX | `ProductVariantEvent` → `indexSession()` (corrected 2026-09-04) |
| `price` (channel price) | `ProductVariantPrice` | price created/updated/deleted | REINDEX | **Correction (2026-09-04):** Vendure emits `ProductVariantPriceEvent` — not `ProductVariantEvent` — for channel price mutations; listener now subscribes and resolves affected variants → sessions → `indexSession()` |
| academy `businessName`, `customDomain`, logo | `TenantProfile` | profile updated | REINDEX (bulk, whole channel) | `TenantProfileUpdatedEvent` → `handleAcademyProfileChange()` |
| academy slug | `BbbOrganization` | **immutable through the API** | NO-OP | ✅ Verified: `UpdateBbbOrganizationInput` (bbb-admin.schema.ts) exposes only `name`/`concurrentMeetingLimit`/`maxParticipantsPerMeeting`/`recordingEnabled`/`suspended` — **no `slug` field**. Since `academySlug` is part of the redirect contract, any future change adding slug mutability MUST add `BbbOrganizationUpdatedEvent` → channel-wide reindex in the same change |
| instructor name/bio/photo/tags | `InstructorProfile` | created / updated | REINDEX | `InstructorProfileCreated/UpdatedEvent` (pre-existing) |
| Bayesian rating | `ProductReview` aggregate | review approved / rejected / hidden | REINDEX (affected sessions only) | `ReviewApproved/Rejected/HiddenEvent` → `handleReviewAggregateChange()` — marketplace consumes the *derived value*, not raw reviews |
| `isSponsored`, `sponsorBoost` | `MarketplaceAdCampaign` | campaign activated / paused / exhausted / expired / changed | REINDEX (target session only) | ⚠️ Campaign mutation surface not built (Phase 3C) — when implemented, campaign mutations MUST enqueue `addIndexSessionJob(targetSessionId)`; no full-marketplace reindex |

**Campaign coupling rule:** ad state is derived search metadata, not session ownership. Campaign changes reindex only their `targetSessionId` — advertising stays isolated from session lifecycle.

**Review coupling rule:** never subscribe to raw review lifecycle beyond aggregate-affecting transitions; when `RankingMaterializedView` lands (Gate 5), this trigger becomes a ranking-change event.

