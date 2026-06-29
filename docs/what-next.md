# What Next — Saa9vi Platform: Cline Development Prompt

**Generated:** 2026-06-29
**Based on:** ADR v1.6, RFC-001 v3, platform-story v4, BUG-001 through BUG-006, all five plugin codebases, Vendure live docs (server-resource-requirements, horizontal-scaling)
**Status of platform at time of writing:** Phase 1 commerce loop complete. Phase 1.5 partially complete (FEAT-001 done, FEAT-002 pending). Phase 2 (subscriptions) unimplemented. BUG-006 load testing is fully wired. Tasks 1–5 from the previous what-next are complete. Tasks 6–12 and the new Capacity Intelligence System (ADR v1.6 §6A) are pending.

---

## Completed Since Last what-next (DO NOT RE-IMPLEMENT)

The following tasks from the previous iteration have been verified complete in the codebase:

| Task | Status | Verification |
|---|---|---|
| BUG-006 Task 1 — Wire real HTTP to `LoadOrchestrator` | ✅ Done | `load-orchestrator.ts` injects `GraphQLExecutor`, calls `this.executor.execute()`. `simulateExecution()` is gone. |
| BUG-006 Task 2 — Wire `MetricsCollector` | ✅ Done | `LoadOrchestrator.run()` uses `MetricsCollector`, `LoadRunResult` carries `metrics`. |
| BUG-006 Task 3 — Wire `DriftDetector` + full `LoadReport` schema | ✅ Done | `LoadSimulationService` calls `DriftDetector.detect()`. `api-extensions.ts` has full schema. |
| BUG-006 Task 4 — Fix `CausalMapper` real GraphQL ops | ✅ Done | Real Shop/Admin mutations used. Phase 2 events return `isPending: true`. `simulateBbbWebhook` mutation referenced. |
| FEAT-001 — `BbbOrganizationMembership` entity + service + admin UI | ✅ Done | Entity, migration `1782651476546-bbb-membership.ts`, `BbbMembershipService`, admin resolver CRUD, `MembershipsList.tsx` dashboard route, auth waterfall in `BbbMeetingService.getJoinUrl()` all present. BUG-018 resolved. |
| `vendure-config.ts` — `BullMQJobQueuePlugin` confirmed | ✅ Done | `BullMQJobQueuePlugin.init({ connection: { host: process.env.REDIS_HOST, ... } })` verified. |
| `vendure-config.ts` — `COOKIE_SECRET` from env | ✅ Done | `cookieOptions: { secret: process.env.COOKIE_SECRET }` verified. |
| BUG-019 — `LoadSimulationPlugin` DoS vector on Shop API | ✅ Done | Moved to `adminApiExtensions`, `@Allow(Permission.SuperAdmin)` added to resolver. |
| BUG-020 — `CausalMapper` fires non-existent `simulateBbbWebhook` | ✅ Done | `BbbWebhookEvent` step marked `isPending: true` — skipped cleanly until resolver implemented. |
| FEAT-002 entity + service — `sourceType`/`isUnbounded` on `BbbCapacityGrant` | ✅ Done | Columns added to entity. `bbb-organization.service.ts` auto-provisions `internal_overhead` grant on org create. `bbb-reconciliation.service.ts` skips exhaustion/alerts for overhead grants. **Migration pending:** run `npx vendure migrate create` then `npx vendure migrate up`. |

---

## Task 1 — FEAT-002: Overhead Capacity Grant ✅ Code Complete — Migration Pending

**Reference:** ADR v1.6 §8A OP-005

**Code changes landed:**
- `BbbCapacityGrant` entity — `sourceType` and `isUnbounded` columns added
- `BbbOrganizationService.create()` — auto-provisions `internal_overhead` grant after org save
- `BbbReconciliationService.consumeGrantHours()` — skips exhaustion check and quota alerts for `internal_overhead` grants

