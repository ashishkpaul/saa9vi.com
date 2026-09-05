# 3D.1b — Implementation Plan

> **Status:** Derived from accepted 3D.1b contract (2026-09-05)
> **Authority:** This document is the implementation authority for 3D.1b
> **Boundary:** Every invariant in the accepted 3D.1b contract maps to concrete implementation work here. Implementation choices not required by the contract are labeled explicitly.

---

## 1. Purpose

Translate the accepted 3D.1b Bayesian Invalidation Contract into concrete, verifiable implementation work covering: the frozen-baseline read path (Path A), the baseline refresh + global reindex path (Path B), versioned convergence measurement, and failure/recovery semantics.

### Relationship to 3D.1a and 3D.1b

| Document | Role |
|---|---|
| 3D.1a | Scope decision: global prior, periodic baseline, two-path invalidation, two-tier SLA |
| 3D.1b contract | Runtime invariants: frozen-G enforcement, versioned convergence, authority hierarchy, retry guard |
| **This plan** | Concrete implementation that satisfies every 3D.1b invariant |

---

## 2. Current implementation delta

Verified facts about the current codebase:

| Fact | Location | Evidence |
|---|---|---|
| **Live G calculation** | `bayesian-rating.service.ts:37-42` | `AVG(review.rating) WHERE state='approved'` — no channel filter, no baseline version |
| **Variant → product → live G** | `bayesian-rating.service.ts:69-82` | `computeForVariant()` resolves variant→product, delegates to `computeForProduct()` |
| **indexSession uses live G** | `marketplace-indexer.service.ts:220` | `bayesianService.computeForVariant(session.productVariantId)` |
| **Document lacks baselineVersion** | `marketplace-indexer.service.ts:27` | `MarketplaceSessionDocument` has `bayesianRating`, no `baselineVersion` |
| **ES mapping lacks baselineVersion** | `marketplace-indexer.service.ts:118-120` | `bayesianRating: { type: 'float' }` — no `baselineVersion` field |
| **Queue lacks baseline/global jobs** | `marketplace-index-queue.service.ts:8-32` | 4 job types: index-session, delete-session, index-instructor, delete-instructor |
| **Existing retry: 3 attempts** | `marketplace-index-queue.service.ts:82` | `{ retries: 3 }` on all jobs |
| **No Settings Store usage** | marketplace plugin | No `SettingsStoreService` injected anywhere |
| **No scheduled task** | marketplace plugin | No `ScheduledTask` registered |

---

## 3. Dependency graph

```
[1] Baseline Settings Store read contract
      │
      ├── SettingsStoreService injection
      ├── Baseline value type + metadata (value, computedAt, baselineVersion)
      └── Read API: getCurrentBaseline() → { globalMean, baselineVersion, computedAt }
      │
      ▼
[2] baselineVersion in ES document + mapping
      │
      ├── MarketplaceSessionDocument.baselineVersion: number
      ├── ES mapping: baselineVersion: { type: 'integer' }
      └── Index migration strategy (see §10)
      │
      ▼
[3] BayesianRatingService consumes {G, V}
      │
      ├── Inject baseline provider
      ├── Replace live AVG query with getCurrentBaseline()
      └── Return { score, baselineVersion } instead of bare score
      │
      ▼
[4] indexSession() writes score + baselineVersion
      │
      ├── Resolve baseline snapshot ONCE per indexSession() call
      ├── Calculate Bayesian score with that G
      └── Write document with that baselineVersion
      │
      ▼  (invariant works end-to-end)
[5] Baseline refresh service + retry-generation guard
      │
      ├── Compute global mean from approved ProductReview
      ├── Deduplication mechanism (generation/epoch identity)
      ├── Persist { value, computedAt, version } atomically
      └── Retry resumes same version, not V+2
      │
      ▼
[6] Vendure ScheduledTask
      │
      ├── marketplaceBayesianBaselineRefresh task
      ├── Daily schedule (configurable)
      └── Single execution across instances
      │
      ▼
[7] Global reindex job
      │
      ├── New job type: 'global-reindex'
      ├── Queue processor: iterate eligible sessions, reindex with current baseline
      └── Convergence tracking
      │
      ▼
[8] Convergence measurement/recovery
      │
      ├── ES query: count(baselineVersion:V) / eligible count
      ├── Stale document detection
      └── Recovery from authoritative baseline
      │
      ▼
[9] E2E + failure-path verification
```

## 4. Steps 1–4: controlled first slice

**Rule:** Steps 1–4 are ONE tightly-controlled implementation slice. The invariant must work end-to-end before introducing scheduled global mutation.

