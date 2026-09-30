# BBB Plugin — Attendee-Hour Billing + Room-Centric UX (V1 Plan)

> **Type:** Cline implementation plan (consolidated) · **Status:** Approved for execution
> **Target:** `src/plugins/bigbluebutton-plugin/`
>
> **Revision 2026-09-30 (§7 answered — gates closed before Phase 2):**
> **H2** retargeted `createBbbCapacityGrant` + `deleteBbbOrganization` to
> `BBBPlatformInfrastructure` (plus its UI nav mirror), **H3** channel-asserted
> `bbbCapacityGrants` via `assertOrganizationAccess`, and **Trials nav** is
> platform-only. Code, regression e2e (`bbb-channel-isolation.e2e-spec.ts` §6/§7),
> the `sec-008-platform-guards` invariant check, the seed script, and the bug/ADR
> registers were updated in the same change. Phase 2 may now proceed (D8 order
> unchanged).
>
> **Goal:** A tenant (Vendure Channel) has one or more persistent rooms. Any number of
> trainers can join the same live meeting. The tenant is charged
> **rate × billable learner-hours** (postpaid, metered, Linode/cloud-style). Nothing else
> is a customer-facing billing concept.
>
> ```text
> billable learners = participantCount − moderatorCount   (sampled every minute)
> charge(month)     = round( Σ(learnerMinutes × ratePaisePerHour) / 60 )   ← rounded ONCE per month
> ```
>
> Trainers/moderators are never billable.
>
> **Locked UX decision:** *Room is the primary user-facing resource; Meeting and Billing
> are consequences of using a Room.* PILOS (https://github.com/THM-Health/PILOS) is an
> **information-architecture reference only** — LGPL: no code, assets, logo, or
> screenshots may be copied. PILOS is Vue/Laravel; this repo is React/Vendure.

---

## 0. Ground rules (read first)

1. **Plan before you act.** For every phase, read the listed files fully before editing.
   Do not guess signatures (`BbbRoomService.create`, scheduled-task registration,
   `startScheduledSession`, etc.) — open them.
2. **Do not break these invariants** (enforced by `npm run verify:invariants` and existing tests):
   - Channel = Tenant: organization always derived from `ctx.channelId`
     (`BbbChannelAccessService`, `bbbMyOrganization`). Never accept
     `organizationId`/`channelId` from tenant client input for billing reads.
   - INV-002: billing idempotency is decided by the **database insert**
     (`INSERT … ON CONFLICT DO NOTHING … RETURNING`), never check-then-insert.
   - INV-027: authorize before provisioning (`joinRoom` → `roomAccessService.evaluate`
     → `requestProvisioning`). Do not reorder. **Do not add new access sources.**
   - Webhooks: persist-before-process. Do not change `BbbWebhookController` semantics.
   - Usage records are append-only. No UPDATE/DELETE on billing facts.
3. **Money is integer paise.** No floats anywhere in stored money.
4. **Do not delete the grant system in this work.** Add a parallel `metered` path behind a
   per-org flag. Grant code becomes dormant for `metered` orgs. Removal is a later PR.
5. Each phase must leave the repo compiling with tests green. One PR per phase.
6. Generate DB migrations **only** via `npx vendure migrate` (Vendure CLI). Never
   hand-write migration files (`.clinerules` §7).
7. Implementation sequence (D8): **channel-isolation fix → roomId migration → room-centric
   UI → billing view.** Not the other way around.

---

## 1. Verified code audit (every claim checked; file:line)

| # | Finding | Where | Consequence for this plan |
|---|---|---|---|
| A1 | Billing is **meeting duration**, not attendees: `consumeGrantHours()` → `durationMinutes` (ceil, min 1; `< fairBillingMinDurationMs` skips billing entirely; `billingCapped` caps at `maxMeetingDurationMs`) | `services/bbb-reconciliation.service.ts:222-381`, `:246-261`; `types.ts` | New metered path; cannot just multiply |
| A2 | `BbbUsageLedger.grant` is **non-null**, unique on `(meeting, grant)`; idempotency = `.orIgnore()+RETURNING` | `entities/bbb-usage-ledger.entity.ts:21,30-31`; `bbb-reconciliation.service.ts:291-316` | **Do not** make `grant` nullable (Postgres NULL-distinctness would kill idempotency). New table unique on `meetingId` |
| A3 | Provisioning **throws** if org has no non-exhausted grant (`grantUnavailableReason`, `hasProvisionableMinutes`) | `services/bbb-provisioning-worker.service.ts:175-216` | Biggest coupling: a postpaid tenant with no grant can never start. Grant gate must be skipped for `metered` orgs |
| A4 | `reconcilePendingBilling` only scans `grantId IS NOT NULL` | `bbb-reconciliation.service.ts:406` | Metered recovery needs a separate scan |
| A5 | BBB wrapper returns only aggregate `participantCount`/`moderatorCount` | `services/bbb-api.service.ts:240-241` | v1 meter = per-minute sampling of `getMeetingInfo` |
| A6 | Webhook handler acts only on `meeting-ended` and `rap-publish-ended` (recording) | `services/bbb-meeting.service.ts:967-1049` | Attendee-minutes need a new meter, not webhooks |
| A7 | Scheduled-task registration uses id-dedupe in `configure()` | `bigbluebutton.plugin.ts:188-211` | Pattern for the new metering task |
| A8 | Tenant registration creates only `BbbOrganization`, **no rooms** | `listeners/bbb-tenant-provisioning.listener.ts:87-96` | Pre-built rooms need Phase 3 seeding |
| A9 | Provisioning passes `organization.maxParticipantsPerMeeting` to BBB, ignoring `BbbRoom.maxParticipants` | `bbb-provisioning-worker.service.ts:235` | Optional Phase 2 fix (`room.maxParticipants ?? org value`) |
| A10 | Multi-trainer works org-wide: `MEMBERSHIP_MODERATOR_ROLES = ['org_admin','moderator']`, staff → viewer; `joinRoom` authorizes before provisioning | `services/room-access.policy.ts:24`; `bbb-meeting.service.ts:785-835` | Keep org-wide for V1 (D5). **No per-room trainer ACL** |
| A11 | Dashboard: single nav section, ~10 technical items | `dashboard/index.tsx` | Phase 6 restructure |
| A12 | `MeetingProvisionedEvent.grantId: string` is **non-nullable** | `events/bbb-events.ts:51` | Widen to `string \| null` for metered meetings |
| A13 | `completeMeetingLifecycle` loads the meeting with `manager.findOne` and **no relations**; `MeetingCompletedEvent` is published with `meeting.organization?.id` which is **`undefined` on that path today** (existing bug) | `bbb-meeting.service.ts:266-269`, `:349-358` | `billMeteredMeeting` must load the org itself; **fix the undefined-org bug while in there** |
| A14 | Grant path returns **without a ledger row** for under-threshold meetings → `reconcilePendingBilling` re-scans them forever (pre-existing quirk) | `bbb-reconciliation.service.ts:246-253` vs `:400-407` | Metered path deliberately writes a **0-charge row** so recovery terminates |

| A15 | Tenant admin role holds `BbbManageOrganizations/Rooms/Sessions/Meetings/Entitlements/Members` and **deliberately lacks `BBBPlatformInfrastructure`** (ADR-033/BUG-029; reconciliation strips it) | `tenant-plugin/constants.ts:93-101`; `tenant-role-reconciliation.service.ts:61-63` | Phase 5/6: retarget nav gates — **never remove permissions from the tenant role** |
| A16 | **Cross-tenant read:** `bbbMeetings` with omitted `organizationId` applies **no channel filter**; the resolver passes the optional arg through; the shipped tenant-visible `MeetingsList.tsx` calls it exactly that way (plus an `bbbOrganizations` picker) | `bbb-meeting.service.ts:137-160`; `bbb-admin.resolver.ts:491-497`; `dashboard/routes/meetings/MeetingsList.tsx:91-103` | **Fix first (D8):** channel-derive for non-platform callers; gate no-org path platform-only; verify `bbbOrganizations` guard; add isolation regression cases |
| A17 | Tenant-callable escalation: `updateBbbOrganization` (`@Allow(BbbAdmin, BbbManageOrganizations)` → `Object.assign(org, input)`; input includes `suspended`) lets a tenant **un-suspend their own org**; `createBbbCapacityGrant` lets them **mint free grants**; `deleteBbbOrganization` lets them **delete their own org** | `bbb-admin.resolver.ts:280-289,599-631,552-561`; `bbb-organization.service.ts:277`; input types `:90-98` | §3 H2 **fixed 2026-09-30** (grants + delete are platform-only now); §3 H1 (`suspended` + the four billing controls) remains Phase 4 |
| A18 | `bbbCapacityGrants` query has **no channel assert** on arbitrary `organizationId` | `bbb-admin.resolver.ts:579-594` | §3 H3 **fixed 2026-09-30** — `assertOrganizationAccess` before the read |
| A19 | `createBbbEntitlement` is legitimately tenant-facing (gated `BbbManageEntitlements`, stamps `channelId: ctx.channelId`) | `bbb-admin.resolver.ts:965-992` | Entitlements must stay **reachable** for tenants (via People), just not a nav item |
| A20 | `BbbScheduledSession` has **no `roomId`** (org + trainer + `activeMeeting` only) | `entities/bbb-scheduled-session.entity.ts:27-91` | D5: nullable `roomId` column |

| A21 | Session-started meetings get **no `roomId`** (`createAndEnqueue` sets only org/title/recording); worker room hooks (`onMeetingActive`/`onMeetingFailed`) and the completion room-reset only fire when `meeting.roomId` is set | `bbb-meeting.service.ts:204-212`, `:299-307`; `bbb-provisioning-worker.service.ts:275-277,304-306`; `bbb-scheduled-session.service.ts:579,627-631` | Session↔room link has **three propagation points** (Phase 5.2), not just a column |
| A22 | No admin "Start class" mutation exists: dashboard is Admin-API only; `bbbModeratorJoinUrl` requires an already-Active meeting; shop `bbbJoinRoom` is not callable from the dashboard | `bbb-admin.resolver.ts:564-575`; `bbb-shop.resolver.ts:208-214` | **New `bbbStartRoom(roomId)`** (Phase 5.1) |
| A23 | UX foundations already present: `useCurrentOrganization` **forbids** tenant org pickers (INV-001); friendly state labels `Ready/Starting/Live/Unavailable`; room create dialog exists; `sessionDetail` route + marketplace attendance screens prove detail-tab routing; attendance backend exists (`SessionAttendance`, `attendance-analytics.service.ts`, `scheduledSessionAttendance`) | `dashboard/shared/useCurrentOrganization.ts:5-17`; `dashboard/routes/rooms/RoomsList.tsx:14-19,225-255`; `dashboard/index.tsx:15`; `marketplace/dashboard/attendance-session-detail.tsx:27-29`; README:1245 | Phase 6 follows existing patterns |
| A24 | Dashboard documents are ratcheted by `dashboard-graphql-contract.spec.ts`; typed `graphql()` helper from `@/gql` is the convention | `subscription/__tests__/dashboard-graphql-contract.spec.ts` | New screens must be typed; update the spec list |

---

## 2. Locked decisions register (settled — no open questions)

| # | Decision |
|---|---|
| D1 | Primary use case: **attendee-hour billing** (`learnerCount = max(0, participantCount − moderatorCount)`); trainers never billable; trainer-only / zero-learner time → **0-charge row still written** (provability; terminates recovery scans — deliberately better than the grant path, A14) |
| D2 | **Rounding:** store exact `learnerMinutes` + `ratePaisePerHour` per meeting; money rounded **once per month, half-up to the paisa**, via a single pure helper (`services/metered-billing.policy.ts`, dependency-light like `grant-selection.policy.ts`) used by summaries **and** spend-limit checks, so the rounding rule cannot drift → **no `chargePaise` column** |
| D3 | **Permission:** tenant billing reads reuse `BBBManageMeetings`; billing queries **never accept an org argument** — org always derived from `ctx.channelId`. Extended by A16 to **all** tenant reads |
| D4 | **Timezone:** `periodMonth char(7)` (`YYYY-MM`) snapshotted at write time — no tz math in queries |
| D5 | **Scope:** org-wide trainers (no per-room ACL, no `room-access.policy.ts` / INV-027 changes, no new access sources) **+ nullable `BbbScheduledSession.roomId`** generated via `npx vendure migrate` (additive; existing rows stay NULL; mandatory-ness deferred) |
| D6 | **UX:** *Room is the primary resource; Meeting and Billing are consequences.* PILOS = IA reference only (LGPL — no code/assets/logo/screenshots) |
| D7 | **Migration safety:** DDL default `'grant'` (entity default must match to avoid a TypeORM diff; existing rows filled automatically — no backfill); `'metered'` set explicitly in `BbbOrganizationService.create()` (one testable place) |
| D8 | **Sequence:** channel-isolation fix → roomId migration → room-centric UI → billing view |
| D9 | **Q2 settled:** trainer-only time is **not** billable (see D1) |

### Final information architecture

```text
Tenant                              Platform (['BBBAdmin','BBBPlatformInfrastructure'])
──────                              ─────────────────────────────────────────────────
BigBlueButton                       BigBlueButton
  Dashboard (new)                     Dashboard
  Rooms ── Room detail                Platform
            Overview                  · Organizations   (old screen)
            People                    · Servers         (old screen)
            Sessions                  · Capacity        (old PlansList + forecasting)
            Attendance                · Live Meetings   (old MeetingsList, technical)
            Recordings                (Entitlements / Trials / Sessions / Enrollments:
            Settings                    routed but nav platform-only, or absorbed)
  Meetings (history)
  People (Trainers | Students)
  Billing
```

- No org picker anywhere tenant-side; no `grantId`/`serverId`/`currentMeetingId`/
  provisioning states/IDs in tenant documents.
- Money rendered via shared `formatPaiseInr` helper; student-hours = `learnerMinutes / 60`
  (1 decimal).

---

## 3. Security hardening register

| ID | Item | Status |
|---|---|---|
| H1 | **Never** add `billingMode`, `ratePaisePerLearnerHour`, `monthlySpendLimitPaise`, or `suspended` to `UpdateBbbOrganizationInput`. All four live only on the new `BBBPlatformInfrastructure`-gated mutation (Phase 4). Note: `OrganizationsList.tsx` edit form does not *send* `suspended` (response-selection only), but grep seed scripts (`scripts/seed/seed-via-graphql.sh` calls `updateBbbOrganization`) when moving the field | **In scope** (Phase 1/4) |
| H2 | Retarget `createBbbCapacityGrant` and `deleteBbbOrganization` from `BbbManageOrganizations` → `BBBPlatformInfrastructure` (both are tenant-callable today, A17) | **CLOSED 2026-09-30** — go-ahead given; both resolvers retargeted, `bbb-plans` nav gate mirrored to platform-only, seed script step 10 now authenticates as platform operator, regression e2e in `bbb-channel-isolation.e2e-spec.ts` §6 |
| H3 | `bbbCapacityGrants` query missing channel assert (A18) — possible cross-tenant grant read | **CLOSED 2026-09-30** — fixed in this work (§7 Q2 answered "fix here, not separately"): `assertOrganizationAccess(ctx, orgId)` before the read, so cross-tenant reads are `ForbiddenError` while own-channel reads stay legitimate (INV-029); regression e2e §7. Query is *not* made platform-only — the tenant boundary is `ctx.channelId`, not the presence of an explicit argument |

---

## 4. Phases

### Phase 0 — ADR + invariants (required by `.clinerules` §9; first, before any entity)

**Canonical doc paths (verified 2026-09-30 — `.clinerules` §9 still cites the *superseded* `docs/adr/platform-adr.md`; the archive itself says "do not cite this file's ADR/DL numbers"):**
`docs/architecture/platform-adr.md` (in-file ADR-001…046 + per-ADR files `adr-0NN-*.md`), `docs/architecture/invariants.md` (next free = **INV-028**), `docs/architecture/security.md` (SEC-00x), `docs/implementation/known-bugs.md` (next free = **BUG-046**). Event matrix: `event-causality-validator.ts#getRfcCausalityRules()` is a hand-maintained list — `MeteredUsageRecordedEvent` is a *consequence* of `MeetingCompletedEvent`, not an RFC purchase chain, so **no new causality rule** (the chain already requires `MeetingEndedEvent → BbbUsageLedger`; metered adds a second ledger writer, not a new chain).

**Do:**
1. ADR-047 `docs/architecture/adr-047-bbb-attendee-hour-billing.md` + summary section in `platform-adr.md`, covering: dual billing path (`grant` | `metered`), `BbbMeteredUsage` as a second append-only billing fact (INV-002 extension), grant system dormant-not-deleted for `metered` orgs, postpaid exposure guards (`suspended`, `monthlySpendLimitPaise`), and the H1 suspension-escape fix as part of the guard story.
2. INV-028 (metered truth + learner math + one-rounding-per-month) and INV-029 (tenant-tier reads derive the org from the channel) in `invariants.md`; SEC-008 in `security.md`; BUG-046…BUG-049 in `known-bugs.md` (A16/A17/A13/A18).
3. Register `MeteredBillingChecker` in `src/platform/invariants/{index.ts,cli.ts}`. **Split deliberately:** Phase 0 ships the doc/registration assertions (green now); the code-level assertions (provisioning never consults grants for `metered` orgs, one rounding implementation, no `chargePaise` column, purity of `metered-billing.policy.ts`) are added to the same checker in Phase 2 once those artifacts exist — the checker carries a TODO naming that phase.

**Acceptance:** ADR merged; `npm run verify:invariants` green.

---

### Phase 1 — Data model

**Read:** `entities/bbb-organization.entity.ts`, `entities/bbb-usage-ledger.entity.ts`, `entities/bbb-meeting.entity.ts`, `entities/bbb-scheduled-session.entity.ts`, `bigbluebutton.plugin.ts` (entity registration), `constants.ts`, `services/bbb-organization.service.ts` (`create`).

**Do:**
1. `BbbOrganization` — add columns:
   - `billingMode: 'grant' | 'metered'` — varchar, **DDL default `'grant'`** (entity default must match — D7). Existing rows inherit `'grant'` automatically; **no backfill**.
   - `ratePaisePerLearnerHour: int | null` (null → platform default).
   - `monthlySpendLimitPaise: int | null` (null = unlimited).
   - `BbbOrganizationService.create()` sets `billingMode = 'metered'` explicitly (testable in one place).
2. Platform default rate: add `defaultRatePaisePerLearnerHour` to **plugin options** (`types.ts`) — *not* `BbbPlatformCapacityPolicy` (that entity documents itself as a *capacity* policy, ADR-031, and must not absorb pricing). Provide one helper `resolveRate(org)`.
3. New entity `BbbMeetingSample` (operational, prunable): `meetingId`, `bucketMinute` (timestamp truncated to minute), `learnerCount`, `moderatorCount`. **Unique `(meetingId, bucketMinute)`.**
4. New entity `BbbMeteredUsage` (**append-only billing fact**): `meetingId` (**unique**), `organizationId`, `channelId`, `roomId` (nullable), `startedAt`, `completedAt`, `learnerMinutes` (int), `peakLearners` (int), **`peakModerators` (int)**, `ratePaisePerHour` (snapshot), **`periodMonth char(7)`** (D4), `billingCapped` (bool). **No `chargePaise` column (D2).** Index `(channelId, completedAt)`.
5. `BbbScheduledSession`: add **nullable** `roomId` varchar + index (D5). Admin create/update inputs + GraphQL types gain optional `roomId`.
6. Register all entities in `bigbluebutton.plugin.ts`. Generate migration via `npx vendure migrate`.

**Acceptance:** app boots; migration up/down works; existing orgs `billingMode='grant'`; new org via `create()` is `'metered'`; entity/DDL defaults match (no diff on re-generate); existing sessions `roomId IS NULL`.

---

### Phase 2 — Meter (sampling) + metered billing + provisioning gate

**Read:** `jobs/bbb-reconciliation.task.ts` (scheduled-task pattern), `services/bbb-api.service.ts#getMeetingInfo`, `services/bbb-reconciliation.service.ts` (full), `services/bbb-meeting.service.ts#completeMeetingLifecycle`, `services/bbb-provisioning-worker.service.ts` (full), `events/bbb-events.ts`, `services/grant-selection.policy.ts`.

**Do:**
1. New `services/metered-billing.policy.ts` — **pure functions only** (mirrors `grant-selection.policy.ts`): `learnerCountFrom(participantCount, moderatorCount)`, `monthOf(date)`, `computeMonthChargePaise(rows)` — the *single* rounding implementation (D2), unit-testable without a DB.
2. New `BbbMeteringService`:
   - `sampleActiveMeetings()`: select meetings in `ACTIVE` state whose org `billingMode='metered'`; for each, `getMeetingInfo(server, bbbMeetingId)`; `learnerCount = max(0, participantCount − moderatorCount)`; insert `BbbMeetingSample` with `ON CONFLICT DO NOTHING` for the current `bucketMinute`.
   - Bounded concurrency (~10 parallel BBB calls); per-meeting try/catch — a failed call skips that meeting for the tick and logs; it must never throw for the whole batch.
   - **Log sample gaps per meeting** (visibility for downtime under-billing — §6).
3. New `jobs/bbb-metering.task.ts`, every minute, registered with the same id-dedupe pattern (`bigbluebutton.plugin.ts:188-211`); guard overlapping runs the way the reconciliation task does.
4. `BbbMeteringService.billMeteredMeeting(ctx, meeting)`:
   - Called from the same completion path that calls `consumeGrantHours`, **only when the org is `metered`**. Grant orgs keep the old path untouched.
   - **Load the org explicitly first** (A13 — `completeMeetingLifecycle` does not).
   - `learnerMinutes = SUM(learnerCount)` over samples (one sample = one minute); discard samples after `provisionedAt + maxMeetingDuration` when `billingCapped` (reuse existing fair-billing/max-duration semantics).
   - Under fair-billing threshold or zero learners → **still insert the row with 0** (D1/A14).
   - `ratePaisePerHour = resolveRate(org)` snapshotted at completion; `periodMonth = monthOf(completedAt)` (D4); `peakLearners`/`peakModerators` from samples.
   - Insert `BbbMeteredUsage` with `INSERT … ON CONFLICT (meetingId) DO NOTHING RETURNING id` (INV-002). No `chargePaise` (D2).
   - Publish `MeteredUsageRecordedEvent` (new, `events/bbb-events.ts`; register per Phase 0).
5. Branch in `completeMeetingLifecycle` (before `consumeGrantHours`) and in `reconcilePendingBilling` — **fix the A13 undefined-org bug here**: load the organization and pass the real id into `MeetingCompletedEvent`.
6. Recovery: `reconcilePendingMeteredBilling()` — `COMPLETED` meetings of metered orgs with no `BbbMeteredUsage` row → `billMeteredMeeting`, **then re-publish `MeetingCompletedEvent`** (mirrors `bbb-reconciliation.service.ts:419-430` — the session listener needs it to leave LIVE). Wire into `bbb-reconciliation.task.ts`.
7. **Provisioning gate** in `doProvisionMeeting` — place it **inside the existing `try` block** where grant selection sits, so failure flows through the uniform catch → `FAILED` + `failureReason` + `MeetingFailedEvent` + `roomService.onMeetingFailed`:
   - `billingMode='metered'` → skip grant selection entirely; store `grantId = null`; **widen `MeetingProvisionedEvent.grantId` to `string | null`** (A12) and audit consumers.
   - Reject (readable `failureReason`) if `org.suspended`, or `monthlySpendLimitPaise` is set and month-to-date `SUM(learnerMinutes × ratePaisePerHour)/60` (via `computeMonthChargePaise`) ≥ limit.
   - Keep `reserveProvisioningCapacity` and server selection exactly as they are.
8. Sample pruning (nightly or inside the reconciliation task): delete `BbbMeetingSample` older than 35 days where `meeting.state NOT IN ('Active','Provisioning')` **AND** (metered row exists OR meeting not `Completed`) — must not leak STALE/FAILED samples.
9. Hygiene while in the file: `if (meeting.grantId)` guard in the reconciliation billing-ceiling path (`:107-109`); optional — pass `room.maxParticipants ?? org.maxParticipantsPerMeeting` to BBB `createMeeting` (A9).

**Acceptance / tests:**
- Unit (`metered-billing.policy.spec.ts`): learner math (moderators excluded, never negative); monthly rounding incl. 0 / 1 / 61 minutes and mixed rates; `periodMonth` boundaries.
- Sampling idempotent within the same minute bucket.
- Completing the same meeting twice writes exactly one `BbbMeteredUsage` row.
- Metered org with **no grants** can provision and join; grant org behaviour unchanged (`grant-selection.policy.spec`, `room-access.e2e-spec`, `bbb-usage-ledger.e2e-spec` green).
- Suspended org / spend-limit exceeded → provisioning `FAILED` with readable reason.
- Two trainers + N students in one meeting → billed only for N.
- Cross-tenant: org A's usage never appears in org B's summaries.

---

### Phase 3 — Pre-built rooms (independent; can ship in parallel with Phase 2)

**Read:** `listeners/bbb-tenant-provisioning.listener.ts`, `services/bbb-room.service.ts` (`create` signature — verified: takes `organizationId`, clamps capacity via policy, slug only set if provided, so seeded rooms never collide).

**Do:**
1. Plugin option `defaultRooms: string[]` (default `["Main Classroom"]`).
2. In the listener, after `bbbOrganizationService.create(...)` succeeds, create those rooms via `BbbRoomService.create` using the channel-scoped `orgCtx` already built in the listener.
3. **Idempotent:** seed only if the org currently has zero rooms (re-delivery of `TenantRegisteredEvent` must not duplicate). Seeding failure is logged and never fails org creation.
4. Multi-room needs no code change — rooms already belong to the organization; the org-wide concurrency cap already limits live meetings.

**Acceptance:** registering a tenant yields org + default room(s) with `billingMode='metered'`; replaying the event adds nothing.

---

### Phase 4 — Billing read API (tenant + platform)

**Read:** `api/schema/bbb-admin.schema.ts`, `api/bbb-admin.resolver.ts` (how `bbbMyOrganization` and `@Allow` are declared; how `BbbChannelAccessService` is used), `services/metered-billing.policy.ts` from Phase 2.

**Do:**
1. Tenant query `bbbBillingSummary(month: String)` (default = current `periodMonth`, `YYYY-MM`):
   ```graphql
   { month, ratePaisePerHour, totalLearnerMinutes, totalChargePaise,
     spendLimitPaise,
     byRoom: [{ roomId, roomName, learnerMinutes, chargePaise }] }
   ```
   Organization resolved from `ctx.channelId`. **No org argument (D3).** `totalChargePaise` via `computeMonthChargePaise` (D2). Money only computed here — never stored per meeting.
2. Tenant query `bbbMeteredMeetings(month, skip, take)` — per-meeting rows: room name, start/end, `peakLearners`, `peakModerators`, learner-minutes, charge share, `recordingUrl`. Org from channel; no org argument.
3. Platform-only mutation `setBbbOrganizationBilling(organizationId, billingMode, ratePaisePerLearnerHour, monthlySpendLimitPaise, suspended)` gated `@Allow(BbbAdminPermission.Permission, BbbPlatformInfrastructurePermission.Permission)` — this is where H1 lands (billing fields + `suspended` live **only** here). Plus `bbbPlatformBillingSummary(month)` across tenants (also platform-gated).
4. Permissions: tenant billing queries use `BbbManageMeetingsPermission` (D3); platform mutations use `BbbPlatformInfrastructurePermission`. **Do not touch the tenant role** (A15).
5. Payment collection (Razorpay, ADR-038) is **out of scope**: this phase only produces the numbers a later invoicing job consumes via `MeteredUsageRecordedEvent` / `BbbMeteredUsage`.
6. Run `npm run codegen` after schema changes.

**Acceptance:** e2e in the style of `bbb-channel-isolation.e2e-spec.ts` proving tenant A cannot read tenant B's billing; platform mutations reject a tenant-admin caller; `npm run build` + `verify:invariants` green.

> **Status (S2, 2026-09-30): LANDED.** `bbbBillingSummary(month)` / `bbbMeteredMeetings(month, skip, take)` / `bbbPlatformBillingSummary(month)` / `setBbbOrganizationBilling(...)` shipped in `api/bbb-admin.resolver.ts` + the new `services/bbb-billing.service.ts`; `BbbOrganization` now exposes `billingMode` / `ratePaisePerLearnerHour` / `monthlySpendLimitPaise` read-only (writes only through the platform-gated mutation — H1's landing spot). **Q2:** platform default = plugin option with a clearly marked placeholder (`DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR` = 2000 paise = ₹20/hr, TODO(PRICE)) resolved by `platformDefaultRatePaisePerHour` in BOTH the metered write and the read API; half-up rounding pinned in `computeMonthChargePaise` + unit tests. `formatPaiseInr` lives in `shared/format.ts` (outside `dashboard/` — it is a separate tsconfig project, TS6305) with unit tests. Regression e2e: `bbb-channel-isolation.e2e-spec.ts` §11 (10 cases: recordingUrl cross-tenant isolation, D3 no-org-arg schema probe, platform-only gates, half-up math end-to-end, platform roll-up); source guard `billing-api-channel-scoped` in `MeteredBillingChecker` (`verify:invariants` 6/6). **Gates (2026-09-30):** `npm run build` / `lint` / `typecheck:e2e` exit 0; `bbb-channel-isolation` **43/43** on real Postgres (33 pre-existing + 10 new); `bbb-metering` **10/10**; full `test:e2e` **417 passed / 3 failed** — the 3 failures are exactly the documented pre-existing set (customer-deletion's `room-1` integer FK fixture + `validUntil` assertion, and BUG-043's two `myLiveUsage` assertions), i.e. no new failures. Two S2 fixture lessons worth keeping: the §11 seed must **upsert** (not insert) its usage rows because §8's A13 completion already wrote a zero-minute row for the same `meetingId` (unique index), and `bodyFor()`-style body slices can include the **next** member's docblock — the D3 check strips comments before asserting the absence of `organizationId`.

---

### Phase 5 — UX backend (order per D8: this includes the channel-isolation fix)

**Read:** `services/bbb-room.service.ts` (full), `services/bbb-meeting.service.ts#joinRoom` + `createRoomMeetingAndEnqueue`, `api/bbb-admin.resolver.ts`, `api/bbb-shop.resolver.ts#startScheduledSession`, `services/bbb-scheduled-session.service.ts` (`create`, `startSession`), `services/room-access.policy.ts`, `services/bbb-channel-access.service.ts`.

**Status update (S1, 2026-09-30):** Item 1 (channel-isolation) and item 5 (room-scoped `roomId` arg) are **landed** — `meetingService.findAll` derives the tenant organization set from `ctx.channelId` behind the shared `isPlatformCaller()` helper, channel-asserts explicit `organizationId`/`roomId` arguments, and keeps the unrestricted listing platform-only; regressions in `bbb-channel-isolation.e2e-spec.ts` §8 (incl. the A13/BUG-048 `MeetingCompletedEvent.organizationId` assertion), source guard `channel-scoped-reads-remediated` in `MeteredBillingChecker`. Also landed with S1 (outside this list): BUG-047-H1 (`TENANT_EDITABLE_ORG_FIELDS` allowlist on `orgService.update` — `suspended` + capacity limits are platform-only) and BUG-050 (`createBbbOrganization` cannot target a foreign channel), regressions §9/§10. **Deferred by scope decision:** item 3 (session↔room propagation) and item 4's `trainerCount` (studentCount remains). Items 2, 4 (studentCount), 6, 7 remain pending in the S1–S6 workstream order (S4, S4, S2, S5 respectively).

**Do:**
1. **Channel-isolation fix (A16 — do this first):** ✅ done (S1 — see status note above).
   - `bbbMeetings` with omitted `organizationId`: derive the org from `ctx.channelId` for non-platform callers; the truly cross-tenant path becomes platform-only (`BBBPlatformInfrastructure`/`BBBAdmin`).
   - Verify the `bbbOrganizations` guard while here; a tenant must not list other tenants' orgs.
   - Add channel-isolation regression cases alongside `bbb-channel-isolation.e2e-spec.ts` (tenant calling `bbbMeetings` with no org sees only its own; tenant passing another tenant's `organizationId` is rejected).
2. **`bbbStartRoom(roomId)` admin mutation** (A22) — admin twin of `joinRoom`, preserving INV-027 ordering: verify the caller is a moderator-capable member of the room's org (`MEMBERSHIP_MODERATOR_ROLES`/legacy roles) → if room Idle: `requestProvisioning` + enqueue → poll until Active → return `{ status, joinUrl }` with a moderator join URL. Idempotent (debounce/lock already in `requestProvisioning`). Returns `status: 'starting'` for the UI to poll.
3. **Session↔room propagation (A21 — the three points):**
   - `startSession`: stamp `meeting.roomId = session.roomId` (pass through `createAndEnqueue` — extend `CreateMeetingInput` with optional `roomId`) so the worker's `onMeetingActive`/`onMeetingFailed` and the completion room-reset drive room state, and Attendance/Recordings joins work.
   - **Room-availability guard:** before starting a session whose `roomId` is set, reuse `createRoomMeetingAndEnqueue`'s live-meeting query (PENDING/PROVISIONING/ACTIVE for that room) and fail with a clear error if the room is already live — otherwise two meetings could share one room.
   - Verify `onMeetingActive` handles a room in `Idle` (the session path never passes through `requestProvisioning`); adjust if it assumes `Provisioning`.

4. **Room card stats:** computed `BbbRoom.studentCount` (active enrollments + active `bbb_room` entitlements for the room) and `BbbRoom.trainerCount` (org moderator-capable members) on the room **list** resolver — batched counts, no N+1. Same for single-room reads.
5. **Room-scoped meetings:** optional `roomId` arg on `bbbMeetings` (channel-asserted via `assertOrganizationAccess`/`assertRoomAccess`) — feeds Recordings/Attendance tabs.
6. Attendance read for a room: derive sessions via `session.roomId` (new) or `session.activeMeeting.roomId` (legacy), then reuse `scheduledSessionAttendance(sessionId)` — no new fact tables.
7. `formatPaiseInr` dashboard helper + typed `graphql()` documents everywhere (A24).

**Acceptance:** tenant A cannot see B's meetings via the no-org path (regression test green); `bbbStartRoom` starts and returns a join URL for a moderator and denies a non-member; a session started with `roomId` flips room state via the normal hooks and a room already live rejects the second start; room cards show counts.

---

### Phase 6 — Dashboard restructure (room-centric UX)

**Read:** `dashboard/index.tsx`, all `dashboard/routes/*`, `dashboard/shared/useCurrentOrganization.ts`, `dashboard-graphql-contract.spec.ts`, marketplace `attendance-overview.tsx`/`attendance-session-detail.tsx` (detail-tab + breadcrumb pattern), `README.md` nav tables.

**Do:**
1. **Nav** in `defineDashboardExtension` — two sections per §2 IA:
   - Tenant section: `Dashboard`, `Rooms`, `Meetings`, `People`, `Billing` (exactly 5).
   - Platform section gated `['BBBAdmin','BBBPlatformInfrastructure']`: `Organizations`, `Servers`, `Capacity` (old `PlansList`), `Live Meetings` (old `MeetingsList` with its org picker). Remaining technical routes (Entitlements, Trials, Memberships, Enrollments, old Sessions list) stay routed but lose tenant nav entries — **retarget gates, never edit the tenant role** (A15). Entitlements remains *reachable* through People (A19).
2. **Rooms** (`routes/rooms/RoomsList.tsx` rewrite): card list — name, `students · trainers`, `Ready`/`Live` badge (existing `STATE_LABEL`), single `[Start]`/`[Join]` (→ `bbbStartRoom`) + `[Manage]`; `[+ Create room]` dialog with only **name, max students, recording** (slug removed from UI, description optional). Strip `currentMeetingId`/`retryCount`/`lastProvisionRequestedAt` from the tenant document.

3. **Room detail** route `/bbb/rooms/$id` (breadcrumb loader, `sessionDetail` pattern) with tabs:
   - **Overview:** counts, rate, today's usage, this month's charge, `[Start class]`.
   - **People:** Trainers (org-wide list, read-only — "all academy trainers can teach here"; D5) + Students (with per-student access).
   - **Sessions:** sessions where `session.roomId = id` (create-session dialog pre-filled with the room); legacy null-room sessions surface on Dashboard.
   - **Attendance:** per-session student counts/durations via Phase 5.6.
   - **Recordings:** meetings of this room with `recordingUrl`.
   - **Settings:** name, max students, recording only — no provisioning fields.
4. **Meetings:** tenant history from `bbbMeteredMeetings` (room, when, peak students, peak trainers, student-hours, ₹, recording link) — replaces the old screen (which becomes Platform › Live Meetings).
5. **People:** two tabs — **Trainers** (existing Members/Memberships lists, relabeled) and **Students** (Enrollments + Entitlements + Trials folded into a person view: rooms, access-until, usage). Reuse existing list components; backend change limited to whatever the person view needs.
6. **Billing:** from `bbbBillingSummary` — rate (`₹x / student-hour`), this month's student-hours + charge, per-room breakdown, spend limit. Zero grant vocabulary.
7. **Dashboard (new):** live rooms now, month summary, upcoming sessions (org-level) — aggregates existing queries; no new backend.
8. All new/changed screens use typed `graphql()` documents; update `dashboard-graphql-contract.spec.ts` file list (A24).

**Acceptance:** a tenant admin sees exactly 5 nav items and zero plumbing fields anywhere in tenant documents; a platform operator additionally sees the Platform section; channel switcher is the only org selector; `npm run build:dashboard`, `lint`, contract spec, and isolation e2e all green.

---

## 5. Explicitly out of scope (do not build)

- Removing or refactoring `BbbCapacityGrant`, daily allowance, subscription grants, internal-overhead grants.
- **Per-room trainer assignment** — no trainer-room ACL, no new access source, no changes to `room-access.policy.ts` / INV-027 (D5). Room detail shows org trainers read-only.
- Per-user join/leave webhook metering (v2; sampling is v1).
- Invoice PDFs, GST, Razorpay collection, wallets/prepaid balances (ADR-038 later job consumes `MeteredUsageRecordedEvent`).
- Making `BbbScheduledSession.roomId` mandatory / backfilling legacy rows (nullable stays; legacy surfaces on Dashboard).
- Copying PILOS code, assets, logo, or screenshots (LGPL; IA reference only — D6).
- ~~H2/H3 changes without explicit go-ahead (§3).~~ **Landed 2026-09-30** with the go-ahead (§3 H2/H3, §7): platform-only `createBbbCapacityGrant` / `deleteBbbOrganization`, channel-asserted `bbbCapacityGrants`, platform-only `Capacity Grants` + `Trial Registrations` nav gates. Everything else in §3's H1 (the four billing controls on `updateBbbOrganization`) stays Phase 4.

## 6. Known trade-offs

- **Under-billing windows (customer-favourable):** per-minute sampling misses sub-minute join/leave and the last partial minute before `meeting-ended`; metering-worker downtime loses minutes. Mitigation: per-meeting **sample-gap logging** keeps it visible (Phase 2.2).
- **Postpaid credit exposure:** `monthlySpendLimitPaise` and `org.suspended` are the only v1 guards — hence H1 matters.
- **Grant-path rescan quirk (A14)** remains for grant orgs; deliberately not fixed here (grant code frozen for metered orgs).
- Existing null-room sessions/attendance stay org-level until naturally recreated with a room.

## 7. Confirm-before-acting register (ask Ashish, do not assume)

> **Answered 2026-09-30 — all three closed before Phase 2 (no item left assumed).**

1. **H2 — ✅ GO: retarget.** `createBbbCapacityGrant` and `deleteBbbOrganization` are now
   `@Allow(BbbAdmin, BBBPlatformInfrastructure)`. The tenant role is untouched (A15); only the
   gate moved. Consequences implemented in the same change: the shipped `Capacity Grants`
   (`/bbb/plans`) nav gate mirrored to platform-only (otherwise a tenant screen would show a
   create form that is now `ForbiddenError`; Phase 6 relocates the item into the Platform
   section as `Capacity`), and `scripts/seed/seed-via-graphql.sh` step 10 now logs in as
   SuperAdmin instead of the tenant moderator token.
2. **H3 — ✅ GO: fix here, not separately.** `bbbCapacityGrants` asserts channel ownership
   (`assertOrganizationAccess`) before reading. Scope resolution recorded: *assert*, do not
   make the query platform-only — an explicit `organizationId` is not the leak, an
   unasserted one is, and the tenant's own read stays legitimate under INV-029.
3. **Trials nav — ✅ DECIDED: platform-only** (the Phase 6.1 assumption, chosen deliberately
   over folding it into People → Students). `/bbb/trials` stays routed and keeps its
   permission, but its nav gate is `['BBBAdmin', 'BBBPlatformInfrastructure']` so it is no
   longer a tenant nav item. Reversal path: merge it into People → Students as a filter in
   Phase 6.1 — a UI-only change that does not touch this backend gate, since the resolver's
   `BbbManageSessions` permission is unchanged.

## 8. Per-phase verification checklist (run before claiming any phase done)

```bash
npm run build && npm run lint && npx tsc -p tsconfig.e2e.json --noEmit --strict
npm run verify:invariants
npm run codegen                # whenever schema or dashboard documents changed
npm run build:dashboard        # Phase 6
npx vitest run --config vitest.config.mts <new-spec>   # + package.json test:e2e:* script entry
# repo truth rule (.clinerules §11):
git fetch origin && git rev-parse HEAD && git rev-parse origin/main
git log --oneline -5 && git status --short
```

Existing suites that must stay green throughout: `grant-selection.policy.spec`, `room-access.e2e-spec`, `bbb-channel-isolation.e2e-spec`, `bbb-usage-ledger.e2e-spec`, `bbb-meeting-concurrency.e2e-spec`, `plan-derived-concurrency.e2e-spec`, `daily-allowance.policy.spec` + its e2e, `dashboard-graphql-contract.spec`.

---

*Plan assembled from: verified code audit (§1, 24 findings), locked decisions D1–D9 (§2), security register H1–H3 (§3), Phases 0–6 (§4). PILOS review outcome: IA and labels only; the room-centric model maps onto existing Saa9vi primitives (channel, rooms, membership moderation, entitlements, immutable usage facts) without inverting them.*