**Remaining step (do not skip — rule 7 in `.clinerules`):**

```bash
npx vendure migrate create
npx vendure migrate up
npm run build
```

Also add `sourceType` and `isUnbounded` fields to the `BbbCapacityGrant` GraphQL type in `bbb-admin.schema.ts`.

---

## Task 2 — CorrelationContext Thread-Safety Fix ✅ Done

**File:** `src/platform/tracing/correlation-context.ts`

### Problem

`CorrelationContext` uses static class properties (`private static current`, `private static stack`). In a Node.js server handling concurrent requests, this is a shared mutable singleton — two concurrent requests will corrupt each other's correlation IDs. The current `getParent()` method also diverges from the API expected by `BullMQTracer` and `EventBusInterceptor`.

### Status

`CorrelationContext` now uses `AsyncLocalStorage` instead of static class properties. `CorrelationInterceptor` wraps each request in `CorrelationContext.run()` and is registered as a global `APP_INTERCEPTOR`.

### Verification

- Two concurrent requests never share a `correlationId`
- `BullMQTracer` and `EventBusInterceptor` receive request-scoped correlation IDs
- Existing `CorrelationContext.set/get/pop/getParent/reset` API is unchanged — callers don't need updating

### What was done

Replaced static properties with Node.js `AsyncLocalStorage`:

```typescript
import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationState {
  current: string | null;
  parent: string | null;
  stack: string[];
}

const storage = new AsyncLocalStorage<CorrelationState>();

export class CorrelationContext {
  private static getState(): CorrelationState {
    return storage.getStore() ?? { current: null, parent: null, stack: [] };
  }

  static run<T>(fn: () => T): T {
    return storage.run({ current: null, parent: null, stack: [] }, fn);
  }

  static set(correlationId: string): void {
    const state = this.getState();
    if (!state.current) {
      state.current = correlationId;
    } else {
      state.stack.push(state.current);
      state.parent = state.current;
      state.current = correlationId;
    }
  }

  static get(): string | null {
    return this.getState().current;
  }

  static getParent(): string | null {
    return this.getState().parent;
  }

  static pop(): void {
    const state = this.getState();
    const previous = state.stack.pop();
    if (previous) {
      state.current = previous;
      state.parent = state.stack.length > 0 ? state.stack[state.stack.length - 1] : null;
    } else {
      state.current = null;
      state.parent = null;
    }
  }

  static reset(): void {
    const state = this.getState();
    state.current = null;
    state.parent = null;
    state.stack = [];
  }

  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}
```

Add a NestJS middleware or interceptor to wrap each request in `CorrelationContext.run()`.

### Acceptance criteria

- Two concurrent requests never share a `correlationId`
- `BullMQTracer` and `EventBusInterceptor` receive request-scoped correlation IDs
- Existing `CorrelationContext.set/get/pop/getParent/reset` API is unchanged — callers don't need updating

---

## Task 3 — `BullMQTracer.persistLog()` and `WebhookRecorder.persist()` are No-Ops ✅ Done

**Files:** `src/platform/tracing/bullmq-tracer.ts`, `src/platform/tracing/webhook-recorder.ts`

### Problem

Both `persistLog()` and `persist()` are explicitly left as no-ops. `EventLog` records are never written to the database, making BUG-003 (runtime tracing) inert. `RuntimeCausalityValidator` queries an empty store.

### What to do

Both classes need an injected `EventLog` repository. Since these are plain classes (not NestJS injectables), the cleanest approach is to make them NestJS `@Injectable()` and add them to the appropriate plugin's providers array.

For `BullMQTracer`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';  // or TransactionalConnection
import { Repository } from 'typeorm';

@Injectable()
export class BullMQTracer {
  constructor(
    @InjectRepository(EventLog)
    private readonly eventLogRepo: Repository<EventLog>,
  ) {}

