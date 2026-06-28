# What Next — Saa9vi Platform: Cline Development Prompt

**Generated:** 2026-06
**Based on:** ADR v1.5, RFC-001 v2, platform-story v2, BUG-001 through BUG-006, all five plugin codebases, load-simulation-plugin, Vendure live docs (server-resource-requirements, horizontal-scaling)
**Status of platform at time of writing:** Phase 1 commerce loop complete. Phase 1.5 partially complete. Phase 2 (subscriptions) unimplemented. BUG-001 through BUG-006 infrastructure implemented but BUG-006 has a critical simulation gap.

---

## Critical Finding Before You Start

**BUG-006 `LoadOrchestrator` is NOT using real HTTP.** Read `load-orchestrator.ts` line ~85:

```typescript
private async simulateExecution(_request: GraphQLRequest): Promise<void> {
  // Simulate variable latency: 10-100ms
  const latency = 10 + Math.random() * 90;
  await this.sleep(latency);
  // Simulate occasional failures (2% error rate)
  if (Math.random() < 0.02) throw new Error("Simulated execution failure");
}
```

The `BUG-006` spec (Section: Key Design Principles, Rule 1) states: **"All load testing MUST use actual Shop/Admin APIs via HTTP transport. No simulation in production mode."** The `GraphQLExecutor` class with real `fetch()` exists and is wired correctly — but `LoadOrchestrator.executeRequest()` never calls it. It calls `simulateExecution()` instead. This is the single most important bug to fix before any load test results can be trusted. Fix this first.

**Vendure docs context (server-resource-requirements):** Vendure officially recommends **k6, Artillery, or jMeter** as external load testing tools. The `LoadSimulationPlugin` is a *Vendure-native observability and causal drift detector* — it is not a replacement for a proper load generator. The correct architecture is: k6/Artillery generates traffic → `LoadSimulationPlugin` captures `EventLog` traces and `DriftDetector` validates causal expectations against that traffic. Tasks 1–4 bring `LoadSimulationPlugin` to its intended role.

**Vendure docs context (horizontal-scaling):** Node.js is single-threaded — a single Vendure instance uses exactly one CPU. The load test profiles (baseline/stress/spike/soak) should therefore measure: (a) GraphQL resolver latency under concurrent requests, (b) BullMQ worker throughput and Redis lock contention correctness, and (c) whether causal invariants hold across concurrent sessions — not raw throughput per CPU. Throughput at scale is achieved by running multiple Vendure instances behind a load balancer, not by vertically scaling a single instance.

---

## Task 1 — BUG-006: Wire Real HTTP Execution (BLOCKER)

**File:** `src/plugins/load-simulation-plugin/engine/load-orchestrator.ts`
**File:** `src/plugins/load-simulation-plugin/executor/graphql.executor.ts`

### What to do

> **Vendure docs note:** Vendure recommends k6, Artillery, or jMeter for load generation. `LoadSimulationPlugin` is the *causal drift validator*, not the traffic generator. Wire it so that when k6 or Artillery is running against the Shop/Admin API, `LoadSimulationPlugin.runLoadTest()` can be called in parallel to measure causal drift in real-time. For standalone testing without an external tool, the `GraphQLExecutor` handles the HTTP transport.

Inject `GraphQLExecutor` into `LoadOrchestrator` and replace `simulateExecution` with real execution:

```typescript
// load-orchestrator.ts — required change
@Injectable()
export class LoadOrchestrator {
  constructor(
    private eventBus: EventBus,
    private executor: GraphQLExecutor,   // ADD THIS INJECTION
  ) {}

  private async executeRequest(request: GraphQLRequest, step: LifecycleStep): Promise<ExecutionResult> {
    const result = await this.executor.execute(
      request.mutation,
      request.variables ?? {},
      request.context,
    );
    return {
      step: step.name,
      success: result.success,
      latencyMs: result.latencyMs,
      error: result.errors?.[0]?.message ?? null,
    };
  }
  // DELETE simulateExecution() entirely
}
```

Update `LoadSimulationPlugin` providers array to include `GraphQLExecutor`.

Wire `VendureHttpClient` with config from `vendure-config.ts` — `shopApiUrl` and `adminApiUrl` should come from environment variables, not hardcoded.

### Acceptance criteria

- `runLoadTest` GraphQL query fires real HTTP POST to `/shop-api` and `/admin-api`

