# 3D.1a — Bayesian Ranking Scope Decision

> **Status:** Design decision required before any ranking persistence work
> **Created:** 2026-09-05 · **Depends on:** Phase 3A/3B/3C complete (all verified)
> **Blocks:** 3D.1b invalidation contract, `RankingMaterializedView` implementation

---

## 1. Current implementation (the baseline we are deciding about)

`BayesianRatingService.computeForProduct()` in `src/plugins/marketplace/services/bayesian-rating-service.ts`:

```
B_p = (C * G + n_p * r̄_p) / (C + n_p)
```

where:
- `C` = 10 (confidence / prior weight)
- `G` = `AVG(review.rating) WHERE state = 'approved'` — **all approved reviews, no channel filter**
- `n_p` = count of approved reviews for this product
- `r̄_p` = average rating for this product

The prior `G` is **platform-global** and **live** (recomputed from ProductReview on every index).

The marketplace ES index is explicitly a **platform-level cross-channel discovery projection** (ADR-020, INV-009). The Bayesian score feeds into `MarketplaceSessionDocument.bayesianRating`, which is consumed by the public `marketplaceSearch` query's `function_score`.

---

## 2. The four decisions

### 2a. Prior population

| Option | Description | ADR alignment | Operational impact |
|---|---|---|---|
| **A. Global platform-wide** | `G` = mean of ALL approved reviews across every channel | Consistent with marketplace being a "platform-level discovery layer" (ADR-020) | A review in channel A affects Bayesian scores in channels B, C, D... |
| **B. Channel-local** | `G` = mean of approved reviews within the same channel as the product | Consistent with DL-027 tenant isolation of authoritative data | Each channel ranks independently; cross-channel comparison less meaningful |

### 2b. Prior lifecycle

| Option | Description | Consistency model |
|---|---|---|
| **A. Live** | `G` recomputed from ProductReview on every index operation | Always reflects current approved-review population; but `G` can shift without any product-local change |
| **B. Periodic baseline** | `G` recomputed on a schedule (e.g., daily) and treated as stable between recomputes | Product-local changes are immediately reflected; global drift is bounded to the baseline interval |

### 2c. Review transition impact (derived from 2a + 2b)

| Combination | Invalidation scope |
|---|---|
| Global + Live | **Potentially all products** — every review transition changes `G`, which changes every Bayesian score |
| Global + Periodic | **Product-local between baselines** — `G` is frozen between scheduled recomputes |
| Channel-local + Live | **Products within the same channel** — a review changes only its own channel's prior |
| Channel-local + Periodic | **Product-local between baselines** — most bounded option |

### 2d. ES freshness SLA

| Guarantee | Description |
|---|---|
| **Eventual (async)** | Review transition → BullMQ job → Bayesian recompute → ES write. Normal propagation lag bounded by job-queue throughput. No transactional guarantee that ES reflects the review before the mutation response. |
| **Bounded eventual** | Same as above, with an explicit SLA: "marketplace ranking reflects approved-review state within N seconds under normal load." |

## 3. Evaluation against Saa9vi architecture

### Option set 1: Global + Live (current implementation)

**Pros:**
- Mathematically consistent: every product ranked against the same platform-wide quality baseline
- Simple to reason about: "a 4.8-rated session means the same thing across the whole marketplace"
- No scheduled job infrastructure needed

**Cons:**
- **Invalidation scope is unbounded** — a single review transition in any channel can theoretically change every marketplace ranking document
- Current `handleReviewAggregateChange()` only recomputes the directly affected product, so **existing ES documents can be stale** under this model
- Creates invisible cross-channel coupling: academy A's review behavior affects academy B's marketplace visibility

**ADR tension:** ADR-020 says marketplace is platform-level, which supports global ranking. But DL-027 enforces tenant isolation of authoritative data. The Bayesian prior is a *statistical derivative*, not authoritative data — so this is not a direct violation, but the coupling should be explicit.

### Option set 2: Global + Periodic baseline

**Pros:**
- Same cross-channel comparability as global + live
- **Invalidation is product-local between baselines** — `G` is frozen, so a review transition only affects the product whose reviews changed
- Current `handleReviewAggregateChange()` implementation becomes correct without modification
- Baseline recomputation can run as a scheduled BullMQ job (daily or hourly)

**Cons:**
- `G` can be slightly stale between baseline recomputes (acceptable for most use cases)
- Need a scheduled job + a place to store the baseline value (could be a config setting or a simple singleton table)

