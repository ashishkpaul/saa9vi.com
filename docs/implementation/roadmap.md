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
- [x] **End-to-end customer deletion test** — `customer-deletion.e2e-spec.ts` covering Flow A + Flow B across BBB/Tenant/Reviews
- [x] **Load estimation ratios tuning** — PILOS ratios configurable via `BigBlueButtonPluginOptions` + env vars

---

## Phase 2 — Subscription Billing & Capacity Policy

- [ ] `SubscriptionPlan` and `OrganizationSubscription` entities
- [ ] `BbbPlatformCapacityPolicy` entity — platform-level BBB capacity limits controlled by Portal Admin
- [ ] Plan-based capacity tiers (Starter: 50, Growth: 200, Enterprise: 500 default room capacity)
- [ ] `BbbRoom.maxParticipants` set from policy default on creation, tenant can increase up to `maxRoomCapacity`
- [ ] `BbbOrganization.maxParticipantsPerMeeting` becomes denormalized cache of policy limit
- [ ] Portal Admin dashboard for capacity policy management
- [ ] `BbbCapacityGrant.sourceType` discriminator
- [ ] Monthly invoice generation job
- [ ] Juspay recurring billing integration
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