- Response latencies reflect actual Vendure resolver execution time
- Error rate reflects actual resolver failures, not `Math.random() < 0.02`
- `simulateExecution()` is removed from the codebase
- `shopApiUrl` and `adminApiUrl` read from `process.env.SHOP_API_URL` / `ADMIN_API_URL` — never hardcoded
- A `README.md` in `load-simulation-plugin/` documents how to use it alongside k6 or Artillery

---

## Task 2 — BUG-006: Wire `MetricsCollector` into `LoadOrchestrator`

**File:** `src/plugins/load-simulation-plugin/engine/load-orchestrator.ts`
**File:** `src/plugins/load-simulation-plugin/observability/metrics.collector.ts`

### What to do

`MetricsCollector` exists and is correct but `LoadOrchestrator.run()` never calls `collector.record()` or `collector.report()`. The `LoadRunResult` returned by `run()` computes error rate manually from the raw `results[]` array — duplicating logic that `MetricsCollector` already owns cleanly.

```typescript
// In LoadOrchestrator.run():
const collector = new MetricsCollector();

// Inside executeWorker, after each step:
collector.record({ latencyMs: result.latencyMs, success: result.success });

// At the end of run():
const metrics = collector.report();
return {
  ...runResult,
  metrics, // attach to LoadRunResult
};
```

Extend `LoadRunResult` interface to include `metrics: LoadMetrics`.

Update `LoadSimulationService.run()` to expose `metrics` in its return value and wire to the GraphQL schema.

### Acceptance criteria

- `runLoadTest` response includes `avgLatency`, `p95`, `p99`, `errorRate`
- `MetricsCollector` is the single source of these numbers — no duplicate calculation

---

## Task 3 — BUG-006: Wire `DriftDetector` into `LoadSimulationService`

**File:** `src/plugins/load-simulation-plugin/api/load-simulation.service.ts`
**File:** `src/plugins/load-simulation-plugin/causal/drift-detector.ts`

### What to do

`DriftDetector` exists but is never called. `LoadSimulationService.run()` returns a simple status string — it never compares runtime metrics against causal expectations.

Define default `CausalExpectation` thresholds per lifecycle, calibrated against Vendure's single-threaded Node.js runtime (one CPU per instance, 200–300MB RAM idle per Vendure docs):

```typescript
const CAUSAL_EXPECTATIONS: Record<string, CausalExpectation> = {
  // Single-instance baselines — multiply concurrency across instances, not CPUs
  student_purchase:  { maxLatency: 800,  maxErrorRate: 0.01 },  // p95 < 800ms
  bbb_session:       { maxLatency: 1200, maxErrorRate: 0.02 },  // BBB API adds latency
  subscription:      { maxLatency: 1000, maxErrorRate: 0.01 },  // Juspay webhook path
};

// LoadProfile concurrency values should not exceed what a single Vendure instance
// can serve. Vendure docs recommend horizontal scaling (multiple instances) for
// throughput — not higher concurrency per instance. Practical limits:
// baseline: concurrency 5   (normal traffic)
// stress:   concurrency 20  (high load, single instance ceiling)
// spike:    concurrency 50  (burst — multi-instance territory)
// soak:     concurrency 10, durationMs: 3_600_000 (1hr stability test)
```

Call `DriftDetector.detect(metrics, expectation)` and include `CausalDrift` in the `LoadReport`.

Extend the GraphQL schema to return:

```graphql
type LoadReport {
  id: String!
  profile: String!
  totalRequests: Int!
  successCount: Int!
  errorCount: Int!
  metrics: LoadMetrics!
  drift: CausalDrift!
  duration: Int!
}

type LoadMetrics {
  avgLatency: Float!
  p95: Float!
  p99: Float!
  errorRate: Float!
  totalRequests: Int!
}

type CausalDrift {
  latencyViolation: Boolean!
  errorViolation: Boolean!
  causalBreak: Boolean!
  details: [String!]!
}
```

### Acceptance criteria

- `runLoadTest` returns a `LoadReport` with populated `drift` field
- A `causalBreak: true` result is returned when p95 > threshold or errorRate > threshold
- Schema is exported from `api-extensions.ts` (currently referenced but not verified complete)

---

## Task 4 — BUG-006: Fix `CausalMapper` — Real GraphQL Operations

**File:** `src/plugins/load-simulation-plugin/engine/causal-mapper.ts`

