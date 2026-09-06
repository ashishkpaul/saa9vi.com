# Phase 3D.3 — Attendance Analytics: Domain Design (3D.3a)

Status: **ALL CHECKPOINTS COMPLETE (3D.3a–3D.3g).** Implementation is finished and E2E-verified on real PostgreSQL. See `docs/implementation/release-notes.md` for the 3D.3 release entry.

## 1. Grounding in existing code

The design reuses the established BBB integration boundary rather than inventing a parallel pipeline:

- **`bbb_webhook_event`** (`BbbWebhookEvent`): raw webhook persisted **before** any processing; failed events are never auto-deleted (manual admin replay); indexed by `bbbMeetingId` for replay lookup. This is the **immutable raw event store** for attendance.
- **`BbbMeetingService.handleWebhookEvent(ctx, eventType, payload)`**: resolves `BbbMeeting` by `bbbMeetingId` and dispatches on event type (`MEETING_ENDED`, `RECORDING_READY`, …). Attendance processing hooks in here as a new event-type branch — no new HTTP surface, no polling of BBB.
- **Precedent:** `updateTrialAttendanceForMeeting(ctx, meeting, payload)` already derives attendance for trial registrations at `MEETING_ENDED`. 3D.3 generalizes this pattern into a first-class, channel-scoped attendance fact for enrolled/entitled students.
- **Chain to scheduled sessions:** `BbbMeeting` → session linkage already used by trial attendance → `BbbScheduledSession`. The attendance fact stores both `meetingId` and `scheduledSessionId`.

## 2. The two-layer fact model (core decision)

```text
BBB webhook
   ↓
BbbWebhookEvent (immutable, already exists)
   ↓
attendance processing (new BullMQ / event branch)
   ↓
SessionAttendance — DERIVED, recomputable fact (PostgreSQL, authoritative)
   ↓
AttendanceAnalyticsService (queries/metrics)
   ↓
Admin reporting APIs (+ future Shop self-view)
   ↓
ES / retention signals — projection only, never authority
```

**`SessionAttendance` is NOT append-only** unlike `CommissionLedger`/`AdWalletLedger`. Attendance is analytical state that may legitimately be corrected when late/updated BBB events arrive. Immutability lives in the raw `BbbWebhookEvent` layer.

| Layer | Mutability | Role |
|---|---|---|
| `BbbWebhookEvent` | immutable (existing) | raw truth, replay source |
| `SessionAttendance` | upsert/recompute under controlled rules | derived authoritative fact |
| ES projection | derived | reporting/search convenience only |

## 3. Proposed `SessionAttendance` shape (to be finalized at 3D.3b)

```text
id
channelId            ← tenant scope (channel = tenant)
scheduledSessionId   ← links to BbbScheduledSession
meetingId            ← links to BbbMeeting
customerId           ← the student
joinedAt             ← first join
leftAt               ← last leave (nullable while live)
totalDurationSeconds ← aggregate of all join/leave cycles
cyclesCount          ← number of join/leave cycles
attendanceStatus     ← PRESENT | PARTIAL | NO_SHOW (threshold-based)
source               ← WEBHOOK | MANUAL_CORRECTION
lastEventAt
createdAt / updatedAt
```

**Uniqueness:** `UNIQUE (scheduledSessionId, customerId, channelId)` — one fact per student per session. Multiple join/leave cycles aggregate into this row; idempotency is enforced by this unique constraint plus a raw-event processing watermark on the aggregation.

## 4. Domain decisions (locked for implementation)

