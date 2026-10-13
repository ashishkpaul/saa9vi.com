# ADR-047: Attendee-Hour (Metered) Billing Is a Second Append-Only Billing Fact

- **Status:** Accepted (2026-09-30)
- **Date:** 2026-09-30
- **Deciders:** Platform architecture
- **Supersedes:** — (extends ADR-031 capacity policy and ADR-039/ADR-041 subscription billing; does **not** supersede the grant system)
- **Related:** ADR-012, ADR-031, ADR-039, ADR-041, ADR-045, ADR-046, INV-001, INV-002, INV-003, INV-016, INV-027, INV-028, INV-029, SEC-002, SEC-008, BUG-045, BUG-046, BUG-047, BUG-048, BUG-049
- **Plan of record:** `docs/implementation/bbb-attendee-hour-billing-plan.md`

## Context

The shipped BBB capacity model bills **meeting duration against a pre-purchased grant**:

```
BbbCapacityGrant (remainingMinutes)
  ← ProvisioningWorkerService.doProvisionMeeting() selects a grant, or FAILS the meeting
  ← BbbReconciliationService.consumeGrantHours() writes BbbUsageLedger(consumedMinutes)
```

That model is wrong for an *academy*: a classroom with 40 students and a classroom with 1
student consume the same grant minutes, so a tenant's price has no relation to the value
delivered. The commercial target is a **postpaid, metered** charge — the Linode/cloud shape:

```
billable learners = participantCount − moderatorCount      (sampled once per minute)
charge(month)     = round( Σ(learnerMinutes × ratePaisePerHour) / 60 )    ← rounded ONCE
```

Attendee-hour billing is also the prerequisite for the room-centric UX (plan §2 IA): once a
room's cost is a function of who was in it, "room" becomes the primary tenant-facing resource
and "meeting" and "billing" become consequences of using it.

