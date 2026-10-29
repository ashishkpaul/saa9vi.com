# Cline Execution Plan: Saa9vi BBB Pool, Permission-Aware Navigation, and Learner-Hour Billing

> **Type:** Cline implementation plan · **Target:** `src/plugins/bigbluebutton-plugin/`
> **Basis:** review of this repo at `0c4393d` (`fix: complete metered meetings with zero samples`) against the "BBB architecture review" assessment, plus a read of Scalelite's source (`config/routes.rb`, `lib/tasks/poll.rake`, `app/models/server.rb`, `app/controllers/bigbluebutton_api_controller.rb`).

---

## 0. Decision (read first)

**Do not adopt Scalelite now. Finish the native pool: make `currentLoad` a measured value, rank servers by utilisation, and fix per-room participant-limit enforcement. Keep learner-hour billing, and reorganize BBB administration navigation around the actual permission model. Record Scalelite as a deferred option with explicit revisit triggers.**

This differs from the assessment's "favor Scalelite". Reasons, each verified in code:

| # | Finding | Evidence |
|---|---|---|
| 1 | Most of what the assessment lists as pool responsibilities **already exists natively**: meeting→server ownership (`bbb_meeting.serverId` FK), create-time failover across servers, 5-min signed health probe with recovery, connection-failure exclusion + ops alerts, orphan census via `getMeetings`. | `entities/bbb-meeting.entity.ts:65-73`, `services/bbb-provisioning-worker.service.ts:262-300`, `jobs/bbb-server-health.task.ts`, `services/bbb-server-selection.service.ts`, `services/bbb-reconciliation.service.ts` (`scanOrphanMeetings`) |
| 2 | The real gap is exactly one thing: **nothing ever writes `BbbServer.currentLoad`**, so every server ties at 0 and selection is random. `CapacityIntelligenceService` also hard-codes `activeParticipants = 0`. | `entities/bbb-server.entity.ts:50-67`, `services/capacity-intelligence.service.ts` (`const activeParticipants = 0`) |
| 3 | **Scalelite has no `hooks/*` route** (unknown paths hit `errors#unsupported_request`). Saa9vi registers `hooks/create` per BBB node and receives `meeting-ended` / `rap-publish-ended` at `POST /bbb/webhook/:serverId`, verified with that node's secret. Behind Scalelite that whole path breaks. | `config/routes.rb` in Scalelite; `services/bbb-hooks.service.ts`; `workers/bbb-webhook.controller.ts` |
| 4 | **Scalelite has no load ceiling.** `Server.find_available` returns the lowest-load online server; there is no `maxLoad` and no rejection. The assessment's "reject when no suitable capacity" is not something Scalelite provides. | `app/models/server.rb` `find_available` |
| 5 | **Scalelite's `getMeetingInfo` forwards only `meetingID`.** Saa9vi's metering and reconciliation send the moderator `password` and document that BBB requires it. This is the revenue path (ADR-047), so it needs an empirical check before any Scalelite adoption. | Scalelite `get_meeting_info`; `services/bbb-api.service.ts:406-445`, `services/bbb-metering.service.ts:160-195` |
| 6 | **Scalelite takes a node offline after 2 consecutive failed polls (default) and, when it does, destroys its meeting records and sends `end` for every meeting on that node.** A transient network blip could end live paid classes. | `lib/tasks/poll.rake` (`server_unhealthy_threshold` default 2) |
| 7 | Scalelite adds operational surface: Rails app + poller + Redis + PostgreSQL + an NFS shared volume for recordings. | Scalelite `README.md` §Requirements |
| 8 | **Invariant conflict in the assessment:** "a meeting should be rejected when no suitable capacity is available" violates **INV-012** ("any code path that throws an error … solely because pool capacity is high is rejected"). | `docs/architecture/invariants.md` §INV-012 |

What the assessment got right and this plan keeps: measure load instead of assuming it; keep billing (`BbbMeteredUsage`, learner-minutes) fully separate from infrastructure load; keep events + polling + reconciliation as complementary; reuse `BbbPlatformCapacityPolicy` rather than inventing parallel settings; don't remove organization concurrency enforcement.

