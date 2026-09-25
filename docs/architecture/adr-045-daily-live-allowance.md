# ADR-045: Daily Live Allowance Is a Server-Day Grant with One Writer

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Platform architecture
- **Supersedes:** — (extends ADR-039; resolves plan decisions **D-6**, **D-7**, **D-8**)
- **Related:** ADR-031, ADR-039, ADR-041, ADR-042, ADR-044, RFC-001 (v4 amendment), INV-002, INV-012, INV-014, INV-015, INV-026

## Context

The commercial matrix (plan §3.6, frozen 2026-09-22) defines **two mutually exclusive
allowance shapes**, and the platform shipped neither of them for the free tier:

| | Free Basic (provider-free) | Paid (provider-backed) |
|---|---|---|
| Daily live minutes | **60 / day** | `—` |
| Live minutes per billing period | `—` | `includedBbbMinutes` (renewal grant) |

Slice 5 delivered plan-derived `concurrentMeetingLimit` (ADR-031 Decision 5's convergence
contract). What was still missing was **anything that creates the free tier's live
allowance at runtime**, and plan §3.3 deliberately left three decisions open:

- **D-6** — "allowance exhausted" at provisioning time: terminal meeting state plus
  notification, or a pre-enqueue check?
- **D-7** — the refresh job's schedule, timezone, and catch-up-after-downtime behaviour.
- **D-8** — does the free plan get a billing-period allowance at all, or daily only?

Three structural facts constrain the answer:

1. **Both consumers already read one table.** `SubscriptionShopService.findMyLiveUsage()`
   sums in-window, tenant-selectable, non-unbounded `BbbCapacityGrant` rows, and
   `BbbProvisioningWorkerService.doProvisionMeeting()` selects from the same set and fails
   closed with `grantUnavailableReason()`. Nothing needs to learn a new shape for the free
   tier to work — the free tier simply needs a grant to exist.
2. **Prerequisite F-6 is closed in favour of the discriminator.** RFC-001 §4 (v4 amendment)
   made `BbbCapacityGrant(sourceType='subscription')` authoritative instead of a separate
   `RecurringCapacityGrant` entity, and that closure recorded an explicit instruction:
   *"safe to extend with slice 6's daily grant (reuse `BbbSubscriptionListener` /
   `BbbCapacityGrant`; do not add a second writer)"*.
3. **The schema is frozen.** Free-plan activation (slice 4) already ships a provider-free
   `SubscriptionPlan`, an `OrganizationSubscription` with **NULL period** and no
   `SubscriptionProviderBinding`, and an unbounded `internal_overhead` grant on organization
   create.

## Decision

