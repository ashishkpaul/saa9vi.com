# Roadmap

> **Purpose:** Track future work only. Organized by phase. When work is completed, move it to release-notes.md.

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

**Status:** Complete (2026-08-23). All remaining blockers resolved.

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
- [x] **FEAT-002 schema migration** — verified already applied (Vendure CLI: no schema changes; `sourceType` + `isUnbounded` confirmed in DB)
- [x] **Next.js public instructor/CMS pages** — CMS page route (`/[locale]/page/[slug]`) added; instructor page already existed
- [x] **Email verification for tenant admins** — `verifyTenantAdmin` Shop API mutation + unverified admin creation
- [x] **End-to-end customer deletion test** — `customer-deletion.e2e-spec.ts` covering Flow A + Flow B across BBB/Tenant/Reviews. **⚠ 2 Flow A tests remain blocked** by a test-harness auth issue (Shop API customer session doesn't resolve tenant channel in the isolated e2e schema); production paths correct + TS-verified. Tracked separately (see Phase 2 — deferred).
- [x] **Load estimation ratios tuning** — PILOS ratios configurable via `BigBlueButtonPluginOptions` + env vars

---

## Phase 2 — Subscription Billing & Capacity Policy

- [x] `SubscriptionPlan` and `OrganizationSubscription` entities — implemented via `SubscriptionPlugin` (`src/plugins/subscription/`); platform-global plan catalogue + channel-scoped org subscriptions (ADR-003 dual pattern). Admin API: `subscriptionPlans`, `organizationSubscriptions`, `createSubscriptionPlan`, `updateSubscriptionPlan`. Migration `1787547472479` generated + applied via Vendure CLI.
- [x] `BbbPlatformCapacityPolicy` entity — platform-level BBB capacity limits controlled by Portal Admin. Admin API: `upsertPlatformCapacityPolicy`, `platformCapacityPolicies`, `effectiveCapacityPolicy`.
- [x] Plan-based capacity tiers (Starter: 50, Growth: 200, Enterprise: 500 default room capacity) — implemented as DATA rows on `BbbPlatformCapacityPolicy` keyed by `subscriptionPlanId` (`PLAN_TIER_DEFAULTS` in `bbb-platform-capacity-policy.service.ts` records the ADR-031 table for seeding/dashboard presets). Tier values are Portal-Admin-created policy rows, not code branches.
- [x] `BbbRoom.maxParticipants` set from policy default on creation, tenant can increase up to `maxRoomCapacity` — `BbbRoomService.create()` resolves effective policy (plan-matched → platform-default → fallback) and clamps; **opt-in adoption**: with zero policy rows, legacy INV-014 behavior is preserved. Admin API: `upsertPlatformCapacityPolicy`, `platformCapacityPolicies`, `effectiveCapacityPolicy` (Portal infrastructure permission).
- [x] `BbbOrganization.maxParticipantsPerMeeting` becomes denormalized cache of policy limit — write-through sync on org creation and on room provisioning (`syncOrganizationCache`, cache = effective `maxRoomCapacity` so INV-014's rejection criterion still holds).
- [x] Portal Admin dashboard for capacity policy management — UI routes added to platform-dashboard, API implemented.
- [x] **`BbbCapacityGrant.sourceType` discriminator** — column + union type exist (FEAT-002); `BbbSubscriptionListener` now idempotently writes `sourceType: "subscription"` grants upon `SubscriptionRenewedEvent`.
- [x] Monthly invoice generation job — simulated via `SubscriptionInvoicePaidEvent` publication in the `SubscriptionRenewalService` background worker.
- [ ] Juspay recurring billing integration — **not greenfield:** generated Shop/Admin types already expose `initiateJuspaySession`, `cancelJuspaySession`, `JuspaySessionResult`, `QueryJuspayOrderStatus`, but with **no handwritten schema, resolver, or service** (vestigial generated-only surface). Build entities + state machine first (testable without money movement), then Juspay webhook ingestion following the INV-004 persist-before-process shape reused from `BbbWebhookEvent`; reconcile the vestigial generated surface.
- [ ] Tenant onboarding flow in storefront
- [ ] `NavigationMenu` entity in CMS
- [ ] Banner BullMQ scheduling (CMS-002)
- [ ] Custom domain routing via Caddy

---

## Phase 3 — Marketplace & Retention

### Prerequisites

- [ ] **Task 16**: `CommissionLedger` $0-row pattern — entity, service, listener, `MARKETPLACE_COMMISSION_PERCENT` env var

### Discovery Layer

- [ ] `MarketplaceIndexerPlugin` — event-driven BullMQ jobs (scaffold complete)
- [ ] `MarketplaceSearchResolver` (Shop API, no channel context)
- [ ] `MarketplaceAcademyPage` — aggregated view
- [ ] `MarketplaceCategoryIndex` — subject taxonomy
- [ ] `RankingMaterializedView` (Postgres)

### Attribution & Commission

- [ ] `Order.customFields.orderSource` — `'marketplace' | 'direct' | 'referral'`
- [ ] `CommissionLedger` — append-only commission records

### Advertising (Stream 3)

- [ ] `MarketplaceAdCampaign` + `AdSpendLedger` entities
- [ ] `AdWallet` + `AdWalletLedger` — prepaid wallet per academy
- [ ] `Banner.scope: 'tenant' | 'marketplace'` discriminator
- [ ] Elasticsearch bid-boost for sponsored sessions
- [ ] Self-serve campaign dashboard

### Engagement & Retention

- [ ] Review entity with composite ranking materialised view
- [ ] Elasticsearch instructor/course search
- [ ] Attendance analytics dashboard
- [ ] Certificate generation on `Entitlement` completion
- [ ] `bbbSession` CMS section type (CMS-004)
- [ ] `ArticleEvent` / `PageEvent` → Elasticsearch indexer

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

> **Purpose:** Consciously-deferred work that was flagged for tracking but not yet scheduled into a phase. Kept visible so it isn't silently carried across releases. Status: **open.**

**Storefront channel-isolation cache gaps** (`nextjs-starter-vendure`)
- [ ] `getActiveChannelCached()` / `getAvailableCountriesCached()` (`lib/vendure/cached.ts`) still resolve channel token from env-var fallback, not per-request header. Fix pattern already established in the same file (dynamic-outer / cached-inner split used for product, collection, layout data).
- [ ] `cart.tsx`'s `'use cache: private'` block tags only `cacheTag('cart')` — no channel dimension. Lower risk (private scope is per-user) but should align with the rest of the caching strategy.

These are the same channel-isolation class as BUG-031 / INV-001. **Why tracked here:** new subscription-billing data paths should be built against a codebase where the channel-cache pattern is 100% consistent (not 90%).

**Storefront template contract Phase A — ESLint guardrail** (`nextjs-starter-vendure`)
- [ ] The Storefront Template Contract's §4a lint guardrail (two ESLint rules) is unimplemented: `eslint.config.mjs` is still just Next.js defaults (`eslint-config-next/typescript`), no custom rules. **Sequence:** land the §4a rules *before* the Phase 2 "Tenant onboarding flow in storefront" surface work, so new storefront surface area is protected by the mechanical channel-isolation checks first. See `nextjs-starter-vendure/docs/adr/storefront-template-contract.md` (cross-repo; the backend's `docs/what-next.md` points to it).

**Blocked Flow A e2e tests** (tracked ticket)
- [ ] 2 Flow A tests in `customer-deletion.e2e-spec.ts` remain blocked by a test-harness auth issue (Shop API customer session doesn't resolve tenant channel in the isolated e2e schema). Production code is correct + TypeScript-verified. Deferred so it doesn't become silently permanent once Phase 2 attention moves elsewhere.