**Revisit Scalelite when** any of these becomes true: more than ~5 BBB nodes; a requirement for one consolidated recordings/playback endpoint across nodes; or ops capacity exists to run Redis + Postgres + NFS. The seam already exists (`BbbServerSelectionService`; Scalelite would be one `BbbServer` row whose `apiUrl` is Scalelite). The pre-adoption spike checklist is in Phase 7.

---

## 1. Non-negotiable rules

1. Start with `git status`, current branch/HEAD. Do not reset, checkout or overwrite user changes. Read `.clinerules` first.
2. **INV-012 is not amended by this work.** No code path may throw, fail a meeting, or deny access *solely* because pool load is high. Saturation produces an operator alert and an overflow selection (Phase 3), never a refusal.
3. **INV-014:** `BbbRoom.maxParticipants` must never exceed `BbbOrganization.maxParticipantsPerMeeting` at provisioning.
4. **Billing implementation is untouched by the pool work, but the pricing decision is locked:** retain learner-hour billing; do not switch to attendee-count-only pricing. Do not edit `bbb-metering.service.ts`, `metered-billing.policy.ts`, `BbbMeteredUsage`, `BbbUsageLedger`, or grant logic in these phases. Load values never feed billing; billing values never feed load. Preserve the existing grant mode for compatibility.
5. Do not change the webhook event filter (`BBB_HOOK_EVENT_FILTER = "meeting-ended,rap-publish-ended"`). Do **not** add `user-joined` / `user-left` hooks: per-minute sampling is the deliberate meter (ADR-047 §5) and the load poll replaces any need for join/leave events.
6. Schema changes: generate migrations only with the Vendure CLI (`npx vendure migrate --generate …`), inspect the output, never hand-write or edit an applied migration (`.clinerules` §7).
7. Every new scheduled task is registered with the id-dedupe pattern used by `bbbServerHealthTask` in `bigbluebutton.plugin.ts` (~line 276).
8. One logical change per phase; each phase leaves `npm run lint` and the listed tests green. Never report a test as passed unless you ran it and saw the result. Do not weaken or skip existing tests.
9. Do not change tier numbers in `BbbPlatformCapacityPolicyService` (starter 25/100/250, growth 100/300/1000, enterprise 250/1000/5000). The "100 participants" figure already corresponds to the `growth` default and the `starter` ceiling.
10. No new dependencies.
11. Navigation changes must reflect real backend authorization. A hidden menu item is not authorization; direct routes and Admin API resolvers/mutations must enforce the corresponding permission and tenant/platform scope. Prefer existing granular permissions; add a new permission only if the audit proves the current model cannot express the intended separation.

---

## 2. Locked decisions

The following two product decisions are included alongside the pool work: (1) use permission-aware BBB navigation, with infrastructure settings separated from cross-tenant operations; (2) retain learner-hour pricing based on learner-minutes. They do not authorize a change to the existing billing implementation in this pool-focused work.

| # | Decision |
|---|---|
| L1 | **Unit of `currentLoad` = attendees**, summed over non-breakout meetings from `getMeetings`. `attendees = participantCount` (see Phase 0 check 1). |
| L2 | **Join buffer** (borrowed from Scalelite): a meeting created within `loadJoinBufferMinutes` (default 15) counts as at least `loadMinUserCount` (default 15) attendees, so a class that has just started is not invisible while students trickle in. |
| L3 | **No per-server multiplier column.** Hardware differences are expressed through each server's own `maxLoad`; selection ranks by **utilisation** `currentLoad / maxLoad`, not raw load. |
| L4 | **`maxLoad` is a soft threshold.** Candidates under `maxLoad` are preferred; if none exist, the least-utilised healthy server is still selected (overflow) and a deduplicated `bbb-pool-saturated` ops alert fires. `capacity` stays the advisory hardware ceiling used by `CapacityIntelligenceService`. |
| L5 | **Stale load is unknown, not zero.** A row whose `loadUpdatedAt` is null or older than `loadStaleAfterMinutes` (default 5) ranks after fresh rows but stays eligible. A poll failure must never take a server out of selection; the health probe owns `healthy`. |
| L6 | **Optimistic increment** after a successful `/create`: atomic `currentLoad = currentLoad + loadMinUserCount` so a burst between polls does not pile onto one node. The next poll overwrites it with the measured value. |
| L7 | `currentLoad` is written **only** by `BbbServerLoadService` (poll) and the L6 increment. `healthy` / `lastHealthCheckAt` remain written only by the health probe and failure bookkeeping. |
| L8 | **Billing remains learner-hour based.** Billable usage is accumulated `learnerMinutes`, with moderators excluded according to the existing metering policy; monthly charge remains `round(sum(learnerMinutes × ratePaisePerHour) / 60)` in paise. A moderator-only metered meeting has zero variable usage charge. Do not replace this with a charge based only on the number of attendees, and do not change the billing implementation in this pool PR. |
| L9 | **Permission-aware navigation.** Move infrastructure configuration (Servers and Capacity) into Settings → BigBlueButton where the installed Dashboard extension API supports that location. Keep cross-tenant operational screens (Organizations, Live Meetings, Trial Registrations) in a clearly separate platform/operations section. Gate each entry with the narrowest permission the backend actually accepts; maintain `BBBAdmin` compatibility. Do not give a tenant-only permission cross-tenant scope merely to make the menu visible. |