1. **One writer, plural triggers.** `BbbDailyAllowanceService` is the sole module that writes
   a daily allowance grant. Two triggers call it:
   - `bbbDailyAllowanceTask` — `cron.every(1).hours()`, task id `bbb-daily-allowance`;
   - `BbbSubscriptionListener`'s `SubscriptionPlanChangedEvent` consumer — so a tenant's
     first meeting does not have to wait for the sweep.

   §3.3 forbids a second writer on the daily key, so triggers never write grants themselves.
   The listener's call is fail-soft and separate from the capacity convergence it follows: a
   grant fault must not mask a capacity fault, and neither may fail a free registration. Both
   are healed by the sweep (ADR-031 Decision 5's convergence contract).

2. **Discriminator: `providerPlanId IS NULL`.** `isDailyOnlyPlan()` reuses the provider-free
   test ADR-039 established and ADR-044 §4 codified as *definitive* — no new
   `dailyAllowanceEnabled` plan flag, therefore no new migration and no second source of plan
   identity. `status`, `providerStatus` and binding existence stay explicitly unreliable
   (ADR-039).

   Load-bearing consequence: **the daily set and the period set are disjoint by plan.** The
   scheduled daily writer and `SubscriptionRenewalService`'s period writer can never race on
   the same `(organizationId, validFrom, sourceType)` key, because a channel is never both.

3. **Grant shape.** A daily grant is an ordinary `BbbCapacityGrant`:
   `sourceType = 'subscription'`, `grantedMinutes = 60` (`DAILY_ALLOWANCE_MINUTES`),
   `consumedMinutes = 0`, `exhausted = false`, `isUnbounded = false`,
   `orderId = orderLineId = productVariantId = null` (no order line backs it), and

   - `validFrom` = local (server-clock) midnight of the day,
   - `validUntil` = one millisecond **before** the next midnight.

   `validUntil` is deliberately not the next `validFrom`: both bounds are tested inclusively
   (`validFrom <= now AND validUntil >= now`), so an `end` equal to tomorrow's `start` would
   place two grants inside the window at that instant and `myLiveUsage` would report 120
   minutes for a 60-minute day. The windows are strictly disjoint, and that is pinned by an
   infrastructure-free spec.

4. **Idempotency and concurrency.** The identity of a daily grant is
   `(organizationId, validFrom = startOfServerDay(now), sourceType = 'subscription')` — the
   key §3.3 froze. The read-then-insert pair runs inside one transaction holding a **per-key
   PostgreSQL advisory lock** derived from `dailyAllowanceIdempotencyKey()`, so the sweep and
   the plan-changed consumer cannot both miss the same existence check and insert two grants
   for one day — a failure that is invisible to both callers and surfaces only as a doubled
   allowance. This reuses the advisory-lock-over-allocation pattern INV-025 established for
   `TenantTheme`, chosen over new DDL precisely because the schema is frozen.

5. **D-7 — schedule, timezone, catch-up.** Hourly; **Saa9vi server clock** (ADR-042's rule
   for the marketplace grace deadline, reused verbatim — there is no per-tenant timezone);
   **no backfill**. The hourly cadence bounds *how late today's grant can be*, not
   correctness — the write is idempotent, so an extra run is free and an exact-midnight cron
   buys nothing. Catch-up is a property of the write rather than a separate mechanism: the
   first run after a rollover (or after downtime) materialises the current day's grant. A
   window that has already closed is unconsumeable, so re-creating a missed past day would
   only inflate reported `includedMinutes`.

6. **D-8 — the free plan is daily-only.** Provider-free plans receive the daily grant and
   **never** a billing-period grant (§3.6: the free billing-period row is `—`); they never
   receive `SubscriptionRenewedEvent`, which is the renewal path that writes period grants.
   Conversely a provider-backed plan receives **no** daily grant even when its pool is
   exhausted — that would hand a paid tenant capacity the matrix does not sell. The ban lives
   in the writer (`isDailyOnlyPlan()`), not in the trigger, so it holds for every present and
   future caller.

7. **D-6 — exhaustion is decided at provisioning, not at enqueue.** No pre-enqueue gate is
   added. `doProvisionMeeting()` already fails closed on an absent or exhausted in-window
   commercial grant, and the daily grant is simply an in-window commercial grant; the worker
   catches the error and lands the meeting in the terminal `Failed` state with
   `failureReason` set, publishes `MeetingFailedEvent` (the notification seam already consumed
   in `BbbMeetingService`), and notifies the room via `roomService.onMeetingFailed()`.
   `Failed → Pending` remains the only (explicit, operator-driven) recovery edge in
   `MEETING_STATE_TRANSITIONS`; nothing re-queues automatically, so "terminal at provisioning"
   is the observable behaviour. Enqueueing is not a commercial decision — the meeting FSM owns
   terminality, and INV-012 keeps capacity advisory rather than an enqueue-time block.

8. **No read-model, SDL or codegen change.** `findMyLiveUsage()` reports the daily grant
   through the same positive `sourceType IN (...)` filter, the same window predicate and the
   same `isUnbounded` handling it already applies — the contract slice 8 froze ("slice 6's
   daily allowance will populate these same fields"). The read model was verified to need
   **zero** changes.

9. **Enforcement is untouched.** Selection, `hasProvisionableMinutes()`, the
   `internal_overhead` sentinel and `TENANT_SELECTABLE_SOURCE_TYPES` are not modified: a daily
   grant is selected and consumed by exactly the same code as an order or period grant,
   because selection and consumption are keyed on `sourceType`, never on a "kind of day".

## Consequences

- The Free Basic programme now delivers the allowance it advertises: registration → plan
  change → today's 60 minutes exists before the tenant can plausibly start a meeting, with the
  hourly sweep as the guarantee.
- **No migration.** Slice 6 changes no schema, which is what keeps the frozen commercial base
  (slice 5 at `47e728c`) verifiable — the idempotency key is expressed as `validFrom` plus
  `sourceType` rather than as an index.
- The disjointness property is the reason a single writer suffices for both allowance shapes;
  it is recorded as INV-026.
- `past_due` is excluded from the daily set along with the paid tier: it is a paid-only state,
  and the predicate `status IN ('trialing','active')` deliberately mirrors Tier 2's plan
  lookup so "which plan is in force for this channel" has exactly one definition.
- **Residual (not DB-enforced).** The one-grant-per-day rule is enforced by the writer's
  existence check under an advisory lock, not by a partial unique index on
  `(organizationId, validFrom, sourceType) WHERE sourceType = 'subscription'`. A future writer
  that bypasses `BbbDailyAllowanceService` could double-grant a day. Closing it needs a
  migration, which slice 6 does not take; INV-026's structural checker guards the
  single-writer property until then.
- **Residual (provisioning gap).** If a subscription exists before its `BbbOrganization` (the
  two plugins provision independently), the trigger logs and returns `null` rather than
  inventing an organization; the sweep retries and counts the gap as `failed`. This is the same
  eventual-convergence contract as plan-derived capacity.
- **Residual (isolation).** The daily write runs in its own transaction, so it is not enlisted
  in any caller's transaction. That is intentional — the grant is an independent fact from the
  plan change that triggered it — and the fail-soft trigger plus the sweep make a partial
  outcome recoverable.
- The subscription lookup is **schema-qualified raw SQL**, following
  `BbbPlatformCapacityPolicyService`'s Tier-2 precedent (BUG-039): the plugin must not depend
  on subscription-plugin entities (the dependency direction is subscription → bbb), and an
  unqualified raw query resolves through `search_path`, silently reading the wrong schema in
  every schema-isolated e2e run.

## Decision traceability

| Plan item | Resolution |
|---|---|
| **D-6** | Decision 7 — terminal `Failed` at provisioning + `MeetingFailedEvent`; no pre-enqueue check |
| **D-7** | Decision 5 — hourly, Saa9vi server clock, idempotent write as catch-up, no backfill |
| **D-8** | Decision 6 — provider-free plans are daily-only; period grants stay renewal-owned |
| F-6 (prereq) | Decisions 1 and 3 — reuse `BbbCapacityGrant` + `sourceType='subscription'`; no second writer, no second entity |

## Alternatives considered

- **`SubscriptionPlan.dailyLiveMinutes` column.** Rejected: a migration whose only ever-value
  is 60 (the paid row is `—`), for a dial no plan needs. `DAILY_ALLOWANCE_MINUTES` is the
  single seam if that ever changes.
- **A separate `BbbDailyAllowance` entity/table.** Rejected: it is the second writer F-6's
  closure forbids, it would need its own enforcement path, and both `myLiveUsage` and the
  provisioning gate would have to learn it.
- **A pre-enqueue allowance check (the D-6 alternative).** Rejected: enqueue is not a
  commercial decision, the meeting FSM owns terminality, and a pre-enqueue probe duplicates
  the provisioning gate's selection so the two can disagree.
- **Midnight-exact cron or a per-minute refresh.** Rejected: precision is worthless against an
  idempotent write, and hourly also covers downtime without a second mechanism.
- **Per-tenant timezone day boundaries.** Rejected by D-7: the boundary a tenant is measured
  against must be the boundary the platform enforces, computed from the same clock at read
  time (ADR-042's precedent).
- **Backfilling missed days.** Rejected: a closed window cannot be consumed, so the grant
  would only inflate reported `includedMinutes`.
- **A partial unique index instead of the advisory lock.** Not rejected on principle — it is
  the stronger enforcement and is recorded as this ADR's residual. Deferred because slice 6 is
  a no-schema-change slice on a frozen base.

## Verification

- **Infrastructure-free policy spec** — `src/plugins/bigbluebutton-plugin/__tests__/daily-allowance.policy.spec.ts`
  (14 cases): discriminator, server-day window, strict disjointness of consecutive windows,
  inclusive containment, idempotency-key stability.
- **Runtime e2e (real Postgres, own schema)** —
  `src/plugins/bigbluebutton-plugin/e2e/daily-allowance.e2e-spec.ts`, gated on
  `DAILY_ALLOWANCE_E2E=true`, **7/7**; without the gate the suite reports 7 skipped and exits 0.
  Cases: one grant per day; concurrent sweeps write exactly one grant; provider-backed plans get
  no daily grant; yesterday's closed window is not reused; the plan-changed event writes today's
  grant; an exhausted allowance lands the meeting in terminal `Failed` at provisioning (D-6); a
  free → paid change stops daily grants without clawing back what was already granted.
  Run with `npm run test:e2e:daily-allowance`.
- **Structural invariant** — `AdrChecker.dailyAllowanceInvariants()` (INV-026) under
  `npm run verify:invariants`.