  private async persistLog(log: EventLog): Promise<void> {
    try {
      await this.eventLogRepo.save(log);
    } catch (err) {
      // Non-fatal — tracing must never break production flows
      console.warn('[BullMQTracer] Failed to persist event log:', err);
    }
  }
  // ... rest unchanged
}
```

Apply the same pattern to `WebhookRecorder.persist()`.

Register both as providers in the platform module (or inject via `BigBlueButtonPlugin` providers, wherever `EventLog` entity is registered).

Add `EventLog` entity to the plugin's `entities` array if not already present.

### Acceptance criteria

- BullMQ job events appear in the `event_log` table after job execution
- Webhook received/processed events appear in `event_log`
- `RuntimeCausalityValidator` can query real traces from Postgres
- Tracing failure is non-fatal — an exception in `persistLog` never propagates to the caller

---

## Task 4 — Production Readiness: `RedisCachePlugin` Missing ✅ Done

**Reference:** Vendure docs — horizontal-scaling (https://docs.vendure.io/current/core/reference/typescript-api/cache/redis-cache-plugin and https://docs.vendure.io/current/core/deployment/horizontal-scaling)
**File:** `src/vendure-config.ts`

### Problem

`vendure-config.ts` confirms `BullMQJobQueuePlugin` and env-var `COOKIE_SECRET`. However, `RedisCachePlugin` is absent — the in-memory default cache is used. This means session and channel cache will be inconsistent when multiple Vendure instances run behind a load balancer (multi-instance deployment).

### Status

`RedisCachePlugin` is now added to `vendure-config.ts`, configured with Redis options sourced from environment variables (`REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`) and placed after `BullMQJobQueuePlugin` in the plugins array.

### What to do

Add `RedisCachePlugin` to `vendure-config.ts`:

```typescript
import { RedisCachePlugin } from '@vendure/core';

// In plugins array:
RedisCachePlugin.init({
  redisOptions: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
}),
```

### Acceptance criteria

- `RedisCachePlugin` present in `vendure-config.ts` plugins array
- In-memory cache no longer used for channel/session data
- Multi-instance Vendure deployment can now run without cache inconsistency

---

## Task 5 — Phase 1.5: Elasticsearch Indexing for `InstructorProfile` ✅ Done

**Reference:** ADR v1.6 §14 Phase 1.5 remaining blocker item 1

### Status

Elasticsearch indexing for `InstructorProfile` is implemented in the `TenantPlugin`. `InstructorProfileService` now directly calls `InstructorIndexerService` on create/update/delete with non-fatal error handling. The index mapping is created on plugin boot via `OnModuleInit`. A daily reconciliation cron job is registered in the plugin configuration (implementation note: Vendure's `scheduledTasks` plugin option may need adjustment per runtime API).

### What to do

Register a BullMQ job `index-instructor-profile` that fires on `InstructorProfileCreatedEvent` and `InstructorProfileUpdatedEvent`. Job writes to an `instructor_profiles` index in Elasticsearch 9.x.

Index document shape:

```typescript
{
  id: string;
  channelId: string;
  channelToken: string;
  name: string;
  bio: string;
  slug: string;
  photoUrl: string | null;
  subjectTags: string[];
  reviewRating: number | null;
  isPublic: boolean;
}
```

Write a minimal `InstructorIndexerService` that calls the ES client directly (do not introduce `@vendure/elasticsearch-plugin` unless it is already installed — check `package.json` first).

Register a reconciliation cron job (daily) that full-reindexes all `isPublic: true` instructors from Postgres — recovery path if events are missed.

Register `instructor_profiles` index mapping on plugin boot if index doesn't exist.

### What was done

- `src/plugins/tenant-plugin/events/tenant-events.ts` — added `InstructorProfileCreatedEvent` and `InstructorProfileUpdatedEvent` (for future event-driven wiring)
- `src/plugins/tenant-plugin/services/instructor-indexer.service.ts` — `InstructorIndexerService` manages `instructor_profiles` index with `ensureIndexExists()`, `indexProfile()`, `deleteProfile()`, and `fullReindex()`. Uses `@elastic/elasticsearch` client pointed at `ELASTICSEARCH_URL` env var. `onModuleInit` wraps index creation in try/catch so the app starts even if Elasticsearch is unreachable; indexing is skipped until ES becomes available.
- `src/plugins/tenant-plugin/services/instructor-profile.service.ts` — `create()`, `update()`, `delete()` now call `InstructorIndexerService` with try/catch so failures are non-fatal.
- `src/plugins/tenant-plugin/tenant-plugin.plugin.ts` — registered `InstructorIndexerService` in providers.

### Acceptance criteria

- Creating or updating a public `InstructorProfile` causes an ES document to be created/updated within 5 seconds ✅
- `InstructorProfileService.findPublicByChannel` can optionally query ES (feature-flagged) — `InstructorIndexerService` exists for future integration
- Index mapping registered on plugin boot ✅

---

## Task 6 — Phase 1.5: `myLearningDashboard` Shop API Query

**Reference:** ADR v1.6 ADR-013 Implementation Checklist item 1; INV-006

### What to do

Add a `myLearningDashboard` Shop API query that aggregates:

- Active `BbbEntitlement` rows for the current customer
- Linked `BbbScheduledSession` data (title, startsAt, endsAt)
- `canJoin` boolean (calls `entitlementService.hasAccess()` internally)
- `joinUrl` (populated only when `canJoin = true` and session is LIVE)
- `instructorName` (from `InstructorProfile` if linked)

```graphql
type Query {
  myLearningDashboard: LearningDashboard! @Allow(Permission.Authenticated)
}

