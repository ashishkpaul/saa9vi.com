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

### P0 — Critical Bugs (block tenant onboarding)

- [ ] **BUG-022**: Fix `bbbRoomStatus`, `myBbbRooms`, `myBbbEnrollments` to read from `BbbEntitlement` in addition to `BbbEnrollment`
- [ ] **BUG-023**: Fix `MarketplaceIndexerService` to populate `academySlug` from `BbbOrganization.slug`, `channelToken` from `Channel.token`, and index `TenantProfile.customDomain`

### Remaining Blockers

- [ ] Run FEAT-002 schema migration (`npx vendure migrate create && npx vendure migrate up`)
- [ ] Build Next.js storefront pages for public instructor profiles and CMS pages
- [ ] Email verification flow for new tenant administrators
- [ ] Auto-provision `ShippingMethod`, `StockLocation`, and `PaymentMethod` for new channels (BUG-024)
- [ ] End-to-end customer deletion flow tested across all three plugins
- [ ] Load estimation ratios tuned from first 2 weeks of `BbbUsageLedger` data
- [ ] BUG-017 remediation — add `ChannelAware` to `ProductReview`

### Completed

- [x] `BbbEntitlement` entity + service for `bbb_session` access checks
- [x] `BbbMeetingService.joinRoom()` migrated to `BbbEntitlement` for room access
- [x] Elasticsearch indexing for instructors (`InstructorIndexerService`)
- [x] `BbbEntitlement` admin UI (GraphQL queries/mutations + dashboard route)
- [x] Scheduled Sessions admin UI
- [x] FEAT-001 (`BbbOrganizationMembership`) — code complete
- [x] FEAT-002 (`internal_overhead` capacity grant) — code complete, migration pending
- [x] `myLearningDashboard` Shop API query
- [x] Rate limiting on `registerNewTenant` mutation
- [x] Custom domain → channel token Redis mapping

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