**ADR alignment:** Strong. Platform-level comparability + bounded invalidation + no cross-channel coupling between baselines.

### Option set 3: Channel-local + Live

**Pros:**
- Each channel ranks against its own quality baseline — fair comparison within an academy's subject area
- Invalidation bounded to same-channel products

**Cons:**
- A "4.8 rating" in channel A is not comparable to a "4.8 rating" in channel B (different priors)
- **Contradicts the platform-level marketplace model** — the whole point of marketplace.saa9vi.com is cross-channel discovery with a unified ranking
- More complex to implement (need to filter by channel, which requires resolving product → variant → session → channel)

**ADR tension:** Directly conflicts with ADR-020's "platform-level discovery layer."

### Option set 4: Channel-local + Periodic

**Pros:** Most bounded invalidation, channel-fair ranking
**Cons:** Same comparability and ADR-020 conflicts as channel-local + live, plus scheduled-job overhead.


## 4. Decision matrix

| Criterion | Global+Live | Global+Periodic | Channel+Live | Channel+Periodic |
|---|---|---|---|---|
| Cross-channel comparability | ✅ strong | ✅ strong | ❌ weak | ❌ weak |
| ADR-020 alignment (platform-level) | ✅ | ✅ | ❌ conflict | ❌ conflict |
| Invalidation scope | ❌ unbounded | ✅ product-local | ⚠️ channel-local | ✅ product-local |
| Current code correctness | ⚠️ ES can be stale | ✅ correct as-is | ❌ needs rewrite | ❌ needs rewrite |
| Implementation complexity | ✅ none (current) | ⚠️ scheduled job + baseline store | ⚠️ channel resolution | ❌ most complex |
| Cross-channel coupling | ❌ invisible coupling | ✅ none between baselines | ✅ none | ✅ none |
| Operational observability | ⚠️ hard to debug | ✅ baseline is a known value | ⚠️ per-channel drift | ⚠️ per-channel drift |

---

## 5. Recommendation

**Global + Periodic baseline** is the recommended contract.

### Rationale

1. **Preserves platform-level ranking comparability** — a 4.8 means the same thing across the marketplace (ADR-020).
2. **Makes current invalidation implementation correct** — `handleReviewAggregateChange()` reindexes only the affected product, which is exactly right when `G` is frozen between baselines.
3. **Eliminates invisible cross-channel coupling** — a review in channel A does not silently change channel B's rankings.
4. **Bounded operational complexity** — one scheduled BullMQ job recomputes `G` and stores it; no distributed invalidation logic needed.
5. **ES freshness becomes a clear SLA** — "rankings reflect product-local review changes immediately, global baseline refreshes every N hours."

### The contract

```
Prior population:  Global — all approved reviews across all channels
Prior lifecycle:   Periodic baseline — recomputed on schedule (e.g., daily)
Prior storage:     A configuration value or singleton row, refreshed by scheduled job
Invalidation:      Product-local — a review transition invalidates only the affected product's Bayesian score
ES freshness:      Eventual — product-local changes propagate via BullMQ within seconds;
                   global baseline changes propagate after next scheduled recomputation
```

### What this defers

- `RankingMaterializedView` — not needed for the prior decision. May be justified later for ranking-history audit or multi-signal ranking, but not for this contract.
- `RankingChangedEvent` — not needed. The existing review events already trigger the correct invalidation.

### What this enables

- 3D.1b (invalidation contract) becomes a direct consequence of this decision, not a separate research item.
- Future multi-signal ranking (attendance, completion, recency) can layer on top of a stable, well-defined Bayesian prior.

---

## 6. Pre-decision checklist

Before finalizing, confirm:

- [ ] **ADR-020** (platform-level marketplace) is still the intended model — global prior depends on this
- [ ] **Baseline interval** — daily is sufficient; hourly only if review volume is high enough to shift `G` meaningfully within a day
- [ ] **Baseline storage** — a `system_config` key or a dedicated singleton row (not a full materialized view)
- [ ] **ES freshness SLA** — agree on the bounded-propagation target (e.g., "product-local ranking reflects review state within 30 seconds at p95")

---

## 7. Out of scope (intentionally)

- No entity, migration, or service code changes in this decision
- No `RankingMaterializedView` — deferred until ranking-history audit or multi-signal ranking requires it
- No changes to `ReviewAggregationService` (customer-facing `reviewRating` / `reviewCount` — separate concern)
- No changes to sponsored-ranking logic (`sponsorBoost` is independent of Bayesian prior scope)