---

## Phase 0 — Baseline (no edits)

1. `git status`, branch, HEAD. Read `.clinerules`, `docs/architecture/invariants.md` (INV-002, INV-012, INV-014, INV-027), ADR-047, and DL-014 in `docs/adr/platform-adr.md`.
2. Read fully before editing: `services/bbb-server-selection.service.ts`, `services/bbb-server.service.ts`, `entities/bbb-server.entity.ts`, `jobs/bbb-server-health.task.ts`, `jobs/bbb-metering.task.ts` (1-minute task pattern), `services/bbb-provisioning-worker.service.ts` (lines 95-330), `services/capacity-intelligence.service.ts`, `services/bbb-api.service.ts` (`getMeetings`, `BbbRemoteMeeting`), `services/bbb-ops-alert.service.ts`, `bigbluebutton.plugin.ts`, `types.ts`.
3. Record baseline results of the commands you can actually run: `npm run lint`, `npm run verify:invariants`, and these unit specs: `bbb-server-connection-resilience.spec.ts`, `bbb-server-test-connection.spec.ts`, `bbb-orphan-scan.spec.ts`, `bbb-api-errors.spec.ts`. Run `npm run test:e2e:bbb-metering` and `npm run test:e2e:bbb-lifecycle` if a database is available; if not, say so. Separate pre-existing failures from anything you introduce.
4. **Two empirical checks the owner must confirm on a real BBB node** (API-Mate is fine). You cannot do these from the sandbox; list them as open in your report, and proceed with the stated defaults:
   - **Check 1:** in `getMeetings`, does `participantCount` already include moderators? Saa9vi's metering assumes yes (`learners = participantCount − moderatorCount`). Scalelite's poller adds `participantCount + moderatorCount`, so the two codebases disagree. This plan uses `participantCount` alone. If the check shows moderators are *not* included, change one line in the load policy.
   - **Check 2:** does `getMeetingInfo` really require `password` on the deployed BBB version? Only matters for the Scalelite pre-adoption spike (Phase 7), not for this work.

---

## Phase 1 — Pure load policy + richer `getMeetings` parse

**Goal:** a dependency-free, fully unit-tested load calculation (same style as `grant-selection.policy.ts`).

1. Extend `BbbRemoteMeeting` and the `getMeetings` mapper in `services/bbb-api.service.ts` with `createTime: number` (ms, default 0), `isBreakout: boolean`, and `videoCount: number` (default 0). Existing fields and the "passwords are dropped at parse time" behaviour must not change. Update any test fixtures that construct `BbbRemoteMeeting`.
2. New `services/server-load.policy.ts` exporting a pure function, e.g.:

   ```ts
   computeServerLoad(
     meetings: ReadonlyArray<Pick<BbbRemoteMeeting,'participantCount'|'createTime'|'isBreakout'|'hasBeenForciblyEnded'>>,
     opts: { nowMs: number; minUserCount: number; joinBufferMs: number },
   ): { load: number; liveMeetings: number; liveParticipants: number }
   ```

   Rules: skip breakout rooms and forcibly-ended meetings for `load`; for a meeting with `nowMs - createTime < joinBufferMs` use `max(participantCount, minUserCount)`; `liveParticipants` is the plain participant sum (no buffer); `liveMeetings` counts non-breakout meetings; `load` is an integer (`Math.ceil`).