### What to do

`CausalMapper` maps `LifecycleStep.eventType` to GraphQL mutations using placeholder operations that do not match the actual Vendure Shop/Admin API schema. Every mutation will fail against a real endpoint.

Audit and replace with real operations. Map against the actual schema from each plugin:

| Event | Real mutation/query | API |
|---|---|---|
| `OrderStateTransitionEvent` | Use `addItemToOrder` + `transitionOrderToState` | shop |
| `BbbScheduledSessionActivatedEvent` | `activateScheduledSession(sessionId: ID!)` | admin |
| `BbbWebhookEvent` | Not a mutation — webhook is a POST to `/bbb/webhook`, not GraphQL | n/a |
| `ReviewRequestCreatedEvent` | Admin internal — no public mutation; use `createReviewRequest` if it exists | admin |
| `SubscriptionRenewedEvent` | Phase 2 not implemented — mark as `PHASE_2_PENDING` and skip, not fake |

For `BbbWebhookEvent`: the load test cannot replay webhooks via GraphQL. The correct approach is an Admin API mutation `simulateBbbWebhook(payload: String!)` that the `LoadSimulationPlugin` itself registers — a test-only resolver that calls `BbbWebhookController` logic directly. This keeps the real persist-first pipeline intact.

For Phase 2 events (`SubscriptionRenewedEvent`, `SubscriptionInvoicePaidEvent`, `RecurringCapacityGrantCreatedEvent`): return a typed `{ mutation: null, context: 'admin', isPending: true }` sentinel and have `LoadOrchestrator` skip these steps with a log entry rather than firing a fake mutation.

### Acceptance criteria

- No `CausalMapper` mapping fires against a non-existent GraphQL field
- Phase 2 event types are explicitly skipped with a log entry, not silently failing
- `simulateBbbWebhook` admin mutation registered in `LoadSimulationPlugin.adminApiExtensions`

---

## Task 5 — Phase 1.5 Blocker: FEAT-001 `BbbOrganizationMembership`

**Reference:** ADR v1.5 §8A OP-001, OP-002, OP-007 steps 1–4
**Blocking:** Archetype B (Internal Staff Meeting flow) cannot be used in production

### What to do

#### Step 5a — Entity

Create `src/plugins/bigbluebutton-plugin/entities/bbb-organization-membership.entity.ts`:

```typescript
@Entity('bbb_organization_membership')
@Index(['organizationId', 'customerId'], { unique: true })
export class BbbOrganizationMembership extends VendureEntity {
  @Column() organizationId: string;
  @Column() customerId: string;
  @Column() channelId: string;             // scalar (DL-017 pattern)
  @Column({
    type: 'simple-enum',
    enum: ['org_admin', 'moderator', 'staff'],
  })
  role: 'org_admin' | 'moderator' | 'staff';
  @Column({ default: true }) isActive: boolean;
}
```

Generate and run TypeORM migration.

#### Step 5b — Service

Create `BbbMembershipService` with:

- `findActiveMembership(ctx: RequestContext, customerId: string, organizationId: string): Promise<BbbOrganizationMembership | null>`
- `create(ctx, input): Promise<BbbOrganizationMembership>`
- `update(ctx, id, input): Promise<BbbOrganizationMembership>`
- `remove(ctx, id): Promise<void>`
- `listByOrganization(ctx, organizationId): Promise<BbbOrganizationMembership[]>`

#### Step 5c — Auth waterfall

Update `BbbShopResolver.joinRoom()` (or `BbbMeetingService.joinRoom()` — find where the entitlement check lives):

```typescript
// Gate 1 — staff short-circuit
const membership = await this.membershipService.findActiveMembership(
  ctx, ctx.activeUserId, room.organizationId
);
if (membership) {
  return this.provisionAndJoin(ctx, room, membership.role);
}
// Gate 2 — existing entitlement check (unchanged)
```

#### Step 5d — Role routing

