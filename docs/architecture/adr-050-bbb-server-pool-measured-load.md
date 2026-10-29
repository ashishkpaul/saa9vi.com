# ADR-050: BBB server pool — measured load and utilisation-ranked selection are native; Scalelite is deferred

**Status:** Accepted (2026-10-29)

**Context:** The BBB architecture review recommended adopting Scalelite as the pool layer. This ADR records the decision, after code review, to finish the native pool instead: make `currentLoad` a measured value, rank servers by utilisation, and honour the per-room participant limit. Learner-hour billing is retained. Scalelite is recorded as a deferred option with explicit revisit triggers.

## Eight findings (verified in code)

1. Most pool responsibilities already exist natively: meeting→server ownership (`bbb_meeting.serverId` FK), create-time failover across servers, 5-minute signed health probe with recovery, connection-failure exclusion + ops alerts, orphan census via `getMeetings`.
2. The real gap was exactly one thing: nothing ever wrote `BbbServer.currentLoad`, so every server tied at 0 and selection was random. `CapacityIntelligenceService` also hard-coded `activeParticipants = 0`.
3. Scalelite has no `hooks/*` route (unknown paths hit `errors#unsupported_request`). Saa9vi registers `hooks/create` per BBB node and receives `meeting-ended` / `rap-publish-ended` at `POST /bbb/webhook/:serverId`, verified with that node's secret. Behind Scalelite that path breaks.
4. Scalelite has no load ceiling: `Server.find_available` returns the lowest-load online server; there is no `maxLoad` and no rejection.
5. Scalelite's `getMeetingInfo` forwards only `meetingID`. Saa9vi's metering and reconciliation send the moderator `password` and document that BBB requires it. This is the revenue path (ADR-047), so it needs an empirical check before any Scalelite adoption.
6. Scalelite takes a node offline after 2 consecutive failed polls (default) and, when it does, destroys its meeting records and sends `end` for every meeting on that node. A transient network blip could end live paid classes.
7. Scalelite adds operational surface: Rails app + poller + Redis + PostgreSQL + an NFS shared volume for recordings.
8. Invariant conflict: "a meeting should be rejected when no suitable capacity is available" violates INV-012 ("any code path that throws an error … solely because pool capacity is high is rejected").

## Decisions L1–L9

- **L1 — Unit of `currentLoad` = attendees**, summed over non-breakout meetings from `getMeetings`.
- **L2 — Join buffer** (borrowed from Scalelite): a meeting created within `loadJoinBufferMinutes` (default 15) counts as at least `loadMinUserCount` (default 15) attendees.
- **L3 — No per-server multiplier column.** Hardware differences are expressed through each server's own `maxLoad`; selection ranks by utilisation `currentLoad / maxLoad`, not raw load.
- **L4 — `maxLoad` is a soft threshold.** Candidates under `maxLoad` are preferred; if none exist, the least-utilised healthy server is still selected (overflow) and a deduplicated `bbb-pool-saturated` ops alert fires. `capacity` stays the advisory hardware ceiling used by `CapacityIntelligenceService`.
- **L5 — Stale load is unknown, not zero.** A row whose `loadUpdatedAt` is null or older than `loadStaleAfterMinutes` (default 5) ranks after fresh rows but stays eligible. A poll failure never takes a server out of selection; the health probe owns `healthy`.
- **L6 — Optimistic increment** after a successful `/create`: atomic `currentLoad = currentLoad + loadMinUserCount`.
- **L7 — `currentLoad` is written only by `BbbServerLoadService` (poll) and the L6 increment.** `healthy` / `lastHealthCheckAt` remain written only by the health probe and failure bookkeeping.
- **L8 — Billing remains learner-hour based.** Billable usage is accumulated `learnerMinutes`, with moderators excluded according to the existing metering policy; monthly charge remains `round(sum(learnerMinutes × ratePaisePerHour) / 60)` in paise. A moderator-only metered meeting has zero variable usage charge.
- **L9 — Permission-aware navigation.** Infrastructure configuration (Servers and Capacity) lives under a BBB Settings section; cross-tenant operational screens (Organizations, Live Meetings, Trial Registrations) stay in a separate BBB Platform section. Each entry is gated by the narrowest permission the backend actually accepts; `BBBAdmin` compatibility is preserved. Tenant-scoped granular permissions are not given cross-tenant scope merely to make the menu visible.

## Permission-aware navigation decision

Granular `BBBManage*` permissions are tenant-scoped in `BbbChannelAccessService` (`isPlatformCaller` = `BBBAdmin` | `BBBPlatformInfrastructure` | `SuperAdmin`). They cannot express a cross-tenant platform scope, so cross-tenant BBB Platform items keep the platform gate (`BBBAdmin` | `BBBPlatformInfrastructure`). This is an authorization-model gap, documented rather than worked around. Servers and Capacity move under BBB Settings with the same platform gate.

## Retained learner-hour billing

Learner-hour pricing (`BbbMeteredUsage`, learner-minutes) is a locked product decision. This work protects it: no billing algorithm, ledger semantics, rate configuration, or grant-system changes. A moderator-only metered meeting has zero variable usage charge.

## Scalelite pre-adoption spike checklist (document only; do not build)

(a) Confirm `hooks/create` has no equivalent and decide how `meeting-ended` / recording-ready reach Saa9vi (per-node hooks need per-node secrets, which defeats the single endpoint; alternatives are BBB `meta_*` callback parameters, which must be tested through Scalelite).
(b) Check 2 (whether `getMeetingInfo` really requires `password`) through Scalelite.
(c) Set `SERVER_UNHEALTHY_THRESHOLD` high enough that a brief blip cannot trigger Scalelite's end-all-meetings behaviour, and test it.
(d) `GET_MEETINGS_API_DISABLED` must stay false (health, orphan scan and load all use `getMeetings`).
(e) Recordings: NFS volume, import pipeline, playback URLs through `getRecordings`.
(f) How per-node health, load and ownership remain visible to operators when `BbbServer` collapses to a single row (Scalelite's `getServers` admin API).
(g) Tenant secret for Saa9vi as a Scalelite tenant.
(h) A decision on `maxLoad` semantics, since Scalelite has none.

## Revisit triggers

Revisit Scalelite only if one of: native pool operational burden exceeds a documented threshold; multi-region BBB deployment is required; or the `hooks/create` + per-node secret model becomes unmaintainable. Until then, the native pool is the supported path.

## Consequences

- `BbbServer.currentLoad` is now a measured, unit-defined value (attendees) with a single writer (`BbbServerLoadService` plus the create-time increment).
- `maxLoad` remains a soft threshold (INV-012); selection never refuses a meeting solely for load.
- `maxConcurrentParticipants` (platform capacity policy) remains stored and displayed but enforced nowhere.
- Scalelite is not installed, configured, or integrated.
