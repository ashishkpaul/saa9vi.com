# Architecture Decision Record
## Saa9vi — Multi-Tenant Education Commerce Platform
### Production Architecture · Version 1.3
**Status:** Active  
**Date:** 2026-06  
**Authors:** Lead Architect, Platform Engineering  
**Supersedes:** ADR v1.2 (2025-06)

> **What changed in v1.1:** Full audit against all three plugin codebases (`bigbluebutton-plugin`, `cms-plugin`, `tenant-plugin`). Status fields updated to match actual implementation. Four divergences from v1.0 documented. Three pending ADR items promoted to explicit open issues. No invariants changed.
>
> **What changed in v1.2:** Three code-verified corrections incorporated: (1) `convertTrialToEnrollment` → `BbbEnrollment` path added to AC-003; (2) EventBus published events corrected — `RoomActivatedEvent` is live, `TrialAttendanceRecordedEvent` is future-only; (3) cipher name corrected to AES-256-GCM. BUG-015 added for banner queue gap. Admin API isolation added as SEC-001 production deployment requirement.
>
> **What changed in v1.3:** Full audit extended to `reviews` plugin. Plugin inventory updated to four plugins. DIV-009 and DIV-010 added for reviews plugin findings. BUG-016 (TS-2353 — `items` in `navSections`) documented and fixed. BUG-017 (Reviews channel scoping deviation) added. Section 5A (Dashboard Extension Pattern) added as canonical reference. ADR-013 (Frontend Independence & API Evolution) added — defines the single-storefront / stable-API-surface architecture that allows backend plugin evolution without per-tenant frontend redeployments. DL-015 and DL-016 added to decision log.

---

## Table of Contents