In `provisionAndJoin()` (create this method if it doesn't exist as a named method):

```typescript
const bbbRole = (['org_admin', 'moderator'] as const).includes(membership.role)
  ? 'MODERATOR'
  : 'VIEWER';
```

Pass `bbbRole` to `bbbApiService.buildJoinUrl()`.

#### Step 5e — Admin mutations

Add to admin GraphQL schema:

```graphql
createBbbOrgMembership(input: CreateBbbOrgMembershipInput!): BbbOrganizationMembership!
updateBbbOrgMembership(id: ID!, input: UpdateBbbOrgMembershipInput!): BbbOrganizationMembership!
removeBbbOrgMembership(id: ID!): Boolean!
bbbOrgMemberships(organizationId: ID!): [BbbOrganizationMembership!]!
```

Add dashboard route `/bbb/memberships` in the React dashboard extension (follow the existing pattern from `BbbEntitlement` dashboard UI).

### Acceptance criteria

- Staff member with `isActive: true` membership can join an internal room (`productVariantId = null`) without purchasing
- Staff member receives moderator join URL when `role` is `org_admin` or `moderator`
- A customer with no membership falls through to the existing entitlement check unchanged
- BUG-018 is resolved — mark as fixed in ADR §12

---

## Task 6 — Phase 1.5 Blocker: FEAT-002 Overhead Capacity Grant

**Reference:** ADR v1.5 §8A OP-005
**Blocking:** Internal session billing writes ledger rows with no grant to debit against

### What to do

#### Step 6a — Add `sourceType` to `BbbCapacityGrant`

```typescript
@Column({ default: 'order' })
sourceType: 'order' | 'subscription' | 'internal_overhead';

@Column({ default: false })
isUnbounded: boolean;   // true for internal_overhead grants (grantedMinutes ignored)
```

Generate and run migration (nullable + default — existing rows get `'order'`).

#### Step 6b — Auto-provision overhead grant

In `BbbOrganizationService.create()` (wherever a new `BbbOrganization` is created), after the org is saved:

```typescript
await this.capacityGrantRepository.save({
  organizationId: org.id,
  channelId: org.channelId,
  sourceType: 'internal_overhead',
  isUnbounded: true,
  grantedMinutes: -1,     // sentinel — ignored when isUnbounded
  consumedMinutes: 0,
  exhausted: false,
  validFrom: new Date(),
  validUntil: new Date('2099-12-31'),  // effectively permanent
});
```

#### Step 6c — Update `consumeGrant()` branch

In `BbbReconciliationService.consumeGrant()` (or wherever grant debiting happens), add:

```typescript
if (grant.sourceType === 'internal_overhead') {
  // Write ledger row — always
  await this.usageLedgerRepository.save({
    meetingId, consumedMinutes, grantId: grant.id,
    startedAt, completedAt,
  });
  // Skip exhaustion check, skip capacity alert
  return;
}
// Existing path for 'order' grants continues unchanged
```

### Acceptance criteria

- Every new `BbbOrganization` has exactly one `internal_overhead` grant auto-created
- Internal session (`productVariantId = null` room) writes `BbbUsageLedger` row referencing the overhead grant
- Existing commercial session billing path is unchanged
- FEAT-002 marked complete in ADR §14 Phase 1.5 blockers

---

## Task 7 — Phase 1.5: Elasticsearch Indexing for `InstructorProfile`

**Reference:** ADR v1.5 §14 Phase 1.5 remaining blockers item 1
**Currently:** `InstructorProfile` entity exists, `findPublicByChannel` / `findPublicBySlug` queries exist — no ES indexer

### What to do

Register a BullMQ job `index-instructor-profile` that fires on `InstructorProfileCreatedEvent` and `InstructorProfileUpdatedEvent`. Job writes to an `instructor_profiles` index in Elasticsearch 9.x.

Index document shape:
```typescript
{
  id: string;
  channelId: string;          // for tenant-scoped search
  channelToken: string;       // for storefront routing
  name: string;
  bio: string;
  slug: string;
  photoUrl: string | null;
  subjectTags: string[];
  reviewRating: number | null; // from Product.customFields.reviewRating if linked
  isPublic: boolean;
}
```

Follow the existing Vendure Elasticsearch plugin pattern — or use `@vendure/elasticsearch-plugin` if already configured. If not, write a minimal `InstructorIndexerService` that calls the ES client directly.

Also register a reconciliation job (daily cron) that full-reindexes all `isPublic: true` instructors from Postgres — recovery path if events are missed.

### Acceptance criteria

- Creating or updating a public `InstructorProfile` causes an ES document to be created/updated within 5 seconds
- `findPublicByChannel` can optionally query ES instead of Postgres (feature-flagged)
- Index mapping registered on plugin boot if index doesn't exist

---

## Task 8 — Phase 1.5: `myLearningDashboard` Shop API Query

**Reference:** ADR v1.5 ADR-013 Implementation Checklist item 1; INV-006 (domain APIs only)

### What to do

Add a `myLearningDashboard` Shop API query that aggregates:

- Active `BbbEntitlement` rows for the current customer
- Their linked `BbbScheduledSession` data (title, startsAt, endsAt)
- `canJoin` boolean (calls `entitlementService.hasAccess()` internally)
- `joinUrl` (populated only when `canJoin = true` and session is LIVE)
- `instructorName` (from `InstructorProfile` if linked)

This is the INV-006 / INV-008 domain API contract — the storefront must query this instead of querying `bbbEntitlements` directly.

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

- Storefront can call `myLearningDashboard` and render all enrolled sessions without querying `bbbEntitlements` directly
- `canJoin` correctly returns `false` for future sessions, `true` only when session is LIVE and entitlement is valid
- INV-008 lint rule: no `Bbb*` or `Cms*` type appears as a top-level storefront query

---

## Task 9 — RFC-001 Q-009: `GrantReaderService` (Phase 2 prerequisite)

**Reference:** RFC-001 v2 §2.2 open seam, Q-009
**Priority:** Must be designed before Phase 2 implementation begins. Can be scaffolded now.

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
    // Phase 2: inject RecurringCapacityGrant repo here when it exists
  ) {}

  async resolveGrantForMeeting(
    grantId: string,
    sourceType: 'order' | 'subscription' | 'internal_overhead',
  ): Promise<CapacityGrantLike | null> {
    if (sourceType === 'order' || sourceType === 'internal_overhead') {
      return this.phase1GrantRepo.findOneBy({ id: grantId });
    }
    // Phase 2: query RecurringCapacityGrant table
    // return this.recurringGrantRepo.findOneBy({ id: grantId });
    throw new Error('RecurringCapacityGrant not yet implemented — Phase 2');
  }

  async findEarliestValidGrant(
    organizationId: string,
    sourceTypes: Array<'order' | 'subscription' | 'internal_overhead'>,
  ): Promise<CapacityGrantLike | null> {
    // Union query across both tables in Phase 2
    // For now: query only BbbCapacityGrant
    return this.phase1GrantRepo.findOne({
      where: {
        organizationId,
        exhausted: false,
        // validFrom <= now() <= validUntil
      },
      order: { validUntil: 'ASC' },
    });
  }
}
```

Update `BbbReconciliationService.consumeGrant()` to use `GrantReaderService.resolveGrantForMeeting()` instead of directly querying `BbbCapacityGrant` repository.

### Acceptance criteria

- `consumeGrant()` calls `GrantReaderService`, not `BbbCapacityGrant` repo directly
- Q-009 seam is closed — adding `RecurringCapacityGrant` in Phase 2 requires adding one branch to `GrantReaderService`, not touching `consumeGrant()`
- RFC-001 Q-009 marked resolved

---

## Task 10 — `CorrelationContext` Thread-Safety Fix

**File:** `src/platform/tracing/correlation-context.ts`

### What to do

`CorrelationContext` uses static class properties (`private static current`, `private static stack`). In a Node.js server handling concurrent requests, this is a **shared mutable singleton** — two concurrent requests will corrupt each other's correlation IDs.

Replace with Node.js `AsyncLocalStorage`:

```typescript
import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationState {
  current: string | null;
  stack: string[];
}