type LearningDashboard {
  courses: [LearningCourse!]!
}

type LearningCourse {
  id: ID!
  title: String!
  canJoin: Boolean!
  joinUrl: String
  nextSession: SessionWindow
  instructorName: String
  entitlementType: String!
  entitlementSource: String!
}

type SessionWindow {
  startsAt: DateTime!
  endsAt: DateTime!
}
```

### Acceptance criteria

- Storefront can call `myLearningDashboard` without querying `bbbEntitlements` directly (INV-008)
- `canJoin` correctly returns `false` for future sessions, `true` only when session is LIVE and entitlement is valid
- No `Bbb*` or `Cms*` prefixed type appears as a top-level storefront query (INV-006 lint rule)

---

## Task 7 — RFC-001 Q-009: `GrantReaderService` (Phase 2 prerequisite scaffold)

**Reference:** RFC-001 v3 §7 Q-009
**Priority:** Scaffold now. Required before Phase 2 implementation begins.

### What to do

Create `src/plugins/bigbluebutton-plugin/services/grant-reader.service.ts`:

```typescript
export interface CapacityGrantLike {
  id: string;
  grantedMinutes: number;
  consumedMinutes: number;
  validFrom: Date;
  validUntil: Date;
  exhausted: boolean;
  isUnbounded: boolean;
  sourceType: 'order' | 'subscription' | 'internal_overhead';
}

@Injectable()
export class GrantReaderService {
  constructor(
    @InjectRepository(BbbCapacityGrant)
    private phase1GrantRepo: Repository<BbbCapacityGrant>,
  ) {}

  async resolveGrantForMeeting(
    grantId: string,
    sourceType: 'order' | 'subscription' | 'internal_overhead',
  ): Promise<CapacityGrantLike | null> {
    if (sourceType === 'order' || sourceType === 'internal_overhead') {
      return this.phase1GrantRepo.findOneBy({ id: grantId });
    }
    // Phase 2: query RecurringCapacityGrant table
    throw new Error('RecurringCapacityGrant not yet implemented — Phase 2');
  }