3. Add optional plugin options to `types.ts` with defaults applied where read (`loadMinUserCount` 15, `loadJoinBufferMinutes` 15, `loadStaleAfterMinutes` 5), documented in the same JSDoc style as `cameraRatio`.
4. **Tests** `__tests__/server-load.policy.spec.ts`: empty list → zeros; single established meeting; new meeting under buffer uses the minimum; new meeting above the minimum uses its real count; breakout excluded; forcibly-ended excluded; boundary at exactly `joinBufferMs`; a pinned test that moderators are **not** added on top of `participantCount`.

**Acceptance:** `npm run lint` clean; new spec and existing API specs pass; no behaviour change at runtime yet.

---

## Phase 2 — Persist measured load + 1-minute updater

1. Add to `entities/bbb-server.entity.ts`: `liveMeetings` (int, default 0), `liveParticipants` (int, default 0), `loadUpdatedAt` (nullable `Date`). Update the long `currentLoad` doc comment so it no longer says "no runtime updater": state the unit (attendees) and that only `BbbServerLoadService` and the L6 increment write it. Generate the migration via the Vendure CLI; inspect it; it must be additive only.
2. New `services/bbb-server-load.service.ts` (`@Injectable`, register in the plugin providers):
   - `refreshAll()`: for each **enabled** server (secret side-loaded the way `runHealthProbe` does), call `bbbApiService.getMeetings(server)`, compute with the Phase 1 policy, then write `currentLoad`, `liveMeetings`, `liveParticipants`, `loadUpdatedAt = now`.
   - Bounded concurrency, per-server error isolation: one failing server never fails the tick. On any error, **leave the previous load values and `loadUpdatedAt` unchanged** (so L5 staleness takes over) and log; do **not** write `healthy` and do **not** raise config/health alerts here (the health probe owns that, and this task runs 5x as often).
   - `noteMeetingCreated(serverId)`: atomic `UPDATE bbb_server SET "currentLoad" = "currentLoad" + :n` (query-builder `set` with a raw expression, not read-modify-write). Swallow and log errors; it must never break provisioning.
   - Return `{ polled, updated, failed }`.
3. New `jobs/bbb-server-load.task.ts`: `ScheduledTask` id `bbb-server-load`, `cron.every(1).minutes()`, same try/catch shape as `bbb-server-health.task.ts`. Register in `bigbluebutton.plugin.ts` with the `existingIds` dedupe, next to the health task.
4. In `bbb-provisioning-worker.service.ts`, immediately after `noteConnectionSuccess(createdOnServerId)` call `bbbServerLoadService.noteMeetingCreated(createdOnServerId)`. Do not change anything else in that loop.
5. **Tests:** unit spec with a stubbed `BbbApiService` and repository: updates fields; one server throwing leaves its row untouched and others still update; no `healthy` write on failure; increment is a single atomic statement. Add an e2e `__tests__`-style or `e2e/` spec following `bbb-metering.e2e-spec.ts` (env-flag gated; add script `test:e2e:bbb-server-load` with flag `BBB_SERVER_LOAD_E2E=true` in the same style as the existing scripts) if a database is available.

**Acceptance:** after a poll, `currentLoad` reflects the fake server's meetings; Servers dashboard shows non-zero loads in the e2e; health/failure tests unchanged.

---

## Phase 3 — Selection by utilisation, INV-012-safe