### Step 1 — Baseline Settings Store read contract

**Files:**
- New: `src/plugins/marketplace/services/marketplace-baseline.service.ts`
- Edit: `src/plugins/marketplace/marketplace-indexer.plugin.ts` (add provider)

**Context strategy (required by Vendure 3.6 API):**

Vendure's `SettingsStoreService` requires a `RequestContext` for `get()`, `getMany()`, `set()` and `setMany()`. The Settings Store supports global scope via `SettingsStoreScopes.global`. Each operation must use an explicit context:

| Operation | Required context |
|---|---|
| Path A `getCurrentBaseline()` | Internal admin context created via `RequestContextService.create()` against the default channel |
| Scheduled baseline refresh | `scheduledContext` provided by `ScheduledTask.execute()` (created against the default channel) |
| Worker retry/job execution | Internal context created inside the worker/service, not an HTTP context |

**Implementation:**
```ts
// marketplace-baseline.service.ts
export interface BayesianBaseline {
  globalMean: number;
  baselineVersion: number;
  computedAt: Date;
}

@Injectable()
export class MarketplaceBaselineService {
  constructor(
    private readonly settingsStoreService: SettingsStoreService,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Create an internal admin context for service work outside the
   * request/response cycle. Vendure's RequestContextService.create()
   * defaults to the default channel when channelOrToken is omitted.
   */
  private async createInternalContext(): Promise<RequestContext> {
    return this.requestContextService.create({
      apiType: 'admin',
    });
  }

  async getCurrentBaseline(ctx: RequestContext): Promise<BayesianBaseline> {
    // Read from Settings Store using the supplied context
    // Keys: marketplace.bayesianGlobalMean, .baselineVersion, .computedAt
    // Fallback: if none exists, return { globalMean: 0, baselineVersion: 0, computedAt: null }
  }
}
```

**Contract satisfied:** Path A reads authoritative frozen baseline, not live ProductReview query.

**Implementation choice:** Settings Store over custom singleton entity. Justification: Vendure Settings Store is intended for persistent programmatic settings/configuration data and supports global scope. Avoids new entity/migration.

### Step 2 — baselineVersion in ES document + mapping

**Files:**
- Edit: `src/plugins/marketplace/services/marketplace-indexer.service.ts`

**Implementation:**
```ts
// MarketplaceSessionDocument
export interface MarketplaceSessionDocument {
  // ... existing fields ...
  bayesianRating: number;
  baselineVersion: number;  // NEW
}
```

**ES mapping addition:**
```ts
baselineVersion: { type: 'integer' }
```

**Index migration:** See §10.

**Contract satisfied:** Every Bayesian ES write can identify the baseline against which its score was calculated.

### Step 3 — BayesianRatingService consumes {G, V}

**Files:**
- Edit: `src/plugins/marketplace/services/bayesian-rating.service.ts`

**Implementation:**
```ts
// The Bayesian service receives the baseline snapshot as a parameter
// rather than fetching it independently. This guarantees the "single
// snapshot" invariant: one indexing execution uses one exact {G, V}.
async computeForProduct(
  productId: string,
  baseline: BayesianBaseline,  // snapshot passed in, not fetched here
): Promise<number> {
  // ... product stats query unchanged ...
  // Use baseline.globalMean instead of live globalMean
  const bayesian = (this.confidence * baseline.globalMean + n * avg) / (this.confidence + n);
  return Math.round(bayesian * 100) / 100;
}
```

**Contract satisfied:** Path A MUST NOT derive G from live ProductReview query. The existing live-AVG behavior is the specific thing being replaced.

**Critical:** Keep the Bayesian formula unchanged. Only the source of `G` changes. The baseline snapshot is passed in from the caller (indexSession), not fetched independently.

### Step 4 — indexSession() writes score + baselineVersion

**Files:**
- Edit: `src/plugins/marketplace/services/marketplace-indexer.service.ts`

**Implementation:**
```ts
// In indexSession():
// Resolve baseline snapshot ONCE at the top of the operation
const baseline = await this.baselineService.getCurrentBaseline(ctx);

// ... resolve all other fields ...

// Bayesian: use the exact snapshot resolved above
const bayesianRating = await this.bayesianService.computeForProduct(productId, baseline);

const doc: MarketplaceSessionDocument = {
  // ... existing fields ...
  bayesianRating,
  baselineVersion: baseline.baselineVersion,  // NEW — same snapshot
};
```