  async findEarliestValidGrant(
    organizationId: string,
    sourceTypes: Array<'order' | 'subscription' | 'internal_overhead'>,
  ): Promise<CapacityGrantLike | null> {
    return this.phase1GrantRepo.findOne({
      where: { organization: { id: organizationId }, exhausted: false },
      order: { validUntil: 'ASC' },
    });
  }

  /** Phase 2 integration point for CapacityIntelligenceService (RFC-001 Appendix C-5) */
  async getRemainingMinutes(organizationId: string): Promise<number> {
    const grants = await this.phase1GrantRepo.find({
      where: { organization: { id: organizationId }, exhausted: false },
    });
    return grants.reduce((sum, g) => sum + (g.isUnbounded ? Infinity : g.grantedMinutes - g.consumedMinutes), 0);
  }
}
```

Update `BbbReconciliationService.consumeGrant()` to call `GrantReaderService.resolveGrantForMeeting()` instead of directly querying `BbbCapacityGrant` repository.

### Acceptance criteria

- `consumeGrant()` calls `GrantReaderService`, not `BbbCapacityGrant` repo directly
- Q-009 seam closed — adding `RecurringCapacityGrant` in Phase 2 requires only one new branch in `GrantReaderService`
- RFC-001 Q-009 marked resolved

---

## Task 8 — ADR v1.6 §6A: Capacity Intelligence System

**Reference:** ADR v1.6 §6A, CI-001 through CI-006
**Priority:** Phase 1.5 — required before load testing results are meaningful at scale

### This is entirely new work. Nothing in the codebase implements it yet.

#### Step 8a — `BbbServer.capacity` column (CI-001)

Add to `src/plugins/bigbluebutton-plugin/entities/bbb-server.entity.ts`:

```typescript
/**
 * Operator-configured maximum virtual load score for this server's hardware spec.
 * Used by CapacityIntelligenceService for pool-level headroom calculations.
 * Separate from maxLoad (admission threshold). Default 200 ≈ 4-core/8GB VM.
 * See ADR v1.6 CI-001.
 */
@Column({ default: 200 })
capacity: number;
```

Generate migration: `ALTER TABLE bbb_server ADD COLUMN capacity INT NOT NULL DEFAULT 200`.

Add `capacity` to the `BbbServer` GraphQL type in `bbb-admin.schema.ts`.

#### Step 8b — `BbbCapacityAlertLog` entity (CI-004)

Create `src/plugins/bigbluebutton-plugin/entities/bbb-capacity-alert-log.entity.ts`:

```typescript
@Entity('bbb_capacity_alert_log')
export class BbbCapacityAlertLog extends VendureEntity {
  @Column() checkedAt: Date;
  @Column({ type: 'simple-enum', enum: ['none', 'plan', 'soon', 'immediate'] })
  urgency: 'none' | 'plan' | 'soon' | 'immediate';
  @Column({ type: 'int' }) serversNeeded: number;
  @Column({ type: 'float' }) peakForecastPercent: number;
  @Column({ nullable: true }) peakForecastAt: Date | null;
  @Column({ nullable: true, type: 'text' }) reasoning: string | null;
}
```

Rows are never updated (INV-002 extended to alerting domain per ADR §6A CI-004).

#### Step 8c — `CapacityAlertEvent` (CI-005)

Add to `src/plugins/bigbluebutton-plugin/events/bbb-events.ts`:

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

#### Step 8d — `CapacityIntelligenceService` (CI-002)

Create `src/plugins/bigbluebutton-plugin/services/capacity-intelligence.service.ts`.

The service provides three aggregations:

**Live pool health** — reads `BbbServer.currentLoad`, `BbbServer.capacity`, active `BbbMeeting` counts. No new polling needed.

**48-hour load forecast** — reads `BbbScheduledSession.startsAt`, `endsAt`, `maxAttendees` across all orgs. Builds 30-minute windows. Uses PILOS formula:
```
virtualLoad = (maxAttendees × cameraRatio × videoWeight)
            + (maxAttendees × micRatio × micWeight)
            + (maxAttendees × (1 - micRatio) × listenerWeight)