const storage = new AsyncLocalStorage<CorrelationState>();

export class CorrelationContext {
  private static getState(): CorrelationState {
    return storage.getStore() ?? { current: null, stack: [] };
  }

  static run<T>(fn: () => T): T {
    return storage.run({ current: null, stack: [] }, fn);
  }

  static set(correlationId: string): void {
    const state = this.getState();
    if (!state.current) {
      state.current = correlationId;
    } else {
      state.stack.push(state.current);
      state.current = correlationId;
    }
  }

  static get(): string | null {
    return this.getState().current;
  }

  static pop(): void {
    const state = this.getState();
    state.current = state.stack.pop() ?? null;
  }

  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}
```

Wrap each request in `CorrelationContext.run()` via a NestJS middleware or interceptor.

### Acceptance criteria

- Two concurrent requests never share a `correlationId`
- `EventBusInterceptor` and `BullMQTracer` correctly receive request-scoped correlation IDs
- Existing `CorrelationContext.set/get/pop` API is unchanged — callers don't need updating

---

## Task 11 — `BullMQTracer.persistLog()` is a No-Op

**File:** `src/platform/tracing/bullmq-tracer.ts` line ~717

### What to do

`persistLog()` contains only a comment and no implementation. `EventLog` records are never persisted to the database, making BUG-003 (runtime tracing) inert.

At the composition root (or via NestJS DI), inject the `EventLog` repository and implement `persistLog()`:

```typescript
private async persistLog(log: EventLog): Promise<void> {
  try {
    await this.eventLogRepository.save(log);
  } catch (err) {
    // Non-fatal — tracing must never break production flows
    // Log to console only, never rethrow
    console.warn('[BullMQTracer] Failed to persist event log:', err);
  }
}
```

Same fix applies to `WebhookRecorder.persist()` (same no-op pattern in `webhook-recorder.ts`).

### Acceptance criteria

- BullMQ job events appear in the `event_log` table after job execution
- Webhook received/processed events appear in `event_log`
- `RuntimeCausalityValidator` can query real traces from Postgres instead of the empty in-memory store

---

## Task 12 — Production Readiness: Multi-Instance Vendure Configuration

**Reference:** Vendure docs — horizontal-scaling, server-resource-requirements
**Priority:** Must be verified before any load test results are meaningful at scale

### What to do

Vendure docs specify that production multi-instance deployments require all persistent state to be stored externally. Audit `vendure-config.ts` against this checklist:

#### 12a — BullMQ Job Queue (already required by platform)

Confirm `BullMQJobQueuePlugin` is registered, not `DefaultJobQueuePlugin`. The platform already uses BullMQ for BBB jobs — verify the Vendure job queue is also wired to the same Redis instance, not to the in-memory default.

```typescript
// vendure-config.ts — must have this, not DefaultJobQueuePlugin
import { BullMQJobQueuePlugin } from '@vendure/job-queue-plugin/package/bullmq';