Edit `services/bbb-server-selection.service.ts` only (plus its callers' types if needed).

1. Keep the SQL filter for `enabled` and `healthy` and the in-memory connection-failure exclusion exactly as is. **Remove** `currentLoad < maxLoad` from the SQL `WHERE`; apply it in memory instead.
2. Selection order:
   1. Partition candidates into *fresh* (`loadUpdatedAt` within `loadStaleAfterMinutes`) and *stale/unknown*.
   2. Prefer candidates with `currentLoad < maxLoad`. Among them rank fresh before stale, then by utilisation `currentLoad / max(maxLoad, 1)` ascending, then random jitter among exact ties (keep the existing jitter idea).
   3. If **no** candidate is under `maxLoad` but healthy candidates exist: pick the least-utilised healthy one (overflow), `Logger.warn`, and call `opsAlert.notify("bbb-pool-saturated", "pool", …, { servers: [...] })`. Never return `null` for load reasons.
   4. Return `null` only when there are no enabled+healthy non-excluded servers (unchanged semantics; the tenant-facing message stays exactly `"No healthy BBB server available"` — `bbb-server-connection-resilience.spec.ts` pins it).
3. Keep `selectServer(ctx)`'s signature. Extract the ranking into an exported pure function (e.g. `rankServers(...)` in `services/server-selection.policy.ts`) so it is unit-testable without a database.
4. `bbb-server.service.ts#selectBestServer` is `@deprecated`; leave it, but confirm nothing calls it (`Grep`); if nothing does, leave a comment and do not delete in this PR.
5. **Tests:** `__tests__/server-selection.policy.spec.ts`: lower utilisation wins over lower raw load for different `maxLoad`; stale ranks after fresh; all servers over `maxLoad` → still returns one (overflow) and flags saturation; all servers at load 0 and no `loadUpdatedAt` → behaves like today (random among ties); excluded servers never returned. Add an **INV-012 regression test**: for any combination of loads, ranking never yields "no server" while a healthy non-excluded server exists. Existing `bbb-server-connection-resilience.spec.ts` must pass unmodified.

**Acceptance:** two servers with `maxLoad` 100 and 400 at loads 60 and 120 → the 400 server is chosen (30% vs 60%).

**Operator note for the release notes (do not auto-migrate values):** existing `maxLoad` (default 100) and `capacity` (default 200) were opaque placeholders. After this phase they are in **attendees**. Operators must set `maxLoad` per server from a load test (the repo has a load-simulation plugin and `docs/adr/bug-006-load-testing-observability.md`) before relying on saturation alerts. Do not invent hardware numbers in code or docs.

---

## Phase 4 — Honour the per-room participant limit (independent fix)

Today provisioning passes `meeting.organization.maxParticipantsPerMeeting` to BBB and ignores `BbbRoom.maxParticipants`.

1. In `bbb-provisioning-worker.service.ts` (the `createMeeting` call, ~line 282) compute `maxParticipants = min(room.maxParticipants ?? org.maxParticipantsPerMeeting, org.maxParticipantsPerMeeting)`. Load the room only when `meeting.roomId` is set; meetings without a room keep the org value. Keep INV-014's ceiling.
2. Put the resolution in a small pure helper so it can be unit-tested; do not duplicate the policy logic in `bbb-platform-capacity-policy.service.ts`.
3. **Tests:** room lower than org → room value; room higher than org (legacy data) → org value; no room → org value; unit test on the helper plus an assertion on the params passed to a stubbed `createMeeting`.
4. **Explicitly out of scope:** `BbbPlatformCapacityPolicy.maxConcurrentParticipants` is stored and shown but **enforced nowhere** (verified). Do not build enforcement here; enforcing a per-org live-participant ceiling is a product decision and would run into INV-012. Mention it in the final report.

**Acceptance:** `session-room-linkage`, `room-access` and lifecycle specs still green.

---

## Phase 5 — Make the dashboards tell the truth

1. `services/capacity-intelligence.service.ts#getLivePoolHealth`: replace the hard-coded `activeParticipants = 0` with the server's `liveParticipants` when `loadUpdatedAt` is fresh, otherwise 0. Keep the service **read-only/advisory** (INV-012); do not add any gate. Keep `activeMeetings` as the local `BbbMeeting` count (do not substitute the BBB census).
2. GraphQL: add `liveMeetings`, `liveParticipants`, `loadUpdatedAt` to the admin `BbbServer` type in `api/schema/bbb-admin.schema.ts`; run `npm run codegen`. `ServerHealth` already exposes `activeParticipants`.
3. `dashboard/routes/servers/ServersList.tsx`: show load as `currentLoad / maxLoad` with the unit "attendees", plus live meetings/participants and "updated <relative time>", with a stale indicator when `loadUpdatedAt` is old. Use the typed `graphql()` helper; update the dashboard contract spec list if required.
4. Run `npm run test:dashboard-contract`, `npm run test:dashboard-tsc`, `npm run build:all`.

**Acceptance:** Servers screen shows measured values; this load-display phase changes no permissions; tenant roles still cannot see platform infrastructure. Permission-aware menu changes are handled separately in Phase 6.

---

## Phase 6 — Permission-aware BBB administration navigation

**Goal:** make the Dashboard menu reflect the intended responsibilities and the actual Vendure authorization model without weakening backend access control.

1. **Baseline before editing:** inspect the current Dashboard extension registration (including the `bbb-platform` section), the installed Dashboard extension API/version, all BBB `PermissionDefinition`s, `requiresPermission` arrays, `@Allow` decorators, and `BbbChannelAccessService` platform-caller checks. Record which permission actually authorizes each route/query/mutation; do not infer authorization solely from a menu label or from the `ListOfRoles` response.
2. **Target information architecture:**
   - **Settings → BigBlueButton:** `Servers` and `Capacity` (infrastructure configuration). Use the built-in Settings section only if the installed Dashboard extension API supports it; otherwise use a clearly named BBB Settings section in the appropriate admin placement rather than breaking route registration.
   - **BBB Platform / Operations:** `Organizations`, `Live Meetings`, and `Trial Registrations`, because these are cross-tenant operational workflows rather than server configuration.
   - Keep tenant-level `/bbb/billing` scoped to the active tenant/channel. Do not accidentally move a tenant billing screen into a platform-wide view. A platform-wide BBB usage/billing view belongs under Billing only if there is an existing platform-wide route with a matching server-side permission.
3. **Permission mapping:**
   - `Servers` and `Capacity`: use the existing `BBBPlatformInfrastructure` permission, retaining broad `BBBAdmin` compatibility.
   - `Organizations`: use `BBBManageOrganizations` only if both the query/mutations and `BbbChannelAccessService` allow the required platform scope; otherwise preserve the existing platform gate until a deliberate server-side permission design is added.
   - `Live Meetings`: use `BBBManageMeetings` only if the operations are intentionally allowed across tenants and the resolver/service scope supports that. Otherwise retain the platform gate.
   - `Trial Registrations`: use `BBBManageSessions` only if its resolver/service permits the intended cross-tenant operations; otherwise retain the platform gate.
   - Do not add invented permission names by default. If the current granular permissions are tenant-scoped and cannot express a platform-scoped operation, document the gap and add narrowly scoped platform permissions only after updating server-side guards and tests together.
4. Treat arrays in `requiresPermission` according to the installed Dashboard API semantics (typically any-of, not all-of). Add tests that pin this behavior so `['BBBAdmin', 'BBBPlatformInfrastructure']` is not mistaken for an all-permissions requirement.
5. Preserve URL paths and route functionality unless there is a separate approved route migration. Hiding a link does not protect a route: direct navigation and every Admin API query/mutation must still enforce permission and channel/platform scope.
6. **Tests:** verify (a) an infrastructure-only role sees Servers and Capacity but not unrelated cross-tenant operations; (b) a role with a specific operations permission sees only the appropriate item and can successfully call only authorized API operations; (c) a tenant-only role cannot see or query cross-tenant organizations/live meetings/trials; (d) `BBBAdmin` retains backward-compatible access; and (e) direct-route/API attempts are rejected when unauthorized. Use GraphQL Admin API role mutations for permission assignment in test/dev environments; do not edit database records manually.
7. Run the relevant dashboard contract/typecheck/build tests and backend authorization tests. If a permission currently cannot express a cross-tenant role without also granting infrastructure access, report that as an explicit authorization-model gap rather than weakening the resolver guard.

**Acceptance:** server settings are grouped under Settings where supported; operational pages remain distinct; menu visibility matches the actual authorized operations; platform and tenant channel boundaries remain enforced; `BBBAdmin` compatibility is preserved.

---

## Phase 7 — Documentation and the Scalelite decision record

1. New ADR in `docs/architecture/platform-adr.md` with its own file under `docs/architecture/` following the `adr-04x-*.md` convention. **Verify the next free number first** (grep `docs/` for `ADR-0`): `platform-adr.md` currently ends at ADR-048 and `adr-049-durable-hostname-channel-mapping.md` already exists, so the next number is probably 050, but do not assume; the repo has had numbering collisions before. Title: *"BBB server pool: measured load and utilisation-ranked selection are native; Scalelite is deferred."* Include the eight findings from §0, decisions L1–L9, the permission-aware navigation decision, the retained learner-hour billing decision, and the revisit triggers.
2. Amend the DL-014 note (the register in `docs/adr/platform-adr.md`, ~line 1792, and the DIV-002 row ~line 185): `currentLoad` is still opaque to the selection *algorithm's* callers, but it now has one defined producer and unit (attendees); `maxLoad` is a soft threshold (INV-012).
3. Add a new invariant to `docs/architecture/invariants.md`. **Do not use INV-028 or INV-029; both are taken, and other docs already reference INV-030.** Grep all of `docs/` for `INV-0` and take the next genuinely free number. Text: *`BbbServer.currentLoad` is measured, not assumed — written only by `BbbServerLoadService` and its create-time increment; selection never refuses a meeting solely for load.* Rejection criterion: any other writer of `currentLoad`, or any selection path that returns no server while a healthy non-excluded server exists. (A structural checker in `verify:invariants` is optional; a spec asserting the single-writer rule with a source-text test is acceptable. Do not claim `verify:invariants` enforces it unless you add the check.)
4. **Scalelite pre-adoption spike checklist** (document only; do not build): (a) confirm `hooks/create` has no equivalent and decide how `meeting-ended` / recording-ready reach Saa9vi (per-node hooks need per-node secrets, which defeats the single endpoint; alternatives are BBB `meta_*` callback parameters, which must be tested through Scalelite); (b) Check 2 from Phase 0, through Scalelite; (c) set `SERVER_UNHEALTHY_THRESHOLD` high enough that a brief blip cannot trigger Scalelite's end-all-meetings behaviour, and test it; (d) `GET_MEETINGS_API_DISABLED` must stay false (health, orphan scan and load all use `getMeetings`); (e) recordings: NFS volume, import pipeline, playback URLs through `getRecordings`; (f) how per-node health, load and ownership remain visible to operators when `BbbServer` collapses to a single row (Scalelite's `getServers` admin API); (g) tenant secret for Saa9vi as a Scalelite tenant; (h) a decision on `maxLoad` semantics, since Scalelite has none.
5. Add a short release-notes entry (`docs/implementation/release-notes.md`) with the `maxLoad` operator note from Phase 3.

