# Roadmap

> **Purpose:** Track future work only. Organized by phase. When work is completed, move it to `release-notes.md`.

---

## Phase 1 — Commercial Operability

**Status:** Substantially complete. Remaining items before first tenant onboarding:

- [x] `BbbWebhookEvent` persist-first pipeline
- [x] `BbbScheduledSession` connected in fulfillment path
- [x] `BbbEntitlement` entity + service for `bbb_session`
- [x] Trial registration creates `Entitlement` automatically
- [x] `BbbMeetingService.getJoinUrl` checks Entitlement for session access
- [x] `BbbScheduledSession` `(organizationId, slug)` composite index
- [x] Rate limiting on public mutations (SEC-005)
- [x] Custom domain → channel token Redis mapping (SEC-006)

---

## Phase 1.5 — Trust Engine & Discovery

**Status:** Complete (2026-08-23). The BUG-033 root cause (e2e `requireVerification` default) is fixed, unblocking the customer-deletion login path; the customer-deletion suit now surfaces separate Flow A/B fixture issues (see below).

### Completed

- [x] `BbbEntitlement` entity + service for `bbb_session` access checks
- [x] `BbbMeetingService.joinRoom()` migrated to `BbbEntitlement` for room access
- [x] Elasticsearch indexing for instructors (`InstructorIndexerService`)
- [x] `BbbEntitlement` admin UI (GraphQL queries/mutations + dashboard route)
- [x] Scheduled Sessions admin UI
- [x] FEAT-001 (`BbbOrganizationMembership`) — code complete
- [x] FEAT-002 (`internal_overhead` capacity grant) — code complete, migration verified applied
- [x] `myLearningDashboard` Shop API query
- [x] Rate limiting on `registerNewTenant` mutation
- [x] Custom domain → channel token Redis mapping
- [x] **FEAT-002 schema migration** — verified already applied (`sourceType` + `isUnbounded` confirmed in DB)
- [x] **Next.js public instructor/CMS pages** — CMS page route (`/[locale]/page/[slug]`) added; instructor page already existed
- [x] **Email verification for tenant admins** — `verifyTenantAdmin` Shop API mutation + unverified admin creation
- [x] **End-to-end customer deletion test** — covers Flow A + Flow B across BBB/Tenant/Reviews. **Login-handler blocker (BUG-033) resolved** (`requireVerification:false`); `leaveAcademy` mutate+Flow B login now execute. 2 further Flow A/B issues surfaced that need separate fixes: (1) Flow B fixture seeds `BbbEnrollment.roomId`/`BbbTrialRegistration.scheduledSessionId` with non-numeric ids into integer FK columns; (2) Flow A "BBB entitlements deactivated" assertion fails. Production paths are TypeScript-verified.
- [x] **Load estimation ratios tuning** — PILOS ratios configurable via `BigBlueButtonPluginOptions` + env vars

---

## Phase 2 — Subscription Billing & Capacity Policy

### Subscription and capacity policy — complete

- [x] `SubscriptionPlan` and `OrganizationSubscription` entities — platform-global plan catalogue + channel-scoped organization subscriptions.
- [x] `BbbPlatformCapacityPolicy` entity and Portal Admin API — `upsertPlatformCapacityPolicy`, `platformCapacityPolicies`, `effectiveCapacityPolicy`.
- [x] Plan-based capacity tiers — Starter 50 / Growth 200 / Enterprise 500 default room capacity, represented as policy data rows keyed by `subscriptionPlanId`, not hard-coded control-flow branches.
- [x] `BbbRoom.maxParticipants` policy enforcement — effective policy resolved on room creation; tenant value may not exceed the policy ceiling. Zero policy rows preserve legacy INV-014 behaviour.
- [x] `BbbOrganization.maxParticipantsPerMeeting` write-through policy cache — synchronized from effective policy during organization creation / room provisioning.
- [x] Portal Admin capacity-policy dashboard and infrastructure permission boundary.
- [x] `BbbCapacityGrant.sourceType` discriminator and subscription-sourced grants on `SubscriptionRenewedEvent`.
- [x] Monthly subscription invoice-generation path — current implementation publishes `SubscriptionInvoicePaidEvent` from the renewal worker; provider-backed settlement is the Juspay work below.

### Juspay recurring billing — implementation complete; production gates pending