plugins: [
  BullMQJobQueuePlugin.init({
    connection: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
    },
  }),
  // ...
]
```

#### 12b — Redis Cache Strategy

Confirm `RedisCachePlugin` is used, not the in-memory default. In-memory cache causes session and channel cache inconsistencies when multiple Vendure instances run behind a load balancer.

```typescript
import { RedisCachePlugin } from '@vendure/core';

plugins: [
  RedisCachePlugin.init({
    redisOptions: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
    },
  }),
]
```

#### 12c — Shared Cookie Secret

Confirm `authOptions.cookieOptions.secret` is set from an environment variable, not a hardcoded string or randomly generated value. All instances must share the same secret.

```typescript
authOptions: {
  cookieOptions: {
    secret: process.env.COOKIE_SECRET, // must be identical across all instances
  },
},
```

#### 12d — Load Profile Alignment

Once multi-instance config is verified, update `LoadProfile` defaults in `load-orchestrator.ts` to document which concurrency levels require multiple instances:

```typescript
// Add to LoadProfile interface
export interface LoadProfile {
  name: 'baseline' | 'stress' | 'spike' | 'soak';
  concurrency: number;
  durationMs: number;
  rampUpMs?: number;
  requestsPerSecond?: number;
  requiresMultipleInstances?: boolean; // spike profile should set this to true
}
```

#### 12e — k6/Artillery integration note

Add a `load-testing/` directory at the project root with:

- `k6-baseline.js` — k6 script targeting `/shop-api` with the student purchase lifecycle
- `k6-stress.js` — 20 concurrent VUs for 5 minutes
- `README.md` — explains how to run k6 alongside `runLoadTest` mutation for combined external load + causal drift validation

### Acceptance criteria

- `BullMQJobQueuePlugin` confirmed in config (not DefaultJobQueuePlugin)
- `RedisCachePlugin` confirmed in config (not in-memory default)
- `COOKIE_SECRET` from environment variable
- `load-testing/k6-baseline.js` exists and targets real Shop API endpoint
- `what-next.md` is the only place Cline needs to read to understand all of this

---

## Priority Order Summary

Execute in this order. Each task unlocks the next.

```
IMMEDIATE (unblocks trust in test results)
  Task 1 — BUG-006: Wire real HTTP to LoadOrchestrator          [BLOCKER]
  Task 2 — BUG-006: Wire MetricsCollector                       [BUG-006 completeness]
  Task 3 — BUG-006: Wire DriftDetector + full LoadReport schema [BUG-006 completeness]
  Task 4 — BUG-006: Fix CausalMapper real GraphQL ops           [BUG-006 correctness]
  Task 10 — CorrelationContext AsyncLocalStorage fix             [correctness]
  Task 11 — BullMQTracer + WebhookRecorder persist              [BUG-003 activation]
  Task 12 — Multi-instance production config audit              [Vendure docs compliance]