**Key discipline:** A single `indexSession()` execution resolves `{ G, baselineVersion }` ONCE at the top, passes that exact snapshot to the Bayesian calculation, and writes that same version to the document. The Bayesian service does NOT independently fetch the baseline.

**Bayesian failure handling (required by authority/recovery model):**

The current `indexSession()` catches Bayesian errors and silently sets `bayesianRating = 0`. Under 3D.1b, a missing/unavailable authoritative baseline cannot produce an apparently valid ES document with a fabricated zero score. The implementation must:

```ts
// baseline resolution failure → indexSession rejects → JobQueue retry
// no new "converged" ES document is written
```

This is consistent with the existing queue's retry model: a rejected processing function is treated as a failed job.

**Contract satisfied:** Same baseline version → same document. Every ES write records the baseline version it was computed against.


## 5. Step 5 — Baseline refresh service + retry-generation guard

**Files:**
- Edit: `src/plugins/marketplace/services/marketplace-baseline.service.ts`

**Durable refresh-generation identity:**

The version-comparison approach alone cannot prove V+2 prevention: a retry cannot distinguish "my previous persist" from "a later refresh" using the version number alone. The guard needs a **durable operation identity** that survives a crash.

**Baseline state stored in Settings Store:**
```ts
interface BayesianBaselineState {
  globalMean: number;
  baselineVersion: number;
  computedAt: string;
  refreshGeneration: string;  // unique per scheduled execution
}
```

**Refresh job flow:**
```
scheduled execution
      ↓
generate durable refreshGeneration (UUID)
      ↓
refresh job(refreshGeneration)
      ↓
read baseline state
      ↓
if state.refreshGeneration === job.refreshGeneration:
      resume same version (crash after persist, before reindex)
      ↓
else:
      claim next version = state.baselineVersion + 1
      persist { G, version: V+1, refreshGeneration: job.generation }
      ↓
enqueue global reindex(V+1)
```

**Why this is correct:**
- The `refreshGeneration` is generated once per scheduled execution and persists with the baseline.
- On crash + retry: the job reads the baseline state, sees its own `refreshGeneration` already persisted, and resumes from that version (enqueues reindex) without creating a new version.
- If a subsequent scheduled execution has already advanced the baseline (different generation), the retry aborts — the newer generation's reindex will converge all documents.
- Single execution is guaranteed by Vendure's `ScheduledTask` (no concurrent refreshes).

**Contract satisfied:** A retry of the same refresh operation resumes the same baseline version. The version is derived from authoritative state plus a durable generation identity, not from a local counter.

---

## 6. Step 6 — Vendure ScheduledTask

**Files:**
- New: `src/plugins/marketplace/jobs/bayesian-baseline-refresh.task.ts`
- Edit: `src/plugins/marketplace/marketplace-indexer.plugin.ts` (register task)

**Implementation (Vendure 3.6 API):**

Vendure's `ScheduledTaskConfig` requires `execute({ injector, scheduledContext, params })`, not `run(ctx)`. The `scheduledContext` is created internally against the default channel.

```ts
export const bayesianBaselineRefreshTask = new ScheduledTask({
  id: 'marketplace-bayesian-baseline-refresh',
  description: 'Refresh global Bayesian baseline and trigger ranking convergence',
  schedule: process.env.MARKETPLACE_BASELINE_INTERVAL || '0 2 * * *', // daily 2am
  execute: async ({ injector, scheduledContext }) => {
    // Enqueue refresh job (don't do heavy work in scheduler itself)
    const baselineQueue = injector.get(BaselineRefreshQueueService);
    await baselineQueue.add('refresh-baseline', {}, { retries: 3 });
  },
});
```

**Why not `@nestjs/schedule @Cron()`:** Vendure explicitly warns that Nest cron handlers execute on every application instance. The ScheduledTask mechanism ensures single execution across multiple worker instances via locking.

**Contract satisfied:** No concurrent baseline refreshes. Vendure's default scheduler acquires a lock before running a task.

---

## 7. Step 7 — Global reindex job

**Files:**
- Edit: `src/plugins/marketplace/services/marketplace-index-queue.service.ts`
- Edit: `src/plugins/marketplace/services/marketplace-indexer.service.ts`

**Implementation:**
```ts
// New job type
export interface GlobalReindexJobData {
  type: 'global-reindex';
  baselineVersion: number;
}

// In queue processor:
case 'global-reindex':
  await this.indexerService.globalReindex(data.baselineVersion);
  break;

// New queue method:
async addGlobalReindexJob(baselineVersion: number): Promise<void> {
  await this.jobQueue.add(
    { type: 'global-reindex', baselineVersion },
    { retries: 3 },
  );
}
```

