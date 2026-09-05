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
  constructor(private readonly settingsStoreService: SettingsStoreService) {}

  async getCurrentBaseline(): Promise<BayesianBaseline> {
    // Read from Settings Store
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
// Replace live AVG query with baseline service
async computeForProduct(productId: string): Promise<{ score: number; baselineVersion: number }> {
  const baseline = await this.baselineService.getCurrentBaseline();
  // ... product stats query unchanged ...
  // Use baseline.globalMean instead of live globalMean
  const bayesian = (this.confidence * baseline.globalMean + n * avg) / (this.confidence + n);
  return { score: Math.round(bayesian * 100) / 100, baselineVersion: baseline.baselineVersion };
}
```

**Contract satisfied:** Path A MUST NOT derive G from live ProductReview query. The existing live-AVG behavior is the specific thing being replaced.

**Critical:** Keep the Bayesian formula unchanged. Only the source of `G` changes.

### Step 4 — indexSession() writes score + baselineVersion

**Files:**
- Edit: `src/plugins/marketplace/services/marketplace-indexer.service.ts`

**Implementation:**
```ts
// In indexSession():
const baseline = await this.baselineService.getCurrentBaseline();
// ... resolve all other fields ...

// Bayesian: resolve ONCE, use exact snapshot
const { score: bayesianRating, baselineVersion } = await this.bayesianService.computeForProduct(productId);

const doc: MarketplaceSessionDocument = {
  // ... existing fields ...
  bayesianRating,
  baselineVersion,  // NEW
};
```

**Key discipline:** A single `indexSession()` execution resolves `{ G, baselineVersion }` ONCE, then calculates and writes using that exact snapshot. Do NOT independently read `G` and `baselineVersion` in separate operations where they could come from different baseline states.

**Contract satisfied:** Same baseline version → same document. Every ES write records the baseline version it was computed against.


## 5. Step 5 — Baseline refresh service + retry-generation guard

**Files:**
- Edit: `src/plugins/marketplace/services/marketplace-baseline.service.ts`

**Implementation:**
```ts
async refreshBaseline(): Promise<BayesianBaseline> {
  // 1. Compute candidate G from approved ProductReview
  const globalMean = await this.computeGlobalMeanFromReviews();

  // 2. Resolve current version with deduplication
  const current = await this.getCurrentBaseline();
  const nextVersion = current.baselineVersion + 1;

  // 3. Persist atomically: { value, computedAt, version }
  await this.settingsStoreService.set({
    'marketplace.bayesianGlobalMean': globalMean,
    'marketplace.bayesianBaselineVersion': nextVersion,
    'marketplace.bayesianGlobalMeanComputedAt': new Date().toISOString(),
  });

  return { globalMean, baselineVersion: nextVersion, computedAt: new Date() };
}
```

**Retry-generation guard (CRITICAL):**
- A crash between "persist version" and "enqueue reindex" must NOT create V+2 on retry.
- **Implementation choice:** The refresh job resolves the current authoritative version at START, computes candidate, and only persists if the version hasn't advanced since it started (optimistic check).
- Alternative (implementation choice): a unique generation token per scheduled execution.

**Contract satisfied:** Retry of the same refresh operation does not create another baseline version.

---

## 6. Step 6 — Vendure ScheduledTask

**Files:**
- New: `src/plugins/marketplace/jobs/bayesian-baseline-refresh.task.ts`
- Edit: `src/plugins/marketplace/marketplace-indexer.plugin.ts` (register task)

**Implementation:**
```ts
export const bayesianBaselineRefreshTask = new ScheduledTask({
  id: 'marketplace-bayesian-baseline-refresh',
  description: 'Refresh global Bayesian baseline and trigger ranking convergence',
  schedule: (ctx) => process.env.MARKETPLACE_BASELINE_INTERVAL || '0 2 * * *', // daily 2am
  run: async (ctx) => {
    // Enqueue refresh job (don't do heavy work in scheduler itself)
    await baselineRefreshQueue.add('refresh-baseline', {}, { retries: 3 });
  },
});
```

**Why not `@nestjs/schedule @Cron()`:** Vendure explicitly warns that Nest cron handlers execute on every application instance. The ScheduledTask mechanism ensures single execution across multiple worker instances.

**Contract satisfied:** No concurrent baseline refreshes.

---

## 7. Step 7 — Global reindex job

**Files:**
- Edit: `src/plugins/marketplace/services/marketplace-index-queue.service.ts`

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

**Global reindex logic:**
```ts
async globalReindex(targetVersion: number): Promise<void> {
  // Load eligible sessions (F7: PUBLIC + SCHEDULED/LIVE, with productVariantId)
  const sessions = await this.connection.rawConnection
    .getRepository(BbbScheduledSession)
    .find({ where: { /* eligibility */ } });

  for (const session of sessions) {
    await this.indexSession(String(session.id)); // uses current baseline
  }
}
```

**Important:** The global convergence worker must NOT equate "processed every PostgreSQL session" with "all currently eligible ES ranking documents have version V." The latter is the actual 3D.1b contract.

**Contract satisfied:** Path B global invalidation converges ES to new baseline version.

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

| Test | Invariant verified |
|---|---|
| Review transition → ES document has correct baselineVersion | Path A frozen-G |
| Two rapid review transitions → both converge to same baseline version | Path A idempotency |
| Baseline refresh → new version, all ES documents converge | Path B global convergence |
| Baseline refresh crash → retry resumes same version | Retry-generation guard |
| ES down during review transition → queue absorbs, converges on recovery | ES failure isolation |
| Baseline refresh + Path A interleaving → Path B corrects staleness | Path A/B interleaving |
| Convergence measurement detects stale documents | Observability |
| Partial reindex crash → recovery resumes from authoritative baseline | Recovery semantics |


## 10. Migration / ES mapping strategy

**Challenge:** Existing index `saa9vi_marketplace_sessions` lacks `baselineVersion`. Can't simply recreate in place (data loss).

**Options:**

| Approach | Pros | Cons |
|---|---|---|
| A. Update mapping + reindex | Zero downtime, additive | Mixed-version during reindex (permitted by contract) |
| B. Reindex to new index + alias swap | Clean cutover | Brief dual-index, alias management |

**Implementation choice:** Option A (update mapping, then trigger fullReindex). Mixed-version state during reindex is explicitly permitted by the 3D.1b convergence contract.

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
- [ ] ES mapping migration strategy approved (Option A: additive)
- [ ] Baseline storage confirmed: Vendure Settings Store
- [ ] Retry-generation guard mechanism selected
- [ ] Test cases agreed (§9)
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