Five verified structural facts shape the decision (all re-checked in the plan's audit §1):

1. **The meter cannot be computed from what BBB tells us today.** The wrapper returns only
   aggregate `participantCount`/`moderatorCount` (`bbb-api.service.ts:240-241`), and the
   webhook handler acts only on `meeting-ended` / `rap-publish-ended`
   (`bbb-meeting.service.ts:967-1049`). There is no per-user join/leave stream, so v1 must
   **sample** `getMeetingInfo` and accept sub-minute imprecision (customer-favourable).
2. **A grant is a hard prerequisite for provisioning.** `doProvisionMeeting()` throws with
   `grantUnavailableReason()` when an org has no non-exhausted grant
   (`bbb-provisioning-worker.service.ts:175-216`). A postpaid tenant with no grant could never
   start a class.
3. **`BbbUsageLedger.grant` is non-nullable and uniquely keyed on `(meeting, grant)`**, and its
   idempotency *is* the database write (`INSERT … ON CONFLICT DO NOTHING … RETURNING`,
   INV-002). Widening `grant` to nullable would silently break idempotency — Postgres treats
   NULLs as distinct, so `ON CONFLICT` would never fire. Metered billing therefore needs its
   **own** table with `UNIQUE(meetingId)`, not a new kind of row in the existing one.
4. **The grant path deliberately writes no ledger row for under-threshold meetings**
   (`bbb-reconciliation.service.ts:246-253` vs `:400-407`), which makes
   `reconcilePendingBilling()` re-scan those meetings forever. Metered billing must not
   inherit that quirk.
5. **`BbbRoom` already exists as a persistent, staff-authorizable resource** with its own
   access policy (INV-027, BUG-045) and moderator capability that is org-wide
   (`MEMBERSHIP_MODERATOR_ROLES`, `room-access.policy.ts:24`). No new access source is needed
   for multi-trainer teaching.

The commercial matrix is unchanged: this ADR adds a **billing mode**, not a new price point.

## Decision

1. **Two billing modes, one flag, no deletion.** `BbbOrganization.billingMode: 'grant' | 'metered'`
   (varchar, **DDL default `'grant'`**, entity default matching so a CLI-generated migration
   re-runs as a no-op; existing rows inherit `'grant'` with no backfill).
   `BbbOrganizationService.create()` sets `'metered'` explicitly — one testable place.
   The grant system is **dormant, not removed**, for `metered` orgs. Removal is a later PR.
2. **`BbbMeteredUsage` is a second append-only billing fact (INV-002 extension).** One row per
   completed metered meeting, `UNIQUE(meetingId)`, written with
   `INSERT … ON CONFLICT (meetingId) DO NOTHING RETURNING id`. Columns:
   `meetingId`, `organizationId`, `channelId`, `roomId` (nullable), `startedAt`, `completedAt`,
   `learnerMinutes`, `peakLearners`, `peakModerators`, `ratePaisePerHour` (snapshot),
   `periodMonth char(7)` (snapshot), `billingCapped` (bool).
   **A row is written even when the charge is zero** (fair-billing threshold not met, no
   learners, trainer-only) — provability plus terminating recovery scans, deliberately better
   than fact 4.
3. **No money column.** Exact `learnerMinutes` and `ratePaisePerHour` are stored; the rupee
   amount is computed **once per month** by a single pure helper
   (`services/metered-billing.policy.ts#computeMonthChargePaise`) that both the summaries and
   the spend-limit check call, so the rounding rule cannot drift between read and guard.
   Floats are never used for money; paise are integers.
4. **Learner math.** `learnerCount = max(0, participantCount − moderatorCount)`; trainers are
   never billable; trainer-only time bills zero. `learnerMinutes` is the sum of per-minute
   samples, so a meeting is worth its attendance, not its wall-clock length.
5. **Sampling, not webhooks.** A per-minute scheduled task samples `getMeetingInfo` for
   `ACTIVE` meetings of `metered` orgs and writes `BbbMeetingSample` with
   `UNIQUE(meetingId, bucketMinute)` + `ON CONFLICT DO NOTHING`. Bounded concurrency,
   per-meeting error isolation (one failing BBB call never fails the tick), and **sample-gap
   logging** so downtime under-billing is visible rather than silent. `BbbMeetingSample` is
   operational and prunable (≈35 days).
6. **The provisioning gate is skipped, not re-implemented, for metered orgs.** Inside the
   existing `try` block, `metered` skips grant selection entirely and stores `grantId = null`
   (`MeetingProvisionedEvent.grantId` widens to `string | null`). Capacity reservation and
   server selection are untouched. Failures still flow through the existing catch →
   `FAILED` + `failureReason` + `MeetingFailedEvent`.
7. **Postpaid exposure is guarded at the two places it can occur.** A `metered` org is refused
   provisioning when `suspended` is set or when month-to-date `computeMonthChargePaise(...)`
   is at/over `monthlySpendLimitPaise` (nullable = unlimited), with a readable `failureReason`.
   Because `suspended` is now a billing control, **the tenant must not be able to clear it**:
   `billingMode`, `ratePaisePerLearnerHour`, `monthlySpendLimitPaise` and `suspended` are
   settable **only** through a new `BBBPlatformInfrastructure`-gated mutation
   (`setBbbOrganizationBilling`) and never through `UpdateBbbOrganizationInput` (BUG-047).
8. **Rate resolution is one helper, one default.** `resolveRate(org)` returns
   `org.ratePaisePerLearnerHour ?? pluginOptions.defaultRatePaisePerLearnerHour`. The default
   lives in **plugin options**, not in `BbbPlatformCapacityPolicy` — that entity is documented
   as a *capacity* policy (ADR-031) and must not absorb pricing.
9. **Tenant-facing billing reads never take an organization argument.** The organization is
   derived from `ctx.channelId` (`BbbChannelAccessService`), exactly as `bbbMyOrganization`
   does. This extends to *all* tenant-tier reads — including the pre-existing
   `bbbMeetings` no-argument path that today applies **no** channel filter (BUG-046).
10. **Timezone is captured at write time, not query time.** `periodMonth char(7)` (`YYYY-MM`)
    is snapshotted on the usage row, so monthly aggregation is a string equality with no
    timezone math in SQL.
11. **`BbbScheduledSession` gains a nullable `roomId`** so a session can name the room it will
    teach in. Existing rows stay NULL (no backfill, no mandatory-ness in v1); session-started
    meetings propagate `roomId` to the meeting so room state, attendance and recordings joins work.
12. **`monthlySpendLimitPaise` is a SOFT ceiling (production-readiness review, item 4 —
    decision recorded 2026-10-02).** The limit is enforced by two unlocked reads: the
    synchronous `meteredGateRefusage` fast path in `BbbMeetingService.startRoom` and the
    authoritative re-check in `BbbProvisioningWorkerService.assertMeteredProvisionable`, both
    comparing `computeMonthChargePaise(monthUsageRows(...))` against the limit. Metering
    writes are per-minute and `BbbMeteredUsage` freezes only at meeting completion, so a burst
    of simultaneous starts can overshoot the cap by the in-flight usage of that burst; the
    worker re-check guarantees no *unbounded* provisioning. A hard ceiling would require a
    synchronous reservation counter (Redis INCRBY or a pessimistic org-row lock around a
    reservation ledger) — deliberately NOT built at launch; if a tenant's overshoot tolerance
    changes, that is the escalation path. Compensating control (same decision): when
    month-to-date charge crosses **90%** of the limit, an operator alert is emitted through
    the ops-alert channel (P1-3) in addition to the `Logger.warn`, so the approach of the cap
    is visible before it is hit.

## Consequences

**Positive**

- A tenant's price tracks the number of students actually taught — the academy metric.
- Multi-trainer teaching costs the same as single-trainer: `moderatorCount` is excluded, so
  adding trainers is free and the org-wide moderator capability stays correct (INV-027).
- Nothing downstream must learn a new consumption model: `BbbMeteredUsage` is a ledger row, so
  INV-002, recovery-scan patterns, and the eventual ADR-038 invoicing job reuse existing shapes.
- Grant-backed tenants are bit-for-bit unaffected: the branch is on `org.billingMode`, and the
  default is `'grant'`.

**Negative / accepted**

- **Under-billing windows are real and customer-favourable:** sub-minute visits and the final
  partial minute are not billed, and metering-worker downtime loses minutes. Mitigated by
  sample-gap logging, not eliminated.
- **Credit exposure is new:** a postpaid tenant can consume before paying. v1 guards are
  `monthlySpendLimitPaise` + `suspended` — which is exactly why `suspended` had to become
  platform-only (BUG-047) and why BUG-046 must be fixed before tenant billing reads ship.
- Two parallel billing paths exist until the grant path is retired — a deliberate,
  time-boxed divergence (§2 rule 4 of the plan: grants are dormant, not deleted).
- `BbbMeetingSample` adds write volume (one row per live meeting per minute) and needs pruning.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Make `BbbUsageLedger.grant` nullable and reuse the table | Postgres NULL-distinctness defeats `UNIQUE(meeting, grant)` + `ON CONFLICT` ⇒ silent idempotency loss (INV-002). The unique key would have to change, i.e. a new table anyway |
| Store `chargePaise` per meeting | The month total would be the sum of per-meeting roundings; two places would implement money. One rounding implementation per month is auditable and cannot drift (D2) |
| Bill `durationMinutes × rate` (drop the learner dimension) | That is the existing model the whole change exists to replace |
| Derive the meter from per-user join/leave webhooks | BBB's webhook surface in this deployment does not carry per-user minute streams; v2 at best |
| Bill every participant including moderators | Punishes the tenant for having trainers; contradicts the commercial intent and `MEMBERSHIP_MODERATOR_ROLES` |
| Put `ratePaisePerLearnerHour` on `BbbPlatformCapacityPolicy` | ADR-031 documents that entity as capacity-only; pricing does not belong in a capacity aggregate |
| Delete the grant system now | It is the live billing path for every existing tenant (`billingMode='grant'`). Deleting it in the same PR would make rollback impossible |
| Add per-room trainer assignment | No requirement (all academy trainers may teach any room), and it would add a fifth access source to INV-027 for nothing (D5) |

## Migrations required

Additive only, generated **via `npx vendure migrate`** (never hand-written — `.clinerules` §7):

1. `bbb_organization`: `billingMode` (varchar, `DEFAULT 'grant'`), `ratePaisePerLearnerHour`
   (int null), `monthlySpendLimitPaise` (int null). No backfill.
2. `bbb_meeting_sample` (new), unique `(meetingId, bucketMinute)`.
3. `bbb_metered_usage` (new), unique `(meetingId)`, index `(channelId, completedAt)`.
4. `bbb_scheduled_session.roomId` (varchar null) + index.

No existing column is dropped, widened or re-typed; the grant tables are untouched.

## Implementation

Phased in `docs/implementation/bbb-attendee-hour-billing-plan.md` §4 (this ADR is Phase 0's
deliverable): **P1** data model → **P2** meter + metered billing + provisioning gate (**fix
BUG-048 here**) → **P3** pre-built rooms → **P4** billing read API + platform-only billing
mutation (H1) → **P5** UX backend incl. the **BUG-046** channel-isolation fix → **P6**
room-centric dashboard.

Structural verification: `MeteredBillingChecker` (`src/platform/invariants/`) registered in
`cli.ts`. Phase 0 asserts the documentation and registration shape; Phase 2 extends the same
checker with the code-level assertions (metered provisioning never consults grants, one
rounding implementation, no money column, pure policy module).

**Resolved 2026-09-30 (plan §7 answered — these were never assumed by this ADR):**
BUG-047's sibling retargets — `createBbbCapacityGrant` and `deleteBbbOrganization` from
`BbbManageOrganizations` to `BBBPlatformInfrastructure` — and the BUG-049 scope decision
(`bbbCapacityGrants` channel assert) both **landed before Phase 2**, together with the
platform-only `Capacity Grants` / `Trial Registrations` nav gates and the platform-authenticated
seed step. Evidence: `bbb-channel-isolation.e2e-spec.ts` §6/§7 (tenant denied, platform allowed,
no partial write), the `sec-008-platform-guards` source check in `MeteredBillingChecker`, and the
updated `security.md` / `known-bugs.md` registers. H1 (moving the four billing controls off
`updateBbbOrganization`) remains Phase 4 as originally planned.