**Global reindex semantics (target-version snapshot):**

The accepted 3D.1b contract describes Path B as: persist version → enqueue global reindex → reindex using the new G → converge to the new baselineVersion. The global reindex job must use the **exact baseline snapshot** associated with its target version, not whatever happens to be current at execution time.

```ts
async globalReindex(targetVersion: number): Promise<void> {
  // Resolve the authoritative baseline snapshot for THIS target version
  const baseline = await this.baselineService.getCurrentBaseline(ctx);

  // Guard: if baseline has advanced beyond our target, another refresh
  // already superseded us. The newer refresh's reindex will converge.
  if (baseline.baselineVersion !== targetVersion) {
    this.logger.log(`Global reindex for V${targetVersion}: baseline already at V${baseline.baselineVersion}, aborting`);
    return;
  }

  // Load eligible sessions (F7: PUBLIC + SCHEDULED/LIVE, with productVariantId)
  const sessions = await this.connection.rawConnection
    .getRepository(BbbScheduledSession)
    .find({ where: { /* eligibility */ } });

  for (const session of sessions) {
    // Each indexSession() resolves the baseline snapshot once and writes
    // that exact version. Since baseline is frozen during this window,
    // all documents converge to targetVersion.
    await this.indexSession(String(session.id));
  }
}
```

**Why target-version semantics:** The job is enqueued for a specific baseline version. If the baseline advances (another refresh) before the job runs, the job aborts — the newer refresh's reindex will converge all documents including those this job would have touched. This prevents the race where a job claims to target V but silently recalculates against V+1.

**Important:** The global convergence worker must NOT equate "processed every PostgreSQL session" with "all currently eligible ES ranking documents have version V." The latter is the actual 3D.1b contract.

**Contract satisfied:** Path B global invalidation converges ES to the target baseline version, using the exact snapshot associated with that version.

---

## 8. Step 8 — Convergence measurement/recovery

**Files:**
- Edit: `src/plugins/marketplace/services/marketplace-indexer.service.ts`

**Implementation:**
```ts
async measureConvergence(targetVersion: number): Promise<{
  total: number;
  converged: number;
  stale: number;
}> {
  // ES count query:
  //   total: count of eligible documents
  //   converged: count where baselineVersion === targetVersion
  //   stale: count where baselineVersion < targetVersion
}
```

**Recovery:** Partial convergence is self-healing. Re-running `globalReindex(targetVersion)` reindexes all sessions whose ES document doesn't match `targetVersion`. No explicit cursor needed.

**Contract satisfied:** Convergence is a measurable property of ES state. "Job submitted" ≠ "converged."

---

## 9. Step 9 — E2E + failure-path verification

**E2E assertion strength requirement:** Tests must assert on `baselineVersion`, not merely on score changes. The existing marketplace E2E test proves that an approved review changes the Bayesian rating — for 3D.1b it must become stricter.

| Test | Invariant verified | Required assertion |
|---|---|---|
| Review transition → ES document has correct baselineVersion | Path A frozen-G | `baselineVersion === expectedVersion` AND score changed |
| Two rapid review transitions → both converge to same baseline version | Path A idempotency | Both documents have identical `baselineVersion` |
| Baseline refresh → new version, all ES documents converge | Path B global convergence | All eligible docs reach `baselineVersion === newVersion` |
| Baseline refresh crash → retry resumes same version | Retry-generation guard | Version advances by exactly 1, no V+2 |
| ES down during review transition → queue absorbs, converges on recovery | ES failure isolation | Documents converge after ES recovery |
| Baseline refresh + Path A interleaving → Path B corrects staleness | Path A/B interleaving | Final state: all docs at same `baselineVersion` |
| Convergence measurement detects stale documents | Observability | `measureConvergence()` reports correct stale count |
| Partial reindex crash → recovery resumes from authoritative baseline | Recovery semantics | Re-running reindex converges remaining docs |

**Before review (existing test pattern, strengthened):**
```
document.baselineVersion = V
review transition → index
after: bayesianRating changed AND baselineVersion === V
```

The test must NOT infer correctness merely from `ratingAfter > ratingBefore`.


## 10. Migration / ES mapping strategy

**Challenge:** Existing index `saa9vi_marketplace_sessions` lacks `baselineVersion`. The current `ensureSessionsIndex()` only adds mappings when the index doesn't exist — it does NOT contain an index-mapping update mechanism for an already-existing index. This gap must be addressed.

**Options:**

