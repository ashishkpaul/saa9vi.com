# 3D.1b — Bayesian Invalidation Contract

> **Status:** Design-only — pending acceptance
> **Created:** 2026-09-05 · **Depends on:** 3D.1a signed off
> **Blocks:** Implementation of baseline refresh, global reindex, ranking persistence

---

## 1. Purpose

Define the invalidation, convergence, failure-recovery, and observability contracts for the Bayesian ranking pipeline established by 3D.1a. This document does **not** introduce new entities, migrations, or code. It locks the invariants that implementation must satisfy.

### Relationship to 3D.1a

3D.1a established the **scope** (global prior, periodic baseline, two-path invalidation, two-tier SLA). 3D.1b establishes the **runtime behavior** of those two paths — what happens on success, on failure, and how convergence is measured.

---

## 2. Two Bayesian invalidation paths

The Bayesian ranking system has exactly **two paths that can invalidate the Bayesian ranking value** of an existing marketplace document. They are deliberately separate.

Other marketplace events (session changes, price changes, instructor changes, advertising changes) can trigger document reindexing, but they do not constitute Bayesian invalidation paths — they update other fields of the ES document without affecting the Bayesian score's validity.

### Path A — Review-local invalidation

A review state transition changes the affected product's Bayesian score. The prior `G` is frozen between baseline refreshes (3D.1a), so only the product whose reviews changed is affected.

```
ReviewApproved / ReviewRejected / ReviewHidden
        ↓
MarketplaceEventListener.handleReviewAggregateChange(productId)
        ↓
resolve product → variants → sessions
        ↓
for each affected session: BullMQ addIndexSessionJob
        ↓
worker: indexSession(sessionId)
        ↓  (computes bayesianRating using authoritative baseline from Settings Store, writes ES)
ES document updated with baselineVersion
```

**Invariants:**
- Only sessions linked to the affected product's variants are reindexed.
- **Path A MUST NOT derive the global prior by querying the current approved-review population.** The existing `BayesianRatingService.computeForProduct()` historically computes `G` live from `ProductReview` — this behavior is incompatible with the frozen-baseline contract.
- **Path A MUST resolve the authoritative baseline (value + baselineVersion) from the Settings Store and use that snapshot when computing the Bayesian score.**
- **The baseline used for an ES write MUST be identifiable by baselineVersion.** Each indexed document records which baseline version it was computed against.
- Reindex is idempotent: re-running `indexSession()` with the same baseline version produces the same document.
- A replayed `ReviewApprovedEvent` for an already-approved review must not corrupt state (idempotent reindex).

### Path B — Global baseline invalidation

A scheduled refresh changes the global prior `G`. This can affect **every** product's Bayesian score, because `G` appears in every product's formula.

```
Vendure ScheduledTask (daily, configurable)
        ↓
enqueue "refresh marketplace Bayesian baseline" job
        ↓
worker: compute G = AVG(approved ProductReview.rating) across all channels
        ↓
persist to Settings Store:
  - bayesianGlobalMean = G
  - bayesianGlobalMeanComputedAt = now
  - bayesianBaselineVersion = previous + 1
        ↓
enqueue "global ranking reindex" job
        ↓
worker: reindex all marketplace sessions using new G
        ↓
ES convergence (all documents reach new baselineVersion)
```

**Invariants:**
- Baseline metadata is persisted **before** the global reindex is considered in-flight.
- The baseline version is monotonically increasing (epoch).
- A new baseline version invalidates all previous-version ES documents.
- ES may temporarily contain mixed versions (some G₁, some G₂) during async reindexing. This is permitted within the convergence SLA.

## 3. Authority hierarchy

When states disagree, resolution follows this authority chain:

```
1. PostgreSQL (authoritative source of truth)
   └── ProductReview rows (approved state)
   └── Settings Store (baseline metadata: G, computedAt, version)

2. BullMQ job queue (in-flight work)
   └── index-session jobs (Path A)
   └── global-reindex jobs (Path B)

3. Elasticsearch (derived read projection)
   └── MarketplaceSessionDocument (bayesianRating, baselineVersion)
```

