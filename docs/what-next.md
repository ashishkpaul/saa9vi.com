# What Next — Saa9vi Platform: Cline Development Prompt

**Generated:** 2026-06-30
**Based on:** ADR v1.6, RFC-001 v3, platform-story v4, BUG-001 through BUG-006, all five plugin codebases, Vendure live docs (server-resource-requirements, horizontal-scaling)
**Status of platform at time of writing:** Phase 1 commerce loop complete. Phase 1.5 partially complete (FEAT-001 done, FEAT-002 pending). Phase 2 (subscriptions) unimplemented. BUG-006 load testing is fully wired. Tasks 1–5 from the previous what-next are complete. Tasks 6–12 and the new Capacity Intelligence System (ADR v1.6 §6A) are pending.

---

## Deep Review Assessment (2026-06-30)

A full end-to-end review of ADR v1.6, platform-story v4, and all five plugin codebases was completed. Key findings:

**Documentation-to-code fidelity is high.** Every ADR claim checked against the actual implementation — including the trickiest one (BUG-003's persist-first guarantee) — was verified correct. The webhook pipeline, encryption service, room lock service, and channel isolation logic are all solid.

**All substantive issues from the previous review have been acted on:**
- BUG-019/020 staleness in ADR §12 — corrected to ✅ Fixed
- Task 3 tense issue — rewritten to past tense
- Rate limiting and custom domain routing — promoted from untracked checklist items to explicit Tasks 10 and 11
- CorrelationInterceptor global scope — captured as Task 12

**Minor doc hygiene:** Task 4's "What to do" section is redundant (status already confirms done) — trimmed in this update.

**No new bugs found.** The remaining open items (BUG-015 banner queues, BUG-017 reviews channel isolation) remain honestly tracked as pending.

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
| Task 4 — `RedisCachePlugin` in `vendure-config.ts` | ✅ Done | `RedisCachePlugin.init()` present in plugins array, reads from `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` env vars. |
| Task 5 — `InstructorProfile` Elasticsearch indexer | ✅ Done | `InstructorIndexerService` wired. ES client fixed to use `ELASTICSEARCH_NODE` + `ELASTICSEARCH_PASSWORD`. |
| Task 12 — CorrelationInterceptor global scope fix | ✅ Done | `PlatformTracingModule` created with `@Global()` + `APP_INTERCEPTOR`. `BigBlueButtonPlugin` imports the module; `APP_INTERCEPTOR` removed from plugin providers. All plugins now inherit correlation context. |

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

`CorrelationContext` now uses `AsyncLocalStorage`. `CorrelationInterceptor` wraps each request in `CorrelationContext.run()` and is registered as a global `APP_INTERCEPTOR` via `PlatformTracingModule`.

✅ **Scope gap closed:** `PlatformTracingModule` is `@Global()` and registers `APP_INTERCEPTOR` at the module level. `BigBlueButtonPlugin` imports `PlatformTracingModule` instead of registering `APP_INTERCEPTOR` directly. All plugins (CmsPlugin, TenantPlugin, ReviewsPlugin) now inherit a correlation context.

### What was done

- `src/platform/tracing/correlation-context.ts` — replaced static properties with `AsyncLocalStorage<CorrelationState>`; `run()`, `set()`, `get()`, `getParent()`, `pop()`, `reset()`, `generateId()` all preserved
- `src/platform/tracing/correlation-interceptor.ts` — `CorrelationInterceptor` wraps each request in `CorrelationContext.run()`
- `src/platform/tracing/platform-tracing.module.ts` — new `@Global()` module that registers `CorrelationInterceptor` as `APP_INTERCEPTOR` and exports `BullMQTracer`, `WebhookRecorder`, `CorrelationInterceptor`
- `BigBlueButtonPlugin` — imports `PlatformTracingModule`; `APP_INTERCEPTOR` registration removed from plugin providers
- All plugins now have correlation context on every request

---

## Task 3 — `BullMQTracer.persistLog()` and `WebhookRecorder.persist()` are No-Ops ✅ Done

**Files:** `src/platform/tracing/bullmq-tracer.ts`, `src/platform/tracing/webhook-recorder.ts`

### What was done

Both classes are now `@Injectable()` with `TransactionalConnection` injected. `persistLog()` and `persist()` call `connection.rawConnection.getRepository(EventLog).save(log)` with non-fatal error handling — a persist failure logs a warning and never propagates to the caller.

- `BullMQTracer` — `@Injectable()`, constructor receives `TransactionalConnection`, `persistLog()` saves to `event_log` table
- `WebhookRecorder` — same pattern, `persist()` saves received/processed webhook events
- Both are registered in `BigBlueButtonPlugin` providers
- `RuntimeCausalityValidator` can now query real traces from Postgres

---

## Task 4 — Production Readiness: `RedisCachePlugin` ✅ Done

**Reference:** Vendure docs — horizontal-scaling (https://docs.vendure.io/current/core/reference/typescript-api/cache/redis-cache-plugin and https://docs.vendure.io/current/core/deployment/horizontal-scaling)
**File:** `src/vendure-config.ts`

### Problem

`vendure-config.ts` confirmed `BullMQJobQueuePlugin` and env-var `COOKIE_SECRET`. However, `RedisCachePlugin` was absent — the in-memory default cache was used. This meant session and channel cache would be inconsistent when multiple Vendure instances run behind a load balancer (multi-instance deployment).

### What was done

`RedisCachePlugin` was added to `vendure-config.ts`, configured with Redis options sourced from environment variables (`REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`) and placed after `BullMQJobQueuePlugin` in the plugins array:

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

### Acceptance criteria (verified)

- `RedisCachePlugin` present in `vendure-config.ts` plugins array ✅
- In-memory cache no longer used for channel/session data ✅
- Multi-instance Vendure deployment can now run without cache inconsistency ✅

---

## Task 5 — Phase 1.5: Elasticsearch Indexing for `InstructorProfile` ✅ Done

**Reference:** ADR v1.6 §14 Phase 1.5 remaining blocker item 1

### What was done

- `InstructorIndexerService` manages `instructor_profiles` index — `ensureIndexExists()`, `indexProfile()`, `deleteProfile()`, `fullReindex()`. Uses `@elastic/elasticsearch` client.
- `InstructorProfileService.create()`, `update()`, `delete()` call the indexer non-fatally.
- Index mapping created on `onModuleInit` (non-blocking — app starts even if ES unreachable).
- `TenantPlugin` registers `InstructorIndexerService` as a provider.
- ES client now reads `ELASTICSEARCH_NODE` + `ELASTICSEARCH_PASSWORD` from env (fixed in this session).

### Scope clarification — per-tenant vs marketplace discovery

The `instructor_profiles` index is **per-tenant scoped** (filtered by `channelId`). It powers search within a single academy's storefront (e.g. `mehta.saa9vi.com`).

**Marketplace discovery** — a student arriving at `marketplace.saa9vi.com` who doesn't know any academy — requires the **platform-level** `saa9vi_marketplace_instructors` index spanning all channels. This is Phase 3 work (`MarketplaceIndexerPlugin`, ADR §14 Phase 3 / DL-020 / INV-009). The per-tenant index in Phase 1.5 and the platform index in Phase 3 are **two separate indices with different scopes** — one is not a replacement for the other.

**Do not install `@vendure-community/elasticsearch-plugin`** — it indexes Vendure `Product`/`ProductVariant` only. `InstructorProfile` and `BbbScheduledSession` are custom entities and require custom indexing, which `InstructorIndexerService` already provides correctly.

### How a student discovers a tenant via marketplace (Phase 3 flow)

```
Student searches "JEE maths coach Delhi" on marketplace.saa9vi.com
  → MarketplaceSearchResolver (no channel token)
  → saa9vi_marketplace_instructors ES index (cross-channel read projection)
  → Result: "Mehta Coaching — Rajesh Mehta, JEE Maths, Delhi"
  → Student clicks → routed to mehta.saa9vi.com
  → All subsequent commerce (checkout, entitlement, billing) happens
    on mehta.saa9vi.com with channel context — INV-001 preserved
```

`InstructorIndexerService.indexProfile()` feeds the per-tenant index. `MarketplaceIndexerPlugin` (Phase 3) will read the same Postgres data and feed the platform index separately — no code change to Phase 1.5 indexer needed.

---

## Task 5b — Phase 3 Prerequisite: `MarketplaceIndexerPlugin` ✅ Done

**Reference:** ADR v1.6 §14 Phase 3, DL-020, INV-009
**Priority:** Phase 3 — scaffold complete. Full Phase 3 features (sponsored listings, Bayesian rating, price from ProductVariant) are deferred.

### What was built

A new `MarketplaceIndexerPlugin` in `src/plugins/marketplace/` with:

| Component | File | Purpose |
|---|---|---|
| Plugin | `marketplace-indexer.plugin.ts` | Vendure plugin registration, ES index creation on bootstrap |
| Indexer service | `services/marketplace-indexer.service.ts` | ES client, `indexSession()`, `indexInstructor()`, `deleteSession()`, `deleteInstructor()`, `fullReindex()` |
| Search resolver | `api/marketplace-search.resolver.ts` | `marketplaceSearch` (public Shop API) + `marketplaceFullReindex` (SuperAdmin) |
| GraphQL schema | `api/marketplace-schema.ts` | `MarketplaceSession`, `MarketplaceInstructor`, `MarketplaceSearchResult`, `MarketplaceSearchInput` types |
| Event listener | `listeners/marketplace-event.listener.ts` | Subscribes to `InstructorProfileCreatedEvent` / `InstructorProfileUpdatedEvent` → triggers marketplace index update |

### Event-driven architecture

```
InstructorProfileService.create()
  → publishes InstructorProfileCreatedEvent (Vendure EventBus)
  → MarketplaceEventListener.handleInstructorCreated()
  → MarketplaceIndexerService.indexInstructor()
  → writes to saa9vi_marketplace_instructors ES index
```

### Indices created

| Index | Document shape | Trigger |
|---|---|---|
| `saa9vi_marketplace_sessions` | `{ id, productVariantId, channelToken, channelId, title, startTime, endTime, priceInPaise, academyName, academySlug, instructorName, subjectTags, bayesianRating, isSponsored, sponsorBoost }` | `ProductVariantEvent` (Phase 3 — not yet wired) |
| `saa9vi_marketplace_instructors` | `{ id, channelId, channelToken, name, bio, slug, photoUrl, subjectTags, reviewRating, academyName, academySlug }` | `InstructorProfileCreatedEvent` / `InstructorProfileUpdatedEvent` ✅ Live |

### Search query

```graphql
query SearchMarketplace($input: MarketplaceSearchInput!) {
  marketplaceSearch(input: $input) {
    sessions { id title academyName priceInPaise bayesianRating isSponsored }
    instructors { id name academyName subjectTags }
    totalSessions
    totalInstructors
  }
}
```

Results are ranked by `function_score` combining `bayesianRating` (log1p) with a 3× weight boost for `isSponsored: true` sessions.

### Registration

`MarketplaceIndexerPlugin` is registered in `vendure-config.ts` plugins array.

### Phase 3 gaps (not yet implemented)

- Sponsored listing bid-boost from `MarketplaceAdCampaign` entity
- Bayesian rating from `ReviewsPlugin` aggregate
- Price from `ProductVariant.price` (currently hardcoded to 0)
- `ProductVariantEvent` subscription for session index updates
- BullMQ job queue for async index writes (currently inline in event handlers)
- `Product.customFields.bbbSessionId` and `instructorProfileId` — defined in `vendure-config.ts` but not yet populated in `BbbScheduledSessionService.create()`




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

## Task 10 — SEC-004: Rate Limiting on Public Mutations

**Reference:** ADR v1.6 §13 Production Readiness Checklist (⚠️ Pending)
**Blocking:** First tenant onboarding — this is the last remaining Phase 1 blocker

### What to do

Add rate limiting to three surfaces via a NestJS `ThrottlerModule` or a Caddy/reverse-proxy layer:

| Surface | Limit | Reason |
|---|---|---|
| `POST /bbb/webhook` | 100 req/min per source IP | BBB server IPs should be allowlisted |
| `registerForTrialSession` mutation | 10 req/min per customer | Abuse vector for free trial seats |
| `joinMeeting` mutation | 10 req/min per customer | Prevents join-URL farming |

The simplest Vendure-native approach is `@nestjs/throttler` registered as a global guard. For `POST /bbb/webhook`, configure an IP allowlist for known BBB server IPs and apply a stricter rate on unknown IPs.

---

## Task 11 — Custom Domain → Channel Token Redis Mapping

**Reference:** ADR v1.6 §13 Production Readiness Checklist (⚠️ Pending), SEC-006
**Blocking:** Custom domain tenants — without this, `mehta.saa9vi.com` cannot resolve to the correct channel

### What to do

When `TenantProfile.customDomain` is set or updated, write a Redis key:

```typescript
// key: `channel-token:${customDomain}`  value: channelToken
await redis.set(`channel-token:${customDomain}`, channel.token);
```

In Next.js middleware, resolve hostname → channelToken:

```typescript
const channelToken = await redis.get(`channel-token:${hostname}`);
// Set as X-Vendure-Token header on all requests
```

Invalidate the Redis key when `TenantProfile.customDomain` changes.

---

## Task 12 — CorrelationInterceptor Global Scope Fix

**Reference:** what-next Task 2 scope gap

### Problem

`CorrelationInterceptor` is registered as `APP_INTERCEPTOR` only inside `BigBlueButtonPlugin`. Requests handled by `CmsPlugin`, `TenantPlugin`, and `ReviewsPlugin` do not inherit a correlation context — their BullMQ traces will have no `correlationId`.

### What to do

Move the `APP_INTERCEPTOR` registration to the root bootstrap or a shared platform module so it applies globally across all plugins:

```typescript
// In vendure-config.ts or a root AppModule if one exists:
// Add to providers at the VendureConfig level via configuration callback
```

The simplest approach in Vendure's plugin architecture: add to `BigBlueButtonPlugin`'s `configuration` callback:

```typescript
configuration: (config) => {
  // Already done — APP_INTERCEPTOR is global when registered in any plugin's providers
  // via NestJS DI — verify this is actually global by testing a TenantPlugin request
  return config;
}
```

Verify by checking that a `TenantPlugin` resolver call creates an `event_log` row with a `correlationId`.

---

## Priority Order Summary

Execute in this order. Each task unlocks the next.

```
PHASE 1 FINAL BLOCKERS (last items before first tenant onboarding)
  Task 10 — SEC-004 Rate limiting                        [ADR §13 last Phase 1 blocker]
  Task 11 — Custom domain Redis mapping                  [SEC-006, multi-tenant routing]

PHASE 1.5 BLOCKERS (unblocks full tenant experience)
  Task 1 — FEAT-002 Overhead Capacity Grant (migration)  [ADR §8A OP-005]
  Task 6 — myLearningDashboard domain API                [ADR-013 INV-006]

CORRECTNESS / RELIABILITY
  Task 12 — CorrelationInterceptor global scope fix      [all-plugin tracing]
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