| Approach | Pros | Cons |
|---|---|---|
| A. Additive mapping update + reindex | Zero downtime, additive field | Mixed-version during reindex (permitted by contract) |
| B. Reindex to new index + alias swap | Clean cutover | Brief dual-index, alias management |

**Implementation choice:** Option A. The additive mapping update uses Elasticsearch's PUT mapping API to add `baselineVersion` to the existing index without recreating it. After the mapping is updated, trigger `fullReindex()` to backfill the field on existing documents.

**Required verification before approval (acceptance gate item):**
- Verify the deployed index accepts the additive mapping change (no field conflicts)
- Verify `fullReindex()` correctly backfills `baselineVersion` on all eligible documents
- Mixed-version state during reindex is explicitly permitted by the 3D.1b convergence contract

**Contract note:** Until the mapping update and backfill complete, existing documents will lack `baselineVersion`. The convergence measurement must handle this gracefully (treat missing `baselineVersion` as "unconverged").

---

## 11. Failure and recovery matrix

| Failure | Detection | Recovery | Authority |
|---|---|---|---|
| ES timeout on indexSession | BullMQ retry (3 attempts) | Automatic retry | ES rebuilt from queue |
| Permanent job failure | Failed job state | Manual inspection + re-enqueue | Postgres unchanged |
| Worker crash mid-global-reindex | Incomplete convergence | Re-run globalReindex(targetVersion) | Self-healing via version mismatch |
| Baseline refresh crash after persist | Retry guard | Resume same version, don't create V+2 | Settings Store |
| ES full outage | Job failures + retry exhaustion | Queue absorbs backlog, drains on recovery | Postgres + Settings Store authoritative |

---

## 12. Invariant → implementation → test traceability

| 3D.1b Invariant | Implementation | Test |
|---|---|---|
| Path A reads frozen baseline (not live G) | Step 3: BayesianRatingService uses baselineService | E2E: review transition → correct baselineVersion |
| Path A MUST NOT query ProductReview for G | Step 3: remove live AVG query | Unit: verify no ProductReview query in baseline resolution |
| ES write records baselineVersion | Step 4: doc.baselineVersion = snapshot | E2E: document carries version |
| Single snapshot per indexSession | Step 4: resolve once, use once | Unit: mock baselineService called exactly once |
| Baseline refresh creates monotonic version | Step 5: version = current + 1 | E2E: refresh → version increments |
| Retry doesn't create V+2 | Step 5: retry guard | E2E: crash → retry → same version |
| Single baseline refresh at a time | Step 6: ScheduledTask locking | Unit: task registration |
| Path B global convergence | Step 7: globalReindex | E2E: all docs reach target version |
| Convergence measurable | Step 8: measureConvergence | Unit: count query correctness |
| Recovery from authoritative baseline | Step 7: reindex from version mismatch | E2E: partial reindex → recovery |
| Authority: Postgres > ES | Settings Store persists before reindex | E2E: ES lost → rebuildable |

---

## 13. Acceptance gate before implementation starts

- [ ] This plan reviewed against accepted 3D.1b contract
- [ ] Steps 1–4 confirmed as single implementation slice
- [ ] ES mapping migration strategy approved (Option A: additive), **with runtime verification that the deployed index accepts the additive mapping change**
- [ ] Baseline storage confirmed: Vendure Settings Store (global scope, RequestContext strategy defined per operation)
- [ ] Retry-generation guard: **durable refresh-generation identity** (not version comparison alone) — same generation resumes same version, never fabricates V+2
- [ ] Global reindex semantics: **target-version snapshot** (job uses exact baseline for its target version, aborts if baseline advanced)
- [ ] Test cases agreed (§9) — **assertions strengthened to verify baselineVersion, not merely score changes**
- [ ] Single-snapshot discipline: baseline resolved ONCE per indexSession, passed through (not fetched twice)
- [ ] Bayesian failure handling: baseline resolution failure → job rejection (not silent zero)
- [ ] No scope creep into RankingMaterializedView or formula changes

---

## 14. Explicitly out of scope

- `RankingMaterializedView` entity — deferred until ranking-history audit or multi-signal ranking requires it
- `RankingChangedEvent` — existing review events + scheduled task are sufficient
- New ranking formula — 3D.1a/3D.1b preserve the existing Bayesian formula
- Channel-local prior — rejected by 3D.1a (ADR-020 platform-level)
- Changes to `ReviewAggregationService` (customer-facing reviewRating/reviewCount)
- Changes to sponsored-ranking logic (`sponsorBoost` independent of Bayesian prior)
- Outbox pattern for queue durability

