# Architecture Decision Record
## Saa9vi — Multi-Tenant Education Commerce Platform
### Production Architecture · Version 1.0
**Status:** Active  
**Date:** 2025-06  
**Authors:** Lead Architect, Platform Engineering  
**Supersedes:** ADR-012 (alignment assessment), all prior incremental reviews

---

## Table of Contents

1. [Platform Context](#1-platform-context)
2. [Non-Negotiable Architectural Invariants](#2-non-negotiable-architectural-invariants)
3. [Plugin Architecture & Bounded Contexts](#3-plugin-architecture--bounded-contexts)
4. [Data Layer Decisions](#4-data-layer-decisions)
5. [Commerce & Access Control](#5-commerce--access-control)
6. [BBB Integration Architecture](#6-bbb-integration-architecture)
7. [CMS Architecture](#7-cms-architecture)
8. [Tenant & Academy Layer](#8-tenant--academy-layer)
9. [Event & Job Queue Architecture](#9-event--job-queue-architecture)
10. [Security Architecture](#10-security-architecture)
11. [Infrastructure & Deployment](#11-infrastructure--deployment)
12. [Known Bugs & Immediate Remediation](#12-known-bugs--immediate-remediation)
13. [Production Readiness Checklist](#13-production-readiness-checklist)
14. [Phase Roadmap](#14-phase-roadmap)
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

**Rejection criterion:** Any PR introducing a `tenantId` column that is not `ctx.channelId` is rejected without review.

**Rationale:** Vendure's `RequestContext` carries the active `channelId`. `ListQueryBuilder` and `TransactionalConnection.findOneInChannel` automatically filter by this channel. A parallel identity system creates two sources of truth that drift in production under concurrent writes.

### INV-002: Every billing fact is an immutable ledger row.

`BbbUsageLedger` rows are never updated. Never deleted. The source of billing truth is always `SUM(consumedMinutes) WHERE organizationId = X AND period`. Meeting state columns (`BbbMeeting.durationMinutes`) are operational convenience fields, never the authoritative billing source.

**Rejection criterion:** Any service method that calls `.update()` on a `BbbUsageLedger` row is rejected.

### INV-003: One access-control system via Entitlement.

All access to paid content — live sessions, recorded courses, workshops, coaching packages — is gated through a single `Entitlement` entity with a uniform `hasAccess(ctx, customerId, type, resourceId)` interface.

**Current status:** `BbbEnrollment` is the interim implementation. It carries `@deprecated` annotation. The generalization to `Entitlement` is Phase 1.5 work and must be completed before any second enrollment type (recorded course access, workshop access) is added.

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

**Current status:** `BbbWebhookController` currently processes inline after HMAC verification. This is the highest production risk in the codebase.

**Rejection criterion:** Any webhook controller that calls a service method before persisting the raw event is rejected.

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

All tenant-scoped entities follow this pattern:

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

**Affected entities that must carry this index:**
- `InstructorProfile` ✅ Applied
- `TenantProfile` (by channelId already unique — slug not exposed yet)
- `Article` ⚠️ Application-level only — migration needed
- `Page` ⚠️ Application-level only — migration needed
- `BbbOrganization` (slug is globally unique — 1 org per channel, correct)
- `BbbScheduledSession` (slug within org — add `(organizationId, slug)` composite)

### DA-003: Encryption Key Versioning

`BbbEncryptionService` encrypts BBB server API secrets and meeting passwords using AES-GCM. Encrypted columns must carry a version field to enable zero-downtime key rotation:

```typescript
// Add to BbbMeeting and BbbServer
@Column({ default: 1 })
encryptionKeyVersion: number;
```

Key rotation procedure:
1. Increment `ENCRYPTION_KEY_VERSION` env var
2. Run background job: fetch all records with `encryptionKeyVersion < current`, decrypt with old key, re-encrypt with new key, update version
3. Remove old key from env after job completes

**Current status:** Version column absent. Must be added before first tenant onboarding.

### DA-004: Migration Governance

Every schema change ships as a TypeORM migration. Rules:

- Migration filenames: `{timestamp}-{scope}-{description}.ts`
- Migrations are never edited after being run on any environment
- `down()` must be implemented and tested
- Destructive column drops require a two-migration pattern: (1) add new column, backfill, (2) drop old column
- No `synchronize: true` in any environment including development

---

## 5. Commerce & Access Control

### AC-001: The Entitlement Model (Target State)

The target access-control entity:

```typescript
@Entity('entitlement')
@Index(['customerId', 'type', 'resourceId'])
export class Entitlement extends VendureEntity implements ChannelAware {
  // What type of access
  @Column({ enum: ['bbb_room', 'bbb_session', 'recorded_course', 'workshop', 'subscription'] })
  type: EntitlementType;

  // What resource — FK string, not a TypeORM relation
  @Column() resourceId: string;

  // Who holds it
  @Column() customerId: string;

  // How it was acquired
  @Column({ nullable: true }) sourceOrderLineId: string | null;
  @Column({ nullable: true }) sourceSubscriptionId: string | null;
  @Column({ enum: ['order', 'trial', 'admin_grant', 'subscription'] })
  source: EntitlementSource;

  // Validity window
  @Column({ nullable: true }) validFrom: Date | null;
  @Column({ nullable: true }) validUntil: Date | null;  // null = perpetual

  @ManyToMany(() => Channel) @JoinTable() channels: Channel[];
  @Column() channelId: string;
}
```

Uniform access check:
```typescript
async hasAccess(ctx: RequestContext, customerId: string, type: EntitlementType, resourceId: string): Promise<boolean> {
  const now = new Date();
  return this.repo.existsBy({
    customerId, type, resourceId, channelId: ctx.channelId,
    ...(now && { validFrom: LessThanOrEqual(now) }),
    ...(now && [{ validUntil: IsNull() }, { validUntil: MoreThan(now) }]),
  });
}
```

**Migration path from `BbbEnrollment`:**
1. Create `Entitlement` entity
2. Migrate existing `BbbEnrollment` rows to `Entitlement` with `type: 'bbb_room'`
3. Update `BbbMeetingService.joinMeeting` to call `entitlementService.hasAccess`
4. Keep `BbbEnrollment` table for 2 sprints with `@deprecated` guard, then drop

### AC-002: Commerce Loop (Checkout → Access)

The complete loop for a paid session purchase:

```
Student adds BbbScheduledSession to cart
  → ProductVariant.id linked to BbbScheduledSession.productVariantId
  → Order placed, Payment settled
  → OrderStateMachine fires PaymentSettledEvent
  → BbbOrderFulfillmentListener.handlePaymentSettled()
      → findBbbScheduledSessionByProductVariantId(productVariantId)
      → create Entitlement { type: 'bbb_session', resourceId: session.id, customerId, sourceOrderLineId }
      → create BbbCapacityGrant { source: 'order', orderId, orderLineId, productVariantId }
  → Student joins: BbbMeetingService.joinMeeting()
      → entitlementService.hasAccess(ctx, customerId, 'bbb_session', sessionId)
      → if granted: provision meeting or return existing join URL
```

**Current gap:** Fulfillment handler resolves `productVariantId → BbbProductAccess → BbbRoom`, bypassing `BbbScheduledSession`. Must be updated before any session-based product is sold.

### AC-003: Trial Session Funnel (Zero-Price Entitlement)

Free trial sessions use the same `Entitlement` model with `source: 'trial'` and `validUntil` set to the session end time:

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
  → emit TrialAttendanceRecordedEvent

Conversion:
  → Student visits trainer profile, purchases full course
  → Normal Entitlement created via AC-002 commerce loop
```

**Current gap:** Trial → Entitlement creation is not connected. `BbbTrialRegistration` exists and attendance is updated from webhook, but no `Entitlement` is created on registration.

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

## 6. BBB Integration Architecture

### BB-001: Webhook Pipeline (Target State)

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

// BbbWebhookProcessor — BullMQ worker
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

`BbbWebhookEvent` entity:

```typescript
@Entity('bbb_webhook_event')
export class BbbWebhookEvent extends VendureEntity {
  @Column() eventType: string;
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  @Column() receivedAt: Date;
  @Column({ enum: ['PENDING', 'PROCESSED', 'FAILED'] }) status: string;
  @Column({ nullable: true }) processedAt: Date | null;
  @Column({ nullable: true, type: 'text' }) errorMessage: string | null;
  @Index() @Column({ nullable: true }) bbbMeetingId: string | null;   // for fast replay lookup
}
```

Replay capability: `SELECT * FROM bbb_webhook_event WHERE status = 'FAILED' ORDER BY received_at` → re-enqueue IDs.

### BB-002: Meeting FSM

Current states and transitions are correct. One addition needed for production:

```typescript
// Add STALE as a terminal state for meetings reconciliation marks as permanently unreachable
export const MEETING_STATE = {
  ...existing,
  STALE: 'Stale',
} as const;

// STALE is reachable from any active state during reconciliation
// It is NOT a billable state — no UsageLedger row is written for STALE meetings
```

### BB-003: Server Selection

`BbbServerSelectionService` must weight by participant-minutes load, not meeting count:

```typescript
// Current (inadequate)
score = server.activeMeetingCount;

// Required
score = server.activeMeetingCount * server.avgParticipantsPerMeeting;
// where avgParticipantsPerMeeting is computed from BbbMetricsService over a 15-min rolling window
```

### BB-004: Billing Ceiling Enforcement

`BbbMeeting.billingCapped` is set when `consumedMinutes >= grant.grantedMinutes`. The reconciliation service correctly handles this. The gap is: when `billingCapped` is set, the system must also **notify the tenant** that their capacity is exhausted. Add an `EventBus` publish of `CapacityExhaustedEvent` that the email plugin handles:

```typescript
// In reconciliation, after marking billingCapped = true
this.eventBus.publish(new CapacityExhaustedEvent(ctx, organization, grant));
// EmailPlugin handler sends: "Your BBB capacity for this billing period is exhausted"
```

### BB-005: Encryption Key Version Column

Both `BbbServer.encryptedApiSecret` and `BbbMeeting.encryptedAttendeePassword` / `encryptedModeratorPassword` must carry `encryptionKeyVersion: number` before production. See DA-003.

---

## 7. CMS Architecture

### CMS-001: Slug Uniqueness Migration

`Article` and `Page` entities require composite unique indexes. Migration:

```sql
-- Drop application-level unique constraints if any
CREATE UNIQUE INDEX "IDX_article_channel_slug" ON "article" ("channelId", "slug");
CREATE UNIQUE INDEX "IDX_page_channel_slug" ON "page" ("channelId", "slug");
```

### CMS-002: Banner Scheduling via BullMQ

Replace runtime date filter with precomputed `isCurrentlyActive`:

```typescript
// Add to Banner entity
@Column({ default: false })
isCurrentlyActive: boolean;

// BullMQ scheduled jobs (run every minute)
// banner-activator: WHERE isActive = true AND startsAt <= NOW() AND isCurrentlyActive = false → set true
// banner-deactivator: WHERE isCurrentlyActive = true AND endsAt <= NOW() → set false

// Storefront query becomes simply:
WHERE channelId = :channelId AND isCurrentlyActive = true
```

### CMS-003: Page Sections Type Index

The `sections: PageSection[]` JSON blob is retained (acceptable for current scale). Add a computed column for queryability:

```typescript
// Add to Page entity
@Column({ type: 'simple-array', nullable: true })
sectionTypes: string[];   // e.g. ['hero', 'productGrid', 'bbbSession']

// Maintained on save: page.sectionTypes = page.sections.map(s => s.type)
```

This allows `WHERE 'bbbSession' = ANY(sectionTypes)` without deserializing JSON.

### CMS-004: BBB Session Section Type

Add `bbbSession` as a page section type:

```typescript
export interface BbbSessionSection {
  type: 'bbbSession';
  scheduledSessionId: string;
  showCountdown: boolean;
  showInstructorProfile: boolean;
}
```

The storefront `PageRenderer` fetches `BbbScheduledSession` by ID and renders the join CTA, countdown, and instructor card inline. This is the bridge between the CMS and live teaching products.

---

## 8. Tenant & Academy Layer

### TP-001: Bug — `TenantProfileDetail.tsx` `useState` used as `useEffect`

**Severity:** High. Form fields are never populated when editing an existing profile.

**Fix:**
```typescript
// Replace
useState(() => {
  if (existing) { setChannelId(existing.channelId); ... }
});

// With
useEffect(() => {
  if (existing) {
    setChannelId(existing.channelId);
    setBusinessName(existing.businessName);
    setTagline(existing.tagline ?? '');
    setTimezone(existing.timezone);
    setContactEmail(existing.contactEmail);
  }
}, [existing]);
```

### TP-002: Bug — `tenantProfile` resolver ignores `__current__`

**Severity:** High. `findByChannelId(ctx, '__current__')` returns null always.

**Fix — resolver:**
```typescript
@Query()
@Allow(tenantProfilePermission.Read)
tenantProfile(@Ctx() ctx: RequestContext, @Args() args?: { channelId?: string }) {
  const cid = (args?.channelId && args.channelId !== '__current__')
    ? args.channelId
    : ctx.channelId as string;
  return this.tenantProfileService.findByChannelId(ctx, cid);
}
```

**Fix — dashboard query:**
```typescript
queryFn: () => api.query(GET_PROFILE, {}),  // remove channelId arg entirely; resolver defaults to ctx
```

**Fix — GraphQL schema:**
```graphql
type Query {
  tenantProfile(channelId: String): TenantProfile   # make arg optional
}
```

### TP-003: `InstructorProfile` is not `ChannelAware`

`InstructorProfile` uses `@ManyToOne channel: Channel` (singular) plus `channelId` scalar. It cannot use `assignToCurrentChannel`. All queries are raw `findAndCount` with explicit `WHERE channelId = :channelId`.

**Decision:** This pattern is acceptable for `InstructorProfile` given the 1:N channel-to-instructor relationship. Document it explicitly. All `InstructorProfileService` methods must include `channelId` in every where clause. Add a service-level assertion on `onModuleInit`:

```typescript
// Future safety net — catches any findAll/findOne missing channel filter
// Add to InstructorProfileService
private assertChannelFilter(options: FindManyOptions): void {
  if (!(options.where as any)?.channelId) {
    throw new InternalServerError('InstructorProfile query missing channelId filter');
  }
}
```

### TP-004: `TenantProfile` — `assignToCurrentChannel` now applied

`TenantProfileService.create` correctly calls `channelService.assignToCurrentChannel`. Confirmed in current code. ✅

---

## 9. Event & Job Queue Architecture

### EQ-001: Job Queue Naming Convention

```
bbb-meeting-provisioning     ← existing, correct
bbb-webhook-processor        ← to be created (INV-004)
bbb-reconciliation           ← existing scheduled task
banner-activator             ← to be created (CMS-002)
banner-deactivator           ← to be created (CMS-002)
billing-invoice-generator    ← Phase 2
usage-ledger-aggregator      ← Phase 2
```

All jobs are registered in `onModuleInit` via `JobQueueService.createQueue`. Job payloads are typed interfaces.

### EQ-002: Vendure EventBus — Published Events

| Event | Publisher | Subscribers |
|---|---|---|
| `MeetingProvisionedEvent` | `BbbMeetingService` | `BbbMetricsService` |
| `GrantConsumedEvent` | `BbbReconciliationService` | Email plugin (capacity alerts) |
| `CapacityExhaustedEvent` | `BbbReconciliationService` | Email plugin |
| `TrialAttendanceRecordedEvent` | `BbbWebhookProcessor` | Analytics (Phase 3) |
| `ArticleEvent` | `ArticleService` | Elasticsearch indexer (Phase 3) |
| `PageEvent` | `PageService` | Elasticsearch indexer (Phase 3) |

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

### SEC-001: HMAC Webhook Verification

Current `BbbWebhookController.verifyWebhookSignature` iterates all enabled servers and tries each secret — constant-time comparison via `crypto.timingSafeEqual`. This is correct. No change needed.

### SEC-002: BBB Password Encryption

AES-GCM encryption via `BbbEncryptionService` for `encryptedAttendeePassword` and `encryptedModeratorPassword` with `select: false` on columns. This is correct.

Add `encryptionKeyVersion` column (see DA-003) before production.

### SEC-003: Channel Isolation — Verified Access Points

Every external-facing resolver must include channel verification. Audit checklist:

- `BbbShopResolver.joinMeeting` — verifies enrollment/entitlement ✅
- `BbbAdminResolver.*` — requires `BbbAdminPermission` ✅
- `TenantAdminResolver.*` — requires scoped permissions ✅
- `TenantShopResolver.instructorProfiles` — public, but filters by `channelId` from ctx ✅
- `CmsShopResolver.articleBySlug` — filters by `channelId` and `isPublished` ✅
- `InstructorProfileService.findOne` — now includes `channelId` filter ✅
- `MediaResourceService.findOne` — now includes `channelId` filter ✅

### SEC-004: Rate Limiting

Before production, add rate limiting to:
- `POST /bbb/webhook` — 100 req/min per source IP (BBB server IPs should be allowlisted)
- `POST /shop-api` mutations: `registerForTrialSession`, `joinMeeting` — 10 req/min per customer
- `POST /admin-api` — Vendure's built-in token auth is sufficient

### SEC-005: Custom Domain TLS

When `TenantProfile.customDomain` is populated, Caddy must provision a TLS certificate via Let's Encrypt. The routing chain:

```
academy.com (CNAME → saa9vi.com)
  → Caddy reverse proxy
    → X-Vendure-Token: {channel-token}  ← injected by Caddy based on hostname lookup
  → Vendure API
    → RequestContext.channelId = lookup(channel-token)
```

Channel token → custom domain mapping is stored in Redis for sub-millisecond Caddy lookup. Updated whenever `TenantProfile.customDomain` changes.

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
BBB_ENCRYPTION_KEY=...           # AES-GCM key, base64
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
  poolSize: 20,                    // API process
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

All items below must be resolved before first tenant onboarding.

| ID | Severity | File | Description | Fix |
|---|---|---|---|---|
| BUG-001 | Critical | `TenantProfileDetail.tsx` | `useState` used instead of `useEffect` — form never populates on edit | Replace with `useEffect(() => {...}, [existing])` |
| BUG-002 | Critical | `tenant-admin.resolver.ts` | `tenantProfile(channelId: '__current__')` always returns null | Make arg optional, default to `ctx.channelId` |
| BUG-003 | High | `BbbWebhookController` | Webhook processed inline — no persist-first, no replay capability | Implement INV-004 pattern |
| BUG-004 | High | `BbbOrganizationService.create` | `channels[]` join table never populated despite `implements ChannelAware` | `assignToCurrentChannel` is now called ✅ — verify join table has rows |
| BUG-005 | High | `BbbOrderFulfillmentListener` | Fulfillment resolves `productVariantId → BbbRoom`, not `→ BbbScheduledSession` | Add session lookup before room lookup |
| BUG-006 | Medium | `Article`, `Page` entities | Slug uniqueness is application-level only — TOCTOU race | Add composite DB index `(channelId, slug)` |
| BUG-007 | Medium | `PlansList.tsx` | `useEffect` dep on derived `organizations` array — auto-select never fires | Change dep to `orgsQuery.data` |
| BUG-008 | Medium | `BbbMeeting`, `BbbServer` | No `encryptionKeyVersion` column | Add column with default `1`, required for key rotation |
| BUG-009 | Low | `BbbScheduledSession` | `(scheduledSessionId, slug)` composite unique missing | Add composite index |
| BUG-010 | Low | CMS list pages | `window.confirm` for destructive actions | Replace with Dialog component |

---

## 13. Production Readiness Checklist

### Security
- [ ] HMAC verification on all BBB webhooks ✅
- [ ] AES-GCM on BBB passwords ✅
- [ ] `encryptionKeyVersion` column on encrypted entities
- [ ] Rate limiting on public mutations
- [ ] Channel isolation verified on all public resolvers ✅
- [ ] No secrets in source control

### Data Integrity
- [ ] All slug-bearing entities have composite `(channelId, slug)` DB unique indexes
- [ ] `BbbUsageLedger` has `(meetingId, grantId)` unique index ✅
- [ ] `BbbOrganization.channelId` has unique index ✅
- [ ] All migrations have `down()` implemented
- [ ] `synchronize: false` in all environments

### Commerce Loop
- [ ] `BbbScheduledSession.productVariantId` connected in fulfillment handler
- [ ] Trial registration creates `Entitlement` (or `BbbEnrollment` interim)
- [ ] `joinMeeting` access check uses `Entitlement.hasAccess`

### Operational
- [ ] `BbbWebhookEvent` persist-first pipeline live
- [ ] Failed webhook jobs surfaced in admin UI
- [ ] `BbbReconciliationService` scheduled task running ✅
- [ ] Health check endpoints responding
- [ ] Custom domain → channel token Redis mapping

### Dashboard
- [ ] `TenantProfileDetail.tsx` useState→useEffect bug fixed
- [ ] Resolver `__current__` bug fixed
- [ ] `PlansList.tsx` auto-select bug fixed

---

## 14. Phase Roadmap

### Phase 1 — Commercial Operability (current sprint)

Fix all BUG-00x items. The platform cannot onboard a paying tenant until BUG-001 and BUG-002 are resolved and BUG-003 and BUG-005 are in flight.

Deliverables:
- All bugs in section 12 resolved
- `BbbWebhookEvent` persist-first pipeline
- `BbbScheduledSession` connected in fulfillment path
- `encryptionKeyVersion` column on encrypted entities

### Phase 1.5 — Trust Engine & Discovery

Deliverables:
- `Entitlement` entity replaces `BbbEnrollment`
- Trial registration creates `Entitlement` automatically
- Public `instructorProfiles` query with Elasticsearch indexing
- Public instructor profile pages in Next.js storefront
- CMS pages served from Next.js with SEO metadata

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
| DL-009 | Caddy for reverse proxy and custom domain TLS | Automatic Let's Encrypt; Caddyfile is programmable via Admin API; simpler than Nginx + cert-manager | Nginx (manual cert management), Traefik (more complex for this use case) |
| DL-010 | `InstructorProfile` not `ChannelAware` — explicit `channelId` WHERE clause | 1:N channel-to-instructors; `assignToCurrentChannel` overhead per create not warranted; all queries are already explicit | Full `ChannelAware` implementation (adds join table, no practical benefit for this entity's query patterns) |

---

*This ADR is the authoritative architecture reference for Saa9vi. All plugin development, schema migrations, and infrastructure changes must be evaluated against the invariants and decisions documented here. Conflicts between this document and code comments are resolved in favour of this document; the code should be updated.*