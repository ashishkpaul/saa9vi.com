# BBB meeting lifecycle & revocation write-path trace (W5 follow-up)

**Purpose:** governance input — a complete map of who writes meeting state and who
revokes access, with the audit gaps a follow-up change would close. Read-only
trace: no behaviour changes are proposed here, only recorded facts and options.

**Scope date:** 2026-10-05, branch `feat/bbb-org-context` (post `5bb9764`).
**Governance follow-up recorded 2026-10-06:** G1 amended (`endedByUserId`
post-ack stamp, `e91b457`) and G2 closed (`33c7c96`); test-port allocation
(`444e3dd`) and the dashboard format parity + ratchet shrink (`850738e`)
landed the same day. Commit-sized details in `known-bugs.md` §BUG-056–058.

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
| 1 | `deleteBbbEntitlement` resolver (`bbb-admin.resolver.ts:1300`) | **soft revoke (2026-10-06, `33c7c96`): one schema-qualified UPDATE deactivating EVERY unexpired row of the natural key** — no hard delete; stamps first-writer-wins (`deactivatedAt`/`deactivatedByUserId` set only when unset) | `deactivatedByUserId` + `deactivatedAt` ✓ (G2 closed) |
| 2 | `BbbEntitlementService.delete` (`bbb-entitlement.service.ts:183`) | channel-scoped variant of the same multi-row revoke (rewritten 2026-10-06 to match #1) | stamps ✓ — **still zero callers, dead code** |
| 3 | `BbbDeletionService.removeFromChannel` / `fullDelete` | entitlements **expire** (`validUntil = now()`), enrollments `active=false`, trials `CANCELLED`, memberships off — privacy/erasure flow | **stamps `deactivatedByUserId` + `deactivatedAt` on both tables (2026-10-05, G1)** |
| 4 | `deactivateBbbEnrollment` resolver (`:1021`) | soft `active=false` | **stamps `deactivatedByUserId` + `deactivatedAt` (2026-10-05, G1)**; `assertEnrollmentAccess` ✓ |
| 5 | `createBbbEnrollment` upsert (`:1068`) | re-activation: `active=true`, `source='admin'` | **clears the deactivation stamp (2026-10-05, G1)** |
| 6 | `updateBbbTrialRegistrationStatus` (`:1160`) | trial `status` transitions | none; ADR-048 org-ownership assert ✓ |

`deactivatedBy`/`deactivatedAt`/`revokedBy`/`revokedAt` fields existed **nowhere**
in the plugin — verified by repo-wide search (2026-10-05, morning). **Superseded
the same day: G1 below is implemented** (`1791209870396-bbb-audit-trail.ts`,
CLI-generated + applied 2026-10-05) — `deactivatedByUserId`/`deactivatedAt`
now exist on both tables, and `startedByUserId`/`endedByUserId` were added to
`BbbMeeting` as part of the same approved migration.

## 3. ctx availability

Every writer in both tables receives `RequestContext` at its call site (resolver
`@Ctx()`, service parameter, or transaction manager bound to the request). Stamping
`ctx.activeUserId` + `new Date()` at revocation time is therefore mechanically
possible at all sites **without signature changes**.

## 4. Gaps a governance follow-up would close

- **G1 — no attribution. → CLOSED 2026-10-05 (approved migration applied).**
  Implemented shape (new rows only, no backfill):
  - nullable `deactivatedByUserId` + `deactivatedAt` on `BbbEnrollment` and
    `BbbEntitlement`, stamped at #3/#4 and cleared at #5 (re-activation);
  - nullable `startedByUserId` + `endedByUserId` on `BbbMeeting`
    (`startedByUserId` at meeting insert from `ctx.activeUserId`;
    **`endedByUserId` wording superseded 2026-10-06 (`e91b457`, BUG-056):**
    the stamp is now written POST-ACK by `endMeeting` — the requesting user,
    via a conditional `UPDATE … WHERE endedByUserId IS NULL` (first
    requester wins) after BBB acknowledges `/end` — and
    `completeMeetingLifecycle` keeps-first (`options ?? ctx.activeUserId ??
    null`), so later system completions cannot overwrite the human; a
    failed `/end` throws before the stamp and stays null, and
    webhook/reconciliation-only completions stay null);
  - SQL: CLI-generated via `npx vendure migrate -g bbb-audit-trail` →
    `src/migrations/1791209870396-bbb-audit-trail.ts` (six additive nullable
    `ALTER TABLE ... ADD` statements, reversible `down()`), applied with
    `npx vendure migrate -r` and verified against `information_schema.columns`;
  - surfaced on Platform › Live Meetings (`startedByUserId`/`endedByUserId`
    columns) and the tenant meeting detail `/bbb/meetings/$id`
    (new `meetingDetail` route — SessionDetail's previously dead
    "View Meeting Detail" link).
- **G2 — inconsistent entitlement semantics. → CLOSED 2026-10-06
  (`33c7c96`, BUG-057).** The admin mutation no longer hard-deletes (#1):
  revoke is **one UPDATE that deactivates every unexpired row** of the
  natural key with first-writer-wins stamps, so the columns survive and a
  live duplicate can never outlive a "successful" revoke; grant is
  `pg_advisory_xact_lock`-guarded (return an existing unexpired row else
  INSERT a new one — never reactivates, revoked rows keep stamps as
  history); `hasAccess` is **ANY** started+unexpired row across all rows of
  the key (`isEntitlementRowLive`/`anyEntitlementRowLive` on the entity);
  the erasure flow stamps only unstamped rows before expiring; the learning
  dashboard dedupes session rows and the entitlements list surfaces both
  rows (Revoked badge + re-grant). This is option (a)'s soft-revoke shape
  with the read-path filter folded into the shared helper — the ADR wording
  that option (a) required was updated the same day (`platform-adr.md`
  "Current status" + "Uniform access check"). One implementation note that
  cost a debugging cycle: raw SQL must be schema-qualified via
  `repo.metadata.tablePath` — a bare table name resolves through
  `search_path` (`public` in the e2e suites) and silently updates 0 rows in
  the configured schema. Evidence: isolation suite rewired to the widened
  spec (revoke stamps, re-grant inserts new, opposite insert orders,
  two-live-rows revoke, 4 concurrent grants → one live row, list both rows,
  cross-tenant revoke rejected) **110/110**.
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
  1018-1034, 1251-1350`, `services/bbb-deletion.service.ts:50-121`,
  `services/bbb-entitlement.service.ts:183-211`.
- Dead seams: `grep -rn transitionState src/` → definition only; entitlement
  `.delete(` search across consumers → no callers.
- FK check: `src/migrations/1790754309519-bbb-attendee-hour-billing-data-model.ts`.