- [x] Step 0 — BuyLits reference analysis (`reference/buylits/`; port patterns, not files).
- [x] Step 1 — vestigial Juspay surface inventory and subscription-aware integration seam.
- [x] Step 2 — `JuspaySubscriptionMandate`, `JuspayPaymentAttempt` (INV-019), `JuspayWebhookEvent`, `JuspayWebhookEndpoint`, reconciliation incident record; migrations generated/applied.
- [x] Step 2 — renewal CLAIM CAS → attempt → charge → FINALIZE CAS state model.
- [x] Step 2 — mandate cardinality and payment-attempt channel isolation.
- [x] **Step 3 — webhook ingestion** — fail-closed Basic Auth + HMAC, raw-body verification, persist-before-process, BullMQ processing, idempotent existing-attempt reconciliation, and per-tenant endpoint routing.
- [x] **Step 4 — recurring charge implementation** — SDK boundary, mandate charge initiation, asynchronous `initiated` semantics, webhook-authoritative terminal result, success finalization, failure `past_due`, and reconciliation incident handling.
- [x] **Step 5 — Portal Admin billing surface** — read-only mandate status, payment-attempt ledger, webhook/reconciliation incidents, operational filters.
- [x] **Step 6 — production hardening** — encrypt stored webhook credentials, final secrets review, production credential validation, regression/e2e coverage.
- [ ] **Provider-contract verification gate** — verify exact sandbox/live mandate, charge, webhook event, signature, idempotency, retry, order-ID and transaction-ID contracts before production use.

### Remaining Phase 2 product/platform work

- [x] `NavigationMenu` entity in CMS — entity, service, migration generated/applied
- [x] Banner BullMQ scheduling (CMS-002) — banner-activator task registered (BUG-005)
- [x] Dunning flow — scheduled task with retry schedule + auto-cancellation (RFC-001 §4.2)
- [ ] Tenant onboarding flow in storefront
- [ ] Custom domain routing via Caddy

---

## Phase 3 — Marketplace & Retention

> **Status framing (verified against code 2026-08):** the *projection layer* of `MarketplaceIndexerPlugin` is implemented (ES indices, BullMQ queue, event listener, public `marketplaceSearch` with bayesian + sponsored function-score). The *business layer* (attribution, commission) and *aggregation surfaces* (academy page, category taxonomy, ranking view) are unimplemented. Ad-entity tables are migrated (Gate 1.1 ✅) but the advertising feature layer is unwired. See `docs/implementation/phase3-audit.md` for the verified capability table.

### Phase 3A — Discovery correctness (current gate)