**Rule:** PostgreSQL + Settings Store always wins. ES is a rebuildable projection. If ES is lost or corrupted, it can be fully rebuilt from PostgreSQL (all approved reviews + current baseline version).

---

## 4. Failure, retry, and recovery

### 4.1 BullMQ job failure

| Scenario | Behavior |
|---|---|
| Transient ES timeout | BullMQ retries (existing `retries: 3` on all marketplace-index jobs) |
| Permanent failure after retries | Job enters failed state; logged; does NOT mark convergence complete |
| Worker crash mid-reindex | Surviving workers pick up remaining jobs; idempotent reindex ensures no corruption |

**Invariant:** A failed job must never be silently treated as "convergence complete." Convergence is measured by ES document state, not by job submission.

### 4.2 Partial convergence

If a global reindex is interrupted (worker crash, deployment, ES outage):

```
Postgres baseline:     version = 42 (G = 4.31)
ES documents:          some at version 41, some at version 42
```

**Recovery:** The global reindex job resumes from the authoritative baseline (version 42). It reindexes all sessions whose ES document does not match version 42. No explicit "resume from where we left off" is needed — the version mismatch itself drives convergence.

**Invariant:** Recovery always flows from PostgreSQL/Settings Store → ES, never the reverse.

### 4.3 ES unavailable

If Elasticsearch is unreachable:
- BullMQ jobs retry (existing retry strategy).
- New review transitions still enqueue jobs (no event loss) — **provided the queue itself is available** (see below).
- When ES recovers, jobs drain and ES converges to current baseline + review state.
- The ≤30s / ≤10m SLAs are suspended during ES outage; convergence resumes when ES is reachable.

**Invariant:** ES unavailability must not block event processing or baseline refresh. The queue absorbs the backlog.

**Queue vs ES failure domains:** The guarantee above assumes the BullMQ/Redis queue is available. Queue unavailability is a **separate failure domain** from ES unavailability. If the queue is down, new jobs cannot be enqueued and events may be lost. This contract does not require an outbox pattern, but the distinction should be explicit: ES failure → queue absorbs; queue failure → separate durability question.

### 4.4 Baseline refresh during active Path A reindex

If a scheduled baseline refresh fires while Path A reindex jobs are still draining:
- Path A jobs that haven't started yet will use the NEW baseline (they read `G` at index time, not enqueue time).
- Path A jobs that already computed with the OLD baseline may write stale documents.
- The subsequent Path B global reindex corrects any such staleness.

**Invariant:** Path B is the ultimate convergence guarantee. Path A is an optimization for product-local freshness; Path B ensures global consistency.


## 5. Idempotency

| Operation | Idempotent? | Mechanism |
|---|---|---|
| `indexSession()` | ✅ | Same inputs (session + baseline version) → same ES document. Re-running produces identical result. |
| Baseline computation | ✅ | Same approved-review population → same `G`. |
| Baseline version increment | ⚠️ with retry guard | A retry of the **same** baseline-refresh operation must not create another baseline version. See §7 — the refresh job must deduplicate (e.g., by intended generation/epoch) so that a crash between "persist version" and "enqueue reindex" does not produce V+2 on retry. |
| Global reindex | ✅ | Reindexing all sessions with the same baseline version converges to the same state regardless of how many times it runs. |

**Invariant:** Replayed events, retried jobs, and duplicate baseline refreshes must not corrupt ranking state. A baseline refresh that crashes after persisting a new version must retry against that same version, not create another one.

---

## 6. Convergence measurement

"Baseline changed" and "ES has converged to that baseline" are **two different states**. The ≤10m p95 global convergence target requires measuring the second.

### Convergence definition

