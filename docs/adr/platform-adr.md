# Architecture Decision Record (Legacy)

> **This document has been refactored.** The enduring architectural decisions have been moved to `docs/architecture/platform-adr.md`. Implementation status, bugs, and roadmap have been moved to `docs/implementation/`.

## What moved where

| Content | New Location |
|---|---|
| Architectural decisions (ADR-001 through ADR-030) | `docs/architecture/platform-adr.md` |
| Invariants (INV-001 through INV-013) | `docs/architecture/invariants.md` |
| Domain model (entities, relationships, lifecycles) | `docs/architecture/domain-model.md` |
| Plugin map (ownership, events, API surfaces) | `docs/architecture/plugin-map.md` |
| Runtime flows (event-driven service interactions) | `docs/architecture/runtime-flow.md` |
| Platform story (capability-based actor lifecycles) | `docs/product/platform-story.md` |
| Glossary (domain term definitions) | `docs/product/glossary.md` |
| Roadmap (future work by phase) | `docs/implementation/roadmap.md` |
| Known bugs (active and fixed) | `docs/implementation/known-bugs.md` |
| Release notes (completed work, chronologically) | `docs/implementation/release-notes.md` |
| Development prompt (priority order) | `docs/what-next.md` |

## Why

The original `platform-adr.md` had grown to mix architecture, changelog, bugs, roadmap, and implementation status in a single file. This made it hard to maintain and caused drift between sections. The new structure separates concerns so each document has a single, clear purpose.

> **Changelog v1.1–v1.6 (condensed):**
>
> | Version | Summary |
> |---|---|
> | v1.1 | Full audit vs. `bigbluebutton-plugin`, `cms-plugin`, `tenant-plugin`. Status fields matched to real implementation; 4 divergences (DIV-001–004) documented. |
> | v1.2 | Code-verified corrections: `convertTrialToEnrollment` path added (AC-003); EventBus table corrected (`RoomActivatedEvent` live, `TrialAttendanceRecordedEvent` future); cipher corrected to AES-256-GCM. BUG-015 (banner queue gap) and SEC-001 (Admin API isolation) added. |
> | v1.3 | Audit extended to `reviews` plugin (4th plugin). DIV-009/010, BUG-016 (`navSections.items` TS-2353), BUG-017 (reviews channel scoping) added. §5A Dashboard Extension Pattern and ADR-013 (Frontend Independence) added. DL-015/016 added. |
> | v1.4 | Archetype B (Internal Staff Meeting) integrated as §8A. FEAT-001 (`BbbOrganizationMembership`) and FEAT-002 (Overhead Capacity Grant) tracked as Phase 1.5 blockers. BUG-018 added. DL-017/018 added. |
> | v1.5 | Phase 3 Marketplace architecture locked: platform-level ES index, `orderSource` attribution, `MarketplaceIndexerPlugin`, `BayesianRatingService`; multivendor-plugin rejected (DL-019). Three-stream revenue model locked. FEAT-003/004 added. INV-009/010 added. DL-019–022 added. ADR-014 added. |
> | v1.6 | Capacity Intelligence System *designed* (§6A, CI-001–006) — `CapacityIntelligenceService`, 48h PILOS-based load forecast, `poolCapacityDashboard`, `BbbCapacityAlertLog`, `capacity-alert` job. INV-012 (advisory-only) and DL-025 added. BUG-019/020 fixed. DL-026/027 added. |
> | v1.7 | Code audit pass: FEAT-001/FEAT-002 status corrected to code-complete; Capacity Intelligence corrected to "Designed, not implemented"; plugin inventory expanded to 6; instructor ES indexing status corrected; §6A/§2B moved to correct TOC positions. |
> | v1.8 | BUG-015/CMS-002 fixed (banner-activator job). INV-013 (customer deletion) added. Tenant Registration System added. BUG-021 fixed. Status fields updated throughout. |
>
> **What changed in v1.10 (this revision):** (1) **Tenant Registration System** code quality pass — all `console.log` calls replaced with `Logger.debug(loggerCtx)` in `TenantRegistrationService` and `TenantShopResolver`. Full-input JSON dump (which logged plaintext email addresses) removed. (2) **Manual Administrator path documented** — added NOTE comment explaining why the repository-level Administrator creation path is kept (`checkActiveUserCanGrantRoles` limitation with new channels), with a flag that it'll need updating on Vendure upgrades. (3) **TS error fixed** — `channelResult.code` access moved after `'id' in channelResult` type guard so TypeScript correctly narrows the union type to `Channel`.
>
> **What changed in v1.9 (this revision):** (1) **Capacity Intelligence System** status updated from "Designed" to "Implemented" — CI-001 through CI-006 all code-complete, migrated, and verified. (2) **MarketplaceIndexerPlugin** status updated — all Phase 3 gaps closed (sponsored listing bid-boost, Bayesian rating, price from ProductVariant, ProductVariantEvent subscription, BullMQ job queue, Product custom fields). (3) **PlatformDashboardPlugin** added — Saa9vi login branding layer with CSS override for Vendure core branding footer (ADR-016). (4) **Phase Roadmap** updated — Phase 1.5 blockers corrected to reflect current state (myLearningDashboard, GrantReaderService, rate limiting, custom domain Redis mapping all done). (5) **ADR-017 (Observability Architecture)** added — formalizes correlation tracing, event causality validation, and runtime invariant monitoring. (6) **Phase 1.6 (Live Classroom Experience)** added to roadmap — elevates Scheduled Sessions follow-ups to a dedicated phase before subscriptions.
>
> **What changed in v1.10 (this revision):** (1) **BUG-022 (Entitlement/Enrollment read mismatch)** — code-audit discovered that `bbbRoomStatus`, `myBbbRooms`, and `myBbbEnrollments` read from `BbbEnrollment` only, while `BbbOrderFulfillmentListener` writes `BbbEntitlement` for room purchases. A paying customer's room never appears in their dashboard and `bbbRoomStatus` throws `ForbiddenError`, even though `bbbJoinRoom` would work. Documented as P0. (2) **BUG-023 (Marketplace indexer broken redirect fields)** — `academySlug` hardcoded to `''`, `channelToken` set to raw `channelId` instead of `Channel.token`, `customDomain` not indexed. Marketplace search results have no usable redirect URL. (3) **BUG-024 (Auto-provisioning gap expanded)** — `ShippingMethod`/`StockLocation` gap confirmed still open; `PaymentMethod` added to the same list since a freshly registered tenant has zero working payment methods. (4) **AC-002 corrected** — `BbbOrderFulfillmentListener` room product path now writes `BbbEntitlement { type: bbb_room }`, not `BbbEnrollment`. The legacy `bbbFulfillmentHandler` still writes `BbbEnrollment` + `BbbCapacityGrant` as a parallel path. (5) **Phase Roadmap** updated — BUG-022 and BUG-023 added as Phase 1.5 blockers.

---

## Table of Contents

