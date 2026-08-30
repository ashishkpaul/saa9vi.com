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

**Status:** Complete (2026-08-23). All remaining blockers resolved except the explicitly deferred Flow A e2e harness issue.

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
- [x] **End-to-end customer deletion test** — covers Flow A + Flow B across BBB/Tenant/Reviews. **2 Flow A tests remain blocked** by a test-harness auth issue; production paths are correct + TypeScript-verified.
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
- [ ] **Provider-contract verification gate** — verify exact sandbox/live mandate, charge, webhook event, signature, idempotency, retry, order-ID and transaction-ID contracts before production use.
- [ ] **Step 5 — Portal Admin billing surface** — read-only mandate status, payment-attempt ledger, webhook/reconciliation incidents, operational filters.
- [ ] **Step 6 — production hardening** — encrypt stored webhook credentials, final secrets review, production credential validation, regression/e2e coverage.

### Remaining Phase 2 product/platform work

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

**Storefront channel-isolation cache gaps** (`nextjs-starter-vendure`)
- [ ] `getActiveChannelCached()` / `getAvailableCountriesCached()` still resolve channel token from env-var fallback, not per-request header.
- [ ] `cart.tsx` private cache tags do not include a channel dimension; lower risk because the scope is per-user.

**Storefront template contract Phase A — ESLint guardrail** (`nextjs-starter-vendure`)
- [ ] §4a lint guardrail remains unimplemented. Land the mechanical channel-isolation checks before expanding storefront onboarding.

**Blocked Flow A e2e tests**
- [ ] 2 tests remain blocked by the isolated-e2e Shop API customer-session/channel-resolution harness issue. Production code is TypeScript-verified.

**Development infrastructure verification**
- [ ] Local PostgreSQL tunnel (`127.0.0.1:5435`) and Redis tunnel (`127.0.0.1:6385`) must be reachable before runtime verification. If either is unavailable, the application intentionally falls back to pg-mem / `DefaultJobQueuePlugin`; that fallback is suitable for development diagnostics, not production verification.