Convergence applies to the **authoritative set of currently eligible marketplace ranking documents** for the target index — i.e., documents that should be present per the F7 eligibility rules (PUBLIC visibility, SCHEDULED/LIVE status), not merely all documents that happen to exist in the index.

For a given baseline version `V`:

```
converged(document) = document.baselineVersion === V

converged(index) = ALL documents where baselineVersion IS NOT NULL
                   satisfy converged(document)
```

### Observability requirements

| Signal | Source | Purpose |
|---|---|---|
| `bayesianBaselineVersion` | Settings Store | Current authoritative baseline |
| `document.baselineVersion` | ES document | Per-document convergence state |
| Convergence ratio | ES count query | `count(baselineVersion:V) / count(baselineVersion:*)` |
| Stale document detection | ES query | `baselineVersion < V` indicates unconverged documents |

**Invariant:** Convergence is a measurable property of ES state, not a claim about job submission. "Job submitted" ≠ "converged."

---

## 7. Ordering guarantees

1. **Baseline before reindex:** Settings Store must reflect the new baseline version BEFORE the global reindex job is considered in-flight. This ensures that any `indexSession()` call that reads the baseline during the reindex window gets the new version.

2. **Path A before Path B (best effort):** Path A jobs enqueued before the baseline refresh should ideally drain before Path B starts. This is a best-effort optimization, not a hard guarantee — Path B corrects any staleness either way.

3. **No concurrent baseline refreshes:** Only one baseline refresh job may run at a time. Vendure's ScheduledTask mechanism ensures single execution across multiple worker instances.

4. **Baseline-version retry guard:** A crash between "persist new baseline version" and "enqueue global reindex" must retry against the **same** version, not create V+2. The refresh job must deduplicate by intended generation/epoch. This is what makes the baseline-version increment effectively idempotent (see §5 idempotency table).

---

## 8. Acceptance criteria

Before implementation begins, confirm these invariants are satisfied:

- [ ] **Path A** reindexes only the affected product's sessions; does not recompute global baseline
- [ ] **Path B** persists baseline metadata (value + computedAt + version) before enqueueing global reindex
- [ ] **Idempotency** — replayed events, retried jobs, duplicate refreshes produce no corruption
- [ ] **Partial convergence recovery** — interrupted global reindex resumes from authoritative baseline without explicit cursor
- [ ] **ES failure isolation** — ES unavailability blocks neither event processing nor baseline refresh
- [ ] **Convergence measurability** — baselineVersion on ES documents makes stale/mixed-version state detectable
- [ ] **Authority hierarchy** — PostgreSQL + Settings Store always wins over ES
- [ ] **No silent convergence** — failed jobs are not treated as convergence complete

---

## 9. Out of scope (intentionally)

- No new entities, migrations, or tables
- No `RankingMaterializedView` — deferred until ranking-history audit or multi-signal ranking requires it
- No `RankingChangedEvent` — existing review events + scheduled task are sufficient
- No implementation code or BullMQ queue changes
- No changes to `BayesianRatingService` formula (scope decision is 3D.1a's responsibility)

---

## 10. Design references

| Component | Location | Role in this contract |
|---|---|---|
| `MarketplaceEventListener` | `marketplace/listeners/marketplace-event.listener.ts` | Path A trigger |
| `MarketplaceIndexQueueService` | `marketplace/services/marketplace-index-queue.service.ts` | BullMQ queue (retries: 3) |
| `MarketplaceIndexerService.indexSession()` | `marketplace/services/marketplace-indexer.service.ts` | Bayesian computation + ES write |
| `BayesianRatingService` | `marketplace/services/bayesian-rating.service.ts` | Bayesian formula (frozen G in Path A) |
| `SettingsStoreService` | Vendure core | Baseline metadata persistence (3D.1a) |
| `ScheduledTask` | Vendure core | Baseline refresh trigger (daily) |
| `banner-activator.task.ts` | `cms/jobs/banner-activator.task.ts` | Existing ScheduledTask pattern reference |