- [x] **Latent defect closure:** migration `1788265440266-MarketplaceAdEntities` generated via Vendure CLI, applied, and PostgreSQL-verified (`marketplace_ad_campaign`, `ad_wallet`, `ad_spend_ledger` — schemas match entity definitions; tables previously existed out-of-band, see `phase3-audit.md` F2). AdSpendLedger immutability service-level test still pending.
- [x] `MarketplaceIndexerPlugin` projection infrastructure — ES indices, BullMQ queue, event listener, public search resolver *(code-verified; e2e coverage pending)*
- [x] Canonical marketplace document contract — `customDomain` added to both documents + ES mappings (F3/Gate 1.2); session `subjectTags` sourced from new `BbbScheduledSession.subjectTags` column via migration `1788266256055` (F4/Gate 1.3); instructor tags from `expertiseAreas`. `MarketplaceCategory` entity deferred until category-browsing UI exists. Field→event matrix still pending (Gate 1.4)
- [x] **Public-index leak fix (F7):** `indexSession()` gates on `visibility === 'PUBLIC'` + `status IN ('SCHEDULED','LIVE')`, removing non-conforming documents
- [x] Projection completeness (Gate 1.4): field→event matrix codified in `phase3-audit.md`; session lifecycle events added (`SessionCreated/Updated/Started/CancelledEvent`) + `updateBbbScheduledSession` mutation; `TenantProfileUpdatedEvent` published on academy profile update → bulk channel reindex; review aggregate transitions (approved/rejected/hidden) → affected-session reindex. ⚠️ Two matrix rows remain open: `BbbOrganizationUpdatedEvent` (org-edit API doesn't exist) and campaign-lifecycle triggers (Phase 3C)
- [x] E2E suite (Gate 1.5, **infrastructure-gated**: `MARKETPLACE_E2E=true` fails unless PG + Redis + ES are all reachable — no silent fallback): multi-channel indexing + channel-free `marketplaceSearch` + F7 removal cases (PUBLIC→PRIVATE, SCHEDULED→CANCELLED) + sponsored/bayesian ordering + tenant isolation + **AdSpendLedger immutability (INV-010)**. **All 7 tests pass** (`commit 2e74020` + follow-up) — unblocked by the BUG-033 root-cause fix (`requireVerification:false` in the e2e harness; see `known-bugs.md`).
- [ ] `MarketplaceAcademyPage` — aggregated view (projection only — never a second tenant-profile DB)
- [ ] `MarketplaceCategoryIndex` — subject taxonomy as data (`MarketplaceCategory` entity), not hardcoded in resolver
- [ ] `RankingMaterializedView` (Postgres) — ranking inputs computed in PG, consumed by ES documents

### Phase 3B — Attribution & Commission

- [x] **Attribution ADR + signed `marketplaceRef` mechanism** - shipped (`750da49`); resolver/listener/migration/e2e remain. — resource referred to (session/academy/result), validity window, navigation persistence (marketplace → academy → different session), precedence vs existing direct/referral attribution, order vs order-line attachment, replay prevention, verification without exposing signing secrets to Next.js; contract settled in ADR-021 addendum.
- [ ] `Order.customFields.orderSource` — `'marketplace' | 'direct' | 'referral'`, stamped **server-side** by Vendure from a signed referrer signal (INV-008; storefront never classifies)
- [ ] **Task 16**: `CommissionLedger` $0-row pattern — entity, service, listener, `MARKETPLACE_COMMISSION_PERCENT` env var, append-only; entity+subscriber shipped (`584530b`); service/listener/migration/e2e pending (INV-002/DL-030)
- [ ] Commission reconciliation/admin reporting

### Phase 3C — Advertising (Stream 3)

- [x] `MarketplaceAdCampaign` + `AdSpendLedger` + `AdWallet` entities *(code exists; blocked on Phase 3A migration)*
- [ ] `AdWalletLedger` — append-only wallet transactions (entity does not exist yet; plugin-map previously listed it as owned — corrected)
- [ ] Wire `MarketplaceAdService` end-to-end: campaign lifecycle → wallet debit → `AdSpendLedger` (INV-010: ledger is truth, `spentInPaise` is cache)
- [ ] `Banner.scope: 'tenant' | 'marketplace'` discriminator
- [ ] Configurable, bounded sponsored bid-boost (replace hardcoded `weight: 3.0` in search resolver)
- [ ] Self-serve campaign dashboard

### Phase 3D — Engagement & Retention

- [ ] Review → ranking projection pipeline (review approved → aggregate recalculated → marketplace index updated)
- [ ] Elasticsearch instructor/course search refinement
- [ ] Attendance analytics dashboard
- [ ] Certificate generation on `Entitlement` completion
- [ ] `bbbSession` CMS section type (CMS-004)
- [ ] `ArticleEvent` / `PageEvent` → Elasticsearch indexer

### Phase 3 Exit Criteria

- [ ] Marketplace discovery is cross-channel but read-only (INV-009)
- [ ] Every marketplace result resolves to the correct academy storefront (redirect contract verified in e2e, not just release notes)
- [ ] Marketplace orders are server-classified (INV-008)
- [ ] Every marketplace order creates an immutable commission fact (DL-030)
- [ ] Advertising spend is ledger-backed (INV-010)
- [ ] Sponsored ranking cannot corrupt organic ranking (ADR-022)
- [ ] Review changes propagate into ranking deterministically
- [ ] Tenant isolation e2e passes

---

## Phase 4 — Scale & Premium

- [ ] White-label theming via `TenantProfile.theme`
- [ ] TimescaleDB for BBB event-heavy analytics
- [ ] AI features (meeting summary, CMS content writer, review summarisation)
- [ ] Multi-BBB-server geographic routing
- [ ] Student Corner (CMS-native)
- [ ] Cross-academy placement network
- [ ] 3CX telephony bridge for academy CRM

---

## Deferred / Tracked Items

**Storefront channel-isolation cache gaps** (`nextjs-starter-vendure`)
- [ ] `getActiveChannelCached()` / `getAvailableCountriesCached()` still resolve channel token from env-var fallback, not per-request header.
- [ ] `cart.tsx` private cache tags do not include a channel dimension; lower risk because the scope is per-user.

**Storefront template contract Phase A — ESLint guardrail** (`nextjs-starter-vendure`)
- [ ] §4a lint guardrail remains unimplemented. Land the mechanical channel-isolation checks before expanding storefront onboarding.

**Customer-deletion e2e (Flow A/B)**
- [ ] The BUG-033 login/auth blocker is fixed, so Flow A/B now execute. Remaining: (1) Flow B fixture persists non-numeric `roomId`/`scheduledSessionId` into integer FK columns; (2) Flow A "BBB entitlements deactivated" assertion. Production code is TypeScript-verified.

**Development infrastructure verification**
- [ ] Local PostgreSQL tunnel (`127.0.0.1:5435`) and Redis tunnel (`127.0.0.1:6385`) must be reachable before runtime verification. If either is unavailable, the application intentionally falls back to pg-mem / `DefaultJobQueuePlugin`; that fallback is suitable for development diagnostics, not production verification.