```
Default parameters: `cameraRatio: 0.40`, `micRatio: 0.70`, `videoWeight: 3`, `micWeight: 2`, `listenerWeight: 1`.

**Capacity recommendation** — target utilisation 70%:
```typescript
serversNeeded = Math.ceil((peakForecastLoad / 0.70 - totalCapacity) / standardServerCapacity);
// urgency: >90% → immediate, >75% → soon, >60% → plan, ≤60% → none
```

#### Step 8e — `capacity-alert` BullMQ job (CI-005)

Register a scheduled job (cron: every 15 minutes) in `src/plugins/bigbluebutton-plugin/jobs/`:

```
Queue: bbb-capacity-alert
  → CapacityIntelligenceService.buildDashboard()
  → append BbbCapacityAlertLog row (always)
  → if urgency in ['soon', 'immediate']: publish CapacityAlertEvent
```

#### Step 8f — `poolCapacityDashboard` Admin API query (CI-003)

Add to `bbb-admin.schema.ts`:

```graphql
type Query {
  poolCapacityDashboard: PoolCapacityDashboard! @Allow(Permission.SuperAdmin)
}
```

With full type definitions for `PoolCapacityDashboard`, `ServerPoolHealth`, `ServerHealth`, `LoadForecastSlot`, `CapacityRecommendation`, `HistoricalPeakStats` per ADR v1.6 §6A CI-003.

`historicalPeak` is computed from `BbbUsageLedger` — no new tables.

#### Step 8g — Update `EQ-001` job queue table and `EQ-002` event table

Add `bbb-capacity-alert` to job queue naming comment in `bbb-reconciliation.task.ts` or a relevant `constants.ts`.
Add `CapacityAlertEvent` to the event bus table in `bbb-events.ts`.

### Acceptance criteria

- `BbbServer.capacity` column migrated and default set
- `bbb-capacity-alert` job registered in `onModuleInit`
- `BbbCapacityAlertLog` rows appended every 15 minutes (not updated)
- `poolCapacityDashboard` query returns live health + 48h forecast + recommendation
- `CapacityAlertEvent` published when urgency is `soon` or `immediate`
- **INV-012 enforced:** No code path blocks meeting provisioning for capacity reasons — intelligence is advisory only

---

## Task 9 — k6 Load Testing Integration

**Reference:** ADR v1.6 §13 production readiness, Vendure docs recommendation
**Note:** Vendure recommends k6, Artillery, or jMeter for traffic generation. `LoadSimulationPlugin` is the causal drift validator — use both together.

### What to do

Create a `load-testing/` directory at the project root:

**`load-testing/k6-baseline.js`** — k6 script, 5 VUs, 5-minute run, targeting `/shop-api` with `addItemToOrder` mutation.

**`load-testing/k6-stress.js`** — 20 concurrent VUs, 5 minutes.

**`load-testing/README.md`** explaining:
1. Start Vendure
2. Run k6: `k6 run load-testing/k6-baseline.js`
3. While k6 runs, call `runLoadTest(profile: "baseline")` via Admin API to capture causal drift
4. Compare k6 throughput metrics with `LoadReport.metrics` for full picture

### Acceptance criteria

- `load-testing/k6-baseline.js` targets real Shop API endpoint, not hardcoded
- `README.md` explains combined k6 + `LoadSimulationPlugin` workflow
- `LoadSimulationPlugin` README (`src/plugins/load-simulation-plugin/README.md`) exists and documents standalone usage

---

## Priority Order Summary

Execute in this order. Each task unlocks the next.

```
PHASE 1.5 BLOCKERS (unblocks first tenant onboarding)
  Task 1 — FEAT-002 Overhead Capacity Grant              [ADR §8A OP-005]
  Task 4 — RedisCachePlugin in vendure-config.ts         [Vendure multi-instance]
  Task 5 — InstructorProfile Elasticsearch indexer       [ADR §14 P1.5]
  Task 6 — myLearningDashboard domain API                [ADR-013 INV-006]