PHASE 1.5 (unblocks first tenant onboarding)
  Task 5 — FEAT-001 BbbOrganizationMembership                   [ADR §8A, BUG-018]
  Task 6 — FEAT-002 Overhead Capacity Grant                     [ADR §8A OP-005]
  Task 7 — InstructorProfile Elasticsearch indexer              [ADR §14 P1.5]
  Task 8 — myLearningDashboard domain API                       [ADR-013 INV-006]

PHASE 2 PREREQUISITE (design now, implement with Phase 2)
  Task 9 — GrantReaderService scaffold                          [RFC-001 Q-009]
```

---

## Architecture Constraints — Do Not Violate

These are load-bearing. Breaking any requires a data migration and full ADR review.

| Invariant | Practical rule |
|---|---|
| INV-001: Channel = Tenant | Never introduce a `tenantId` column. All new entities use `channelId`. |
| INV-002: Append-only ledger | Never call `.update()` on `BbbUsageLedger`, `AdSpendLedger`, or `AdWalletLedger`. |
| INV-004: Persist-before-process | Webhooks write to DB before BullMQ enqueue. Never process inline in the HTTP handler. |
| INV-008: Business logic in Vendure | No access control, pricing, or entitlement checks in Next.js storefront. |
| INV-009: Marketplace indices are read projections | ES indices are written by background jobs only, never by Shop API mutations. |
| INV-010: Ad spend truth is ledger | `MarketplaceAdCampaign.spentInPaise` is a cache. Truth is `SUM(AdSpendLedger)`. |
| DL-010/011/017 | `InstructorProfile`, `BbbEntitlement`, `BbbOrganizationMembership` use scalar `channelId` — no `ChannelAware` join table. All service methods must include explicit `channelId` WHERE clause on every query. |
| DL-015 | Dashboard nav uses `navMenuItem` on route definitions, never `items` inside `navSections`. |
| DL-019 | Do not install the Vendure `multivendor-plugin`. |
| Vendure: Node.js is single-threaded | A single Vendure instance uses exactly one CPU. Do not attempt to increase throughput by raising `concurrency` on a single process. Scale horizontally (multiple instances behind a load balancer) instead. |
| Vendure: external state for multi-instance | `BullMQJobQueuePlugin` (not Default), `RedisCachePlugin` (not in-memory), shared `COOKIE_SECRET` are mandatory before any multi-instance deployment. |
| Vendure: load test tooling | k6, Artillery, or jMeter are the recommended tools for traffic generation. `LoadSimulationPlugin` is a causal drift validator, not a traffic generator. Use both together. |

---

## Reference Files

| File | Purpose |
|---|---|
| `platform-adr.md` v1.5 | Authoritative architecture — all invariants, decision log, phase roadmap |
| `rfc-001-continuous-commerce-loop.md` v2 | Phase 2 subscription billing design — entity specs, dunning FSM, open questions |
| `platform-story.md` v2 | Human-readable flow narrative — Archetypes A, B, Phase 3 preview |
| `bug-006-load-testing-observability.md` | BUG-006 spec — what BUG-006 is supposed to do (not what it currently does) |
| [Vendure: server-resource-requirements](https://docs.vendure.io/current/core/deployment/server-resource-requirements) | RAM/CPU constraints, official load testing tool recommendations (k6, Artillery, jMeter) |
| [Vendure: horizontal-scaling](https://docs.vendure.io/current/core/deployment/horizontal-scaling) | BullMQJobQueuePlugin, RedisCachePlugin, and shared cookie secret requirements for multi-instance |
| [Vendure: llms.txt](https://docs.vendure.io/llms.txt) | Machine-readable index of all Vendure documentation — fetch this for any API reference question |

When in doubt: the ADR is the authority. Code comments are secondary. If code and ADR conflict, fix the code.