---

## Out of scope (do not do)

- Installing, configuring or integrating Scalelite, PILOS, Greenlight, bbb-events, API Mate or the BBB plugin framework.
- Changing billing algorithms, ledger semantics, rate configuration, grant-system removal, or replacing per-minute learner-minute metering with join/leave-event billing. Learner-hour pricing is retained as a locked product decision; these phases only document and protect it.
- Adding broad platform permissions just to make navigation render; authorization changes must be narrow and backed by resolver/service tests.
- Per-room trainer ACLs.
- New webhook event types; replacing per-minute sampling with join/leave events.
- Hard capacity rejection, waiting queues, or enforcing `maxConcurrentParticipants` (INV-012; needs an explicit amendment/ADR from the owner first).
- Removing `selectBestServer`, `capacity`, or `maxLoad`.

## Final report (required format)

Branch/HEAD; commands actually run with observed results; pre-existing failures vs new; the migration file generated; the two Phase 0 empirical checks marked **open** unless the owner supplied results; any deviation from this plan and why; `maxConcurrentParticipants` noted as still unenforced; final menu-to-permission matrix and any backend permission gaps; confirmation that metered billing still uses learner-minutes and moderator-only metered usage remains zero variable charge.

### Empirical check results (supplied by owner, 2026-10-29)

**Participant-count semantics (live BBB via curl `getMeetings`, server https://meeting.saa9vi.com/bigbluebutton/):**

| Meeting | participantCount | moderatorCount | Attendees |
|---|---|---|---|
| Room - 1 | 4 | 1 | 1 MODERATOR + 3 VIEWER |
| cb8vcm | 2 | 1 | 1 MODERATOR + 1 VIEWER |
| Main Classroom (Vendure-started) | 1 | 1 | 1 MODERATOR |

**Conclusion:** `participantCount` **includes** moderators (it is a total attendee count); `moderatorCount` reports moderators separately. Both code paths are consistent:

- Load policy (`computeServerLoad`) uses `participantCount` alone → moderator counts toward load (conservative/safe).
- Billing (`learnerCountFrom(participantCount, moderatorCount) = max(0, p − m)`) → moderator-only meeting ("Main Classroom": p=1, m=1) yields **0 billable learners**, confirming moderator-only metered usage remains zero variable charge.

No change to `bbb-server-load.service.ts`, `server-load.policy.ts`, `metered-billing.policy.ts`, or `bbb-metering.service.ts` is required.