1. [Platform Context](#1-platform-context)
2. [Non-Negotiable Architectural Invariants](#2-non-negotiable-architectural-invariants)
2A. [Code Audit Divergences](#2a-code-audit-divergences-v10--v12)
2B. [Phase 3 Architectural Invariants](#2b-phase-3-architectural-invariants)
3. [Plugin Architecture & Bounded Contexts](#3-plugin-architecture--bounded-contexts)
4. [Data Layer Decisions](#4-data-layer-decisions)
5. [Commerce & Access Control](#5-commerce--access-control)
5A. [Dashboard Extension Pattern](#5a-dashboard-extension-pattern)
6. [BBB Integration Architecture](#6-bbb-integration-architecture)
**[6A. Capacity Intelligence Architecture](#6a-capacity-intelligence-architecture)**
7. [CMS Architecture](#7-cms-architecture)
7A. [Reviews Plugin Architecture](#7a-reviews-plugin-architecture)
8. [Tenant & Academy Layer](#8-tenant--academy-layer)
8A. [Internal Operations Architecture](#8a-internal-operations-architecture)
9. [Event & Job Queue Architecture](#9-event--job-queue-architecture)
10. [Security Architecture](#10-security-architecture)
11. [Infrastructure & Deployment](#11-infrastructure--deployment)
12. [Known Bugs & Immediate Remediation](#12-known-bugs--immediate-remediation)
13. [Production Readiness Checklist](#13-production-readiness-checklist)
14. [Phase Roadmap](#14-phase-roadmap)
**[ADR-013: Frontend Independence & API Evolution](#adr-013-frontend-independence--api-evolution)**
**[ADR-014: Revenue Model & Marketplace Architecture](#adr-014-revenue-model--marketplace-architecture)**
15. [Decision Log](#15-decision-log)

---

## 1. Platform Context

### What Saa9vi Is

Saa9vi is a **multi-tenant education commerce platform** targeting Indian coaching institutes, tutors, trainers, and academies. It is not a course marketplace clone. It is an **Education Business Operating System** — the single platform through which an educator runs their live classes, sells courses, manages students, and acquires new ones via marketplace discovery.

### Technology Foundation

| Layer | Technology |
|---|---|
| Commerce backend | Vendure 3.x (NestJS + TypeORM + GraphQL) |
| Database | PostgreSQL |
| Job queue | BullMQ via `@vendure/job-queue-plugin` |
| Cache | Redis |
| Search | Elasticsearch 9.x |
| Admin UI | Vendure React Dashboard (`@vendure/dashboard`) |
| Storefront | Next.js |
| Live classes | BigBlueButton (self-hosted) |
| Payments | Juspay |

### Plugin Inventory (current)

| Plugin | Purpose | Status |
|---|---|---|
| `BigBlueButtonPlugin` | Live class infrastructure | Production-near |
| `CmsPlugin` | Articles, pages, banners | Beta |
| `TenantPlugin` | Tenant profiles, instructors, media | Beta |
| `ReviewsPlugin` | Product reviews, moderation, fraud detection, reputation aggregation | Beta |
| `LoadSimulationPlugin` | Causal drift / load-test observability (BUG-006) | Production-near — Admin API only, Shop API vector closed (BUG-019) |
| `MarketplaceIndexerPlugin` | Phase 3 cross-channel Elasticsearch discovery layer | Production-ready projection layer — platform-level instructor/session discovery indexes, ranking, sponsored listing support |
| `PlatformDashboardPlugin` | Saa9vi login branding — replaces Vendure logo, welcome message, and footer on the login page | Live — `login.logo`, `login.beforeForm`, `login.afterForm` customized via `defineDashboardExtension` |

*Corrected in v1.7 — all six were registered in `vendure-config.ts` but only four appeared in this table. PlatformDashboardPlugin added in v1.9.*

---

## 2. Non-Negotiable Architectural Invariants

These rules are load-bearing. Violating any one of them requires a full data migration to fix.

### INV-001: Channel = Tenant. One identity system.

```
Channel (Vendure core)
    ↕  1:1
TenantProfile (TenantPlugin)
    ↕  1:1
BbbOrganization (BigBlueButtonPlugin)
    ↕  1:1
Seller (Vendure core — Phase 3)    ← platform Seller entity linked to TenantProfile
```

Every entity that is tenant-scoped **must** implement `ChannelAware` and be persisted via `channelService.assignToCurrentChannel(entity, ctx)` before the first `save()`. Every read against a channel-scoped entity **must** use `ListQueryBuilder` with `RequestContext` or `findOneInChannel`.

**Exceptions documented in the Decision Log (DL-010, DL-011):** `InstructorProfile` and `BbbEntitlement` use scalar `channelId` without full `ChannelAware` implementation. All service methods for these entities must include explicit `channelId` WHERE clauses on every query — this is verified in the code audit.

**Rejection criterion:** Any PR introducing a `tenantId` column that is not `ctx.channelId` is rejected without review.

**Rationale:** Vendure's `RequestContext` carries the active `channelId`. `ListQueryBuilder` and `TransactionalConnection.findOneInChannel` automatically filter by this channel. A parallel identity system creates two sources of truth that drift in production under concurrent writes.

### INV-002: Every billing fact is an immutable ledger row.

`BbbUsageLedger` rows are never updated. Never deleted. The source of billing truth is always `SUM(consumedMinutes) WHERE organizationId = X AND period`. Meeting state columns (`BbbMeeting.durationMinutes`) are operational convenience fields, never the authoritative billing source.

**Rejection criterion:** Any service method that calls `.update()` on a `BbbUsageLedger` row is rejected.

### INV-003: One access-control system via Entitlement.

All access to paid content — live sessions, recorded courses, workshops, coaching packages — is gated through a single `Entitlement` entity with a uniform `hasAccess(ctx, customerId, type, resourceId)` interface.

**Current status:** `BbbEntitlement` entity and `BbbEntitlementService` are live. The entity supports `bbb_session` and `bbb_room` types with scalar `channelId` (non-ChannelAware). The service provides idempotent `create()`, `hasAccess()`, and `delete()` methods. No admin UI yet. `BbbEnrollment` remains as the legacy room-access path.

**Rejection criterion:** Any new entity named `*Enrollment` or `*Access` that is not `BbbEnrollment` backward-compatibility is rejected.

### INV-004: Webhooks are persisted before processing.

BBB webhooks are idempotent events from an external system. The correct pattern is:

```
POST /bbb/webhook
  → validate HMAC signature
  → persist BbbWebhookEvent { eventType, payload, receivedAt, status: PENDING }
  → enqueue BbbWebhookEvent.id to BullMQ
  → return { ok: true }

BullMQ processor
  → fetch BbbWebhookEvent by id
  → run handleWebhookEvent()
  → update BbbWebhookEvent.status to PROCESSED | FAILED
```

**Current status:** ✅ Implemented and code-verified. `BbbWebhookController` persists events via `BbbWebhookEvent` then enqueues to `bbb-webhook-processor` BullMQ queue. `BbbWebhookProcessorService` loads events, delegates to `BbbMeetingService.handleWebhookEvent()`, and marks `PROCESSED` or `FAILED`. Failed events remain queryable for replay.

**Rejection criterion:** Any webhook controller that calls a service method before persisting the raw event is rejected.

---

## 2A. Code Audit Divergences (v1.0 → v1.2)

The following divergences were found between ADR v1.0 and the plugin code, and corrected across v1.1 and v1.2.

| ID | Location | Earlier ADR Said | Code Reality | Resolution |
|---|---|---|---|---|
| DIV-001 | `constants.ts` `MEETING_STATE` | `STALE` state required before production | `STALE` is **absent** from `MEETING_STATE` map and transition table | **Pending fix** — BUG-012 / BB-002 |
| DIV-002 | `BbbServerSelectionService` | Score = `activeMeetingCount × avgParticipants` (15-min rolling window) | Score = `server.currentLoad` (opaque integer set externally) | **Accepted** — abstraction is superior; documented as DL-014 |
| DIV-003 | `BbbReconciliationService` | `CapacityExhaustedEvent` published when `billingCapped = true` | Event class added and publisher wired | **Fixed** — BUG-013 / BB-004 |
| DIV-004 | Dashboard `index.tsx` | `BbbEntitlement` admin UI implied as Phase 1 | No entitlement route registered | **Accepted** — deferred to Phase 1.5 |
| DIV-005 | `BbbEncryptionService` | Cipher referred to as "AES-GCM" | Code comments explicitly state **AES-256-GCM** | **Corrected** in v1.2 — SEC-003, INF-002 |
| DIV-006 | `BbbAdminResolver` / `TrialRegistrationService` | AC-003 omitted the trial→enrollment conversion path | `convertTrialToEnrollment` exists and routes to `BbbEnrollment` via `trial_conversion` source | **Added** in v1.2 — AC-003 |
| DIV-007 | EventBus event table | `TrialAttendanceRecordedEvent` listed as live/pending | No publisher exists yet; `RoomActivatedEvent` was live but omitted | **Corrected** in v1.2 — EQ-002 |
| DIV-008 | `CmsPlugin` / `BannerService` | Banner queue gap not tracked | `banner-activator`/`banner-deactivator` queues unregistered | **Added** in v1.2 — BUG-015 / CMS-002 |
| DIV-009 | `ReviewsPlugin` / `dashboard/index.tsx` | Not previously audited | `navSections` entry used `items: [...]` property which does not exist on `DashboardNavSectionDefinition` — TS-2353 compile error, Reviews menu invisible | **Fixed** in v1.3 — BUG-016. Removed `items`, added `navMenuItem` on each route. Root cause was also missing `ReviewAdmin` permission registration in plugin configuration (matched BBB pattern). |
| DIV-010 | `ReviewsPlugin` entities | Not previously audited | `ProductReview`, `ReviewRequest`, `ReviewReport`, `ReviewReward`, `ReviewVote` do not implement `ChannelAware`. Channel isolation achieved via `ctx.channel.token` string comparison in service queries — no ORM-level enforcement | **Added** in v1.3 — BUG-017. Scheduled for remediation before multi-tenant production |

---

## 2B. Phase 3 Architectural Invariants

### INV-009: Marketplace Indices Are Read Projections. No Marketplace Write Bypasses Channel Context.

The platform-level Elasticsearch indices (`saa9vi_marketplace_sessions`, `saa9vi_marketplace_instructors`) are derived read projections. Authoritative data always lives in channel-scoped PostgreSQL tables.

```
PostgreSQL (authoritative, channel-scoped)
    ↓ ProductVariantEvent / InstructorProfileUpdatedEvent (Vendure EventBus)
    ↓ MarketplaceIndexerPlugin reads Product.customFields.bbbSessionId → BbbScheduledSession
Elasticsearch platform index (derived, cross-channel read only)
    ↓
MarketplaceSearchResolver (public, no channel context on reads)
```

No marketplace write operation may bypass channel context. `OrderLine` creation, entitlement creation, and billing writes always go through the channel-scoped Vendure Shop API.

**Rejection criterion:** Any mutation that creates or modifies a channel-scoped entity without a `RequestContext.channelId` is rejected.

### INV-010: Ad Spend Truth Is the AdSpendLedger. Campaign.spentInPaise Is a Denormalised Cache Only.

`AdSpendLedger` rows are never updated, never deleted. `MarketplaceAdCampaign.spentInPaise` is a convenience cache maintained for fast budget-check queries. Discrepancies are resolved in favour of `SUM(AdSpendLedger.amountInPaise) WHERE campaignId = X`.

This extends INV-002 (append-only billing truth) to the advertising domain.

**Rejection criterion:** Any service method that calls `.update()` on an `AdSpendLedger` row is rejected.

---


## 3. Plugin Architecture & Bounded Contexts

### Bounded Context Map

```
┌──────────────────────────────────────────────────────────────────┐
│ VENDURE CORE                                                       │
│ Channel · Product · ProductVariant · Order · OrderLine            │
│ Customer · Fulfillment · Payment · Asset                          │
└───────────────┬──────────────────┬──────────────────┬────────────┘
                │                  │                  │
    ┌───────────▼──────┐ ┌────────▼───────┐ ┌────────▼───────────┐
    │  TENANT CONTEXT  │ │  CMS CONTEXT   │ │ COMMUNICATION       │
    │  TenantPlugin    │ │  CmsPlugin     │ │ CONTEXT             │
    │                  │ │                │ │ BigBlueButtonPlugin │
    │  TenantProfile   │ │  Article       │ │                     │
    │  InstructorProfile│ │  Page         │ │  BbbOrganization    │
    │  MediaResource   │ │  Banner        │ │  BbbRoom            │
    │  SubscriptionPlan│ │  NavigationMenu│ │  BbbScheduledSession│
    │  OrgSubscription │ │                │ │  BbbMeeting         │
    └──────────────────┘ └────────────────┘ │  BbbEnrollment      │
                                            │  BbbCapacityGrant   │
                                            │  BbbUsageLedger     │
                                            │  BbbWebhookEvent    │
                                            │  BbbEntitlement     │
                                            └─────────────────────┘
                                                      │
                                            ┌─────────▼───────────┐
                                            │ MARKETPLACE CONTEXT  │
                                            │ (Phase 3)            │
                                            │  Review              │
                                            │  Rating              │
                                            │  RankingMaterialized │
                                            └─────────────────────┘
```

### Cross-Plugin Service Injection Rules

Plugins share the NestJS DI container. Cross-plugin injection is permitted with these constraints:

1. Direction must be downward: `TenantPlugin` may not import from `BigBlueButtonPlugin`. `BigBlueButtonPlugin` may import from `TenantPlugin` (e.g., to verify `tenantProfileId` on org create).
2. Cross-plugin FK references use string IDs, never TypeORM relation decorators across plugin boundaries. `BbbOrganization.tenantProfileId: string` references `TenantProfile.id` without a `@ManyToOne` FK.
3. If circular dependency appears, extract the shared contract to a `SharedModule`.

---

## 4. Data Layer Decisions

### DA-001: ChannelAware Implementation Pattern ✅ Done

All tenant-scoped entities follow this pattern (code-verified in `TenantProfile`, `BbbOrganization`, `OrganizationSubscription`, `Article`, `Page`, `Banner`):

```typescript
@Entity('entity_name')
export class MyEntity extends VendureEntity implements ChannelAware {
  constructor(input?: DeepPartial<MyEntity>) { super(input); }

  // Framework join table — populated by assignToCurrentChannel
  @ManyToMany(() => Channel)
  @JoinTable()
  channels: Channel[];

  // Scalar copy for efficient direct queries
  @Index()
  @Column()
  channelId: string;
}
```

Service create pattern:
```typescript
async create(ctx: RequestContext, input: CreateInput): Promise<MyEntity> {
  const entity = new MyEntity(input);
  entity.channelId = ctx.channelId as string;
  await this.channelService.assignToCurrentChannel(entity, ctx);
  return this.connection.getRepository(ctx, MyEntity).save(entity);
}
```

**CMS plugin uses `ListQueryBuilder` + `findOneInChannel`** (code-verified in `ArticleService`, `PageService`, `BannerService`) — these entities are ChannelAware and use the framework tooling correctly.

**`Banner` was remediated in this audit:** The entity implemented `ChannelAware` with the `@ManyToMany(() => Channel) @JoinTable() channels` join table, but was missing the scalar `channelId` column. Added per the DA-001 pattern.

**`InstructorProfile` exception:** Uses raw `findAndCount` with explicit `WHERE channelId = :channelId`. Acceptable per DL-010.

**Current status:** ✅ All tenant-scoped entities comply with the ChannelAware pattern. Five known exceptions documented: `InstructorProfile` (DL-010), `BbbEntitlement` (DL-011), and reviews plugin entities `ProductReview`, `ReviewRequest`, `ReviewReport`, `ReviewReward`, `ReviewVote` (BUG-017).

### DA-002: Slug Uniqueness

Slugs are scoped per channel, not globally. All slug-bearing entities use a composite unique index:

```typescript
@Entity()
@Index(['channelId', 'slug'], { unique: true })
export class SlugBearingEntity extends VendureEntity {
  @Column() channelId: string;
  @Column() slug: string;    // no unique: true on the @Column itself
}
```

Application-level `assertSlugIsUnique` checks are acceptable as UX helpers but the database constraint is the authoritative guard.

**Affected entities and status:**
- `InstructorProfile` ✅ Applied
- `TenantProfile` (by channelId already unique — slug not exposed yet)
- `Article` ✅ Fixed — composite unique index `(channelId, slug)` via migration `1782369776476-bugs`
- `Page` ✅ Fixed — composite unique index `(channelId, slug)` via migration `1782369776476-bugs`
- `BbbOrganization` (slug is globally unique — 1 org per channel, correct)
- `BbbScheduledSession` ✅ Applied — composite `(organizationId, slug)` unique index, global unique slug dropped

### DA-003: Encryption Key Versioning

`BbbEncryptionService` encrypts BBB server API secrets and meeting passwords using AES-GCM. Encrypted columns carry `encryptionKeyVersion` for zero-downtime key rotation.

**Current status:** ✅ `encryptionKeyVersion` column present on `BbbMeeting` (line 2966) and `BbbServer` (line 3416) in plugin code. Migration `1782369776476-bugs` applied.

Key rotation procedure:
1. Increment `ENCRYPTION_KEY_VERSION` env var
2. Run background job: fetch all records with `encryptionKeyVersion < current`, decrypt with old key, re-encrypt with new key, update version
3. Remove old key from env after job completes

### DA-004: Migration Governance

Every schema change ships as a TypeORM migration. Rules:

- Migration filenames: `{timestamp}-{scope}-{description}.ts`
- Migrations are never edited after being run on any environment
- `down()` must be implemented and tested
- Destructive column drops require a two-migration pattern: (1) add new column, backfill, (2) drop old column
- No `synchronize: true` in any environment including development

---

## 5. Commerce & Access Control

### AC-001: The Entitlement Model ✅ Implemented (Minimal)

The implemented `BbbEntitlement` entity (code-verified):

```typescript
@Entity('bbb_entitlement')
@Index(['customerId', 'type', 'resourceId'])
@Index(['resourceId', 'type'])
@Index(['channelId'])
export class BbbEntitlement extends VendureEntity {
  @Column() type: 'bbb_session' | 'bbb_room';
  @Column() resourceId: string;
  @Column() customerId: string;
  @Column() source: 'purchase' | 'trial' | 'admin' | 'import';
  @Column({ nullable: true }) validFrom: Date | null;
  @Column({ nullable: true }) validUntil: Date | null;
  @Column({ nullable: true }) channelId: string | null;   // scalar, not ChannelAware
}
```

**Key implementation decisions differing from the ADR target:**
- Entity named `BbbEntitlement` (prefixed like other BBB entities), not bare `Entitlement`
- Scalar `channelId` without `ChannelAware` — follows DL-010 pattern (DL-011)
- No `sourceOrderLineId` or `sourceSubscriptionId` yet — Phase 2
- No admin UI or expiry cron yet — Phase 1.5

**Uniform access check:** `BbbEntitlementService.hasAccess()` — checks `customerId`, `type`, `resourceId`, and `validFrom`/`validUntil` window (code-verified).

**Integration points (all code-verified):**
1. `BbbOrderFulfillmentListener` creates Entitlement for session purchases ✅
2. `TrialRegistrationService.register()` creates Entitlement for trial registrations ✅
3. `BbbMeetingService.getJoinUrl()` checks Entitlement for session-based attendees (membership fallback) ✅
4. `BbbMeetingService.joinRoom()` Gate 3 checks `BbbEntitlement { type: 'bbb_room' }` for room access ✅ (legacy `BbbEnrollment` read paths in `bbbRoomStatus`, `myBbbRooms`, `myBbbEnrollments` not yet migrated — see BUG-022)

### AC-002: Commerce Loop (Checkout → Access) ✅ Fixed

```
Student adds BbbScheduledSession to cart
  → ProductVariant.id linked to BbbScheduledSession.productVariantId
  → Order placed, Payment settled
  → OrderStateMachine fires PaymentSettledEvent
  → BbbOrderFulfillmentListener.handlePaymentSettled()
      → findBbbScheduledSessionByProductVariantId(productVariantId) — FIRST
      → create Entitlement { type: 'bbb_session', resourceId: session.id, customerId, source: 'purchase' }
      → continue to next line (skip room path)
  → fallback for room products: productVariantId → BbbProductAccess → BbbRoom
      → create Entitlement { type: 'bbb_room', resourceId: room.id, customerId, source: 'purchase' }
  → Student joins: BbbMeetingService.getJoinUrl()
      → entitlementService.hasAccess(ctx, customerId, 'bbb_session', sessionId)
      → if granted: attendee join URL
```

**Current status:** ✅ Dual-path fulfillment code-verified. `BbbOrderFulfillmentListener` uses `TransactionalConnection` to look up `BbbScheduledSession` by `productVariantId` first; room products create `BbbEntitlement { type: 'bbb_room' }`. A legacy parallel path (`bbbFulfillmentHandler`) also writes `BbbEnrollment` + `BbbCapacityGrant` via the classic Vendure FulfillmentHandler — this is redundant and creates a read/write mismatch (see BUG-022) since `bbbRoomStatus`, `myBbbRooms`, and `myBbbEnrollments` still read from `BbbEnrollment` only.

### AC-003: Trial Session Funnel (Zero-Price Entitlement) ✅ Fixed

```
Student registers for free trial via Shop API mutation
  → registerForTrialSession(sessionId)
  → validate session.isTrial = true and session.capacity not exhausted
  → create BbbTrialRegistration { status: REGISTERED }
  → create Entitlement { type: 'bbb_session', source: 'trial', validUntil: session.endsAt }
  → Student joins using same joinMeeting path — entitlement check passes

After session ends (BBB meeting-ended webhook):
  → BbbWebhookProcessor.handleMeetingEnded()
  → update BbbTrialRegistration.status based on attendance data
  → emit TrialAttendanceRecordedEvent (future — no subscribers yet)

Conversion path A — direct purchase:
  → Student visits trainer profile, purchases full course
  → Normal Entitlement created via AC-002 commerce loop

Conversion path B — admin-initiated room enrollment:
  → Admin calls convertTrialToEnrollment(registrationId, roomId, accessDays?)
  → TrialRegistrationService.convertToEnrollment() creates BbbEnrollment
    { source: 'trial_conversion', validUntil: now + accessDays }
  → Student gains legacy BbbEnrollment room access (interim until Phase 1.5 migration)
```

**Current status:** ✅ Code-verified. `TrialRegistrationService.register()` validates session existence, `isTrial = true`, `maxAttendees` capacity, creates `BbbTrialRegistration`, then creates `BbbEntitlement` with `type: 'bbb_session', source: 'trial', validUntil: session.endTime`. Entitlement creation failure is non-fatal. `convertTrialToEnrollment` resolver exists (code-verified at `BbbAdminResolver`) and bridges trial registrations to `BbbEnrollment` for room access during the interim period before full Entitlement migration.

### AC-004: Subscription Billing Model (Phase 2)

```typescript
@Entity('subscription_plan')
export class SubscriptionPlan extends VendureEntity {
  @Column() name: string;                         // 'Starter' | 'Professional' | 'Enterprise'
  @Column() monthlyPriceInPaise: number;
  @Column() includedBbbMinutes: number;
  @Column() maxStudents: number;
  @Column() customDomainEnabled: boolean;
  @Column() whitelabelEnabled: boolean;
}

@Entity('organization_subscription')
export class OrganizationSubscription extends VendureEntity implements ChannelAware {
  @Column() planId: string;
  @Column({ enum: ['trialing', 'active', 'past_due', 'cancelled'] })
  status: SubscriptionStatus;
  @Column() currentPeriodStart: Date;
  @Column() currentPeriodEnd: Date;
  @Column({ default: false }) cancelAtPeriodEnd: boolean;
  @Column({ nullable: true }) billingCustomerId: string | null;   // Juspay ref
  @ManyToMany(() => Channel) @JoinTable() channels: Channel[];
  @Column() channelId: string;
}
```

`BbbCapacityGrant` gains a `sourceType: 'order' | 'subscription'` discriminator so billing reconciliation knows whether to bill against a one-time purchase or a subscription's included minutes.

---

## 5A. Dashboard Extension Pattern

This is the canonical pattern for all Vendure React Dashboard extensions on this platform. It is binding. Deviations cause TypeScript compile errors and broken admin navigation.

### Rule: `navSections` defines containers; `navMenuItem` on routes defines links

`DashboardNavSectionDefinition` (from `@vendure/dashboard`) accepts: `id`, `title`, `icon`, `placement`, `order`. It has **no `items` property**. Nav links are registered by adding a `navMenuItem` field to each `DashboardRouteDefinition` that should appear in the sidebar.

### Canonical pattern

```tsx
// plugin/dashboard/index.tsx
export default defineDashboardExtension({
    navSections: [
        {
            id: 'my-plugin',       // unique string ID — referenced by route navMenuItems
            title: 'My Plugin',
            icon: SomeIcon,
            placement: 'top',
            order: 110,
            // ❌ NEVER add 'items: [...]' here — property does not exist on the type
        },
    ],
    routes: [listRoute, detailRoute],
});

// plugin/dashboard/list-route.tsx  — appears in sidebar
export const listRoute: DashboardRouteDefinition = {
    path: '/my-plugin/items',
    loader: () => ({ breadcrumb: 'Items' }),
    component: () => <ItemListPage />,
    navMenuItem: {
        sectionId: 'my-plugin',           // must match navSection id above
        id: 'my-plugin-items',            // unique across ALL plugins
        title: 'Items',
        url: '/my-plugin/items',          // must match path
        requiresPermission: ['MyPluginAdmin'],
    },
};

// plugin/dashboard/detail-route.tsx  — drill-through only, no sidebar link
export const detailRoute: DashboardRouteDefinition = {
    path: '/my-plugin/items/$id',
    loader: () => ({ breadcrumb: 'Item detail' }),
    component: route => <ItemDetailPage route={route} />,
    // ✅ No navMenuItem — detail routes are never top-level sidebar links
};
```

### Compliance status per plugin

| Plugin | navSections | navMenuItems | Status |
|---|---|---|---|
| `BigBlueButtonPlugin` | ✅ Section only, no `items` | ✅ On each route | ✅ Compliant |
| `TenantPlugin` | ✅ Section only, no `items` | ✅ On each route | ✅ Compliant |
| `CmsPlugin` | ✅ Section only, no `items` | ⚠️ Not verified on all sub-routes | Verify |
| `ReviewsPlugin` | ✅ Fixed — section only, no `items` | ✅ On all routes | ✅ Compliant |

### Anti-patterns

| Anti-Pattern | Failure Mode |
|---|---|
| `navSections[n].items = [...]` | `DashboardNavSectionDefinition` has no `items` → TS-2353 compile error, menu invisible |
| Route with no `navMenuItem` and no `sectionId` | Route registers but never appears in sidebar |
| `navMenuItem.sectionId` not matching any section `id` | Link has no parent section — silently invisible |
| Duplicate `navMenuItem.id` across plugins | Last-registered wins; earlier entry is silently dropped |

---

## 6. BBB Integration Architecture


### BB-001: Webhook Pipeline ✅ Implemented & Code-Verified

```typescript
// BbbWebhookController — only validates and persists
@Post('webhook')
async handleWebhook(@Req() req, @Headers('x-hub-signature-256') sig: string, @Body() body: unknown) {
  const rawBody = req.rawBody;
  const isValid = await this.verifyHmacSignature(rawBody, sig);
  if (!isValid) return { ok: false };

  const event = await this.webhookEventRepo.save(new BbbWebhookEvent({
    eventType: this.extractEventType(body),
    payload: body,
    receivedAt: new Date(),
    status: 'PENDING',
  }));

  await this.jobQueue.add('process-bbb-webhook', { eventId: event.id });
  return { ok: true };
}

// BbbWebhookProcessorService — BullMQ worker
async processWebhookJob(job: Job<{ eventId: string }>) {
  const event = await this.webhookEventRepo.findOneOrFail({ where: { id: job.data.eventId } });
  try {
    const ctx = await this.ctxService.create({ apiType: 'admin' });
    await this.meetingService.handleWebhookEvent(ctx, event.eventType, event.payload);
    await this.webhookEventRepo.update(event.id, { status: 'PROCESSED', processedAt: new Date() });
  } catch (err) {
    await this.webhookEventRepo.update(event.id, { status: 'FAILED', errorMessage: err.message });
    throw err;  // BullMQ will retry per job config
  }
}
```

`BbbWebhookEvent` entity (code-verified):

```typescript
@Entity('bbb_webhook_event')
export class BbbWebhookEvent extends VendureEntity {
  @Column() eventType: string;
  @Column({ type: 'simple-json' }) payload: Record<string, unknown>;  // simple-json for DB portability (DL-013)
  @Column() receivedAt: Date;
  @Column() status: 'PENDING' | 'PROCESSED' | 'FAILED';
  @Column({ nullable: true }) processedAt: Date | null;
  @Column({ nullable: true, type: 'text' }) errorMessage: string | null;
  @Index() @Column({ nullable: true }) bbbMeetingId: string | null;
}
```

Replay: `SELECT * FROM bbb_webhook_event WHERE status = 'FAILED' ORDER BY received_at` → re-enqueue IDs.

### BB-002: Meeting FSM ✅ Fixed

**Implemented states:**

```typescript
export const MEETING_STATE = {
  PENDING:      'Pending',
  PROVISIONING: 'Provisioning',
  ACTIVE:       'Active',
  COMPLETED:    'Completed',
  ARCHIVED:     'Archived',
  FAILED:       'Failed',
  STALE:        'Stale',
} as const;
```

**Transitions:**

```typescript
export const MEETING_STATE_TRANSITIONS: Record<MeetingState, MeetingState[]> = {
  Pending:      ['Provisioning', 'Failed'],
  Provisioning: ['Active', 'Failed'],
  Active:       ['Completed', 'Failed', 'Stale'],
  Completed:    ['Archived'],
  Archived:     [],
  Failed:       ['Pending'],
  Stale:        [],   // terminal — not billable
};
```

`STALE` is reachable from `Active` when reconciliation determines a meeting is permanently unreachable on BBB (`getMeetingInfo` returns null). No `BbbUsageLedger` row is written for `STALE` meetings. `BbbReconciliationService` now calls `BbbMeetingService.markMeetingStale()` instead of `completeMeetingLifecycle()` for missing BBB meetings, and `reconcileRooms()` resets rooms to Idle when the linked meeting is STALE.

**Current status:** ✅ Fixed. `STALE` implemented in `constants.ts`, transitions validated, reconciliation wired to use new state, and `expireJoinLinks()` includes STALE.

### BB-003: Server Selection — Load Scoring

**Current implementation (code-verified):**

```typescript
// BbbServerSelectionService.selectServer()
.andWhere('server.currentLoad < server.maxLoad')
.orderBy('server.currentLoad', 'ASC')
// + random jitter among tied servers
```

**ADR v1.0 target:** Score = `activeMeetingCount × avgParticipantsPerMeeting` from a 15-min rolling window.

**Accepted divergence (v1.1):** The `currentLoad` / `maxLoad` abstraction is a valid alternative. `currentLoad` is an opaque integer that `BbbReconciliationService` or an external agent can update to any desired metric (participant-minutes, raw meeting count, CPU load, etc.) without changing the selection algorithm. The selection service does not need to know the scoring formula — that is the reconciliation concern.

**Fixed:** Documented in `BbbServer` entity JSDoc. `currentLoad` is an opaque 0–100 score maintained by `BbbReconciliationService` via a composite of active meeting count and participant load. The selection service only needs to filter and sort — it does not need to know the scoring formula.

### BB-004: Capacity Exhaustion Notification ✅ Fixed

When `billingCapped = true` is set during reconciliation, `CapacityExhaustedEvent` is published so downstream subscribers (e.g., EmailPlugin) can notify the tenant.

```typescript
// Event class
export class CapacityExhaustedEvent extends VendureEvent {
  constructor(
    public readonly ctx: RequestContext,
    public readonly organization: BbbOrganization,
    public readonly grant: BbbCapacityGrant,
  ) { super(); }
}

// Published from BbbReconciliationService billing ceiling path
if (organization && grant) {
  this.eventBus.publish(new CapacityExhaustedEvent(ctx, organization, grant));
}
```

**Current status:** ✅ Fixed. `CapacityExhaustedEvent` class added to `bbb-events.ts` and published from `BbbReconciliationService` when a meeting is force-completed with `billingCapped = true`.

### BB-005: Encryption Key Version ✅ Fixed

Both `BbbServer.encryptedApiSecret` and `BbbMeeting.encryptedAttendeePassword` / `encryptedModeratorPassword` carry `encryptionKeyVersion: number`. See DA-003.

**Current status:** ✅ Code-verified. `encryptionKeyVersion` column present on both entities.

---

## 6A. Capacity Intelligence Architecture

**Section-wide status (v1.9, code-verified): ✅ Fully implemented.** `CapacityIntelligenceService`, `BbbCapacityAlertLog`, `BbbServer.capacity`, `poolCapacityDashboard`, and the `capacity-alert` job are all live in `bigbluebutton-plugin`. See CI-001–CI-006 below for implementation details.

**Origin:** Peer assessment 2026-06. Formalised from the Capacity Intelligence System proposal following architectural review.

**Background:** `BbbServer.currentLoad` and `BbbServer.maxLoad` (BB-003, DL-014) establish the server selection primitive. What was missing was a layer that aggregates that primitive into pool-level health, forecasts future load from scheduled session data, and informs operators before saturation — not after. This section specifies that layer.

**Design principle (INV-012 revised, DL-025):** The system warns operators; it never blocks meetings. See INV-012 and DL-025 for rationale.

---

### CI-001: `BbbServer.capacity` — Operator-Configured Hardware Ceiling

**New column on `BbbServer`:**

```typescript
/**
 * Operator-configured maximum virtual load score for this server's hardware spec.
 * Used by CapacityIntelligenceService for pool-level headroom calculations.
 *
 * Not used by BbbServerSelectionService — that service continues to use
 * currentLoad < maxLoad for selection (DL-014 preserved).
 *
 * Default 200 ≈ a 4-core 8GB VM at moderate session density.
 * A 8-core 16GB server would typically be configured with capacity: 500.
 */
@Column({ default: 200 })
capacity: number;
```

`capacity` is deliberately separate from `maxLoad`. `maxLoad` is the admission threshold — servers at or above it are excluded from selection. `capacity` is the physical ceiling — the denominator for headroom percentage. An operator may set `maxLoad: 85` (stop accepting new meetings at 85% of capacity) and `capacity: 200` (where 85% = 170 virtual load units). These are independent tuning knobs.

**Migration:** `ALTER TABLE bbb_server ADD COLUMN capacity INT NOT NULL DEFAULT 200`.

---

### CI-002: `CapacityIntelligenceService`

**New service** that exposes three aggregations from data already in the system.

#### Live Pool Health

```typescript
interface ServerPoolHealth {
  servers: ServerHealth[];
  totalServers: number;
  activeServers: number;
  totalVirtualLoad: number;     // sum of BbbServer.currentLoad across pool
  totalCapacity: number;        // sum of BbbServer.capacity across pool
  poolLoadPercent: number;      // totalVirtualLoad / totalCapacity × 100
  activeAttendees: number;      // from BbbMeeting (Active state)
  activeMeetings: number;
  safeHeadroom: number;         // capacity remaining before 80% threshold
}

interface ServerHealth {
  serverId: string;
  serverName: string;
  status: 'active' | 'disabled' | 'unreachable';
  currentLoad: number;
  loadPercent: number;          // currentLoad / capacity × 100
  activeMeetings: number;
  activeParticipants: number;
  isOverloaded: boolean;        // loadPercent > 85
}
```

No new polling. `currentLoad` is already maintained by `BbbReconciliationService.reconcileServerLoad()`.

#### 48-Hour Load Forecast

```typescript
interface LoadForecastSlot {
  windowStart: Date;
  windowEnd: Date;              // 30-minute windows across next 48h
  expectedSessions: number;
  expectedAttendees: number;    // sum of BbbScheduledSession.maxAttendees
  expectedVirtualLoad: number;  // PILOS formula: videos×3 + mics×2 + listeners×1
  projectedLoadPercent: number; // vs current pool capacity
  riskLevel: 'safe' | 'warning' | 'critical';
}
```

**Data source:** `BbbScheduledSession.startsAt`, `endsAt`, `maxAttendees` — all present in Phase 1 entities.

**Load estimation parameters (currently hardcoded defaults — planned for `BigBlueButtonPluginOptions`):**

> **Note:** These parameters are not yet exposed in `vendure-config.ts`. They are hardcoded in `CapacityIntelligenceService`. Promoting them to `BigBlueButtonPlugin.init()` options is a tracked Phase 1.5 gap. They can be refined once `BbbUsageLedger.peakParticipantCount` history accumulates.

| Parameter | Default | Rationale |
|---|---|---|
| `cameraRatio` | 0.40 | 40% of attendees typically enable camera |
| `micRatio` | 0.70 | 70% of attendees typically unmute |
| `videoWeight` | 3 | PILOS virtual load weight for video streams |
| `micWeight` | 2 | PILOS virtual load weight for microphone streams |
| `listenerWeight` | 1 | PILOS virtual load weight for listen-only |

These ratios are **not yet configurable** — they are hardcoded defaults. The `BigBlueButtonPluginOptions` extension is a tracked gap (see BUG-019 remediation work, Phase 1.5).

#### Capacity Recommendation

```typescript
interface CapacityRecommendation {
  currentServers: number;
  currentCapacity: number;
  peakForecastLoad: number;
  peakForecastAt: Date;
  peakForecastPercent: number;
  serversNeeded: number;        // 0 if within safe threshold
  urgency: 'none' | 'plan' | 'soon' | 'immediate';
  reasoning: string;            // plain English, shown in dashboard
}
```

**Target utilisation:** Peak load should not exceed 70% of total capacity (30% headroom for session join spikes). `serversNeeded = Math.ceil((peakForecastLoad / 0.70 - currentCapacity) / standardServerCapacity)`.

**Urgency thresholds:**

| Projected peak % | Urgency |
|---|---|
| > 90% | `immediate` |
| > 75% | `soon` |
| > 60% | `plan` |
| ≤ 60% | `none` |

---

### CI-003: Admin API Query

```graphql
type Query {
  """
  Returns live pool health, 48-hour load forecast, capacity recommendation,
  and historical peak stats for the specified server pool.
  Only accessible by SuperAdmin.
  """
  poolCapacityDashboard: PoolCapacityDashboard!
    @Allow(Permission.SuperAdmin)
}

type PoolCapacityDashboard {
  liveHealth: ServerPoolHealth!
  forecast: [LoadForecastSlot!]!
  recommendation: CapacityRecommendation!
  historicalPeak: HistoricalPeakStats!
}

type HistoricalPeakStats {
  last7DaysPeakAttendees: Int!
  last7DaysPeakLoad: Float!
  last7DaysPeakAt: DateTime!
  avgDailyAttendeeMinutes: Float!
}
```

`historicalPeak` is computed from `BbbUsageLedger` — no new tables.

---

### CI-004: `CapacityAlertLog` — Append-Only Alert Audit Trail

**New entity** following INV-002 principle extended to the alerting domain.

```typescript
@Entity('bbb_capacity_alert_log')
export class BbbCapacityAlertLog extends VendureEntity {
  @Column() checkedAt: Date;
  @Column() urgency: 'none' | 'plan' | 'soon' | 'immediate';
  @Column() serversNeeded: number;
  @Column() peakForecastPercent: number;
  @Column({ nullable: true }) peakForecastAt: Date | null;
  @Column({ nullable: true, type: 'text' }) reasoning: string | null;
}
```

Rows are never updated. Never deleted. Operators can retrospectively audit when the system flagged a capacity risk and whether a server was added in time.

---

### CI-005: `capacity-alert` BullMQ Job

**New scheduled job** — runs every 15 minutes.

```
Queue: bbb-capacity-alert (cron: every 15 minutes)
  → CapacityIntelligenceService.buildDashboard()
  → append BbbCapacityAlertLog row (always — provides continuous audit trail)
  → if urgency = 'immediate': publish CapacityAlertEvent → email to platform admin
  → if urgency = 'soon': publish CapacityAlertEvent (lower priority)
```

**`CapacityAlertEvent`** (new VendureEvent):

```typescript
export class CapacityAlertEvent extends VendureEvent {
  constructor(
    public readonly urgency: 'soon' | 'immediate',
    public readonly message: string,
    public readonly peakForecastAt: Date,
    public readonly serversNeeded: number,
  ) { super(); }
}
```

Subscribers: `EmailPlugin` handler sends alert to platform admin email. Future: MSG91 SMS (`urgency = 'immediate'` only), WhatsApp Business.

---

### CI-006: ADR Updates Required

**New entries in job queue table (§9 EQ-001):**

```
bbb-capacity-alert    ← ✅ live — 15-minute cron, logs to BbbCapacityAlertLog, publishes CapacityAlertEvent (CI-005)
```

**New entry in EventBus table (§9 EQ-002):**

| Event | Publisher | Subscribers | Status |
|---|---|---|---|
| `CapacityAlertEvent` | `BbbCapacityAlertJob` | `EmailPlugin` | ✅ Live — published by 15-minute cron job |

**Production Readiness Checklist (§13) — new items:**

- [x] `BbbServer.capacity` column migrated and set per server spec ✅
- [x] `bbb-capacity-alert` job registered in `onModuleInit` ✅
- [x] `poolCapacityDashboard` query verified in dashboard ✅
- [ ] Load estimation ratios tuned from first 2 weeks of `BbbUsageLedger` data

---

### INV-012 (Capacity Intelligence Invariant): Capacity Intelligence Is Advisory. Meetings Are Never Blocked for Capacity Reasons.

The `CapacityIntelligenceService` warns operators when forecast load approaches pool capacity. It does not block meeting provisioning.

**Rationale:** A coaching institute's 6:00 PM class with 42 students enrolled cannot be cancelled at the last minute because the platform's infrastructure is under-provisioned. The failure mode of a blocked class (42 students lose a session, academy loses trust, refunds issued) is categorically worse than the failure mode of a degraded class (video choppy for some participants, recoverable with a server addition). The correct response to approaching capacity is operator notification and server addition — not meeting rejection.

**Operational consequence:** The 15-minute alert job and the `poolCapacityDashboard` query provide the operator sufficient warning to add a server before saturation. `BbbServerSelectionService` continues to use `currentLoad < maxLoad` as the admission filter — this is the soft ceiling, not a block. Once all servers are above `maxLoad`, new provisioning jobs will queue and retry (up to `BBB_MAX_AUTO_RETRIES`), giving the operator a window to act.

**Rejection criterion:** Any code path that throws an error or returns an access-denied response solely because pool capacity is high is rejected. Capacity is a signal for operators, not a gate for students.

---

### DL-025 (Decision Log detail): Proactive Capacity Intelligence Over Reactive Throttling

**Decision:** The platform implements 48-hour load forecasting with operator notification rather than capacity-based meeting blocking.

**Rationale:** The education context makes reactive throttling uniquely harmful. A live class has a scheduled time, enrolled students, and a trainer who has prepared. Blocking the class at provisioning time means real students lose real learning time with no recovery path in the moment. The infrastructure failure is the platform's responsibility, not the academy's problem to absorb.

By contrast, a 15-minute alert cadence with a 48-hour forecast window gives the operator between 48 hours and 15 minutes of warning — enough to provision a new server before any student is affected. The operator takes the action; the student experience is uninterrupted.

**Alternatives rejected:**

- Hard ceiling blocking (rejected — see INV-012 rationale)
- Per-meeting capacity checks at join time (rejected — too late; the meeting is already provisioned)
- Reactive server auto-scaling (deferred to Phase 4 — requires cloud-native infrastructure; current BBB servers are self-hosted)

---

### INV-013: Customer Deletions Are Always Anonymizations. No Cascade Deletes.

Customer deletion (both `leaveAcademy` and `deleteMyAccount` flows) must **anonymize** all personal data rather than hard-deleting rows. Financial and audit data must retain immutable foreign key references.

**Rules:**
- `CustomerDeletionService` orchestrates cross-plugin deletion via registered handlers
- Each plugin registers `removeFromChannel` and `fullDelete` handlers in `onApplicationBootstrap`
- `CustomerDeletionLog` entity tracks every deletion with status and timestamps
- `BbbUsageLedger`, `Order`, `ReviewReward` rows are **never deleted** — they carry financial/audit value
- `BbbEntitlement`, `BbbEnrollment`, `ReviewRequest` are soft-deleted (deactivated) or hard-deleted if no PII
- `InstructorProfile` is anonymized (fullName → "[deleted]", photo nullified, isActive = false) — slugs preserved for URL integrity
- `ProductReview.authorName` is anonymized, review text retained for community value
- All operations are idempotent and logged for audit

**Rejection criterion:** Any schema change that adds `onDelete: CASCADE` from `Customer` or `User` to financial/audit tables is rejected.

---

## 7. CMS Architecture

### CMS-001: Slug Uniqueness Migration ✅ Fixed

`Article` and `Page` entities have composite unique indexes:

```sql
CREATE UNIQUE INDEX "IDX_article_channel_slug" ON "article" ("channelId", "slug");
CREATE UNIQUE INDEX "IDX_page_channel_slug" ON "page" ("channelId", "slug");
```

**Current status:** ✅ Code-verified. Both `ArticleService` and `PageService` use `ListQueryBuilder` + `findOneInChannel` which enforce channel scope. Migration `1782369776476-bugs` applied.

### CMS-002: Banner Scheduling via BullMQ ✅ Fixed

Replaced runtime date filter with precomputed `isCurrentlyActive`:

```typescript
// Added to Banner entity
@Column({ default: false })
isCurrentlyActive: boolean;

// BullMQ scheduled job (runs every minute)
// banner-activator: WHERE isActive = true AND startsAt <= NOW() AND isCurrentlyActive = false → set true
//                   WHERE isCurrentlyActive = true AND (isActive = false OR endsAt < NOW()) → set false

// Storefront query becomes:
WHERE channelId = :channelId AND isCurrentlyActive = true
```

**Current status:** ✅ Fixed. `banner-activator` BullMQ scheduled task registered in `CmsPlugin.configuration()`. `BannerService.findActiveForPlacement()` now queries `isCurrentlyActive = true` instead of runtime date-range comparisons. The `isCurrentlyActive` column and index already existed in the database.

### CMS-003: Page Sections Type Index (Phase 2)

The `sections: PageSection[]` JSON blob is retained for current scale. For Phase 2 queryability:

```typescript
// Add to Page entity
@Column({ type: 'simple-array', nullable: true })
sectionTypes: string[];   // e.g. ['hero', 'productGrid', 'bbbSession']

// Maintained on save: page.sectionTypes = page.sections.map(s => s.type)
```

Enables `WHERE 'bbbSession' = ANY(sectionTypes)` without JSON deserialization.

### CMS-004: BBB Session Section Type (Phase 2)

Add `bbbSession` as a page section type:

```typescript
export interface BbbSessionSection {
  type: 'bbbSession';
  scheduledSessionId: string;
  showCountdown: boolean;
  showInstructorProfile: boolean;
}
```

The storefront `PageRenderer` fetches `BbbScheduledSession` by ID and renders the join CTA, countdown, and instructor card inline. Bridge between CMS and live teaching products.

---

## 7A. Reviews Plugin Architecture

### RV-001: Plugin Scope

`ReviewsPlugin` provides product reviews, moderation workflows, fraud detection, aggregated reputation scoring, review request campaigns, reward issuance, and a Phase 1A strategy-based abstraction layer for extensible review targets.

**Entities:** `ProductReview`, `ReviewRequest`, `ReviewReport`, `ReviewReward`, `ReviewVote`

**Services:** `ProductReviewService`, `ReviewRequestService`, `ReviewAggregationService`, `ReviewCacheService`, `ReviewEmailService`, `ReviewRewardService`, `ReviewReportService`, `ReviewAntiFraudService`

**Phase 1A abstraction (live):** `ReviewTargetRegistry`, `ReviewEligibilityStrategyRegistry`, `ReviewAggregationStrategyRegistry` — strategy-pattern contracts that allow future review targets (courses, instructors) to plug in without modifying core service code.

### RV-002: Channel Scoping — Deviation from INV-001 (see BUG-017)

Reviews entities do not implement `ChannelAware`. Channel isolation is enforced in service query layers via `WHERE channelId = :channelId` string comparisons against `ctx.channelId`. This is a documented deviation (DIV-010, DL-010 pattern applied to reviews). All service methods have been written with explicit channel filters.

**Remediation target:** Add `ChannelAware` implementation to `ProductReview` at minimum before multi-tenant production launch. Backfill join table from existing `channelId` strings.

### RV-003: Custom Fields on `Product`

On boot, the plugin appends three custom fields to `Product` if absent:

- `reviewRating` (float, public) — cached aggregate, updated by `ReviewAggregationService`
- `reviewCount` (float, public) — cached count, same service
- `featuredReview` (relation to `ProductReview`, public) — pinnable featured review

These are denormalised caches. Authoritative data is always the `ProductReview` rows.

### RV-004: Admin Permission

`ReviewAdmin` custom permission governs all admin API access. All dashboard routes carry `requiresPermission: ['ReviewAdmin']`.

### RV-005: Dashboard Extension — BUG-016 Fixed

See §5A for the canonical pattern. The applied fix:

- `index.tsx`: `navSections` contains section container only — no `items` array
- `review-list.tsx`: `reviewList` route gains `navMenuItem: { sectionId: 'reviews', id: 'review-list', ... }`
- `review-placeholder.tsx`: `reportList`, `rewardList`, `requestList` were already correct

---

## 8. Tenant & Academy Layer


### TP-001: Bug — `TenantProfileDetail.tsx` `useState` used as `useEffect`

**Status:** ✅ Fixed (prior to this sprint).

### TP-002: Bug — `tenantProfile` resolver ignores `__current__`

**Status:** ✅ Fixed (prior to this sprint). Code-verified: `TenantAdminResolver.tenantProfile()` correctly handles `__current__` by defaulting to `ctx.channelId`.

### TP-003: `InstructorProfile` is not `ChannelAware`

`InstructorProfile` uses an explicit `channelId` scalar — no `channels[]` join table, no `assignToCurrentChannel`. All service methods use raw `findAndCount` / `findOne` with `WHERE channelId = :channelId`.

**Code verification:** All five `InstructorProfileService` methods (`findAll`, `findPublicByChannel`, `findOne`, `findPublicBySlug`, `create`, `update`, `delete`) include explicit `channelId` in every query or guard. ✅

**Decision:** Acceptable per DL-010. Explicitly documented as an exception to DA-001.

### TP-004: `TenantProfile` — `assignToCurrentChannel` applied ✅

`TenantProfileService.create` correctly calls `channelService.assignToCurrentChannel`. Code-verified.

### TP-005: `MediaResourceService` — Channel Filter Applied ✅

`MediaResourceService.findOne` includes `channelId` filter. Code-verified.

### TP-006: Tenant Registration System ✅ Implemented

The Tenant Registration System provides a self-service `registerNewTenant` Shop API mutation (`Permission.Public`) that provisions a complete tenant channel in a single synchronous transaction. This is the **primary tenant creation path** — any unauthenticated visitor (academy owner / seller) can register. A platform admin can also create tenants manually via the Admin API as an override path.

It follows the INV-004 persist-first pattern: the registration request is logged as `PENDING` before any entity creation, and marked `COMPLETED` or `FAILED` on outcome.

#### Registration Flow (5-Step Orchestration)

```
registerNewTenant(input: RegisterTenantInput)
  → 1. Persist TenantRegistrationLog { status: PENDING }
  → 2. Create Seller (Vendure core) — required for channel creation
  → 3. Create Channel — reuses default channel's zones/currency
       channelCode = slugify(shopName) + "_" + randomSuffix(4)
       channelToken = "tok_" + randomToken(8)
  → 4. Create channel-scoped Role with TENANT_ADMIN_ROLE_PERMISSIONS
  → 5. Create Administrator (email + password) assigned to the new Role
  → 6. Create TenantProfile — assigned to the new Channel via assignToCurrentChannel
  → 7. Mark TenantRegistrationLog { status: COMPLETED }
  → Return { success: true, channelToken, message }
```

**Error handling:** If any step fails, the log is marked `FAILED` with the error message. The mutation throws, and the caller receives the error. Partial entity creation (e.g., Channel created but Administrator creation failed) is handled by the `@Transaction()` decorator — the entire mutation rolls back on exception.

#### `TenantRegistrationLog` Entity

```typescript
@Entity('tenant_registration_log')
@Index(['channelId'])
@Index(['status'])
export class TenantRegistrationLog extends VendureEntity {
  @Column() email: string;
  @Column() shopName: string;
  @Column({ nullable: true }) channelId: string | null;
  @Column({ nullable: true }) channelToken: string | null;
  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  @Column({ nullable: true, type: 'text' }) errorMessage: string | null;
}
```

Rows are never updated after final status (COMPLETED/FAILED). The PENDING → COMPLETED/FAILED transition is the only mutation. This follows the INV-002 append-only principle extended to the registration domain.

#### `TENANT_ADMIN_ROLE_PERMISSIONS`

```typescript
export const TENANT_ADMIN_ROLE_PERMISSIONS: PermissionDefinition[] = [
  // Channel-scoped commerce permissions
  Permission.Catalog, Permission.Asset, Permission.Collection,
  Permission.Customer, Permission.CustomerGroup, Permission.Facet,
  Permission.Order, Permission.PaymentMethod, Permission.Promotion,
  Permission.ShippingMethod, Permission.Tag,
  // Plugin CRUD permissions
  Permission.CreateTenantProfile, Permission.ReadTenantProfile,
  Permission.UpdateTenantProfile, Permission.DeleteTenantProfile,
  Permission.CreateInstructorProfile, Permission.ReadInstructorProfile,
  Permission.UpdateInstructorProfile, Permission.DeleteInstructorProfile,
  Permission.CreateMediaResource, Permission.ReadMediaResource,
  Permission.UpdateMediaResource, Permission.DeleteMediaResource,
];
```

The role is created with `channelIds: [newChannel.id]` so the administrator's permissions are scoped to their own channel only — they cannot access other tenants' data.

#### GraphQL Schema

```graphql
input RegisterTenantInput {
  email: String!
  password: String!
  shopName: String!
}

type RegisterTenantResult {
  success: Boolean!
  channelToken: String
  message: String
}

extend type Mutation {
  registerNewTenant(input: RegisterTenantInput!): RegisterTenantResult!
    @Allow(Permission.Public)
}
```

#### Outstanding Items (Phase 1.5)

- **SEC-004 (Rate limiting):** ✅ Done — `shopApiRateLimiter` extended to cover `registerNewTenant` mutation, matching the pattern in SEC-005.
- **Email verification:** The Administrator is created in a usable state immediately. Should mirror `registerCustomerAccount`/`verifyCustomerAccount` pattern before production to prevent disposable-account abuse.
- **Shipping/payment methods and stock location:** New tenant Channels will need at least one ShippingMethod and StockLocation before they can sell. These are not auto-provisioned in the current flow.

---

## 8A. Internal Operations Architecture

This section defines the design for **Archetype B: Internal Staff Meeting** — the flow by which academy staff (admins, moderators, internal team) join BBB rooms that are not listed in the student product catalogue. It documents what is currently implemented, what is a planned gap, and the precise design required before this flow can be production-ready.

### Overview

Internal rooms are `BbbRoom` entities with `productVariantId = null`. They are not Vendure products. A staff member joining an internal room bypasses the entire commerce loop — no cart, no `OrderLine`, no `BbbEntitlement` from purchase. Access is granted purely on the basis of organizational membership.

```
Staff member clicks "Join"
  → joinRoom(roomId) mutation
  → Auth waterfall: is this customerId a member of the BbbOrganization owning this room?
      → YES (staff): grant access immediately, assign moderator role
      → NO (not a member): fall through to entitlement check
  → Provision room (BbbRoomLockService + BullMQ)
  → buildJoinUrl() with moderator password
  → Usage written to BbbUsageLedger against overhead grant
```

### OP-001: Auth Waterfall Short-Circuit — FEAT-001 ✅ Done

**Current state (v1.7, code-verified):** `BbbOrganizationMembership` entity, migration `1782651476546-bbb-membership.ts`, `BbbMembershipService.findActiveMembership()`, admin CRUD resolvers, and the `MembershipsList.tsx` dashboard route are all implemented. `BbbShopResolver.joinRoom()` (and `BbbMeetingService.getJoinUrl()`) now runs the membership check as Gate 1 before falling through to entitlement — the design below is implemented as written. BUG-018 is resolved.

**Design (implemented):**

```typescript
// FEAT-001: New entity
@Entity('bbb_organization_membership')
export class BbbOrganizationMembership extends VendureEntity {
  @Column() organizationId: string;     // FK → BbbOrganization.id
  @Column() customerId: string;         // FK → Customer.id (Vendure)
  @Column() channelId: string;          // scalar, explicit filter (DL-010 pattern)
  @Column({
    type: 'enum',
    enum: ['org_admin', 'moderator', 'staff'],
  })
  role: 'org_admin' | 'moderator' | 'staff';
  @Column({ default: true }) isActive: boolean;

  // Composite index: fast lookup "is this customer a member of this org?"
  @Index(['organizationId', 'customerId'], { unique: true })
}
```

**Auth waterfall (target, requires FEAT-001):**

```typescript
// BbbShopResolver.joinRoom()
async joinRoom(ctx, { roomId }) {
  const room = await this.roomService.findOne(ctx, roomId);

  // Gate 1 — staff short-circuit (FEAT-001 required)
  const membership = await this.membershipService.findActiveMembership(
    ctx, ctx.activeUserId, room.organizationId
  );
  if (membership) {
    // Skip all entitlement checks — org membership grants access
    return this.provisionAndJoin(ctx, room, membership.role);
  }

  // Gate 2 — commercial entitlement (existing path, unchanged)
  const hasAccess = await this.entitlementService.hasAccess(
    ctx, ctx.activeUserId, 'bbb_room', roomId
  );
  if (!hasAccess) throw new ForbiddenError();

  return this.provisionAndJoin(ctx, room, 'attendee');
}
```

**Status:** FEAT-001 shipped — Archetype B's prerequisite is satisfied.

### OP-002: Moderator Role Assignment — FEAT-001 ✅ Done

**Current state (v1.7, code-verified):** `BbbApiService.buildJoinUrl()` constructs HMAC-signed URLs and supports both attendee and moderator passwords (AES-256-GCM decrypted). The routing logic that maps `membership.role` to the moderator/viewer password path is now wired into `provisionAndJoin()`. Mapping:

```typescript
const bbbRole = membership.role === 'org_admin' || membership.role === 'moderator'
  ? 'MODERATOR'
  : 'VIEWER'; // 'staff' gets viewer by default; can be overridden per room
```

This is a one-line addition once `BbbOrganizationMembership.role` exists. No changes to `BbbEncryptionService` or `buildJoinUrl()` are needed.

### OP-003: Internal Room Detection — Commerce Bypass

**Current state:** ✅ Already correct by design.

`BbbRoom.productVariantId` is nullable. A room without a `productVariantId` cannot be linked to a Vendure product and cannot be added to a cart. The commerce bypass is structurally enforced — it requires no code change.

**Storefront contract:** The internal team portal fires `joinRoom(roomId)` directly, identical to the student mutation. The auth waterfall (OP-001) handles the branching. The storefront does not need to know whether a room is internal or commercial.

### OP-004: Distributed Lock — Already Correct ✅

`BbbRoomLockService` acquires a Redis distributed lock on `roomId` before provisioning. This applies equally to internal rooms. If two staff members click "Join" at the same millisecond, only one provisioning job fires. The second worker finds the room already in `Provisioning` state and waits. No changes needed.

### OP-005: Overhead Consumption Ledger — FEAT-002 ✅ Code Complete, Migration Pending

**Current state (v1.7, code-verified):** `sourceType` (`'order' | 'subscription' | 'internal_overhead'`) and `isUnbounded` columns exist on `BbbCapacityGrant`. `BbbOrganizationService.create()` auto-provisions an `internal_overhead` grant per org. `BbbReconciliationService.consumeGrantHours()` branches on `sourceType === 'internal_overhead'` to skip exhaustion checks and capacity alerts, per Option A below. The design is implemented as written.

**Remaining step:** the schema migration for the new columns has not been run (`npx vendure migrate create && npx vendure migrate up`) — see `what-next.md` Task 1.

**Design (implemented, Option A):**

```typescript
// FEAT-002: Add sourceType discriminator to BbbCapacityGrant
// Option A (recommended): auto-create an 'internal_overhead' grant per org,
// flagged as unbounded (grantedMinutes: -1) and exempt from exhaustion checks.

@Column({ default: 'order' })
sourceType: 'order' | 'subscription' | 'internal_overhead';

// BbbReconciliationService.consumeGrant() gains a branch:
if (grant.sourceType === 'internal_overhead') {
  // write ledger row, skip exhaustion check, skip capacity alert
  await this.ledger.write({ meetingId, consumedMinutes, grantId: grant.id });
  return;
}
```

**Alternative (Option B):** Allow `grantId` to be nullable on `BbbUsageLedger` rows. Internal sessions write a ledger row with `grantId = null`. Simpler, but loses per-organization overhead tracking structure.

**Recommendation:** Option A. An explicit `internal_overhead` grant per org preserves the invariant that every ledger row has a grant reference, keeps billing reports clean, and provides a natural hook for future internal cost accounting.

### OP-006: Compliance Table — Archetype B vs. Architectural Invariants

| Invariant | Archetype B Compliance | Notes |
|---|---|---|
| INV-001: Channel = Tenant | ✅ Compliant | `BbbOrganizationMembership.channelId` scalar, DL-010 pattern |
| INV-002: Append-only ledger | ✅ Compliant | Internal sessions still write ledger rows |
| INV-003: One access-control system | ✅ Compliant | Membership check is a prior gate that short-circuits before entitlement — it does not replace entitlement |
| INV-004: Webhooks persist-first | ✅ Compliant | `meeting-ended` webhook path unchanged |
| INV-008: Business logic in Vendure | ✅ Compliant | All branching logic in `BbbShopResolver`, not in Next.js |

### OP-007: Phase 1.5 Implementation Order — ✅ All Steps Complete

1. **FEAT-001:** ✅ `BbbOrganizationMembership` entity + migration + `BbbMembershipService` (`findActiveMembership`, `create`, `update`, `delete`)
2. **FEAT-001:** ✅ Admin mutations (`createBbbOrgMembership`, `updateBbbOrgMembership`) and dashboard UI (`MembershipsList.tsx`)
3. **FEAT-001:** ✅ `BbbShopResolver.joinRoom()` / `BbbMeetingService.getJoinUrl()` check membership before entitlement
4. **OP-002:** ✅ `membership.role → bbbRole` wired in `provisionAndJoin()`
5. **FEAT-002:** ✅ `sourceType` discriminator added to `BbbCapacityGrant`; `internal_overhead` grant auto-provisioned on `BbbOrganization` create
6. **FEAT-002:** ✅ `BbbReconciliationService.consumeGrantHours()` handles the `internal_overhead` path

**Only remaining action:** run the FEAT-002 schema migration (columns exist in the entity but the DB has not been migrated — `what-next.md` Task 1).

---


## 9. Event & Job Queue Architecture

### EQ-001: Job Queue Naming Convention

```
bbb-meeting-provisioning     ← ✅ live
bbb-webhook-processor        ← ✅ live (INV-004)
bbb-reconciliation           ← ✅ live (scheduled task)
bbb-capacity-alert           ← ✅ live — 15-minute cron, logs to BbbCapacityAlertLog, publishes CapacityAlertEvent (CI-005)
banner-activator             ← ✅ live — 1-minute cron, precomputes isCurrentlyActive (CMS-002)
billing-invoice-generator    ← Phase 2
usage-ledger-aggregator      ← Phase 2
```

All jobs are registered in `onModuleInit` via `JobQueueService.createQueue`. Job payloads are typed interfaces.

### EQ-002: Vendure EventBus — Published Events

| Event | Publisher | Subscribers | Status |
|---|---|---|---|
| `MeetingProvisionedEvent` | `BbbMeetingService` | `BbbMetricsService` | ✅ Live |
| `GrantConsumedEvent` | `BbbReconciliationService` | Email plugin (capacity alerts) | ✅ Live |
| `RoomActivatedEvent` | `BbbRoomService` | `BbbMetricsService` | ✅ Live |
| `CapacityExhaustedEvent` | `BbbReconciliationService` | Email plugin | ✅ Live |
| `CapacityAlertEvent` | `BbbCapacityAlertJob` | Email plugin (→ SMS Phase 3) | ✅ Live — published by 15-minute cron job (CI-005) |
| `TrialAttendanceRecordedEvent` | `BbbWebhookProcessor` | Analytics (Phase 3) | ⚠️ Future — no publisher yet |
| `ArticleEvent` | `ArticleService` | Elasticsearch indexer (Phase 3) | ⚠️ Future |
| `PageEvent` | `PageService` | Elasticsearch indexer (Phase 3) | ⚠️ Future |

Events without subscribers are still correct to publish — they enable future extension without modifying the publisher.

### EQ-003: BullMQ Retry Policy

```typescript
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 1000 },   // keep last 1000 completed for audit
  removeOnFail: false,                  // never auto-remove failed jobs
};
```

Failed jobs are never auto-removed. Ops console or admin query surfaces them for manual replay.

---

## 10. Security Architecture

### SEC-005: Rate Limiting ✅ Fixed

Rate limiting applied to four surfaces via `express-rate-limit` middleware:

| Surface | Limit | Mechanism |
|---|---|---|
| `POST /bbb/webhook` | 100 req/min per IP | `bbbWebhookRateLimiter` — IP-based, with allowlist via `BBB_WEBHOOK_ALLOWED_IPS` env var |
| `registerForTrial` mutation | 10 req/min per customer | `shopApiRateLimiter` — inspects GraphQL body, keys by `activeUserId` or IP |
| `bbbJoinMeeting` mutation | 10 req/min per customer | `shopApiRateLimiter` — same mechanism, separate counter |
| `registerNewTenant` mutation | 5 req/hour per IP | `shopApiRateLimiter` — IP-keyed (no authenticated customer at registration time), 60-minute window |

**Current status:** ✅ Implemented. All limiters are Express middleware registered via `config.apiOptions.middleware` in the BBB plugin's `configuration()` function.

### SEC-006: Custom Domain TLS ✅ Fixed

Channel token → custom domain mapping stored in Redis for sub-millisecond lookup:

```
academy.com (CNAME → saa9vi.com)
  → DomainChannelMiddleware (Express, route: '*')
    → Redis: GET channel-token:{hostname}
    → Sets X-Vendure-Token header
  → Vendure API → RequestContext.channelId = lookup(channel-token)
```

**Current status:** ✅ Implemented. `DomainChannelResolverService` manages Redis key `channel-token:{domain}` with 7-day TTL, synced automatically in `TenantProfileService.create()` and `update()`. Redis failure fails open (unauthenticated request, not crash).

### SEC-001: Admin API Network Isolation

The Admin API (`/admin-api`) must not be exposed on a public-facing port or hostname in production. It should be bound to an internal interface or placed behind network-level access control. Caddy or the host firewall should block external access to the admin path. This is a deployment constraint, not enforced in plugin code.

### SEC-002: HMAC Webhook Verification ✅

`BbbWebhookController.verifyWebhookSignature` iterates all enabled servers and tries each secret — constant-time comparison via `crypto.timingSafeEqual`. Correct. No change needed.

### SEC-003: BBB Password Encryption ✅

AES-256-GCM encryption via `BbbEncryptionService` for `encryptedAttendeePassword` and `encryptedModeratorPassword` with `select: false` on columns. `encryptionKeyVersion` column added to `BbbServer` and `BbbMeeting`. Code-verified (cipher name confirmed in `BbbEncryptionService` class comments and entity jsdoc).

### SEC-004: Channel Isolation — Verified Access Points

Every external-facing resolver includes channel verification (code-verified):

- `BbbShopResolver.joinMeeting` — verifies enrollment/entitlement ✅
- `BbbAdminResolver.*` — requires `BbbAdminPermission` ✅
- `TenantAdminResolver.*` — requires scoped permissions ✅
- `TenantShopResolver.instructorProfiles` — public, filters by `channelId` from ctx ✅
- `TenantShopResolver.registerNewTenant` — `Permission.Public`, creates new Channel (no channel context needed) ✅
- `CmsShopResolver.articleBySlug` — filters by `channelId` and `isPublished` ✅
- `InstructorProfileService.findOne` — includes `channelId` filter ✅
- `MediaResourceService.findOne` — includes `channelId` filter ✅


---

## 11. Infrastructure & Deployment

### INF-001: Service Topology

```
                    ┌──────────────┐
                    │   Caddy      │  TLS termination + custom domain routing
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
    ┌─────────▼──┐  ┌──────▼─────┐  ┌──▼──────────┐
    │  Vendure   │  │  Next.js   │  │  BBB Server  │
    │  API       │  │  Storefront│  │  (self-hosted)│
    │  :3000     │  │  :4000     │  │  :8080        │
    └─────────┬──┘  └────────────┘  └──────────────┘
              │
    ┌─────────┼──────────────────┐
    │         │                  │
┌───▼──┐  ┌───▼──┐  ┌──────────▼──┐
│  PG  │  │Redis │  │Elasticsearch │
│  DB  │  │Cache │  │Search        │
└──────┘  └──────┘  └─────────────┘
```

### INF-002: Environment Variables

```bash
# Core
DATABASE_URL=postgres://...
REDIS_URL=redis://...

# BBB
BBB_DEFAULT_SERVER_URL=https://bbb.yourdomain.com/bigbluebutton/
BBB_WEBHOOK_SECRET=...

# Encryption
BBB_ENCRYPTION_KEY=...           # AES-256-GCM key, base64
BBB_ENCRYPTION_KEY_VERSION=1

# Juspay
JUSPAY_API_KEY=...
JUSPAY_MERCHANT_ID=...

# Elasticsearch
ELASTICSEARCH_URL=http://...
```

No secrets in source control. All secrets in environment or secrets manager.

### INF-003: Database Connection Pool

```typescript
// vendure-config.ts
dbConnectionOptions: {
  type: 'postgres',
  poolSize: 20,
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
}
```

BullMQ worker process uses a separate pool with `poolSize: 10`.

### INF-004: Health Checks

```
GET /health          → { db: ok, redis: ok, elasticsearch: ok }
GET /health/bbb      → { servers: [{ url, status, activeMeetings }] }
```

Caddy upstream health check polls `/health` every 10 seconds.

---

## 12. Known Bugs & Immediate Remediation

| ID | Severity | File | Description | Fix |
|---|---|---|---|---|
| BUG-001 | Critical | `TenantProfileDetail.tsx` | `useState` instead of `useEffect` — form never populates on edit | ✅ Fixed (prior sprint) |
| BUG-002 | Critical | `tenant-admin.resolver.ts` | `tenantProfile(channelId: '__current__')` always returns null | ✅ Fixed (prior sprint) |
| BUG-003 | High | `BbbWebhookController` | Webhook processed inline — no persist-first, no replay | ✅ Fixed — persist-first via `BbbWebhookEvent` + `BbbWebhookProcessorService` |
| BUG-004 | High | `BbbOrganizationService.create` | `channels[]` join table never populated | ✅ Fixed — `assignToCurrentChannel` called |
| BUG-005 | High | `BbbOrderFulfillmentListener` | Fulfillment resolved `productVariantId → BbbRoom`, not `→ BbbScheduledSession` | ✅ Fixed — dual-path: session → `BbbEntitlement`, room → `BbbEnrollment` |
| BUG-006 | Medium | `Article`, `Page` entities | Slug uniqueness application-level only — TOCTOU race | ✅ Fixed — composite unique index `(channelId, slug)` via migration `1782369776476-bugs` |
| BUG-007 | Medium | `PlansList.tsx` | `useEffect` dep on derived `organizations` — auto-select never fires | ✅ Fixed (prior sprint) |
| BUG-008 | Medium | `BbbMeeting`, `BbbServer` | No `encryptionKeyVersion` column | ✅ Fixed — column added via migration `1782369776476-bugs` |
| BUG-009 | Low | `BbbScheduledSession` | `(organizationId, slug)` composite unique missing | ✅ Fixed — composite index added, global unique dropped |
| BUG-010 | Low | Dashboard list pages (6 files) | `window.confirm` for destructive actions | ✅ Fixed — replaced with `Dialog` confirmation |
| BUG-011 | Low | `MembersList.tsx`, `EnrollmentsList.tsx` | Org auto-select never fires on first load | ✅ Fixed — `useEffect` auto-select added |
| BUG-012 | High | `constants.ts` | `STALE` meeting state absent from FSM | ✅ Fixed — `STALE` state added to `constants.ts`, transitions wired, reconciliation calls `markMeetingStale()` for missing BBB meetings |
| BUG-013 | Medium | `BbbReconciliationService` | `CapacityExhaustedEvent` not published when `billingCapped = true` | ✅ Fixed — `CapacityExhaustedEvent` class added and published from billing ceiling path |
| BUG-014 | Low | `BbbServerSelectionService` | `currentLoad` scoring semantics undocumented | ✅ Fixed — documented in `BbbServer` entity JSDoc and BB-003 section |
| BUG-015 | Medium | `CmsPlugin` / `BannerService` | `banner-activator` and `banner-deactivator` BullMQ queues not registered; banners filtered at query-time instead of via precomputed `isCurrentlyActive` | ✅ Fixed — `banner-activator` scheduled task registered, `isCurrentlyActive` replaces date-range comparisons in `BannerService.findActiveForPlacement()` |
| BUG-016 | High | `ReviewsPlugin` / `dashboard/index.tsx` | `navSections` entry uses `items: [...]` which does not exist on `DashboardNavSectionDefinition` — TS error 2353, Reviews menu invisible in admin dashboard | ✅ Fixed — remove `items` from `navSections`; add `navMenuItem` to `reviewList` route in `review-list.tsx` |
| BUG-017 | Medium | `ReviewsPlugin` / all review entities | `ProductReview`, `ReviewRequest`, `ReviewReport`, `ReviewReward`, `ReviewVote` do not implement `ChannelAware` — channel isolation relies solely on explicit `ctx.channelId` WHERE clauses in services; ORM provides no guard against missed query paths | ⚠️ Pending — add `ChannelAware` + `@ManyToMany(() => Channel)` to `ProductReview` as minimum; backfill join table from existing `channelId` strings via migration |
| BUG-018 | Medium | `BbbShopResolver.joinRoom()` / `BbbMeetingService.joinRoom()` | `buildJoinUrl()` moderator role-routing has no trigger path — no entity exists to distinguish staff members from students, so all users receive the attendee password regardless of their organizational role | ✅ Fixed — FEAT-001 `BbbOrganizationMembership` entity + `BbbMembershipService` created; Gate 1 short-circuit in `joinRoom()` checks active membership before entitlement check; role-based `provisionAndJoin()` routes org_admin/moderator → MODERATOR URL, staff → VIEWER URL |
| BUG-019 | High | `LoadSimulationPlugin` / `load-simulation.plugin.ts` | `runLoadTest` is exposed on the public Shop API via `shopApiExtensions`, creating a DoS vector — any unauthenticated caller can trigger a sustained load test against the platform | ✅ Fixed — moved to `adminApiExtensions`, `@Allow(Permission.SuperAdmin)` applied to resolver |
| BUG-020 | Medium | `CausalMapper` / `bbb-admin.schema.ts` | `SIMULATE_BBB_WEBHOOK_MUTATION` is referenced in `CausalMapper` but `simulateBbbWebhook` resolver does not exist in `BbbAdminResolver` — load tests silently fail on every `BbbWebhookEvent` lifecycle step | ✅ Fixed — `BbbWebhookEvent` step returns `isPending: true` in `CausalMapper`; skipped cleanly by `LoadOrchestrator` until resolver is implemented |
| BUG-021 | High | `TenantProfileService.create()` | `channelOrToken` parameter passed as raw `Channel` entity object to `RequestContextService.create()` instead of `channel.token` string — causes `TypeError: channelOrToken.startsWith is not a function` on tenant profile creation | ✅ Fixed — resolved `Channel` entity to `channel.token` string before passing to `RequestContextService.create()` |
| BUG-022 | P0 | `bbb-shop.resolver.ts` | `bbbRoomStatus`, `myBbbRooms`, and `myBbbEnrollments` read from `BbbEnrollment` only, while `BbbOrderFulfillmentListener` writes `BbbEntitlement` for room purchases. A paying customer's room never appears in their dashboard and `bbbRoomStatus` throws `ForbiddenError`, even though `bbbJoinRoom` would work. | ⚠️ Pending — add `entitlementService.hasAccess(ctx, customerId, "bbb_room", id)` checks to `bbbRoomStatus` and `myBbbRooms`; deprecate `myBbbEnrollments` in favor of `myLearningDashboard` |
| BUG-023 | P1 | `marketplace-indexer.service.ts` | `academySlug` hardcoded to `''`, `channelToken` set to raw `channelId` instead of `Channel.token`, `customDomain` not indexed. Marketplace search results have no usable redirect URL. | ⚠️ Pending — fetch `BbbOrganization.slug` from session.organization relation, query `Channel.token` by channelId, index `TenantProfile.customDomain` |
| BUG-024 | P2 | `TenantRegistrationService` | `ShippingMethod`/`StockLocation`/`PaymentMethod` not auto-provisioned for new channels. A freshly registered tenant has zero working payment methods and shipping configurations. | ⚠️ Pending — extend `TenantRegistrationService` to auto-provision default `ShippingMethod`, `StockLocation`, and `PaymentMethod` for new channels |

---

## 13. Production Readiness Checklist

### Security

- [x] HMAC verification on all BBB webhooks ✅
- [x] AES-256-GCM on BBB passwords ✅
- [x] `encryptionKeyVersion` column on encrypted entities ✅
- [ ] Admin API bound to internal interface only ⚠️ Deployment constraint (SEC-001)
- [x] Rate limiting on public mutations ✅ (SEC-005)
- [x] Channel isolation verified on all public resolvers ✅
- [ ] No secrets in source control

### Data Integrity

- [x] All slug-bearing entities have composite `(channelId, slug)` DB unique indexes
  - [x] `BbbScheduledSession` ✅ (organizationId, slug) composite
  - [x] `Article` ✅ via migration `1782369776476-bugs`
  - [x] `Page` ✅ via migration `1782369776476-bugs`
- [x] `BbbUsageLedger` has `(meetingId, grantId)` unique index ✅
- [x] `BbbOrganization.channelId` has unique index ✅
- [x] All migrations have `down()` implemented ✅
- [x] `synchronize: false` in all environments ✅

### Commerce Loop

- [x] `BbbScheduledSession.productVariantId` connected in fulfillment handler ✅
- [x] Trial registration creates `Entitlement` ✅
- [x] `getJoinUrl` access check uses `BbbEntitlementService.hasAccess` ✅

### Operational

- [x] `BbbWebhookEvent` persist-first pipeline live ✅
- [ ] Failed webhook jobs surfaced in admin UI
- [x] `BbbWebhookProcessorService` queue initialized in `onApplicationBootstrap` ✅
- [x] `BbbReconciliationService` scheduled task running ✅
- [x] `STALE` meeting FSM state added ✅ BUG-012 fixed
- [x] `CapacityExhaustedEvent` published on billing cap ✅ BUG-013 fixed
- [x] `currentLoad` scoring semantics documented ✅ BUG-014 fixed
- [x] Banner BullMQ queues registered (`banner-activator`) ✅ BUG-015
- [ ] Health check endpoints responding
- [x] Custom domain → channel token Redis mapping ✅ (SEC-006)

### Tenant Registration System

- [x] `TenantRegistrationLog` entity with append-only pattern ✅
- [x] `TenantRegistrationService` 5-step orchestration (Seller → Channel → Role → Administrator → TenantProfile) ✅
- [x] `registerNewTenant` Shop API mutation (`Permission.Public`) ✅
- [x] `TENANT_ADMIN_ROLE_PERMISSIONS` constant with channel-scoped permissions ✅
- [x] BUG-021 fixed — `channelOrToken` resolved to `channel.token` string ✅
- [x] Rate limiting on `registerNewTenant` mutation (SEC-004) ✅ Done
- [ ] Email verification flow for new tenant administrators ⚠️ Phase 1.5
- [ ] Auto-provision ShippingMethod and StockLocation for new channels ⚠️ Phase 1.5

### Customer Deletion System

- [x] `CustomerDeletionService` with cross-plugin orchestration ✅
- [x] BBB plugin handler (anonymize enrollments, entitlements; preserve ledger) ✅
- [x] Tenant plugin handler (anonymize InstructorProfile, MediaResource) ✅
- [x] Reviews plugin handler (anonymize ProductReview.authorName, deactivate ReviewRequest) ✅
- [x] `CustomerDeletionLog` entity with status tracking ✅
- [x] `leaveAcademy` Shop API mutation (password confirmation) ✅
- [x] `deleteMyAccount` Shop API mutation (password confirmation) ✅
- [ ] End-to-end deletion flow tested across all three plugins ⚠️ Pre-production

### Dashboard

- [x] `TenantProfileDetail.tsx` useState→useEffect bug fixed ✅ (prior)
- [x] Resolver `__current__` bug fixed ✅ (prior)
- [x] `PlansList.tsx` auto-select bug fixed ✅ (prior)
- [x] `MembersList.tsx` / `EnrollmentsList.tsx` org auto-select ✅
- [x] `window.confirm` replacements in 6 files ✅
- [x] Reviews dashboard nav fix applied (BUG-016) ✅

---

## 14. Phase Roadmap

### Phase 1 — Commercial Operability (current sprint)

**Completed:**

- `BbbWebhookEvent` persist-first pipeline ✅
- `BbbScheduledSession` connected in fulfillment path ✅
- `BbbEntitlement` entity + service for `bbb_session` ✅
- Trial registration creates `Entitlement` automatically ✅
- `BbbMeetingService.getJoinUrl` checks Entitlement for session access ✅
- `BbbScheduledSession` `(organizationId, slug)` composite index ✅

**Remaining before first tenant onboarding:**

- Rate limiting on public mutations (SEC-004)

Note: `CapacityExhaustedEvent` (BUG-013 / BB-004) is now implemented and published from the reconciliation billing-ceiling path. `currentLoad` scoring semantics are documented in `BbbServer` entity JSDoc and BB-003 section.

### Phase 1.5 — Trust Engine & Discovery

**Current state (code-verified):**

- `BbbEntitlement` entity + service exist and are live for `bbb_session` access checks ✅
- `BbbMeetingService.joinRoom()` migrated to `BbbEntitlement` for room access ✅ `BbbEnrollment` rows retained as audit trail
- `InstructorProfile` entity exists in `TenantPlugin` with public query `findPublicByChannel` / `findPublicBySlug` ✅
- Elasticsearch indexing for instructors: ✅ Done — `InstructorIndexerService` implemented and wired into `InstructorProfileService.create/update/delete` (was pending as of v1.6, corrected in v1.7)
- Public instructor profile pages in Next.js: ⚠️ pending — storefront rendering not started
- CMS pages served from Next.js with SEO metadata: ⚠️ pending — `CmsShopResolver` exists but Next.js page renderer not implemented
- `BbbEntitlement` admin UI: ✅ Added — GraphQL queries/mutations (`bbbEntitlements`, `createBbbEntitlement`, `deleteBbbEntitlement`) and `/bbb/entitlements` dashboard route registered
- **Scheduled Sessions admin UI:** ✅ Added — Educational session management boundary introduced. Added dedicated `bbbScheduledSession(id)` query, `bbbScheduledSessions(organizationId)` list query, and `cancelBbbScheduledSession` mutation. Dashboard routes `/bbb/sessions` and `/bbb/sessions/$id` provide session lifecycle visibility through Session Information, Commercial Reference, and Live Runtime views while keeping Meeting infrastructure separate.
- **FEAT-001** (`BbbOrganizationMembership`) and **FEAT-002** (`internal_overhead` capacity grant): ✅ Both code-complete (see §8A OP-007). FEAT-002's schema migration is still outstanding.

**Phase 1.5 room-access migration (Interim State):**

- `joinRoom()` auth check uses `entitlementService.hasAccess(ctx, customerId, 'bbb_room', roomId)` ✅
- `BbbOrderFulfillmentListener` room product path writes `BbbEntitlement { type: 'bbb_room' }` ✅
- ⚠️ **Partial Gap:** `TrialRegistrationService.convertToEnrollment()` still bridges trial registrations to legacy `BbbEnrollment` records. This is a **frozen interim state** retained for audit trails — the primary join path uses `BbbEntitlement`, but trial conversion writes the old entity. Full cleanup is a Phase 1.5 remaining blocker.
- Admin resolver and schema updated; dashboard fragment updated ✅

**Remaining blockers before Phase 1.5 completion:**

1. Run the FEAT-002 schema migration (`npx vendure migrate create && npx vendure migrate up`) — code is complete, DB is not
2. Build Next.js storefront pages for public instructor profiles and CMS pages
3. `myLearningDashboard` Shop API query (ADR-013 INV-006) — ✅ Done — `GrantReaderService` implemented, `myLearningDashboard` query registered in BBB admin resolver, returns active grants with consumed/total minutes per organization
4. Rate limiting on `registerNewTenant` mutation (SEC-004) — ✅ Done — `shopApiRateLimiter` extended to cover `registerNewTenant` mutation
5. Custom domain → channel token Redis mapping — ✅ Done — `DomainChannelResolverService` manages `channel-token:{domain}` keys with 7-day TTL, synced on `TenantProfileService.create/update`
6. Email verification flow for new tenant administrators — Phase 1.5
7. Auto-provision ShippingMethod and StockLocation for new channels — Phase 1.5
8. End-to-end customer deletion flow tested across all three plugins — Pre-production
9. Load estimation ratios tuned from first 2 weeks of `BbbUsageLedger` data — Phase 1.5
10. BUG-017 remediation — add `ChannelAware` to `ProductReview` — Phase 1.5
11. **BUG-022 (P0)** — Fix `bbbRoomStatus`, `myBbbRooms`, `myBbbEnrollments` to read from `BbbEntitlement` in addition to `BbbEnrollment` — Phase 1.5
12. **BUG-023 (P1)** — Fix `MarketplaceIndexerService` to populate `academySlug` from `BbbOrganization.slug`, `channelToken` from `Channel.token`, and index `TenantProfile.customDomain` — Phase 1.5
13. **BUG-024 (P2)** — Auto-provision `PaymentMethod` in addition to `ShippingMethod`/`StockLocation` for new channels — Phase 1.5

### Phase 2 — Subscription Billing

Deliverables:

- `SubscriptionPlan` and `OrganizationSubscription` entities
- `BbbCapacityGrant.sourceType` discriminator
- Monthly invoice generation job
- Juspay recurring billing integration
- Tenant onboarding flow in storefront
- `NavigationMenu` entity in CMS
- Banner BullMQ scheduling (CMS-002)
- Custom domain routing via Caddy

### Phase 3 — Marketplace & Retention

**Model:** Shopify/Kajabi model (NOT multivendor order-split model — see DL-019). Each academy is an isolated storefront. The marketplace is a platform-level discovery layer, not a cross-academy cart.

**Revenue Streams enabled by Phase 3:**

- **Stream 2:** Marketplace commission (5–15%) on `orderSource = 'marketplace'` orders only. Zero commission on direct traffic.
- **Stream 3A:** Sponsored listings — `BbbScheduledSession` and `TenantProfile` promoted in Elasticsearch results via bid-boost multiplier.
- **Stream 3B:** Marketplace banners — `Banner.scope = 'marketplace'` banners served on `marketplace.saa9vi.com`.

**Deliverables:**

*Discovery Layer*

- `MarketplaceIndexerPlugin` — event-driven BullMQ jobs subscribed to `ProductVariantEvent` and `InstructorProfileUpdatedEvent`; writes `saa9vi_marketplace_sessions` and `saa9vi_marketplace_instructors` Elasticsearch indices (platform-level, not per-tenant). `BbbScheduledSession.productVariantId` is the bridge — the plugin reads `Product.customFields.bbbSessionId` to join to BBB session data.
- **Required `Product` custom fields** (add to `vendure-config.ts` before Phase 3): `bbbSessionId: string` and `instructorProfileId: string` (both nullable, non-public). Set in `BbbScheduledSessionService.create()` when a `productVariantId` is provided.
- **Default channel isolation (DL-027):** Vendure assigns new products to both the default channel and the tenant channel by default. Session products must be restricted to the **tenant channel only** — the default channel must never become an accidental cross-tenant product listing. The marketplace ES index is the correct discovery surface.
- `MarketplaceSearchResolver` (Shop API, no channel context) — public discovery queries
- `MarketplaceAcademyPage` — aggregated view: `TenantProfile` + public sessions + review rating
- `MarketplaceCategoryIndex` — subject taxonomy (JEE, NEET, CA, coding, language, fitness, etc.)
- `RankingMaterializedView` (Postgres) — `BayesianRatingService` score refreshed by indexer; prevents review gaming

*Attribution & Commission*

- `Order.customFields.orderSource: 'marketplace' | 'direct' | 'referral'` — **INV-008 enforced:** the storefront passes a raw `referrerCode` or `utm_source` to the checkout mutation; Vendure-side `OrderProcess` logic classifies and stamps the field. The storefront never makes this business decision directly.
- `CommissionLedger` — append-only, records platform fee per `orderSource = 'marketplace'` order

*Advertising (Stream 3)*

- **FEAT-003:** `MarketplaceAdCampaign` + `AdSpendLedger` entities (see INV-010)
- **FEAT-003:** `AdWallet` + `AdWalletLedger` — prepaid wallet per academy, top-up via Juspay
- **FEAT-004:** `Banner.scope: 'tenant' | 'marketplace'` discriminator + `MarketplaceBannerService`
- Elasticsearch bid-boost for sponsored sessions (see INV-009)
- Self-serve campaign dashboard (admin UI extension)

*Engagement & Retention*

- `Review` entity with composite ranking materialised view
- Elasticsearch instructor/course search with channel-scoped indices (per-tenant) + platform index
- Attendance analytics dashboard
- Certificate generation on `Entitlement` completion
- `bbbSession` CMS section type (CMS-004)
- `ArticleEvent` / `PageEvent` → Elasticsearch indexer

*Vendure Seller Integration*

- Ensure `TenantProfile` has 1:1 FK to Vendure `Seller` entity
- Use `Seller`-scoped admin roles for per-academy dashboard access (no custom RBAC needed)
- Do **not** install the example `multivendor-plugin` (DL-019)

### Phase 4 — Scale & Premium

Deliverables:

- White-label theming via `TenantProfile.theme`
- TimescaleDB for BBB event-heavy analytics
- AI features (meeting summary, CMS content writer, review summarisation) — feature flags on stable data model
- Multi-BBB-server geographic routing
- Student Corner (CMS-native) — career options, placement partners, internship listings as `PageSection` types; no new plugin required; channel-scoped CMS pages per academy
- Cross-academy placement network (requires deliberate break of channel isolation — ADR-level decision deferred)
- 3CX telephony bridge for academy CRM (operator-facing Admin API integration, not student-facing)

---

## 15. Decision Log

| ID | Decision | Rationale | Alternatives Rejected |
|---|---|---|---|
| DL-001 | Channel = Tenant as sole identity system | Vendure's `RequestContext` and `ListQueryBuilder` provide automatic channel scoping at framework level | Separate `tenantId` column (dual source of truth), separate database per tenant (operational overhead) |
| DL-002 | BbbEnrollment interim, Entitlement target | Generalizing now prevents 5 separate access tables in 18 months | Keep `BbbEnrollment` forever (accumulates tech debt per new product type) |
| DL-003 | `channels[]` ManyToMany + `channelId` scalar on same entity | `channels[]` enables framework tooling; `channelId` scalar enables efficient direct joins | `channelId` scalar only (loses framework channel-safety), `channels[]` only (loses query efficiency) |
| DL-004 | Append-only `BbbUsageLedger` | Immutable billing facts; no retroactive mutation risk; enables audit | Live calculation from `BbbMeeting.durationMinutes` (fragile, mutation risk) |
| DL-005 | Webhook persist-before-process | Enables replay, audit, recovery; idempotency guaranteed by job deduplication | Inline processing (no replay, silent loss on crash) |
| DL-006 | `BbbScheduledSession` as the commercial product entity | Trainers sell scheduled time slots, not abstract rooms; marketplace requires browsable sessions with price and capacity | `BbbRoom` as the product entity (too abstract, no time dimension) |
| DL-007 | Postgres for all transactional data, Elasticsearch for search | Single source of truth in PG; ES as a derived read projection rebuilt on event | Dual-write to ES (synchronization failures), PG-only search (performance degrades at 10K+ instructors) |
| DL-008 | Self-hosted BBB | Data residency (India), cost control, integration depth | Zoom/Meet (no API for room-level access control), BBB SaaS (loses per-meeting credential control) |
| DL-009 | Caddy for reverse proxy and custom domain TLS | Automatic Let's Encrypt; Caddyfile is programmable via Admin API | Nginx (manual cert management), Traefik (more complex for this use case) |
| DL-010 | `InstructorProfile` not `ChannelAware` — explicit `channelId` WHERE clause | 1:N channel-to-instructors; `assignToCurrentChannel` overhead per create not warranted; all queries are explicit and code-verified | Full `ChannelAware` implementation (adds join table, no practical benefit) |
| DL-011 | `BbbEntitlement` not `ChannelAware` — scalar `channelId` only | Same pattern as DL-010: simple access checks rarely need the join table | Full `ChannelAware` implementation (adds join table with no query-benefit at current access-check volume) |
| DL-012 | `BbbScheduledSession` uses `(organizationId, slug)` not `(channelId, slug)` | Sessions are scoped to organizations. Org-to-channel is 1:1 making org-scoped slugs equivalent to channel-scoped slugs while matching domain semantics | `(channelId, slug)` composite (requires joining org to resolve channel for every slug lookup) |
| DL-013 | `BbbWebhookEvent` uses `simple-json` not `jsonb` payload | Keeps Postgres as the only DB dependency; avoids migration if switching DB provider; no query-time JSON-path queries needed | `jsonb` (enables PG-specific JSON queries not needed for the replay/audit use case) |
| DL-014 | `BbbServerSelectionService` uses opaque `currentLoad` integer | Decouples selection algorithm from scoring formula; reconciliation service owns scoring logic and can evolve it without touching selection | Hard-coded `activeMeetingCount × avgParticipants` formula inside selection service (couples two concerns) |
| DL-015 | `navMenuItem` on route definitions, never `items` inside `navSections` | `DashboardNavSectionDefinition` type constraint enforced by TypeScript; confirmed by BBB and Tenant plugin code audit | `items` array inside section (fails at compile time — TS-2353) |
| DL-016 | Single shared Next.js storefront served across all tenants; tenant identity resolved from hostname | Eliminates per-tenant code deployments; backend plugin evolution is decoupled from storefront deployments; matches Shopify/Kajabi/Teachable operating model at scale | Per-tenant Next.js fork (500 tenants = 500 deployment pipelines); iframe embedding (SEO dead, mobile broken) |
| DL-017 | `BbbOrganizationMembership` uses scalar `channelId` without `ChannelAware` (DL-010 pattern) | Membership checks are high-frequency, low-data-volume queries. The join table overhead of full `ChannelAware` implementation adds no practical channel-safety benefit since all queries include explicit `organizationId` which already implies the channel via the 1:1 org-to-channel mapping | Full `ChannelAware` implementation (adds join table, redundant with org-scoped filter) |
| DL-018 | Internal room access via organizational membership check as a waterfall gate prior to entitlement check, not as a separate access-control system | Preserves INV-003 (one access-control system). Membership short-circuits the waterfall rather than replacing it. Commercial and internal access paths are additive, not competing | Separate `InternalRoomAccess` entity (creates a second access-control system, violates INV-003); adding `isInternal` flag to `BbbRoom` and bypassing all checks (no audit trail) |
| DL-019 | Vendure `multivendor-plugin` (example plugin) rejected for Saa9vi marketplace | The plugin implements cross-vendor order splitting (`OrderSellerStrategy`, `ShippingLineAssignmentStrategy`, aggregate order FSM) for the Amazon/Etsy model where a single cart contains products from multiple sellers. Saa9vi uses the Shopify/Kajabi model — each academy is an isolated storefront; cross-academy carts do not exist. Installing the plugin would conflict with `BbbOrderFulfillmentListener` and `TenantProfileService`. The Saa9vi marketplace is a platform-level Elasticsearch read projection, not a cross-channel commerce engine | Vendure multivendor-plugin (wrong data model); separate marketplace microservice (operational overhead, dual source of truth) |
| DL-020 | Platform-level Elasticsearch index spans all channels for marketplace discovery | Marketplace discovery requires reading across tenant boundaries. A single platform index (`saa9vi_marketplace_sessions`) is a derived read projection — PG remains authoritative per-channel. INV-001 (Channel = Tenant for writes) is preserved | Per-tenant index only (no cross-tenant discovery); PG-only search (performance degrades at 10K+ sessions) |
| DL-021 | Three-stream revenue model: subscription + commission + advertising | Streams are additive and reinforce each other. Subscription provides predictable base revenue. Commission aligns Saa9vi's growth with academy growth. Advertising creates a self-serve high-margin stream. Zero commission on direct traffic protects academy relationships | Single-stream SaaS only (leaves growth revenue on table); commission on all traffic (penalises academies for existing students, risks churn) |
| DL-022 | Sponsored listings use Elasticsearch function-score bid-boost, not position injection | Bid-boost multiplier (`weight: 3.0` on `isSponsored: true`) integrates cleanly with existing `bayesianRating` function score. Organic ranking below sponsored results. Organic ordering is never manipulated. | Position injection (couples ranking and ad logic, fragile); separate sponsored endpoint (bad UX, no interleaving) |
| DL-025 | Proactive capacity intelligence over reactive throttling | The education context makes reactive throttling uniquely harmful — a live class with enrolled students cannot be cancelled at provisioning time. A 48-hour forecast with 15-minute alert cadence gives operators enough warning to add infrastructure before any student is affected. See INV-012 and §6A. | Hard capacity ceiling blocking meetings (rejected — INV-012); per-join capacity checks (too late — meeting already provisioned); cloud auto-scaling (deferred to Phase 4 — current BBB servers are self-hosted) |
| DL-026 | `SubscriptionEntitlement` as pure computed state accepts a time-driven FSM race condition | Access is computed at runtime from `SubscriptionEnrollment.status`. The transition `IN_GRACE → SUSPENDED` is driven by an async BullMQ cron job — a student technically past grace expiry retains access until the job processes. In a live education billing context, granting a few extra minutes during a queue delay is an acceptable business tolerance and vastly preferable to the complexity of persisting and syncing a duplicate access state. | Persisting `SubscriptionEntitlement` explicitly (creates fragile sync between billing state and access state, introduces drift risk on job failure) |
| DL-027 | Session products are assigned to the tenant channel only — never to the default channel | Vendure assigns new products to both the default channel and the current channel by default. Allowing session products on the default channel would create an accidental cross-tenant product listing visible to all storefronts. The marketplace ES index (`saa9vi_marketplace_sessions`) is the correct and only cross-tenant discovery surface. This must be enforced via a custom `ProductChannelMappingStrategy` or by explicitly removing default channel assignment in `BbbScheduledSessionService.create()`. | Allow default channel assignment (creates uncontrolled cross-tenant product leakage); per-tenant index only for discovery (acceptable for Phase 1.5; not scalable for Phase 3 marketplace) |
| DL-028 | `TenantRegistrationLog` uses append-only pattern (INV-004) — PENDING → COMPLETED/FAILED transition only, rows never updated after final status | Registration is a critical platform operation. Append-only logging provides an immutable audit trail for every tenant creation attempt, enabling retrospective analysis of registration failures and abuse patterns. The pattern mirrors `BbbWebhookEvent` (DL-005) and `BbbUsageLedger` (DL-004). | Mutable `TenantRegistrationLog` (loses audit trail on failure); no log at all (no observability into registration failures) |
| DL-029 | `TenantProfileService.create()` resolves `Channel` entity to `channel.token` string before passing to `RequestContextService.create()` | `RequestContextService.create()` expects a `channelToken: string` parameter. Passing a raw `Channel` entity object causes `TypeError: channelOrToken.startsWith is not a function` because the method calls `.startsWith()` on the first argument. The fix resolves the entity to its `.token` string property before the call. | Passing `Channel` entity directly (crashes with TypeError); refactoring `RequestContextService.create()` to accept both types (adds complexity to a Vendure core method) |
| DL-030 | `CommissionLedger` always writes a row per marketplace order, even at 0% rate ($0 rows). Env var is `MARKETPLACE_COMMISSION_PERCENT` (not `PLATFORM_FEE_PERCENT`). | Three-stream revenue model has three separate control mechanisms. Stream 2 (marketplace commission) is the only one where "the event happened but the rate is zero" is a recurring state worth recording. Writing $0 rows preserves complete `orderSource = 'marketplace'` GMV history so future rate changes have full historical data. The env var name must be unambiguous about which stream it controls — `PLATFORM_FEE_PERCENT` would incorrectly imply it also controls Stream 1 (tenant billing) or Stream 3 (advertising). | `PLATFORM_FEE_PERCENT` (ambiguous — reads like it controls all three streams); not writing $0 rows (loses GMV history when rate is turned up later); applying $0-row pattern to Stream 1 or 3 (incorrect — absence of rows in those streams correctly means no usage/no ad spend) |

---

## ADR-013: Frontend Independence & API Evolution

**Status:** Active
**Date:** 2026-06
**Trigger:** Platform scaling constraint — per-tenant storefront deployments become unmanageable at 50+ tenants. Plugin API surface must not be exposed directly to storefronts.

---

### The Problem This ADR Solves

If the storefront consumes internal plugin entities directly (e.g., queries `bbbEnrollment`, `bbbEntitlement`, `bbbScheduledSession` by name), then every plugin refactor requires a matching storefront deployment. At 500 academies running the same codebase, this is still **one deployment**, but at the code level every GraphQL field rename is still a breaking change. The invariants below prevent that class of breakage entirely.

---

### INV-005: One Shared Storefront. Tenants Own Content, Not Code.

```
              Saa9vi Cloud

           One Vendure Backend        One Next.js Storefront
                  │                           │
        BBB Plugin                   Hostname → Channel Resolver
        CMS Plugin                           │
        Tenant Plugin          ┌─────────────┼─────────────┐
        Reviews Plugin         │             │             │
                  │       academyA.com  academyB.com  academyC.com
           Shop GraphQL API
                  │
           (stable domain API)
```

Each academy customises: logo, theme, CMS pages, products, instructors, BBB rooms, custom domain.

Each academy does **not** own: application code, GraphQL queries, business rule evaluation.

**Operational consequence:** A backend plugin deployment (`bbb-plugin v1.5`) takes effect immediately for all tenants. A storefront deployment likewise updates all tenant sites. Neither requires coordinating with individual tenants.

**Rejection criterion:** Any architecture that requires per-tenant code fork, per-tenant build pipeline, or per-tenant deployment of the Next.js storefront is rejected.

---

### INV-006: Storefronts Consume Domain APIs, Not Plugin Internals.

The storefront must query **domain-oriented GraphQL operations** that hide internal plugin structure. Plugin-internal entity names, field names, and relationship traversals are implementation details.

**Good — domain API:**

```graphql
query MyLearningDashboard {
    myLearningDashboard {
        courses {
            id
            title
            canJoin
            joinUrl
            nextSession { startsAt endsAt }
            progress
            instructorName
        }
    }
}
```

**Bad — plugin internals exposed:**

```graphql
query {
    bbbEnrollments { bbbRoom { bbbScheduledSessions { ... } } }
    bbbEntitlements(type: "bbb_session") { ... }
}
```

When `BbbEnrollment` is retired and replaced entirely by `BbbEntitlement` (Phase 1.5), the domain API (`myLearningDashboard`) does not change. The storefront does not redeploy.

**Rejection criterion:** Any Shop API resolver that exposes a plugin-prefixed type (`Bbb*`, `Cms*`) as a top-level storefront query is rejected. These types may exist as internal return types on domain queries.

---

### INV-007: GraphQL Schema Changes Are Additive. Breaking Changes Are Prohibited.

Schema evolution must follow this order:

1. **Add** the new field / argument alongside the old one.
2. **Mark old field `@deprecated`** with migration guidance in the deprecation message.
3. **Keep old field working** for at minimum one major release cycle.
4. **Remove** only after all consumers (storefront queries, mobile clients) have migrated.


```graphql
# ✅ Correct evolution
type Query {
    joinMeeting(input: JoinMeetingInput!): JoinMeetingResult!
    # @deprecated — use joinSession which supports timezone and device hints
    joinMeetingLegacy(meetingId: ID!): String
}

# ❌ Breaking change — prohibited
type Query {
    # removed joinMeeting without deprecation period
    joinScheduledSession(input: JoinSessionInput!): JoinSessionResult!
}
```

**Input types evolve via optional fields:**

```graphql
# v1 — storefront sends { meetingId }
# v2 — storefront still sends { meetingId }, new fields are optional
input JoinMeetingInput {
    meetingId: ID!
    timezone: String         # optional, added in v2, old clients send nothing
    deviceType: DeviceType   # optional, added in v2
}
```

**Rejection criterion:** Any PR that removes or renames a GraphQL field or required argument without a prior deprecation cycle is rejected.

---

### INV-008: Business Logic Lives in Vendure. The Storefront Is a Renderer.

Access control, eligibility checks, pricing, capacity enforcement, trial rules, and fulfillment decisions must be evaluated by Vendure plugins — never by the Next.js storefront.

**Bad (logic in storefront):**
```tsx
// next.js page component
if (enrollment) { showJoinButton() }
else if (trial && !trialExpired) { showTrialJoinButton() }
else if (subscription?.status === 'active') { showJoinButton() }
else { showPurchaseButton() }
```

**Good (logic in Vendure, render in Next.js):**

```graphql
query CourseAccess($courseId: ID!) {
    courseAccess(courseId: $courseId) {
        canJoin       # Vendure evaluated all paths
        joinUrl       # populated only when canJoin
        ctaLabel      # "Join" | "Start trial" | "Purchase"
        ctaAction     # "join" | "trial" | "checkout"
    }
}
```

```tsx
// next.js — pure render
<Button onClick={() => handleAction(access.ctaAction)}>
    {access.ctaLabel}
</Button>
```

**Rationale:** When the access model changes (new Entitlement type, new subscription tier, new trial logic), Vendure is updated once. The storefront render code does not change. No frontend deployment is required.

---

### Implementation Checklist

- [ ] Define `myLearningDashboard` Shop API query (Phase 1.5) — aggregates across `BbbEntitlement`, `BbbEnrollment`, `BbbScheduledSession` into a single frontend contract
- [ ] Define `courseAccess(courseId)` Shop API query — returns `{ canJoin, joinUrl, ctaLabel, ctaAction }`
- [ ] Custom domain → Channel token resolver in Next.js middleware (hostname → `channelToken` via Redis lookup populated by `TenantProfile.customDomain`)
- [ ] GraphQL deprecation linting rule in CI — fail build if deprecated field is queried in storefront codebase
- [ ] No `Bbb*` / `Cms*` prefixed types in storefront GraphQL query files (lint rule)

---

---

## ADR-014: Revenue Model & Marketplace Architecture

**Status:** Active
**Date:** 2026-06
**Trigger:** Platform strategic review — Phase 1 commerce loop complete, Phase 3 marketplace design requires locking a business model and ruling out incompatible architectural patterns.

---

### The Three-Stream Revenue Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    SAA9VI REVENUE STREAMS                        │
├──────────────────┬──────────────────┬───────────────────────────┤
│  Stream 1        │  Stream 2        │  Stream 3                 │
│  Tenant Billing  │  Marketplace     │  Advertising              │
│  (BBB usage +    │  Commission      │                           │
│   portal/hosting)│                  │                           │
│                  │                  │                           │
│  Usage-driven    │  % of order,     │  Opt-in, tenant-initiated │
│  from day one    │  only when       │  via AdWallet top-up      │
│  via             │  orderSource =   │  (Juspay)                 │
│  BbbCapacityGrant│  'marketplace'   │                           │
│  /BbbUsageLedger │                  │                           │
│                  │                  │                           │
│  Control: none   │  Control:        │  Control: none (tenant    │
│  (always on)     │  MARKETPLACE_    │  decides whether to       │
│                  │  COMMISSION_     │  advertise)               │
│                  │  PERCENT env var │                           │
│                  │  (default 0%)    │                           │
│                  │                  │                           │
│  Ledger: rows    │  Ledger: ALWAYS  │  Ledger: rows only on     │
│  only on actual  │  write a row per │  actual impression/click/ │
│  usage (no usage │  marketplace     │  conversion for tenants   │
│  = no rows,      │  order, even at  │  who opted in (no rows =  │
│  which is        │  0% — $0 rows    │  no ad spend, correct)    │
│  correct)        │  preserve GMV    │                           │
│                  │  history for     │                           │
│                  │  future rate     │                           │
│                  │  changes         │                           │
└──────────────────┴──────────────────┴───────────────────────────┘
```

**Key property:** Zero commission on direct traffic. A student who goes directly to `mehta.saa9vi.com` never generates a platform commission. Only `orderSource = 'marketplace'` orders are subject to Stream 2. This is the merchant-friendly design that prevents churn.

**CommissionLedger $0-row pattern (Stream 2 only):** `CommissionLedger` rows are written for every marketplace order regardless of the current `MARKETPLACE_COMMISSION_PERCENT` rate. When the rate is 0%, rows are written with `amountInPaise: 0`. This preserves complete `orderSource = 'marketplace'` GMV history so that when the rate is turned up in the future, every qualifying order is already recorded. This pattern does **not** apply to Stream 1 (`BbbUsageLedger` — usage-driven, absence of rows correctly means no usage) or Stream 3 (`AdSpendLedger` — opt-in only, absence of rows correctly means no ad spend). See DL-030.

---

### Marketplace Data Architecture

```
                    SAA9VI MARKETPLACE

Per-tenant (existing)              Platform-level (Phase 3)
═════════════════════              ════════════════════════
channel_A → PostgreSQL      ──┐
channel_B → PostgreSQL      ──┼──→ ProductVariantEvent (Vendure EventBus)
channel_C → PostgreSQL      ──┘    MarketplaceIndexerPlugin reads
                                   Product.customFields.bbbSessionId
                                   → BbbScheduledSession join
                                         │
                                         ▼
                              saa9vi_marketplace_sessions (ES)
                              saa9vi_marketplace_instructors (ES)
                                         │
                                         ▼
                              MarketplaceSearchResolver
                              (public Shop API, no channel token)
                                         │
                              ┌──────────┼──────────┐
                              │          │          │
                         Organic    Sponsored   Banners
                         Results    (bid-boost) (scope=marketplace)
```

**INV-009 enforced:** The Elasticsearch indices are read-only projections. All writes (orders, entitlements, billing) go through channel-scoped Vendure Shop API as always.

---

### FEAT-003: Marketplace Advertising Entities

```typescript
// Entities defined in a new MarketplacePlugin (Phase 3)

@Entity('marketplace_ad_campaign')
export class MarketplaceAdCampaign extends VendureEntity {
  @Column() channelId: string;                        // owning academy
  @Column({ enum: ['sponsored_listing', 'banner'] })
  type: 'sponsored_listing' | 'banner';
  @Column({ enum: ['draft', 'active', 'paused', 'exhausted'] })
  status: 'draft' | 'active' | 'paused' | 'exhausted';
  @Column() budgetInPaise: number;
  @Column() spentInPaise: number;                     // cache only — truth is AdSpendLedger
  @Column({ nullable: true }) targetSubject: string | null;
  @Column({ nullable: true }) targetCity: string | null;
  @Column() startsAt: Date;
  @Column() endsAt: Date;
}

@Entity('ad_spend_ledger')                            // append-only (INV-010)
export class AdSpendLedger extends VendureEntity {
  @Column() campaignId: string;
  @Column({ enum: ['impression', 'click', 'conversion'] })
  eventType: 'impression' | 'click' | 'conversion';
  @Column() amountInPaise: number;
  @Column() occurredAt: Date;
  @Column({ nullable: true }) orderId: string | null; // populated on conversion
}

@Entity('ad_wallet')
export class AdWallet extends VendureEntity {
  @Column() channelId: string;                        // one per academy
  @Column() balanceInPaise: number;                   // cache only — truth is AdWalletLedger
}

@Entity('ad_wallet_ledger')                           // append-only
export class AdWalletLedger extends VendureEntity {
  @Column() walletId: string;
  @Column({ enum: ['topup', 'spend', 'refund'] })
  type: 'topup' | 'spend' | 'refund';
  @Column() amountInPaise: number;                    // positive=topup, negative=spend
  @Column() occurredAt: Date;
  @Column({ nullable: true }) campaignId: string | null;
  @Column({ nullable: true }) orderId: string | null; // Juspay order for top-up
}
```

**Billing loop:** Academies top up their `AdWallet` via Juspay (existing `JuspayPlugin` — no new payment integration). Each impression/click writes an `AdSpendLedger` row, decrements the wallet cache. When `balanceInPaise <= 0`, campaign status → `exhausted`, listing de-sponsored immediately. No credit risk.

---

### FEAT-004: Banner Scope Discriminator

```typescript
// Added to existing Banner entity (CmsPlugin)
@Column({ default: 'tenant' })
scope: 'tenant' | 'marketplace';

// Marketplace-specific targeting (nullable — tenant banners ignore these)
@Column({ nullable: true }) targetSubject: string | null;
@Column({ nullable: true }) targetCity: string | null;
@Column({ nullable: true }) campaignId: string | null; // FK → MarketplaceAdCampaign
```

`BannerService.findActiveForPlacement()` defaults to `scope = 'tenant'` — existing queries are unchanged. New `MarketplaceBannerService.findActiveForPlacement()` queries only `scope = 'marketplace'` banners, ordered by campaign wallet balance (higher spenders get priority when multiple banners compete for the same slot).

---

### Multivendor Plugin Rejection (DL-019)

The Vendure example `multivendor-plugin` implements order splitting for a marketplace where a single cart contains products from multiple sellers. This is the **Amazon/Etsy model**.

Saa9vi uses the **Shopify/Kajabi model** — each academy is a completely isolated storefront. A student on `mehta.saa9vi.com` never sees products from `verma.saa9vi.com` in their cart. Cross-academy carts do not exist. The plugin's entire machinery (`OrderSellerStrategy`, `ShippingLineAssignmentStrategy`, aggregate order FSM, seller order splitting) solves a problem Saa9vi does not have.

**Use the plugin as a reference for Vendure `Seller` API patterns. Do not install it.**

---

## ADR-016: Platform Dashboard Branding Layer

**Status:** Active
**Date:** 2026-07-17
**Trigger:** Login page displayed generic "Vendure Admin" branding instead of Saa9vi identity. Multiple options existed for customization — modifying Vendure core, patching individual plugins, or creating a dedicated platform layer.

---

### Decision

Saa9vi dashboard customization is implemented through `PlatformDashboardPlugin` — a dedicated plugin that owns all platform-level UI branding — rather than modifying Vendure core or individual domain plugins.

---

### Rationale

1. **Preserves Vendure upgrade path.** Modifying Vendure core files (`node_modules/@vendure/dashboard`) would be overwritten on every `npm update`. The `defineDashboardExtension` API is the supported customization surface.

2. **Keeps branding concerns separate.** Login page customization (`login.logo`, `login.beforeForm`, `login.afterForm`) is a platform identity concern, not a domain concern. Placing it in `BigBlueButtonPlugin` or `TenantPlugin` would couple branding to a specific domain plugin's lifecycle.

3. **Supports future tenant-aware branding.** The `Channel = Tenant` invariant (INV-001) enables a future where the login page renders the tenant's own logo and academy name instead of the platform logo. `PlatformDashboardPlugin` is the natural home for this logic — it can inject a `TenantProfileService` dependency and resolve branding per channel without touching any domain plugin.

4. **Avoids coupling BBB plugin with platform identity.** `BigBlueButtonPlugin` is a live-class infrastructure plugin. It should not know about Saa9vi's brand colors, logo SVG, or welcome copy. Cross-cutting platform identity concerns belong in a platform-level extension.

---

### Architecture

```
PlatformDashboardPlugin (platform-level, no domain dependencies)
  └── dashboard/index.tsx
        ├── import './styles.css'          // CSS override for Vendure core branding
        └── defineDashboardExtension({
              login: {
                logo: Saa9viLogo,          // replaces Vendure logo
                beforeForm: LoginWelcome,   // welcome message above form
                afterForm: LoginFooter,     // footer below form
              },
            })
```

**Plugin registration** (in `vendure-config.ts`):

```typescript
PlatformDashboardPlugin.init({}),
```

**No `navSections` or `navMenuItem`** — this plugin customizes the login page only. Dashboard navigation is owned by domain plugins (BBB, CMS, Tenant, Reviews) per the DL-015 pattern.

### Vendure Core Branding Override

The Vendure dashboard shell renders a vendor branding footer (`"Vendure v3.x.x"`) outside the login extension slots. This element is not part of the `login.logo`, `login.beforeForm`, or `login.afterForm` slots — it is rendered by the core dashboard layout component.

**Solution:** CSS override via `styles.css` imported in the dashboard extension entry point:

```css
/* Hide Vendure branding footer container */
div[class*="gap-1.5"][class*="text-muted-foreground"] {
    display: none !important;
}
```

The selector targets the footer container by its Tailwind utility classes. In Vendure v3.6.x, the footer is rendered as:

```html
<div class="flex items-center justify-center gap-1.5 text-muted-foreground">
    <svg .../>
    <span>Vendure</span>
    <span>v3.6.5</span>
</div>
```

The `[class*="..."]` attribute selector approach avoids CSS escaping issues with the dot in `gap-1.5` while still being specific enough to not accidentally match other elements. The Saa9vi-owned footer (`LoginFooter` component) remains visible below the login form.

**Note on `data-vendure-branding`:** The `[data-vendure-branding]` attribute does not exist in Vendure v3.6.x. The attribute-based selector was the original approach but was updated to use class-based matching after verification against the actual DOM.

**Rationale:** The `defineDashboardExtension` API does not expose a slot for replacing the core dashboard footer. The CSS override is the minimal, maintainable approach. If a future Vendure version changes these class names, the fallback is acceptable (Vendure branding reappears) and can be addressed with an updated selector.

---

### Future Evolution

| Phase | Capability | Mechanism |
|---|---|---|
| Current | Platform-level Saa9vi branding | Static components in `PlatformDashboardPlugin` |
| Phase 1.5 | Environment-aware footer | `import.meta.env.MODE` — shows "Development Environment" in dev, "Education Commerce Operating System" in production |
| Phase 2 | Tenant-aware login | `PlatformDashboardPlugin` injects `TenantProfileService`, resolves `channelId` from login URL hostname, renders tenant logo + academy name |
| Phase 3 | Academy Console landing page | Post-login dashboard route (`/`) shows Saa9vi operating cockpit — live sessions, upcoming classes, student counts, BBB usage, recent orders |

---

### Alternatives Rejected

| Alternative | Reason |
|---|---|
| Modify Vendure core `node_modules/@vendure/dashboard` | Overwritten on `npm update` — not maintainable |
| Add login customization to `BigBlueButtonPlugin` | Couples platform identity to a domain plugin; violates separation of concerns |
| Add login customization to `TenantPlugin` | Tenant plugin manages tenant data, not platform UI; wrong abstraction level |
| Custom React app outside Vendure dashboard | Loses all Vendure admin functionality (orders, customers, products, etc.) — would require rebuilding the entire admin panel |

---

*This ADR is the authoritative architecture reference for Saa9vi. All plugin development, schema migrations, and infrastructure changes must be evaluated against the invariants and decisions documented here. Conflicts between this document and code comments are resolved in favour of this document; the code should be updated.*
