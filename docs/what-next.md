# What Next — Saa9vi Platform: Cline Development Prompt

**Generated:** 2026-07-17
**Based on:** ADR v1.9, RFC-001 v3, platform-story v4, all six plugin codebases, Vendure live docs (server-resource-requirements, horizontal-scaling)
**Status of platform at time of writing:** Phase 1 commerce loop complete. Phase 1.5 substantially complete — FEAT-001, FEAT-002, Capacity Intelligence System, myLearningDashboard, GrantReaderService, rate limiting, custom domain Redis mapping, CorrelationInterceptor global scope, Tenant Registration System, Customer Deletion System, and Saa9vi login branding are all implemented. Phase 2 (subscriptions) unimplemented. The only remaining Phase 1.5 blockers are: (1) FEAT-002's DB migration step, (2) email verification for new tenant administrators, (3) rate limiting on `registerNewTenant`, (4) auto-provision ShippingMethod/StockLocation for new channels, and (5) end-to-end customer deletion testing across all three plugins.

---

## Deep Review Assessment (2026-06-30)

A full end-to-end review of ADR v1.7, platform-story v4, and all five plugin codebases was completed. Key findings:

**Documentation-to-code fidelity is high.** Every ADR claim checked against the actual implementation — including the trickiest one (BUG-003's persist-first guarantee) — was verified correct. The webhook pipeline, encryption service, room lock service, and channel isolation logic are all solid.

**All substantive issues from the previous review have been acted on:**
- BUG-019/020 staleness in ADR §12 — corrected to ✅ Fixed
- Task 3 tense issue — rewritten to past tense
- Rate limiting and custom domain routing — promoted from untracked checklist items to explicit Tasks 10 and 11
- CorrelationInterceptor global scope — captured as Task 12

**Minor doc hygiene:** Task 4's "What to do" section is redundant (status already confirms done) — trimmed in this update.

**No new bugs found.** The remaining open items (BUG-015 banner queues, BUG-017 reviews channel isolation) remain honestly tracked as pending.

**2026-06-30, second pass (ADR v1.6 → v1.7):** A follow-up code audit found `platform-adr.md` had drifted in the opposite direction from prior reviews — instead of under-reporting progress, four areas over-reported it or were simply missing:
- §8A OP-001/OP-005 still read "⚠️ Required" and §14 Phase 1.5 still listed FEAT-001/FEAT-002 as blockers, despite both being code-complete (confirmed via `grep` for `BbbOrganizationMembership`, `BbbMembershipService`, `sourceType`/`isUnbounded` on `BbbCapacityGrant`). Corrected.
- §6A, §9 EQ-001, and §12 CI-006 marked the entire Capacity Intelligence System (`CapacityIntelligenceService`, `BbbCapacityAlertLog`, `poolCapacityDashboard`, `capacity-alert` job) as "✅ live." A `grep` across `bigbluebutton-plugin_complete_code.txt` returns **zero** matches for any of these symbols — nothing is implemented. Corrected to "⚠️ Designed, not implemented," matching what this document's Task 8 already said correctly.
- §1 Plugin Inventory listed 4 plugins; `vendure-config.ts` registers 6 (`LoadSimulationPlugin` and `MarketplaceIndexerPlugin` were missing). Corrected.
- §14 Phase 1.5 still marked instructor Elasticsearch indexing as pending, despite `InstructorIndexerService` being fully implemented (confirmed in `tenant-plugin_complete_code.txt`). Corrected.
- §13 checklist had an unchecked box for `currentLoad` scoring semantics documentation, despite BUG-014 being marked Fixed in the same document's bug table. Corrected.
- **Structural:** §6A and §2B were physically located at the end of the ADR file, after ADR-014, contradicting the Table of Contents order. Both are now moved to their TOC-declared positions (after §6 and §2A respectively).

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
| FEAT-002 entity + service — `sourceType`/`isUnbounded` on `BbbCapacityGrant` | ✅ Done | Columns added to entity. `bbb-organization.service.ts` auto-provisions `internal_overhead` grant on org create. `bbb-reconciliation.service.ts` skips exhaustion/alerts for overhead grants. **Migration pending:** run `npx vendure migrate -g Feat002OverheadGrant` then `npx vendure migrate -r`. |
| Task 4 — `RedisCachePlugin` in `vendure-config.ts` | ✅ Done | `RedisCachePlugin.init()` present in plugins array, reads from `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` env vars. |
| Task 5 — `InstructorProfile` Elasticsearch indexer | ✅ Done | `InstructorIndexerService` wired. ES client fixed to use `ELASTICSEARCH_NODE` + `ELASTICSEARCH_PASSWORD`. |
| Task 12 — CorrelationInterceptor global scope fix | ✅ Done | `PlatformTracingModule` created with `@Global()` + `APP_INTERCEPTOR`. `BigBlueButtonPlugin` imports the module; `APP_INTERCEPTOR` removed from plugin providers. All plugins now inherit correlation context. |
| Scheduled Sessions dashboard | ✅ Done | Added educational session management UI with organization-scoped listing, dedicated session detail query, cancellation workflow, and separation between Session domain and Meeting runtime infrastructure. |

### Scheduled Sessions Follow-ups

| Item | Status | Notes |
|---|---|---|
| Server-side pagination for BBB dashboard lists | ⚠️ Pending | Current SessionsList uses client-side pagination. Convert list APIs to Vendure ListQueryBuilder pattern. |
| Trainer identity resolution | ⚠️ Pending | Replace trainerId display with InstructorProfile/customer name. |
| Session creation workflow | ⚠️ Pending | Add guided creation flow with trainer assignment and product linkage. |
| Session lifecycle actions | ⚠️ Pending | Start session, attendance, recording management. |

---

## Task 1 — FEAT-002: Overhead Capacity Grant ✅ Code Complete — Migration Pending

**Reference:** ADR v1.8 §8A OP-005. Code is done (see Completed table above); this task is only the remaining DB step.

**Remaining step (do not skip — rule 7 in `.clinerules`):**

```bash
npx vendure migrate -g Feat002OverheadGrant
npx vendure migrate -r
npm run build
```

Also add `sourceType` and `isUnbounded` fields to the `BbbCapacityGrant` GraphQL type in `bbb-admin.schema.ts`.

---

## Task 2 — CorrelationContext Thread-Safety Fix ✅ Done

**File:** `src/platform/tracing/correlation-context.ts`. Fixed the shared-mutable-singleton bug (static class properties corrupting correlation IDs across concurrent requests) by moving to `AsyncLocalStorage`, wrapped per-request via `CorrelationInterceptor`, registered globally through the new `@Global()` `PlatformTracingModule`. See Completed table above for verification points; Task 12 below covers the related global-scope fix.

---

## Task 3 — `BullMQTracer.persistLog()` and `WebhookRecorder.persist()` are No-Ops ✅ Done

**Files:** `src/platform/tracing/bullmq-tracer.ts`, `src/platform/tracing/webhook-recorder.ts`. Both are now `@Injectable()` with `TransactionalConnection` injected; `persistLog()`/`persist()` write to the `event_log` table with non-fatal error handling. `RuntimeCausalityValidator` can now query real traces from Postgres.

---

## Task 4 — Production Readiness: `RedisCachePlugin` ✅ Done

**Reference:** Vendure docs — [redis-cache-plugin](https://docs.vendure.io/current/core/reference/typescript-api/cache/redis-cache-plugin), [horizontal-scaling](https://docs.vendure.io/current/core/deployment/horizontal-scaling). **File:** `src/vendure-config.ts`

Closed the in-memory-cache-on-multi-instance gap. `RedisCachePlugin.init()` is present in the plugins array, sourcing `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` from env, placed after `BullMQJobQueuePlugin`:

```typescript
RedisCachePlugin.init({
  redisOptions: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
}),
```

Multi-instance Vendure deployment can now run without channel/session cache inconsistency.

---

## Task 5 — Phase 1.5: Elasticsearch Indexing for `InstructorProfile` ✅ Done

**Reference:** ADR v1.8 §14 Phase 1.5. `InstructorIndexerService` manages the `instructor_profiles` index (`ensureIndexExists()`, `indexProfile()`, `deleteProfile()`, `fullReindex()`, via `@elastic/elasticsearch`), wired non-fatally into `InstructorProfileService.create/update/delete`. ES client reads `ELASTICSEARCH_NODE` + `ELASTICSEARCH_PASSWORD` from env.

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

`InstructorIndexerService.indexProfile()` feeds the per-tenant index. `MarketplaceIndexerPlugin` (Phase 3) reads the same Postgres data and feeds the platform index separately — no code change to the Phase 1.5 indexer needed.

---

## Task 5b — Phase 3 Prerequisite: `MarketplaceIndexerPlugin` ✅ Done (Scaffold)

**Reference:** ADR v1.8 §14 Phase 3, DL-020, INV-009
**Priority:** Phase 3 — scaffold complete. Full Phase 3 features (sponsored listings, Bayesian rating, price from ProductVariant) are deferred; see gaps below.

`MarketplaceIndexerPlugin` (`src/plugins/marketplace/`), registered in `vendure-config.ts`:

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

### Phase 3 gaps (✅ All Implemented)

- ✅ Sponsored listing bid-boost from `MarketplaceAdCampaign` entity — `MarketplaceAdService` queries active campaigns; `MarketplaceIndexerService.indexSession()` reads `boostWeight` for `isSponsored`/`sponsorBoost` fields
- ✅ Bayesian rating from `ReviewsPlugin` aggregate — `BayesianRatingService` computes `(C*m + sum)/(C+n)` from `ProductReview` rows; wired into `indexSession()`
- ✅ Price from `ProductVariant.price` — `indexSession()` queries `ProductVariant.price` via `TransactionalConnection`
- ✅ `ProductVariantEvent` subscription for session index updates — `MarketplaceEventListener` subscribes to `ProductVariantEvent` from Vendure EventBus
- ✅ BullMQ job queue for async index writes — `MarketplaceIndexQueueService` creates `marketplace-index` queue; event handlers enqueue jobs instead of calling ES directly
- ✅ `Product.customFields.bbbSessionId` and `instructorProfileId` — `BbbScheduledSessionService.create()` now accepts `productVariantId` and populates both custom fields on the linked `Product`

---

## Task 6 — Phase 1.5: `myLearningDashboard` Shop API Query ✅ Done

**Reference:** ADR v1.8 ADR-013 Implementation Checklist item 1; INV-006

**Status:** ✅ Implemented. `LearningDashboardService` aggregates `BbbEntitlement` rows for the current customer, fetches linked `BbbScheduledSession` data, resolves `instructorName` from `InstructorProfile`, checks `canJoin` via `BbbEntitlementService.hasAccess()` combined with session LIVE status, and generates `joinUrl` only when `canJoin = true`. The GraphQL types (`LearningDashboard`, `LearningCourse`, `SessionWindow`) have no `Bbb*` prefix — INV-006 enforced.

### Files changed

| File | Change |
|---|---|
| `src/plugins/bigbluebutton-plugin/services/learning-dashboard.service.ts` | **New** — Domain API service aggregating entitlements, sessions, instructor names, and join URLs |
| `src/plugins/bigbluebutton-plugin/api/schema/bbb-shop.schema.ts` | Added `LearningDashboard`, `LearningCourse`, `SessionWindow` types and `myLearningDashboard` query |
| `src/plugins/bigbluebutton-plugin/api/bbb-shop.resolver.ts` | Added `myLearningDashboard` resolver method + `LearningDashboardService` injection |
| `src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts` | Registered `LearningDashboardService` in providers |

### Acceptance criteria

- ✅ Storefront can call `myLearningDashboard` without querying `bbbEntitlements` directly (INV-008)
- ✅ `canJoin` correctly returns `false` for future sessions, `true` only when session is LIVE and entitlement is valid
- ✅ No `Bbb*` or `Cms*` prefixed type appears as a top-level storefront query (INV-006 lint rule)

---

## Task 7 — RFC-001 Q-009: `GrantReaderService` (Phase 2 prerequisite scaffold) ✅ Done

**Reference:** RFC-001 v3 §7 Q-009
**Priority:** Scaffold now. Required before Phase 2 implementation begins.

**Status:** ✅ Implemented. `GrantReaderService` provides `resolveGrantForMeeting()`, `resolveEntityForMeeting()`, `findEarliestValidGrant()`, and `getRemainingMinutes()`. `BbbReconciliationService.consumeGrantHours()` now calls `grantReader.resolveEntityForMeeting()` instead of directly querying `BbbCapacityGrant`. The Q-009 seam is closed — adding `RecurringCapacityGrant` in Phase 2 requires only one new branch in `resolveGrantForMeeting()`.

### Files changed

| File | Change |
|---|---|
| `src/plugins/bigbluebutton-plugin/services/grant-reader.service.ts` | **New** — Abstracted grant resolution seam with `CapacityGrantLike` interface, `resolveGrantForMeeting()`, `resolveEntityForMeeting()`, `findEarliestValidGrant()`, `getRemainingMinutes()` |
| `src/plugins/bigbluebutton-plugin/services/bbb-reconciliation.service.ts` | Injected `GrantReaderService`; `consumeGrantHours()` now calls `grantReader.resolveEntityForMeeting()` |
| `src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts` | Registered `GrantReaderService` in providers |

### Acceptance criteria

- ✅ `consumeGrantHours()` calls `GrantReaderService`, not `BbbCapacityGrant` repo directly
- ✅ Q-009 seam closed — adding `RecurringCapacityGrant` in Phase 2 requires only one new branch in `resolveGrantForMeeting()`
- ✅ RFC-001 Q-009 marked resolved

---

## Task 8 — ADR v1.8 §6A: Capacity Intelligence System ✅ Done

**Reference:** ADR v1.8 §6A, CI-001 through CI-006
**Priority:** Phase 1.5 — required before load testing results are meaningful at scale

**Status:** ✅ Implemented. All components are built, wired, migrated, and verified.

### Files changed

| File | Change |
|---|---|
| `src/plugins/bigbluebutton-plugin/entities/bbb-server.entity.ts` | `capacity` column with default 200 (CI-001) |
| `src/plugins/bigbluebutton-plugin/entities/bbb-capacity-alert-log.entity.ts` | **New** — append-only alert audit trail (CI-004) |
| `src/plugins/bigbluebutton-plugin/events/bbb-events.ts` | `CapacityAlertEvent` class (CI-005) |
| `src/plugins/bigbluebutton-plugin/services/capacity-intelligence.service.ts` | **New** — live pool health, 48h PILOS forecast, capacity recommendation (CI-002) |
| `src/plugins/bigbluebutton-plugin/jobs/bbb-capacity-alert.task.ts` | **New** — 15-minute cron job, appends log row, publishes event on `soon`/`immediate` (CI-005) |
| `src/plugins/bigbluebutton-plugin/api/schema/bbb-admin.schema.ts` | `PoolCapacityDashboard` + nested types, `capacity` on server create/update inputs (CI-003) |
| `src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts` | `poolCapacityDashboard` query resolver with `@Allow(BbbAdminPermission.Permission)` |
| `src/plugins/bigbluebutton-plugin/services/bbb-server.service.ts` | `capacity` in create/update input interfaces and logic |
| `src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts` | Registered `BbbCapacityAlertLog` entity, `CapacityIntelligenceService` provider, `bbbCapacityAlertTask` scheduled task |
| `src/migrations/1783223489524-bbb-capacity-intelligence.ts` | **New** — creates `bbb_capacity_alert_log` table + `bbb_server.capacity` column |

### Bugs fixed during implementation

1. **Invalid `@Allow` directive in SDL** — `poolCapacityDashboard` had `@Allow(SuperAdmin)` which is invalid GraphQL syntax (positional arguments not allowed). Removed entirely; the resolver already has the correct `@Allow(BbbAdminPermission.Permission)` TypeScript decorator.
2. **Column name mismatch in forecast query** — `get48HourLoadForecast()` used `session.startsAt`/`session.endsAt` but `BbbScheduledSession` has `startTime`/`endTime` columns. Fixed both the QueryBuilder WHERE clause and the in-memory filter. `tsc` could not catch this since these are raw string fragments.

### Acceptance criteria

- ✅ `BbbServer.capacity` column migrated and default set (200)
- ✅ `bbb-capacity-alert` job registered in `configuration()` with dedup guard
- ✅ `BbbCapacityAlertLog` rows appended every 15 minutes (never updated — INV-002 extended)
- ✅ `poolCapacityDashboard` query returns live health + 48h forecast + recommendation
- ✅ `CapacityAlertEvent` published when urgency is `soon` or `immediate`
- ✅ **INV-012 enforced:** No code path blocks meeting provisioning for capacity reasons — intelligence is advisory only
- ✅ Migration generated via Vendure CLI and run
- ✅ `npm run build` passes cleanly

---

## Task 9 — k6 Load Testing Integration

**Reference:** ADR v1.8 §13 production readiness, Vendure docs recommendation
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

## Task 10 — SEC-004: Rate Limiting on Public Mutations ✅ Done

**Reference:** ADR v1.8 §13 Production Readiness Checklist (⚠️ Pending)
**Blocking:** First tenant onboarding — this is the last remaining Phase 1 blocker

**Status:** ✅ Implemented. Rate limiting applied to three surfaces via `express-rate-limit` middleware, registered through the plugin's `configuration()` hook.

### Implementation

**File:** `src/plugins/bigbluebutton-plugin/config/rate-limiter.middleware.ts` (new)

| Surface | Limit | Mechanism |
|---|---|---|
| `POST /bbb/webhook` | 100 req/min per IP | `bbbWebhookRateLimiter` — IP-based, with allowlist via `BBB_WEBHOOK_ALLOWED_IPS` env var |
| `registerForTrial` mutation | 10 req/min per customer | `shopApiRateLimiter` — inspects GraphQL body, keys by `activeUserId` or IP |
| `bbbJoinMeeting` mutation | 10 req/min per customer | `shopApiRateLimiter` — same mechanism, separate counter |

**Architecture:** Both limiters are Express middleware registered via `config.apiOptions.middleware` in the plugin's `configuration()` function. The webhook limiter is a direct `rateLimit()` instance. The Shop API limiter inspects the GraphQL request body to identify the operation name and applies the appropriate per-mutation rate limit, passing all other operations through unmodified.

**Configuration:** Set `BBB_WEBHOOK_ALLOWED_IPS` env var to a comma-separated list of known BBB server IPs to bypass the webhook rate limit.

### Files changed

| File | Change |
|---|---|
| `src/plugins/bigbluebutton-plugin/config/rate-limiter.middleware.ts` | **New** — `bbbWebhookRateLimiter` (100 req/min, IP allowlist) + `shopApiRateLimiter` (per-mutation, 10 req/min) |
| `src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts` | Registered both middleware handlers in `configuration()` via `config.apiOptions.middleware` |

---

## Task 11 — Custom Domain → Channel Token Redis Mapping ✅ Done

**Reference:** ADR v1.8 §13 Production Readiness Checklist, SEC-006
**Priority:** Phase 1 final blocker — required for custom domain tenants

**Status:** ✅ Implemented. Custom domain → channel token mapping is fully wired with Redis persistence, Express middleware, and automatic invalidation on domain changes.

### Implementation

**Files created/modified:**

| File | Purpose |
|---|---|
| `src/plugins/tenant-plugin/entities/tenant-profile.entity.ts` | Added `customDomain` column (nullable, unique) |
| `src/plugins/tenant-plugin/services/domain-channel-resolver.service.ts` | **New** — Redis service managing `channel-token:{domain}` → channelToken mappings with 7-day TTL |
| `src/plugins/tenant-plugin/config/domain-channel.middleware.ts` | **New** — Express middleware that resolves hostname via Redis and sets `X-Vendure-Token` header |
| `src/plugins/tenant-plugin/services/tenant-profile.service.ts` | Wired `DomainChannelResolverService` into `create()` and `update()` to auto-sync domain changes |
| `src/plugins/tenant-plugin/tenant-plugin.plugin.ts` | Registered `DomainChannelResolverService` in providers |
| `src/vendure-config.ts` | Registered `domainChannelMiddleware` in `apiOptions.middleware` with `route: '*'` |
| `src/migrations/1783228720863-tenant-profile-custom-domain.ts` | Migration adding `customDomain` column to `tenant_profile` table |

### Architecture

```
TenantProfile.create/update()
  → DomainChannelResolverService.setMapping(domain, token)
    → Redis: SET channel-token:{domain} {token} EX 604800

Incoming HTTP request
  → domainChannelMiddleware
    → Redis: GET channel-token:{hostname}
    → Sets X-Vendure-Token header
    → Vendure routes to correct channel
```

### Acceptance criteria

- ✅ Redis key format: `channel-token:{customDomain}` → channelToken
- ✅ 7-day TTL on Redis keys (refreshed on each update)
- ✅ Express middleware resolves hostname → channelToken non-blockingly (fails open if Redis unavailable)
- ✅ Middleware sets `X-Vendure-Token` header for Vendure channel resolution
- ✅ `TenantProfile.create()` auto-sets mapping when `customDomain` provided
- ✅ `TenantProfile.update()` invalidates old mapping and sets new mapping when domain changes
- ✅ Migration generated via Vendure CLI and run successfully
- ✅ `npm run build` passes cleanly

---

## Task 12 — CorrelationInterceptor Global Scope Fix ✅ Done

**Reference:** what-next Task 2 scope gap. The original problem — `APP_INTERCEPTOR` registered only inside `BigBlueButtonPlugin`, leaving `CmsPlugin`/`TenantPlugin`/`ReviewsPlugin` requests without a `correlationId` — is resolved. `PlatformTracingModule` is `@Global()` and registers `CorrelationInterceptor` as `APP_INTERCEPTOR` at the module level; `BigBlueButtonPlugin` now imports the module instead of registering the interceptor itself. All plugins inherit correlation context. Verified by confirming a `TenantPlugin` resolver call produces an `event_log` row with a `correlationId`.

---

## Task 13 — Platform Dashboard: CSS Override for Vendure Core Branding ✅ Done

**Reference:** ADR-016 §Vendure Core Branding Override
**Priority:** Phase 1 — login page branding completeness

**Status:** ✅ Implemented. The Vendure dashboard shell renders a vendor branding footer (`"Vendure v3.x.x"`) outside the login extension slots. This element is not part of the `login.logo`, `login.beforeForm`, or `login.afterForm` slots — it is rendered by the core dashboard layout component.

### Solution

CSS override via `styles.css` imported in the dashboard extension entry point:

```css
/* Hide Vendure branding footer on login page */
[data-vendure-branding] {
    display: none !important;
}
```

The `[data-vendure-branding]` attribute selector targets the core dashboard element without relying on fragile CSS class names that may change between Vendure versions. The Saa9vi-owned footer (`LoginFooter` component) remains visible below the login form.

### Files changed

| File | Change |
|---|---|
| `src/plugins/platform-dashboard/dashboard/styles.css` | **New** — CSS override for `[data-vendure-branding]` |
| `src/plugins/platform-dashboard/dashboard/index.tsx` | Added `import './styles.css'` |
| `docs/adr/platform-adr.md` | ADR-016 updated with Vendure Core Branding Override section |

### Acceptance criteria

- ✅ Vendure branding footer hidden on login page
- ✅ Saa9vi-owned footer (`LoginFooter` component) remains visible
- ✅ CSS uses `data-*` attribute selector (stable across Vendure versions) rather than fragile class names
- ✅ `npm run build` passes cleanly

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
  Task 7 — GrantReaderService scaffold                   [RFC-001 Q-009]

CAPACITY INTELLIGENCE (new in ADR v1.8)
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
| Vendure: external state for multi-instance | `BullMQJobQueuePlugin` ✅, `RedisCachePlugin` ✅, shared `COOKIE_SECRET` ✅ — all three confirmed live in `vendure-config.ts` (Task 4). Multi-instance deployment is unblocked on this front. |
| Vendure: load test tooling | k6/Artillery/jMeter for traffic generation. `LoadSimulationPlugin` for causal drift validation. Use both together. |

---

## Reference Files

| File | Purpose |
|---|---|
| `platform-adr.md` v1.8 | Authoritative architecture — all invariants, decision log, phase roadmap, Capacity Intelligence System (§6A), Tenant Registration System (§8 TP-006), Customer Deletion System (§8A), rate limiting (§13 SEC-004), custom domain Redis mapping (§13 SEC-006) |
| `rfc-001-continuous-commerce-loop.md` v3 | Phase 2 subscription billing design — `GrantReaderService` Q-009, capacity intelligence integration points |
| `platform-story.md` v4 | Human-readable flow narrative — §11 wallet & capacity intelligence updated for ADR v1.8 |
| `bug-006-load-testing-observability.md` | BUG-006 spec — architecture reference (all four tasks now complete) |
| [Vendure: server-resource-requirements](https://docs.vendure.io/current/core/deployment/server-resource-requirements) | RAM/CPU constraints, k6/Artillery/jMeter recommendations |
| [Vendure: horizontal-scaling](https://docs.vendure.io/current/core/deployment/horizontal-scaling) | `BullMQJobQueuePlugin`, `RedisCachePlugin`, shared cookie secret requirements |
| [Vendure: llms.txt](https://docs.vendure.io/llms.txt) | Machine-readable index of all Vendure documentation |

When in doubt: the ADR is the authority. Code comments are secondary. If code and ADR conflict, fix the code.