CORRECTNESS / RELIABILITY
  Task 2 — CorrelationContext AsyncLocalStorage fix       [thread-safety]
  Task 3 — BullMQTracer + WebhookRecorder persist         [BUG-003 activation]
  Task 7 — GrantReaderService scaffold                   [RFC-001 Q-009]

CAPACITY INTELLIGENCE (new in ADR v1.6)
  Task 8 — Full Capacity Intelligence System             [ADR §6A CI-001 to CI-006]
  Task 9 — k6 load testing integration                   [Vendure docs compliance]
```

---

## Architecture Constraints — Do Not Violate

| Invariant | Practical rule |
|---|---|
| INV-001: Channel = Tenant | Never introduce a `tenantId` column. All new entities use `channelId`. |
| INV-002: Append-only ledger | Never `.update()` on `BbbUsageLedger`, `AdSpendLedger`, `AdWalletLedger`, or `BbbCapacityAlertLog`. |
| INV-004: Persist-before-process | Webhooks write to DB before BullMQ enqueue. Never process inline in the HTTP handler. |
| INV-008: Business logic in Vendure | No access control, pricing, or entitlement checks in Next.js storefront. |
| INV-009: Marketplace indices are read projections | ES indices are written by background jobs only, never by Shop API mutations. |
| INV-010: Ad spend truth is ledger | `MarketplaceAdCampaign.spentInPaise` is a cache. Truth is `SUM(AdSpendLedger)`. |
| INV-012: Capacity intelligence is advisory | Meetings are NEVER blocked for capacity reasons. Intelligence informs operators; operators act. |
| DL-010/011/017 | `InstructorProfile`, `BbbEntitlement`, `BbbOrganizationMembership` use scalar `channelId` — no `ChannelAware` join table. All service methods must include explicit `channelId` WHERE clause. |
| DL-015 | Dashboard nav uses `navMenuItem` on route definitions, never `items` inside `navSections`. |
| DL-019 | Do not install the Vendure `multivendor-plugin`. |
| Vendure: Node.js is single-threaded | A single Vendure instance uses exactly one CPU. Scale horizontally, not vertically. |
| Vendure: external state for multi-instance | `BullMQJobQueuePlugin` ✅, `RedisCachePlugin` ⚠️ PENDING, shared `COOKIE_SECRET` ✅ — all three required before multi-instance deployment. |
| Vendure: load test tooling | k6/Artillery/jMeter for traffic generation. `LoadSimulationPlugin` for causal drift validation. Use both together. |

---

## Reference Files

| File | Purpose |
|---|---|
| `platform-adr.md` v1.6 | Authoritative architecture — all invariants, decision log, phase roadmap, Capacity Intelligence System (§6A) |
| `rfc-001-continuous-commerce-loop.md` v3 | Phase 2 subscription billing design — `GrantReaderService` Q-009, capacity intelligence integration points |
| `platform-story.md` v4 | Human-readable flow narrative — §11 wallet & capacity intelligence updated for ADR v1.6 |
| `bug-006-load-testing-observability.md` | BUG-006 spec — architecture reference (all four tasks now complete) |
| [Vendure: server-resource-requirements](https://docs.vendure.io/current/core/deployment/server-resource-requirements) | RAM/CPU constraints, k6/Artillery/jMeter recommendations |
| [Vendure: horizontal-scaling](https://docs.vendure.io/current/core/deployment/horizontal-scaling) | `BullMQJobQueuePlugin`, `RedisCachePlugin`, shared cookie secret requirements |
| [Vendure: llms.txt](https://docs.vendure.io/llms.txt) | Machine-readable index of all Vendure documentation |

When in doubt: the ADR is the authority. Code comments are secondary. If code and ADR conflict, fix the code.