1. [Platform Context](#1-platform-context)
2. [Non-Negotiable Architectural Invariants](#2-non-negotiable-architectural-invariants)
3. [Plugin Architecture & Bounded Contexts](#3-plugin-architecture--bounded-contexts)
4. [Data Layer Decisions](#4-data-layer-decisions)
5. [Commerce & Access Control](#5-commerce--access-control)
5A. [Dashboard Extension Pattern](#5a-dashboard-extension-pattern)
6. [BBB Integration Architecture](#6-bbb-integration-architecture)
7. [CMS Architecture](#7-cms-architecture)
7A. [Reviews Plugin Architecture](#7a-reviews-plugin-architecture)
8. [Tenant & Academy Layer](#8-tenant--academy-layer)
9. [Event & Job Queue Architecture](#9-event--job-queue-architecture)
10. [Security Architecture](#10-security-architecture)
11. [Infrastructure & Deployment](#11-infrastructure--deployment)
12. [Known Bugs & Immediate Remediation](#12-known-bugs--immediate-remediation)
13. [Production Readiness Checklist](#13-production-readiness-checklist)
14. [Phase Roadmap](#14-phase-roadmap)
**[ADR-013: Frontend Independence & API Evolution](#adr-013-frontend-independence--api-evolution)**
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

### DA-001: ChannelAware Implementation Pattern

All tenant-scoped entities follow this pattern (code-verified in `TenantProfile`, `BbbOrganization`, `OrganizationSubscription`):

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

**`InstructorProfile` exception:** Uses raw `findAndCount` with explicit `WHERE channelId = :channelId`. Acceptable per DL-010.

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
4. `BbbMeetingService.joinRoom()` still uses legacy `BbbEnrollment` for room access ✅ (interim)

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
  → fallback for room products: productVariantId → BbbProductAccess → BbbRoom → BbbEnrollment (legacy)
  → Student joins: BbbMeetingService.getJoinUrl()
      → entitlementService.hasAccess(ctx, customerId, 'bbb_session', sessionId)
      → if granted: attendee join URL
```

**Current status:** ✅ Dual-path fulfillment code-verified. `BbbOrderFulfillmentListener` uses `TransactionalConnection` to look up `BbbScheduledSession` by `productVariantId` first; room products fall through to legacy path.

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

## 7. CMS Architecture

### CMS-001: Slug Uniqueness Migration ✅ Fixed

`Article` and `Page` entities have composite unique indexes:

```sql
CREATE UNIQUE INDEX "IDX_article_channel_slug" ON "article" ("channelId", "slug");
CREATE UNIQUE INDEX "IDX_page_channel_slug" ON "page" ("channelId", "slug");
```

**Current status:** ✅ Code-verified. Both `ArticleService` and `PageService` use `ListQueryBuilder` + `findOneInChannel` which enforce channel scope. Migration `1782369776476-bugs` applied.

### CMS-002: Banner Scheduling via BullMQ ⚠️ Pending

Replace runtime date filter with precomputed `isCurrentlyActive`:

```typescript
// Add to Banner entity
@Column({ default: false })
isCurrentlyActive: boolean;

// BullMQ scheduled jobs (run every minute)
// banner-activator: WHERE isActive = true AND startsAt <= NOW() AND isCurrentlyActive = false → set true
// banner-deactivator: WHERE isCurrentlyActive = true AND endsAt <= NOW() → set false

// Storefront query becomes:
WHERE channelId = :channelId AND isCurrentlyActive = true
```

**Current status:** ⚠️ Pending. `BannerService` currently filters by date at query time. `banner-activator` and `banner-deactivator` queues not yet registered.

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

---

## 9. Event & Job Queue Architecture

### EQ-001: Job Queue Naming Convention

```
bbb-meeting-provisioning     ← ✅ live
bbb-webhook-processor        ← ✅ live (INV-004)
bbb-reconciliation           ← ✅ live (scheduled task)
banner-activator             ← ⚠️ pending (CMS-002)
banner-deactivator           ← ⚠️ pending (CMS-002)
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
- `CmsShopResolver.articleBySlug` — filters by `channelId` and `isPublished` ✅
- `InstructorProfileService.findOne` — includes `channelId` filter ✅
- `MediaResourceService.findOne` — includes `channelId` filter ✅

### SEC-005: Rate Limiting ⚠️ Pending

Before production, add rate limiting to:
- `POST /bbb/webhook` — 100 req/min per source IP (BBB server IPs should be allowlisted)
- `POST /shop-api` mutations: `registerForTrialSession`, `joinMeeting` — 10 req/min per customer
- `POST /admin-api` — Vendure's built-in token auth is sufficient

### SEC-006: Custom Domain TLS

When `TenantProfile.customDomain` is populated, Caddy provisions TLS via Let's Encrypt:

```
academy.com (CNAME → saa9vi.com)
  → Caddy reverse proxy
    → X-Vendure-Token: {channel-token}  ← injected by Caddy based on hostname lookup
  → Vendure API
    → RequestContext.channelId = lookup(channel-token)
```

Channel token → custom domain mapping stored in Redis for sub-millisecond Caddy lookup. Updated whenever `TenantProfile.customDomain` changes.

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
| BUG-015 | Medium | `CmsPlugin` / `BannerService` | `banner-activator` and `banner-deactivator` BullMQ queues not registered; banners currently filtered at query-time instead of via precomputed `isCurrentlyActive` | ⚠️ Pending — see CMS-002 |
| BUG-016 | High | `ReviewsPlugin` / `dashboard/index.tsx` | `navSections` entry uses `items: [...]` which does not exist on `DashboardNavSectionDefinition` — TS error 2353, Reviews menu invisible in admin dashboard | ✅ Fixed — remove `items` from `navSections`; add `navMenuItem` to `reviewList` route in `review-list.tsx` |
| BUG-017 | Medium | `ReviewsPlugin` / all review entities | `ProductReview`, `ReviewRequest`, `ReviewReport`, `ReviewReward`, `ReviewVote` do not implement `ChannelAware` — channel isolation relies solely on explicit `ctx.channelId` WHERE clauses in services; ORM provides no guard against missed query paths | ⚠️ Pending — add `ChannelAware` + `@ManyToMany(() => Channel)` to `ProductReview` as minimum; backfill join table from existing `channelId` strings via migration |

---

## 13. Production Readiness Checklist

### Security
- [x] HMAC verification on all BBB webhooks ✅
- [x] AES-256-GCM on BBB passwords ✅
- [x] `encryptionKeyVersion` column on encrypted entities ✅
- [ ] Admin API bound to internal interface only ⚠️ Deployment constraint (SEC-001)
- [ ] Rate limiting on public mutations ⚠️ Pending
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
- [ ] `currentLoad` scoring semantics documented ⚠️ BUG-014
- [ ] Banner BullMQ queues registered (`banner-activator`, `banner-deactivator`) ⚠️ BUG-015
- [ ] Health check endpoints responding
- [ ] Custom domain → channel token Redis mapping

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

Deliverables:
- Full migration from `BbbEnrollment` to `BbbEntitlement` for room access
- Public `instructorProfiles` query with Elasticsearch indexing
- Public instructor profile pages in Next.js storefront
- CMS pages served from Next.js with SEO metadata
- `BbbEntitlement` admin UI (dashboard route)

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

Deliverables:
- `Review` entity with composite ranking materialized view
- Elasticsearch instructor/course search with channel-scoped indices
- Attendance analytics dashboard
- Certificate generation on `Entitlement` completion
- Marketplace commission model via Vendure `Seller` entity
- `bbbSession` CMS section type (CMS-004)
- `ArticleEvent` / `PageEvent` → Elasticsearch indexer

### Phase 4 — Scale & Premium

Deliverables:
- White-label theming via `TenantProfile.theme`
- TimescaleDB for BBB event-heavy analytics
- AI features (meeting summary, CMS content writer) — feature flags on stable data model
- Multi-BBB-server geographic routing

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

*This ADR is the authoritative architecture reference for Saa9vi. All plugin development, schema migrations, and infrastructure changes must be evaluated against the invariants and decisions documented here. Conflicts between this document and code comments are resolved in favour of this document; the code should be updated.*