| Question | Decision |
|---|---|
| One row per student/session? | **Yes** — `UNIQUE (scheduledSessionId, customerId)` |
| Multiple join/leave cycles? | Aggregate durations into one fact; cycles counted; raw events retained for audit |
| Authoritative duration? | Derived from BBB lifecycle events, persisted in PG; recomputed on late events |
| Attendance thresholds? | Configurable (channel-level setting): minimum minutes AND/OR percentage of session duration → determines `PRESENT`/`PARTIAL`/`NO_SHOW` |
| No-show definition | Registered/entitled student with zero join events at session completion |
| Trial vs paid? | Record relationship via existing enrollment/entitlement linkage; do **not** duplicate access truth |
| Late-event correction | `MEETING_ENDED` finalizes; later correction events may recompute duration/status via `MANUAL_CORRECTION` source; audit trail = raw events |
| Channel isolation | Every query filtered by `ctx.channelId`; no cross-channel reads outside SuperAdmin operational reporting |
| ES | Projection only (future); PG is authority |
| Ranking | **Explicitly NOT connected to Bayesian ranking in 3D.3** — deferred future signal; preserves the 3D.1b baseline architecture and the `RankingMaterializedView` deferral rationale |

## 5. Event flow (3D.3b)

```text
BBB webhook received
   ↓
BbbWebhookEvent persisted (existing, unchanged)
   ↓
BbbMeetingService.handleWebhookEvent
   ├── user-join / user-left events  → enqueue attendance aggregation job
   └── MEETING_ENDED                 → finalize session attendance (existing trial path preserved)
   ↓
AttendanceAggregationService (idempotent upsert keyed on raw event)
   ↓
SessionAttendance upsert
   ↓
Vendure EventBus: SessionAttendanceUpdatedEvent (new, plugin-scoped)
```

- Aggregation must be **idempotent**: replaying the same `BbbWebhookEvent` must not double-count (watermark = last processed raw-event id per attendance row).
- No continuous BBB polling.
- Existing `updateTrialAttendanceForMeeting` behavior must remain unchanged (regression guard in E2E).

## 6. Analytics service contract (3D.3c)

```text
getSessionAttendance(ctx, sessionId)          → per-student facts (channel-scoped)
getCustomerAttendance(ctx, customerId)        → student's own history
getSessionAttendanceSummary(ctx, sessionId)   → registered / attended / noShow / attendanceRate / avgDuration
getChannelAttendanceSummary(ctx, from, to)    → operational reporting window
```

Metrics: `registered`, `attended`, `noShow`, `attendanceRate`, `averageDurationSeconds`, `completionRate`.

## 7. Security boundary (3D.3d)

```text
Tenant Admin  → own channel attendance only
Student (Shop)→ own attendance only (self-view)
SuperAdmin    → platform-wide operational reporting
```

**No public marketplace Shop API exposes individual student attendance of others.** Shop API may expose a student's own record only.

## 8. E2E acceptance matrix (3D.3e — real PG + Redis/BullMQ)

| Scenario | Expected |
|---|---|
| join → leave → MEETING_ENDED | one `SessionAttendance` row, correct duration, `PRESENT` |
| duplicate webhook event | no double-counted duration |
| late leave/correction event | duration/status recomputed, source = `MANUAL_CORRECTION` |
| registered but never joined + session ended | `NO_SHOW` |
| join cycles ×3 | cyclesCount = 3, duration = sum |
| Tenant A student attendance | invisible to Tenant B queries |
| student self-view | only own rows |
| existing trial attendance flow | unchanged (regression) |

## 9. Dashboard (3D.3f)

New Marketplace/Engagement route — do not modify native Vendure order pages:

```text
Marketplace
  └── Attendance
       ├── Overview (channel summary, date window)
       ├── Session detail (per-student table)
       └── Student detail
```

Use `@vendure/dashboard` public API (`defineDashboardExtension`) only.

## 10. Checkpoints

```text
3D.3a  this design doc                        ← COMPLETE
3D.3b  entity + migration (Vendure CLI) + aggregation service
3D.3c  AttendanceAnalyticsService
3D.3d  Admin + Shop (self-view) APIs
3D.3e  real-infrastructure E2E (matrix above)
3D.3f  dashboard extension
3D.3g  roadmap + release notes
```

Migration governance: entity change MUST be generated via Vendure CLI migration tooling and registered in `vendure-config.ts` per `.clinerules` §7–8.
