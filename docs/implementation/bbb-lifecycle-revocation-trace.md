# BBB meeting lifecycle & revocation write-path trace (W5 follow-up)

**Purpose:** governance input — a complete map of who writes meeting state and who
revokes access, with the audit gaps a follow-up change would close. Read-only
trace: no behaviour changes are proposed here, only recorded facts and options.

**Scope date:** 2026-10-05, branch `feat/bbb-org-context` (post `5bb9764`).

## 1. Meeting lifecycle — every state writer

| # | Writer | Transition | Guard | ctx |
|---|--------|-----------|-------|-----|
| 1 | `BbbMeetingService.createAndEnqueue` (resolver `createBbbMeeting`) | → `Pending` | `assertOrganizationAccess` in resolver | ✓ |
| 2 | `BbbProvisioningWorkerService` success (`.update()`) | `Provisioning` → `Active` | **none** — raw column write, no FSM assert | ✓ |
| 3 | `BbbProvisioningWorkerService` catch (`.update()`) | → `Failed` (+`failureReason`, `retryCount`) | **none** — raw column write | ✓ |
| 4 | `BbbMeetingService.endMeeting` (resolver `endBbbMeeting`) | requires `Active` | `assertMeetingAccess` + explicit state check; best-effort BBB `endMeeting`, then delegates to #5 | ✓ |
| 5 | `BbbMeetingLifecycleService.completeMeetingLifecycle` | → `Completed` (+`completedAt`, room → `Idle`) | **the single COMPLETED writer.** Inline idempotence: already-`Completed` skip (+ metric), non-`Active` skip. Sources: end-meeting, webhook `meeting-ended`, reconciliation confirmed-remote-end, 24 h ceiling branch | ✓ (tx manager) |
| 6 | `BbbMeetingLifecycleService` stale recovery | → `Stale` | `assertTransitionAllowed` (`MEETING_STATE_TRANSITIONS`) — **the only live call of the transition table** | ✓ |
| 7 | `BbbReconciliationService` audit fields | `lastReconciledAt`, `reconciliationAttemptCount` | channel-derived scan; confirmed end delegates to #5 | ✓ |
| 8 | `retryBbbMeeting` resolver | none — creates a **new** meeting; resets room FSM | `assertMeetingAccess` | ✓ |
| 9 | `deleteBbbMeeting` resolver → `meetingService.delete` | **hard `remove()` of any state, incl. `Active`** | `assertMeetingAccess` only — no state guard | ✓ |

**Billing facts survive meeting deletion by design:** `bbb_metered_usage.meetingId`
and `bbb_meeting_sample.meetingId` are plain `varchar` columns with no FK
(`1790754309519-bbb-attendee-hour-billing-data-model.ts:8-10`), so no cascade —
ledger immutability (INV-002) is not violated by #9.

### FSM seams that are dead or duplicated

- `BbbMeetingService.transitionState` + its private `assertTransitionAllowed`
  (`bbb-meeting.service.ts:155-174`) have **zero callers** — dead code.
- `BbbMeetingLifecycleService` carries its **own copy** of
  `assertTransitionAllowed` (`bbb-meeting-lifecycle.service.ts:75`), called once
  (stale recovery, `:253`).
- The edges `Pending → Provisioning` and `Provisioning → Active/Failed` are
  written as raw `.update()` calls by the provisioning worker, never checked
  against `MEETING_STATE_TRANSITIONS`. They are structurally legal today, but
  the table is not what enforces them.

## 2. Access revocation — every entitlement / enrollment writer

| # | Writer | Semantics | Audit stamp |
|---|--------|-----------|-------------|
| 1 | `deleteBbbEntitlement` resolver (`bbb-admin.resolver.ts:1272`) | **hard `delete(id)`** | none — row gone, no tombstone; `assertEntitlementAccess` ✓ |
| 2 | `BbbEntitlementService.delete` (`bbb-entitlement.service.ts:153`) | hard `delete` by natural key + channel | **zero callers — dead code** |
| 3 | `BbbDeletionService.removeFromChannel` / `fullDelete` | entitlements **expire** (`validUntil = now()`), enrollments `active=false`, trials `CANCELLED`, memberships off — privacy/erasure flow | none |
| 4 | `deactivateBbbEnrollment` resolver (`:1021`) | soft `active=false` | none; `assertEnrollmentAccess` ✓ |
| 5 | `createBbbEnrollment` upsert (`:1068`) | re-activation: `active=true`, `source='admin'` | none |
| 6 | `updateBbbTrialRegistrationStatus` (`:1160`) | trial `status` transitions | none; ADR-048 org-ownership assert ✓ |

`deactivatedBy`/`deactivatedAt`/`revokedBy`/`revokedAt` fields exist **nowhere**
in the plugin — verified by repo-wide search (2026-10-05).

## 3. ctx availability

Every writer in both tables receives `RequestContext` at its call site (resolver
`@Ctx()`, service parameter, or transaction manager bound to the request). Stamping
`ctx.activeUserId` + `new Date()` at revocation time is therefore mechanically
possible at all sites **without signature changes**.

## 4. Gaps a governance follow-up would close

- **G1 — no attribution.** Neither enrollment deactivation nor entitlement
  revocation records who or when. Proposed shape: nullable
  `deactivatedByUserId` + `deactivatedAt` on `BbbEnrollment` and
  `BbbEntitlement` (new rows only; no backfill), stamped at #4/#1 and cleared
  at #5 (re-activation).
- **G2 — inconsistent entitlement semantics.** The admin mutation hard-deletes
  (#1) while the erasure flow expires (#3). Columns cannot survive a hard
  delete, so G1 for entitlements requires either (a) unifying on soft-revoke
  (`revokedAt` + read-path filter in `hasAccess`) or (b) an append-only
  `BbbRevocationLog` row written before the delete. Option (a) changes access
  semantics and needs an ADR; option (b) is additive.
- **G3 — FSM single path.** Delete the dead `transitionState` seam or route the
  worker's raw edges through one guarded helper; today the transition table
  guards exactly one edge (stale recovery).
- **G4 — `deleteBbbMeeting` on a live meeting.** No state guard: deleting an
  `Active` meeting removes the row while BBB still runs it (reconciliation and
  webhook paths then find no row and warn). Consider refusing until ended.

## 5. Evidence

- Writers: `services/bbb-provisioning-worker.service.ts`,
  `services/bbb-meeting-lifecycle.service.ts:91-260`,
  `services/bbb-meeting.service.ts:155-174, 557-597, 1183-1187`,
  `services/bbb-reconciliation.service.ts`, `api/bbb-admin.resolver.ts:517-658,
  1018-1034, 1269-1280`, `services/bbb-deletion.service.ts:50-121`,
  `services/bbb-entitlement.service.ts:153-166`.
- Dead seams: `grep -rn transitionState src/` → definition only; entitlement
  `.delete(` search across consumers → no callers.
- FK check: `src/migrations/1790754309519-bbb-attendee-hour-billing-data-model.ts`.

