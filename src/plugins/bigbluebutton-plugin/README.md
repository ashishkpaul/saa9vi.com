# BigBlueButton Orchestration Plugin for Vendure 3.x

A production-grade, multi-tenant Vendure plugin that turns BigBlueButton into a sellable product. Sell meeting-hour plans, auto-provision live classrooms, grant access on purchase (or via trial conversion), and monitor everything from the Admin UI — without a single line of custom orchestration code.

> **Location:** this plugin ships **inside this repository** (`src/plugins/bigbluebutton-plugin`), not as a published npm package. Import it from its source path; see [Installation](#installation).
>
> **Two operational tiers.** *Tenant Admin* screens resolve their organization from the request context channel (Channel = Tenant, **INV-001**) and never choose one client-side; *Platform* screens (`Servers`, `Organizations`, platform capacity policies) cross tenants and require the platform-tier permission.

---

## Table of Contents

- [Real-World Usage Guide](#real-world-usage-guide)
- [Core Architecture](#core-architecture)
- [Data Model](#data-model)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Setup Order](#setup-order)
- [Meeting Lifecycle](#meeting-lifecycle)
- [Room Lifecycle](#room-lifecycle)
- [Enrollment, Entitlements & Access Control](#enrollment-entitlements--access-control)
- [Capacity Grants, Daily Allowance & Billing](#capacity-grants-daily-allowance--billing)
- [Scheduled Sessions & Templates](#scheduled-sessions--templates)
- [Capacity Policies & Capacity Intelligence](#capacity-policies--capacity-intelligence)
- [Trial Registrations & Conversion](#trial-registrations--conversion)
- [Attendance Analytics & Learning Dashboard](#attendance-analytics--learning-dashboard)
- [Security Model](#security-model)
- [Rate Limiting & Webhook Hardening](#rate-limiting--webhook-hardening)
- [Reconciliation Workers & Scheduled Tasks](#reconciliation-workers--scheduled-tasks)
- [Distributed Locking](#distributed-locking)
- [Observability & Metrics](#observability--metrics)
- [Domain Events](#domain-events)
- [Tenant & Subscription Lifecycle](#tenant--subscription-lifecycle)
- [Data Deletion & Erasure](#data-deletion--erasure)
- [Admin UI](#admin-ui)
- [GraphQL API Reference](#graphql-api-reference)
- [Tests](#tests)
- [Invariants, ADRs & Known Deviations](#invariants-adrs--known-deviations)
- [File Reference](#file-reference)
- [Roadmap](#roadmap)

---

## Real-World Usage Guide

This section explains how the plugin works in practice for common business models.

### Use Case 1 — Online Teaching Platform (Classrooms)

**Scenario:** A school sells "Math Class — 30 Days Access" as a Vendure product. When a student buys it, they get access to the Math Class Room and can join live sessions run by a trainer.

**How it maps to this plugin:**

```
Product Variant "Math Class — 30 Days"
  └── BbbProductAccess → BbbRoom "Math Class Room"   (accessDays: 30)
        │
        │   this mapping is also the AUTO-FULFILLMENT ELIGIBILITY GATE
        ▼
   Order reaches PaymentSettled
        └── bbbOrderProcess → autoFulfillBbbOrder()
              └── bbb-access-fulfillment handler  (grantedHours 10 / validityDays 30)
                    ├── BbbCapacityGrant  (600 min, valid 30 days)   ← org-level billing pool
                    └── BbbEntitlement    (bbb_room, source 'purchase',
                                           validUntil = now + accessDays)  ← room access
```

**Step-by-step setup:**

1. Create a BBB Server in Admin UI → Servers
2. Create an Organization in Admin UI → Organizations (one per Vendure channel/school)
3. Create a Room in Admin UI → Rooms (`Math Class Room`, slug: `math-class`)
4. Create a Vendure Product → ProductVariant (digital, e.g. "Math Class — 30 Days"). The variant screen has **no Fulfillment Handler field** — Price, Stock, Channels only — so do not look for BBB configuration there
5. In Admin UI → Enrollments, map the variant to the room via **Add Mapping** with `Access Days: 30`. This writes `BbbProductAccess` and is **required** — the automatic flow only fulfils variants it knows about (see [Automatic fulfillment (PaymentSettled)](#automatic-fulfillment-paymentsettled))
6. Add a trainer via Admin UI → Staff → Add Staff Member (role: `trainer`)
7. Student purchases the product → on `PaymentSettled` the order is fulfilled automatically: capacity grant + room access are written, with no operator action
8. Trainer clicks "Join" in storefront → gets moderator URL (is the presenter)
9. Student clicks "Join" → gets attendee URL

> **`grantedHours` / `validityDays` are not Product Variant fields** and are not read from the Shipping Method. They are the `bbb-access-fulfillment` handler's declared args, and the automatic path supplies its own values (10 h / 30 d today). The Shipping Method screen only *selects* the handler code. Full explanation: [Automatic fulfillment (PaymentSettled)](#automatic-fulfillment-paymentsettled).

**What happens when student clicks Join:**

```
bbbJoinRoom(roomId, participantName)
  → Room is Idle → transition to Provisioning
  → BullMQ job: select BBB server → check capacity grant → createMeeting on BBB
  → Room transitions to Active
  → Storefront polls bbbRoomStatus until Active
  → Student gets attendee join URL → joins BBB directly
```

---

### Use Case 2 — Consulting / On-Demand Sessions (Hour Bundles)

**Scenario:** A consulting firm sells "10-Hour Meeting Bundle" — buy once, use across any meeting the firm runs. No room, no enrollment — just capacity.

**How it maps:**

```
Product Variant "10-Hour Bundle"
  └── manually fulfilled with the bbb-access-fulfillment handler
        └── BbbCapacityGrant (600 minutes, 30 days)   ← that's it, no room access
```

> ⚠️ **Hour bundles are not auto-fulfilled today.** `autoFulfillBbbOrder()` is deliberately BBB-only: a line is eligible when its variant maps to a `BbbRoom` (`BbbProductAccess`) or to a `BbbScheduledSession`. `BbbProductAccess.roomId` is `NOT NULL`, so there is no "capacity-only mapping" — a bundle variant that maps to nothing is left untouched at `PaymentSettled`. Fulfil those orders explicitly with the `bbb-access-fulfillment` handler (Admin UI or `addFulfillmentToOrder`), or attach the bundle to a session — see [Automatic fulfillment (PaymentSettled)](#automatic-fulfillment-paymentsettled).

Consultants are added as Staff members (TRAINER/ORG_ADMIN). They create meetings directly from Admin UI → Meetings → Create Meeting, which provisions on-demand. (The create-target organization picker on that screen is a recorded legacy deviation — see [Known deviations](#invariants-adrs--known-deviations).)

**Key difference from Use Case 1:** No `BbbProductAccess` or `BbbEnrollment`. Capacity is pooled across all meetings the org runs. The grant is consumed per meeting-hour at session close.

---

### Use Case 3 — Scheduled Webinar (Fixed Time Slot)

**Scenario:** A live webinar is scheduled for a specific date/time. Only a trainer can start it within the time window. Students can see the scheduled slot and join once it's live.

**How it maps:**

```
BbbScheduledSession
  ├── startTime / endTime
  ├── trainer (BbbOrganizationMember)
  └── activeMeeting (BbbMeeting, nullable — linked when provisioning is requested)
```

**Flow:**
1. Admin creates `BbbScheduledSession` (title, startTime, endTime, trainerId) → status `DRAFT`
2. Admin publishes it via `publishBbbScheduledSession` → `SCHEDULED`, the session becomes visible to learners (INV-021)
3. Storefront shows it through `myScheduledSessions` (entitled/session-scoped learners) or `publicScheduledSessions` (public discovery)
4. Trainer calls `startScheduledSession(sessionId)` at start time
5. `startScheduledSession` creates a **Pending** meeting, links it to the session, and enqueues provisioning (session **stays SCHEDULED**)
6. The BullMQ worker calls BBB `createMeeting`; on success the meeting becomes **Active**
7. `BbbSessionProvisioningListener` (on `MeetingProvisionedEvent`) transitions the session SCHEDULED → **LIVE**
8. Learners read `myLearningDashboard` for `joinUrl` — join authorization requires the session to be **LIVE** *and* its meeting to be **Active**
9. On provisioning failure the meeting becomes **Failed** and the session remains SCHEDULED
10. Session auto-transitions to FINISHED when endTime passes

> Need a series instead of one slot? Create a `BbbSessionTemplate` and fan out `DRAFT` sessions with `createSessionsFromTemplate` — see [Scheduled Sessions & Templates](#scheduled-sessions--templates).

---

### Understanding the Capacity Grant System

This is the most important concept to understand before going to production.

A `BbbCapacityGrant` is **time-based credit** for an organization. Think of it like a pre-paid minute bundle for a phone plan.

```
Organization "Acme Academy"
  ├── Grant A: 600 minutes, valid Jun 1–Jun 30  (from order #101)
  ├── Grant B: 300 minutes, valid Jun 15–Jul 15 (from order #102)
  └── Grant C: 600 minutes, valid Jul 1–Jul 31  (from manual admin)
```

**Rules:**
- Grants are picked **earliest-expiry-first** at provisioning time (not billing time)
- Only **tenant-selectable** source types are considered (`order`, `subscription`). `internal_overhead` capacity is ops/internal headroom — it is never selected for a tenant session (BUG-036)
- Once a meeting is provisioned, it is **permanently linked** to that grant (`grantId` is immutable). Mid-meeting grant changes do not affect billing
- A meeting under 2 minutes is **not billed** (fair billing guard)
- Usage is billed in **whole minutes** — actual duration, not rounded hours
- When `consumedMinutes >= grantedMinutes`, the grant is marked `exhausted = true` and excluded from future provisioning. `isUnbounded` grants never exhaust and report Infinity remaining (`grantedMinutes: -1` is a sentinel, not a quantity)
- If no selectable grant exists in-window → provisioning fails with `"No active capacity grant found for this organization. Please purchase or renew a plan."`
- If an in-window commercial grant exists but is exhausted → provisioning fails with `"Your plan's meeting minutes for this period are exhausted. Please purchase or renew a plan to continue."` (distinct from "no grant at all" since `d711940`)

**Managing grants from the Admin UI:**

Go to **Admin UI → BigBlueButton → Capacity Grants** (`/bbb/plans`). You can:
- See remaining hours at a glance (summary bar)
- Add a new plan (hours + validity days) without touching GraphQL
- See which grants came from purchases, subscriptions, the daily allowance, or manual admin additions
- See the colour-coded usage bar per grant (green → amber at 75% → red at 100%)

> **Operational tip:** Set a calendar reminder when purchased grants expire. There is no automatic renewal for one-off purchases — a student buying a new plan auto-creates a grant via the fulfillment handler, but admin-created grants must be renewed manually. Provider-free (Free Basic) tenants do not need this: their 60-minute allowance is written every day by the `bbb-daily-allowance` task.

---

### Common Operational Issues and Solutions

| Symptom | Cause | Fix |
|---------|-------|-----|
| `"Your plan's meeting minutes for this period are exhausted…"` in meeting log | An in-window commercial grant is exhausted (`consumedMinutes >= grantedMinutes`) | Admin UI → Capacity Grants → Add Plan |
| `"No active capacity grant found for this organization"` | No *tenant-selectable* grant in-window — all expired, or the org has only its auto-created `internal_overhead` grant | Add a new grant in Admin UI → Capacity Grants |
| `"Couldn't start session"` on storefront | Room stuck in `Failed` state | Admin UI → Rooms → (room is in Failed state — `resetBbbRoom` mutation or delete+recreate) |
| Meeting stays in `Pending` forever | Provisioning job lost (worker restart during job) | Reconciliation worker auto-retries after 5 min. Check worker logs. |
| Room shows `retryCount: 3`, no Retry button effect | `maxAutoRetries` reached; room is in `Failed` | Use `resetBbbRoom` mutation from GraphiQL, then try again |
| Student can't join after buying | `BbbProductAccess` not mapped to the variant | Admin UI → Enrollments → Add Mapping for the variant |
| Trainer joins as attendee, not moderator | Customer not added as Staff member | Admin UI → Staff → Add Staff Member with TRAINER role |

---

## Core Architecture

The plugin separates the **Commerce Domain** (Products, Orders, Payments) from the **Infrastructure Engine** (BBB servers, meeting FSM, room state) so your commerce node is never blocked by external video conferencing round-trips.

```
[ Vendure Channel ]  ── 1:1 (INV-001) ──►  [ BbbOrganization ]
                                                │
                                                ├──► [ BbbCapacityGrant ]   (billing pool)
                                                │         ▲
                                                │         │ daily-allowance writer (ADR-045)
                                                │
                                                ├──► [ BbbRoom ]            (persistent space)
                                                │         │
                                                │         ├──► [ BbbMeeting ]      (FSM — live token)
                                                │         ├──► [ BbbProductAccess ] (variant → room)
                                                │         └──► [ BbbEnrollment ]    (legacy room access, admin-only)
                                                │
                                                └──► [ BbbScheduledSession ] (calendar slot, INV-021)
                                                          ▲        │
                                       [ BbbSessionTemplate ]        ├──► [ BbbMeeting ]  (on start)
                                          (factory, INV-023)         └──► [ SessionAttendance ]
                                                                              ▲
                                                     [ BbbEntitlement ] ──────┘  (access primitive, INV-003)
```

### Separation of Concerns

```
Organization
 ├── Staff (ORG_ADMIN / TRAINER roles, BbbOrganizationMember/-Membership) → join as moderator
 ├── Rooms
 │     └── Enrollments / room entitlements (students via purchase)        → join as attendee
 └── Scheduled sessions
       └── Session entitlements (purchase / trial / trial_conversion)     → join as attendee
```

Students are **not** Organization Members. They reach rooms through a `bbb_room` `BbbEntitlement` written at `PaymentSettled` (plus the admin-only legacy `BbbEnrollment`) and sessions through a `bbb_session` `BbbEntitlement` (the ADR-targeted access primitive — INV-003). Keeping staff membership and learner access separate prevents org-level access escalation: a student buying one course cannot see or affect other rooms or sessions.

---

## Data Model

The plugin registers **19 domain entities** (`Bbb*` prefix; tables are `bbb_*`) plus two platform-tier entities it participates in (`EventLog`, `CustomerDeletionLog`).

### Infrastructure & tenancy

| Entity | Table | Purpose |
|--------|-------|---------|
| `BbbServer` | `bbb_server` | BBB host with AES-256-GCM encrypted API secret + capacity ceiling |
| `BbbOrganization` | `bbb_organization` | Tenant workspace, bound 1:1 to a Vendure Channel (INV-001) |
| `BbbOrganizationMember` | `bbb_organization_member` | Staff (ORG_ADMIN / TRAINER) linked to a Customer — moderator access |
| `BbbOrganizationMembership` | `bbb_organization_membership` | Formal membership record (FEAT-001), unique on `(organizationId, customerId)` |
| `BbbPlatformCapacityPolicy` | `bbb_platform_capacity_policy` | Plan-tier / channel infrastructure ceiling (ADR-031) |

### Rooms & meetings

| Entity | Table | Purpose |
|--------|-------|---------|
| `BbbRoom` | `bbb_room` | Persistent reusable classroom with its own FSM (optimistic lock via `version`) |
| `BbbMeeting` | `bbb_meeting` | Transient live session on a BBB server — meeting FSM + encrypted passwords + immutable `grantId` |
| `BbbProductAccess` | `bbb_product_access` | Maps a ProductVariant → `BbbRoom` (one variant, one room) |

### Sessions & attendance

| Entity | Table | Purpose |
|--------|-------|---------|
| `BbbScheduledSession` | `bbb_scheduled_session` | Calendar reservation with fixed access window; `DRAFT\|SCHEDULED\|LIVE\|FINISHED\|CANCELLED` (INV-021) |
| `BbbSessionTemplate` | `bbb_session_template` | Factory entity that generates series/draft sessions (INV-023) |
| `BbbInstructorAssignment` | `bbb_instructor_assignment` | Instructor ↔ scheduled-session assignment |
| `BbbTrialRegistration` | `bbb_trial_registration` | Trial seat request; `REGISTERED\|ATTENDED\|CANCELLED\|NO_SHOW` |
| `SessionAttendance` | `session_attendance` | Per-student attendance facts (`PRESENT\|PARTIAL\|NO_SHOW`) from webhook cycles |

### Access & billing

| Entity | Table | Purpose |
|--------|-------|---------|
| `BbbEntitlement` | `bbb_entitlement` | Canonical access primitive (INV-003): `bbb_session` \| `bbb_room`, scalar `channelId` for isolation |
| `BbbEnrollment` | `bbb_enrollment` | Legacy/manual room access — written only by the admin `createBbbEnrollment` mutation; unique on `(roomId, customerId)` |
| `BbbCapacityGrant` | `bbb_capacity_grant` | Purchased, subscription, daily-allowance or manual minute credit |
| `BbbUsageLedger` | `bbb_usage_ledger` | Immutable usage fact (INV-002), unique on `(meeting, grant)` |
| `BbbWebhookEvent` | `bbb_webhook_event` | Inbound webhook persisted before processing (INV-004) with processing status |
| `BbbCapacityAlertLog` | `bbb_capacity_alert_log` | Audit row per capacity forecast sweep (`none\|plan\|soon\|immediate`) |

> **Access layering.** There are three distinct ways a customer reaches a session — staff membership (`BbbOrganizationMember` / `BbbOrganizationMembership`) → moderator URL; entitlement (`BbbEntitlement`) → attendee URL; legacy room enrollment (`BbbEnrollment`, now created only by the admin `createBbbEnrollment` mutation) → attendee URL. `BbbEntitlement` is the ADR-targeted primitive going forward (INV-003); new code reads entitlements first and `myBbbEnrollments` is **deprecated** in the Shop API.

### Key Entity Details

#### BbbCapacityGrant

| Field | Type | Notes |
|-------|------|-------|
| `organization` | relation | Owning org |
| `orderId` | string (nullable) | Set by fulfillment handler; null for admin-manual grants |
| `orderLineId` | string (nullable) | Idempotency key — prevents duplicate grants on fulfillment retry |
| `grantedMinutes` | int | Total minutes purchased (UI displays as hours) |
| `consumedMinutes` | int | Atomically incremented at session close |
| `validFrom` | DateTime | Grant becomes available |
| `validUntil` | DateTime | Grant expires (earliest-expiring picked first) |
| `exhausted` | boolean | Set when `consumedMinutes >= grantedMinutes` |

#### BbbRoom

| Field | Type | Notes |
|-------|------|-------|
| `state` | enum | `Idle` → `Provisioning` → `Active` → `Failed` |
| `currentMeetingId` | string (nullable) | FK to active BbbMeeting; null when Idle/Failed |
| `retryCount` | int | Auto-retry count; room enters `Failed` when `>= maxAutoRetries` |
| `version` | int | Optimistic lock — prevents double-provisioning |
| `lastProvisionRequestedAt` | DateTime | Debounce tracking (15s window) |

#### BbbMeeting

| Field | Type | Notes |
|-------|------|-------|
| `state` | enum | `Pending` → `Provisioning` → `Active` → `Completed` → `Archived` / `Failed` |
| `grantId` | string | **Immutable** — set at provisioning time, never changes |
| `encryptedAttendeePassword` | string | AES-256-GCM, `select: false` |
| `encryptedModeratorPassword` | string | AES-256-GCM, `select: false` |
| `billingCapped` | boolean | True if meeting duration exceeded grant remainder |
| `failureReason` | string | Human-readable provisioning failure detail |

#### BbbEnrollment

| Field | Type | Notes |
|-------|------|-------|
| `roomId` | string | Enrolled room |
| `customerId` | string | Vendure Customer.id |
| `active` | boolean | Deactivated by `deactivateBbbEnrollment`, re-activated by the `createBbbEnrollment` upsert |
| `validFrom` | DateTime | Access start |
| `validUntil` | DateTime | Access expiry (null = lifetime) |
| `source` | enum | `purchase` (column default) \| `admin` \| `invite` \| `import` \| `trial_conversion` — only `admin` is written today |

Unique index on `(roomId, customerId)` — the admin upsert re-activates an existing row instead of duplicating it.

> **Source-level drift to be aware of:** the entity still carries a comment stating enrollments should "continue using for paid fulfillments only", but the fulfillment handler writes `bbb_room` **entitlements** instead — so `createBbbEnrollment` (Admin API) is the only writer of this table today.

#### BbbOrganizationMember roles

| Role | Capabilities |
|------|-------------|
| `ORG_ADMIN` | Buy plans, manage members, create meetings, join as moderator |
| `TRAINER` | Create meetings, join as moderator (presenter controls in BBB) |

#### BbbOrganization (key fields)

| Field | Notes |
|-------|-------|
| `channelId` | Unique — one organization per Channel (INV-001) |
| `tenantProfileId`, `ownerUserId` | Tenant identity wiring from the tenant plugin |
| `slug`, `name` | Unique slug, display name |
| `concurrentMeetingLimit` | Enforcement surface for simultaneous live meetings. Defaults to 5; overwritten by plan-derived capacity **only** when the policy source is `plan` or `channel-override` (ADR-031) |
| `maxParticipantsPerMeeting` | Room participant ceiling |
| `maxSessionsPerOrg` | Atomic session-creation cap (INV-022) |
| `recordingEnabled`, `suspended` | Feature flags / tenant suspension |

#### BbbEntitlement

| Field | Notes |
|-------|-------|
| `type` | `bbb_session` (session-scoped products) or `bbb_room` (room-scoped products) — both written by the purchase flow; `bbb_room` is also read alongside legacy `BbbEnrollment` |
| `resourceId` | The granted resource (e.g. `BbbScheduledSession.id`) |
| `customerId` | Vendure `Customer.id`; indexed with `type` + `resourceId` |
| `source` | `purchase` \| `trial` \| `trial_conversion` \| `admin` \| `import` |
| `validFrom` / `validUntil` | Nullable; `null` = immediate / no expiry |
| `channelId` | Scalar, not a Channel junction — deliberate isolation without ChannelAware (INV-001) |

#### BbbScheduledSession

| Field | Notes |
|-------|-------|
| `status` | `DRAFT` (default) → `SCHEDULED` → `LIVE` → `FINISHED`, or `CANCELLED` |
| `organizationId` + `slug` | Unique together |
| `startTime` / `endTime` | Access window; trainer start is only allowed inside it |
| `activeMeeting` | Nullable link to the provisioned `BbbMeeting` |
| `trainer` | `BbbOrganizationMember` who presents |

#### BbbSessionTemplate

| Field | Notes |
|-------|-------|
| `defaultTitle`, `defaultTrainerId`, `defaultSubjectTags`, `defaultVisibility` | Defaults applied to each generated session |
| `durationMinutes` | `endTime = startTime + durationMinutes` per occurrence |
| `productVariantId` | Optional commerce linkage |
| `organizationId`, `channelId` | Tenancy scope |

#### BbbTrialRegistration

| Field | Notes |
|-------|-------|
| `status` | `REGISTERED` → `ATTENDED` / `CANCELLED` / `NO_SHOW` (also settable from the Admin UI) |
| `sessionId`, `customerId` | The trial seat |
| Conversion | `convertTrialToEnrollment(registrationId, roomId, accessDays)` issues a `bbb_room`-admitting entitlement with `source: trial_conversion` |

#### SessionAttendance

| Field | Notes |
|-------|-------|
| `attendanceStatus` | `PRESENT` \| `PARTIAL` \| `NO_SHOW` |
| `source` | `WEBHOOK` \| `MANUAL_CORRECTION` |
| `joinedAt`, `leftAt`, `totalDurationSeconds`, `cyclesCount` | Accumulated across attendance cycles, not first/last-join only |
| `lastProcessedWebhookEventId` | Idempotency anchor for replayed webhooks (INV-004) |

#### BbbWebhookEvent

| Field | Notes |
|-------|-------|
| payload | Stored raw (`simple-json`) **before** processing (INV-004) |
| processing status | Defaults to `PENDING`, `processedAt` set on success; failures recorded for replay |

#### BbbPlatformCapacityPolicy

| Field | Notes |
|-------|-------|
| `channelId` / `subscriptionPlanId` | Partial-unique per target; both null = global platform default |
| `defaultRoomCapacity`, `maxRoomCapacity`, `maxConcurrentParticipants`, `maxConcurrentMeetings` | Infrastructure ceilings (ADR-031, INV-015) |
| Precedence | plan-matched → channel override → platform default → fallback |

---

## Prerequisites

- **Vendure 3.x** (`>=3.0.0`)
- **BigBlueButton 3.x** server (URL + API secret from `bbb-conf --secret`)
- **PostgreSQL** (primary database)
- **Redis** (distributed room locking + BullMQ job queue)
- **`BBB_ENCRYPTION_KEY`** environment variable (64-char hex)

Generate the encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Installation

### 1. Register the plugin

This plugin lives in this repository — there is no published npm artifact, so import it by source path:

```ts
// src/vendure-config.ts
import { BigBlueButtonPlugin } from "./plugins/bigbluebutton-plugin";
```

Entities are registered by the plugin decorator itself, so no extra entry is needed in `dbConnectionOptions.entities`. Schema changes land as generated TypeORM migrations in `src/migrations/` (registered globally via `dbConnectionOptions.migrations`) and are applied with the Vendure CLI — never hand-written (see [Invariants, ADRs & Known Deviations](#invariants-adrs--known-deviations)).

### 2. Environment Variables

```env
# Required
BBB_ENCRYPTION_KEY="your_64_char_hex_key_here"

# Redis (for distributed locking and BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=           # optional

# Storefront URL (used in meeting logout redirect)
STOREFRONT_URL=https://your-store.com

# ─── Optional tuning (all have sensible defaults) ──────────────────────

# Distributed locking
BBB_ROOM_LOCK_STRICT=false          # true = Redis failure blocks provisioning
# BBB_LOCK_TTL_SECONDS=30
# BBB_LOCK_HEARTBEAT_INTERVAL_MS=10000

# Room provisioning behaviour
# BBB_PROVISION_DEBOUNCE_MS=15000   # suppress rapid re-join clicks
# BBB_RUNTIME_VALIDATION_TTL_MS=10000
# BBB_MAX_AUTO_RETRIES=3            # retries before room needs manual reset
# BBB_MEETING_GRACE_PERIOD_MS=90000 # trust DB state after provisioning

# Reconciliation
# BBB_STUCK_PROVISIONING_TIMEOUT_MS=300000
# BBB_FAIR_BILLING_MIN_DURATION_MS=120000  # sessions under this are free
# BBB_ROOM_STALE_TIMEOUT_MS=300000

# BullMQ job
# BBB_PROVISIONING_JOB_RETRIES=3
# BBB_PROVISIONING_JOB_BACKOFF_MS=5000

# ─── Webhook hardening (optional) ─────────────────────────────────────
# Comma-separated allowlist of BBB server IPs that skip webhook rate limiting.
# Unknown IPs are always limited (100 req/min) — never trusted implicitly.
# BBB_WEBHOOK_ALLOWED_IPS=203.0.113.10,203.0.113.11
```

Additional environment variables read elsewhere in the codebase and consumed by this plugin's flows: `DB_*` (queue/worker context schemas in E2E), and the `*_E2E` gates used to opt specific E2E suites in (`DAILY_ALLOWANCE_E2E`, `ATTENDANCE_E2E`, `BBB_USAGE_LEDGER_E2E`, `MEETING_CONCURRENCY_E2E`, `PLAN_CAPACITY_E2E`, `R4_E2E`).

### 3. Vendure Config

```ts
// vendure-config.ts
import { BigBlueButtonPlugin } from './plugins/bigbluebutton-plugin';

export const config: VendureConfig = {
  plugins: [
    BigBlueButtonPlugin.init({
      meetingIdPrefix: 'bbb',
      attendeeJoinUrlTtlSeconds: 86400,  // 24 hours
      runScheduledTasks: true,           // registers reconciliation scheduler
      maxAutoRetries: 3,                 // increase for dev/test environments
    }),
  ],
};
```

### Plugin Options Reference

```ts
interface BigBlueButtonPluginOptions {
  storefrontUrl?: string;              // Public storefront base URL for BBB logoutURL (falls back to STOREFRONT_URL)
  meetingIdPrefix?: string;            // Prefix for BBB meeting IDs (default: "bbb")
  attendeeJoinUrlTtlSeconds?: number;  // Join URL TTL in seconds (default: 86400)
  runScheduledTasks?: boolean;         // Register reconciliation scheduler (default: true)

  // Tenant provisioning (ADR-047 Phase 3)
  defaultRooms?: string[];             // Rooms seeded per new organization (default: ["Main Classroom"])
                                       // Idempotent: seeds only while the org has zero rooms.
                                       // [] = seed nothing (explicit opt-out).

  // Redis
  redisHost?: string;                  // Falls back to REDIS_HOST env
  redisPort?: number;                  // Falls back to REDIS_PORT env
  redisPassword?: string;              // Falls back to REDIS_PASSWORD env
  roomLockStrict?: boolean;            // Redis failure blocks provisioning (default: false)

  // Lock timing
  lockTtlSeconds?: number;             // default: 30
  lockHeartbeatIntervalMs?: number;    // default: 10000

  // Room provisioning
  provisionDebounceMs?: number;        // default: 15000
  runtimeValidationTtlMs?: number;     // default: 10000
  maxAutoRetries?: number;             // default: 3
  meetingGracePeriodMs?: number;       // default: 90000

  // Reconciliation
  stuckProvisioningTimeoutMs?: number; // default: 300000
  fairBillingMinDurationMs?: number;   // default: 120000
  roomStaleTimeoutMs?: number;         // default: 300000

  // BullMQ provisioning job
  provisioningJobRetries?: number;     // default: 3
  provisioningJobBackoffMs?: number;   // default: 5000

  // Orphan protection
  maxMeetingDurationMs?: number;       // default: 86400000 (24 h) — force-complete + cap billing

  // Capacity intelligence load estimation (CI-001, advisory only — INV-012)
  cameraRatio?: number;                // default: 0.40 — share of attendees expected on camera
  micRatio?: number;                   // default: 0.70 — share expected unmuted
  videoWeight?: number;                // default: 3 — PILOS virtual-load weight per video stream
  micWeight?: number;                  // default: 2 — weight per mic stream
  listenerWeight?: number;             // default: 1 — weight per listen-only attendee
}
```

### 4. Run Migrations

```bash
npx vendure migrate
```

---

## Setup Order

Follow this order exactly — each step depends on the previous.

### Step 1 — Add a BBB Server

From Admin UI → Servers → Add Server, or via GraphQL:

```graphql
mutation {
  createBbbServer(input: {
    name: "Primary Server"
    apiUrl: "https://bbb.yourserver.com/bigbluebutton"
    apiSecret: "your-secret-from-bbb-conf-secret"
    maxLoad: 100
  }) { id name healthy }
}
```

The API secret is AES-256-GCM encrypted before storage and never exposed via any API.

### Step 2 — Create an Organization

One organization per Vendure Channel (school, company, team):

```graphql
mutation {
  createBbbOrganization(input: {
    channelId: "1"
    slug: "acme-academy"
    name: "Acme Academy"
    concurrentMeetingLimit: 5
    maxParticipantsPerMeeting: 30
  }) { id slug }
}
```

### Step 3 — Create a Room (for classroom use cases)

```graphql
mutation {
  createBbbRoom(input: {
    organizationId: "org-id"
    name: "Math Class Room"
    slug: "math-class"
    description: "Weekly math sessions"
    maxParticipants: 20
  }) { id name slug }
}
```

### Step 4 — Create a Product + Map to Room

1. Create a **Product** with a **ProductVariant** in Vendure (digital, no stock tracking). There is no BBB fulfillment field on the variant — do not look for one there
2. In Admin UI → Enrollments, map the variant to the room via **Add Mapping** (`Access Days`, e.g. `30`). This writes `BbbProductAccess` — the room-access mapping **and** the auto-fulfillment eligibility gate. Room-access duration (`accessDays`) is configured only here
3. *(optional)* In Settings → Shipping Methods, select `Grants BigBlueButton meeting access to organization` as the **Fulfillment handler**, so that manual fulfillments from the Admin UI pre-select it. The Shipping Method stores only the handler *code* — changing it never changes what an automatic purchase grants
4. For automatic BBB orders, reaching `PaymentSettled` invokes `bbb-access-fulfillment` with the current pinned grant policy — `grantedHours: 10`, `validityDays: 30` → a 600-minute grant valid 30 days. See [Automatic fulfillment (PaymentSettled)](#automatic-fulfillment-paymentsettled)

> The handler resolves the organization from the **request channel** (`ctx.channelId` → `BbbOrganization`, INV-001). If the channel has no organization it logs `bbbFulfillmentHandler: No BbbOrganization for channel …` and skips that line — so create the organization (step 2) before publishing products.

```graphql
mutation {
  createBbbProductAccess(input: {
    roomId: "room-id"
    productVariantId: "variant-id"
    accessDays: 30
  }) { id }
}
```

Purchasing this product now automatically:
- Creates a `BbbCapacityGrant` (600 minutes, valid 30 days) for the org
- Creates a `bbb_room` `BbbEntitlement` for the buyer (`validUntil = now + accessDays`)
- Writes a `Fulfillment` row with `handlerCode = bbb-access-fulfillment` — see [Automatic fulfillment (PaymentSettled)](#automatic-fulfillment-paymentsettled)

### Step 5 — Add Staff Members

```graphql
mutation {
  addBbbMember(input: {
    organizationId: "org-id"
    customerId: "trainer-customer-id"
    role: "trainer"
  }) { id role active }
}
```

Or use Admin UI → Staff → Add Staff Member.

### Step 6 — Add an Initial Capacity Plan (if needed)

For dev/test or admin-only orgs without a purchase flow, add a plan manually from Admin UI → Capacity Grants → Add Plan. **Platform permission required** (`BBBPlatformInfrastructure`, or the coarse `BBBAdmin`): minting capacity is a platform act, not a tenant one — a tenant admin's call is rejected (H2 / SEC-008), and the `Capacity Grants` nav item is platform-only.

```graphql
mutation {
  createBbbCapacityGrant(input: {
    organizationId: "org-id"
    grantedMinutes: 600
  }) { id grantedMinutes validUntil }
}
```

### Step 7 — Configure BBB Webhooks

In your BBB server's `bbb-web.properties`:

```properties
hooks.default.serverUrl=https://your-vendure.com/bbb/webhook
```

Webhook endpoint: `POST /bbb/webhook`. Optionally allowlist your BBB server IPs via `BBB_WEBHOOK_ALLOWED_IPS` so known senders bypass rate limiting.

### Step 8 (optional) — Infrastructure ceilings per plan tier (ADR-031)

Only needed when you want plan-derived capacity instead of per-organization values set by hand. Platform infrastructure permission required.

```graphql
mutation {
  upsertPlatformCapacityPolicy(input: {
    subscriptionPlanId: null        # null = the platform-default row
    defaultRoomCapacity: 25
    maxRoomCapacity: 100
    maxConcurrentParticipants: 50
    maxConcurrentMeetings: 5
  }) { id subscriptionPlanId maxConcurrentMeetings }
}
```

Verify the effective resolution for a channel before enabling adoption:

```graphql
query { effectiveCapacityPolicy(channelId: "1") { ... on EffectiveCapacityPolicy {
  defaultRoomCapacity maxRoomCapacity maxConcurrentParticipants maxConcurrentMeetings source
} } }
```

A `platform-default` or `fallback` answer never overwrites an Admin-set `BbbOrganization.concurrentMeetingLimit`; only `plan` and `channel-override` do.

### Step 9 (optional) — Session templates and publishing

Sessions are **not** bookable until published (INV-021). Templates are factories, not bookings (INV-023) — generating from a template always produces `DRAFT` sessions.

```graphql
mutation {
  createBbbSessionTemplate(input: {
    organizationId: "org-id"
    name: "Weekly Algebra"
    defaultTitle: "Algebra — Live"
    defaultTrainerId: "member-id"
    durationMinutes: 60
    defaultVisibility: "enrolled"
  }) { id name durationMinutes }
}

mutation {
  createSessionsFromTemplate(
    templateId: "template-id"
    startTimes: ["2026-07-01T09:00:00Z", "2026-07-08T09:00:00Z"]
  ) { id status startTime endTime }
}

mutation { publishBbbScheduledSession(id: "session-id") { id status } }  # DRAFT → SCHEDULED
```

### Step 10 — Verify

1. Admin UI → `/bbb/servers`: the server row reports `healthy`, `currentLoad`, `maxLoad`, `capacity`.
2. Admin UI → `/bbb/rooms` (or Sessions for the scheduled path): join as staff and confirm a moderator URL is returned.
3. Confirm billing landed: Admin UI → `/bbb/plans` shows increased consumed minutes and `/bbb/sessions/$id` shows the session's meeting state.

---

## Meeting Lifecycle

### FSM Transitions

```
             ┌──────────┐
             │  Pending │ ◄── createBbbMeeting / createRoomMeetingAndEnqueue
             └────┬─────┘        ▲
                  │ BullMQ worker picks up job      │ retryBbbMeeting (Failed → Pending)
             ┌────▼──────────┐   │
       ┌─────┤ Provisioning  │───┘ (provisioning failure)
       │     └────┬──────────┘
       │          │ BBB createMeeting succeeds
       │     ┌────▼──────┐
       │     │  Active   │ ◄── participants can join
       │     └────┬──────┘
       │          │ webhook / reconciliation / endBbbMeeting / stale-active-runtime
       │     ┌────▼────────┐
       │     │  Completed  │ ◄── billing runs here
       │     └────┬────────┘
       │          │
       │     ┌────▼────────┐
       │     │  Archived   │   (terminal)
       │     └─────────────┘
       │
  ┌────▼────┐
  │ Failed  │ ◄── retryable (max 3 auto-retries, then manual retryBbbMeeting / resetBbbRoom)
  └─────────┘

  Stale ── (Active that the runtime no longer confirms) — terminal; reconciliation
           completes or re-provisions from this state
```

Allowed transitions (`MEETING_STATE_TRANSITIONS` in `constants.ts`):

| From | To |
|------|----|
| `Pending` | `Provisioning`, `Failed` |
| `Provisioning` | `Active`, `Failed` |
| `Active` | `Completed`, `Failed`, `Stale` |
| `Completed` | `Archived` |
| `Failed` | `Pending` |
| `Archived`, `Stale` | — (terminal) |

### Provisioning Flow (Async via BullMQ)

```
1. createBbbMeeting() called
   → Meeting saved in PENDING state
   → setImmediate(() => provisioningQueue.add(...))
      ↑ deferred to next event loop tick so the DB transaction commits first

2. BullMQ Worker (doProvisionMeeting)
   → Transition PENDING → PROVISIONING
   → Select least-loaded healthy BBB server
   → Find earliest-expiring non-exhausted grant with sourceType IN (order, subscription)
     (`internal_overhead` capacity is ops headroom and is never selected — BUG-036)
   → Guard: hasProvisionableMinutes(grant) — Infinity semantics for isUnbounded grants
     else throw "Your plan's meeting minutes for this period are exhausted…"
   → If nothing selectable: "No active capacity grant found…", or the exhausted
     message above when an in-window exhausted commercial grant exists
   → Call BBB createMeeting API (OpenTelemetry traced)
   → AES-256-GCM encrypt attendee + moderator passwords
   → Store grantId (immutable — billing uses this even if grants change later)
   → Transition → ACTIVE
   → Publish MeetingProvisionedEvent
   → Notify room (onMeetingActive → room.state = "Active")

3. On failure
   → Transition → FAILED, store failureReason, increment retryCount
   → Publish MeetingFailedEvent
   → Notify room (onMeetingFailed → room.state = "Idle" or "Failed")
```

### Completion Flow (Idempotent)

`completeMeetingLifecycle()` is the single path for all completion sources:

```
source: "webhook" | "end-meeting" | "reconciliation" | "stale-active-runtime" | "manual"

1. Pessimistic write lock on meeting row
2. Guard: skip if already Completed (duplicate-prevention)
3. Guard: skip if not Active
4. Transition → COMPLETED, set completedAt
5. Reset room to Idle (clear currentMeetingId)
6. consumeGrantMinutes() — transactional ledger write + grant increment
7. Publish MeetingCompletedEvent (regardless of billing outcome)
```

### Dynamic Join URLs

Join URLs are **never stored**. They are derived on every join request:

```
encryptedPassword → BbbEncryptionService.decrypt() → BbbApiService.buildJoinUrl()
```

Before returning a join URL, the service validates the meeting still exists on BBB via `getMeetingInfo()` (not `isMeetingRunning()` — the latter returns false for meetings with zero participants).

---

## Room Lifecycle

Rooms are persistent UX objects that persist across individual meetings. Each room tracks its own FSM independently.

```
  Idle ──► Provisioning ──► Active
   ▲            │               │
   │            ▼               │
   │          Failed            │ (meeting ends)
   │            │               ▼
   └────────────┴───────────── Idle
```

| State | Description |
|-------|-------------|
| `Idle` | Ready for next session |
| `Provisioning` | Meeting being created; debounce window active |
| `Active` | Meeting is live and joinable |
| `Failed` | Retries exhausted; requires manual `resetBbbRoom` |

### bbbJoinRoom Flow

```
bbbJoinRoom(roomId, participantName)
  │
  ├─ Acquire distributed Redis lock (BbbRoomLockService)
  │
  ├─ requestProvisioning(roomId) [pessimistic DB transaction]
  │    ├── Idle  → Provisioning → shouldEnqueue=true → create meeting + enqueue
  │    ├── Provisioning → shouldEnqueue=false, return status=provisioning (debounced)
  │    ├── Active → shouldEnqueue=false, return currentMeetingId
  │    └── Failed (retries exhausted) → shouldEnqueue=false, return status=failed
  │
  └─ If Active:
       ├─ Staff path (TRAINER / ORG_ADMIN member) → moderator join URL
       ├─ Student path (valid `bbb_room` BbbEntitlement or legacy BbbEnrollment) → attendee join URL
       └─ Neither → throw "You do not have access to this room"
```

**Frontend polling pattern:**

```ts
// storefront: SessionLauncher component
const poll = async () => {
  const { status, joinUrl } = await bbbJoinRoom(roomId, name);
  if (status === 'active' && joinUrl) {
    window.location.href = joinUrl;  // redirect to BBB
  } else if (status === 'provisioning') {
    setTimeout(poll, 3000);  // poll every 3s
  } else {
    showError('Failed to start session');
  }
};
```

### Provisioning Debounce

Rapid clicks within 15 seconds of the last provisioning request return `status: "provisioning"` without creating a new meeting. Active rooms bypass debounce — a user joining just after provisioning completes gets their URL immediately.

---

## Enrollment, Entitlements & Access Control

There are **two independent access systems** on purpose: staff get moderator URLs from organization membership, learners get attendee URLs from an entitlement (or a legacy room enrollment). `BbbEntitlement` is the ADR-targeted primitive (INV-003) and is the only access type that will eventually remain.

### Authorization Decision Tree

```
bbbJoinRoom(roomId, participantName)
      │
      ▼
Is Customer an active BbbOrganizationMember (TRAINER / ORG_ADMIN)?
      │ Yes                                         │ No
      ▼                                             ▼
Moderator join URL            Has the room been provisioned (Active) and does the Customer hold
                              a valid BbbEnrollment OR a bbb_room BbbEntitlement for it?
                                        │ Yes                    │ No
                                        ▼                        ▼
                                 Attendee join URL        Error: "No access" / "Do not have access to this room"

startScheduledSession(sessionId) / session join
      │
      ▼
Is caller the session's assigned trainer (or org staff)?
      │ Yes → moderator join URL (session must be SCHEDULED and inside its window)
      │ No  → valid bbb_session BbbEntitlement scoped to that session (channel-matched) → attendee URL
```

### Entitlements (primary learner path)

| Source | Created by | Notes |
|--------|-----------|-------|
| `purchase` | `BbbOrderFulfillmentListener` (session + room) and `bbbFulfillmentHandler` (room) | Written automatically at `PaymentSettled` for mapped variants: `bbb_session` (room-mapped session products) and `bbb_room` (`BbbProductAccess` mappings) |
| `trial` | `registerForTrial(sessionId)` | One trial seat per session per customer |
| `trial_conversion` | `convertTrialToEnrollment(registrationId, roomId, accessDays)` | Issues `bbb_room` access and returns the new `BbbEntitlement` |
| `admin` | `createBbbEntitlement` | Manual grant/repair |
| `import` | Bulk migrations | — |

Validity is enforced on read: `validFrom` in the future or `validUntil` in the past makes the entitlement unusable. `channelId` is a scalar on the row, so an entitlement can never leak across tenants (INV-001). The shop-side read model is `myLearningDashboard`, which exposes `LearningCourse` objects (never `Bbb*` types — INV-006) with a **server-derived** `ctaAction` / `ctaLabel`, so the storefront never re-derives eligibility from the clock (INV-008).

### Room access for purchasers (entitlement path)

1. Admin creates `BbbProductAccess` (variant → room, `accessDays`) in Admin UI → Enrollments → Add Mapping
2. Student purchases the product
3. On `PaymentSettled` access is provisioned by two idempotent writers — `BbbOrderFulfillmentListener` and `bbbFulfillmentHandler` — both writing a `bbb_room` `BbbEntitlement` (`validUntil = now + accessDays`); the handler additionally writes the `BbbCapacityGrant` (600 min / 30 days by default)
4. Student calls `bbbJoinRoom` → access check passes on `BbbEntitlement` **or** `BbbEnrollment` **or** org membership (BUG-022) → attendee join URL

`BbbEnrollment` is **no longer written by purchases**. It is created today only by the admin `createBbbEnrollment` mutation (source `admin`, upsert on `roomId + customerId` that re-activates a deactivated row and applies the new `accessDays`), which keeps legacy and manually-granted room access working. Entitlements are created skip-if-exists, so a re-purchase does **not** extend `validUntil` — extend the existing row instead. `myBbbRooms` merges entitlement-backed room access into its list, and `myBbbEnrollments` is deprecated in favour of `myLearningDashboard` / `myBbbRooms`.

### Staff access (Trainer / Admin path)

1. Admin calls `addBbbMember` with role `trainer` or `org-admin` (or creates a `BbbOrganizationMembership` via `createBbbOrgMembership`, FEAT-001)
2. Staff member calls `bbbJoinRoom` → membership found → moderator join URL
3. In BBB, the moderator is the **presenter** (can share slides, control whiteboard, mute others)

Students are **not** Organization Members. Keeping staff membership and learner entitlements separate prevents org-level access escalation — a student buying one course cannot see or affect other rooms or sessions.

---

## Capacity Grants, Daily Allowance & Billing

Capacity is expressed as `BbbCapacityGrant` rows — time-based credit owned by an organization. Two shapes exist and they are **disjoint by plan**: provider-free plans get a *daily* allowance, provider-backed plans get a *per-billing-period pool*. A single tenant is never both.

| Allowance shape | Written by | Discriminator | Amount |
|-----------------|-----------|---------------|--------|
| Daily live allowance (ADR-045, INV-026) | `BbbDailyAllowanceService` — the **only** writer | plan has `providerPlanId IS NULL` (`isDailyOnlyPlan`) | `DAILY_ALLOWANCE_MINUTES` = **60 minutes per server day** |
| Per-period pool | Renewal path (`includedBbbMinutes`) | plan has a provider binding | Plan-defined |

Daily grants are **not** a second table or a new grant kind: they are `BbbCapacityGrant` rows with `sourceType = 'subscription'`, which keeps one union seam and one billing story. The writer runs hourly (`bbb-daily-allowance` task) and is idempotent per server day, so a duplicate registration or an extra run can never hand out a second allowance for the same day.

### How Grants Work

Grants are resolved at **provisioning time** (not billing time). The earliest-expiring active grant is used first:

```ts
SELECT * FROM bbb_capacity_grant
WHERE organizationId = :orgId
  AND exhausted = false
  AND validFrom <= NOW()
  AND validUntil >= NOW()
ORDER BY validUntil ASC   -- earliest-expiring first
LIMIT 1
```

Selection semantics live in exactly one place — `grant-selection.policy.ts` (BUG-036):

| Helper | Meaning |
|--------|---------|
| `isTenantSelectableSourceType(t)` | Only `order` and `subscription`. `internal_overhead` is ops headroom and is **never** selectable for a tenant session |
| `remainingMinutesForGrant(g)` | `Infinity` for `isUnbounded` grants (their `grantedMinutes: -1` is a sentinel, not a quantity) |
| `hasProvisionableMinutes(g)` | `remainingMinutesForGrant(g) > 0` |

Distinct failure messages, so operators can tell "never bought" from "used up":

- nothing selectable in-window → `"No active capacity grant found for this organization. Please purchase or renew a plan."`
- in-window commercial grant exists but is exhausted → `"Your plan's meeting minutes for this period are exhausted. Please purchase or renew a plan to continue."`

The resolved grant ID is stored immutably on the meeting (`meeting.grantId`). If the org purchases a new grant mid-meeting, billing still hits the original grant.

### Automatic fulfillment (PaymentSettled)

> **BBB capacity grants are currently automatic after `PaymentSettled`; the `bbb-access-fulfillment` handler's default policy is 10 hours / 30 days. Product-to-room access duration is configured separately through BBB → Enrollments.**

**This is where the "10 hours / 30 days" purchase policy actually lives.** It is *not* configured on the Product Variant, and it is *not* read from the Shipping Method.

```
Order reaches PaymentSettled
    ↓   bbbOrderProcess.onTransitionEnd()                config/bbb-fulfillment.ts
autoFulfillBbbOrder()
    │  • skip if the order already has a Fulfillment      (idempotent)
    │  • eligible lines = variants mapped via BbbProductAccess
    │                    or BbbScheduledSession.productVariantId
    ↓
orderService.createFulfillment({
  lines,
  handler: {
    code: 'bbb-access-fulfillment',
    arguments: [ { grantedHours: '10' }, { validityDays: '30' } ],   ← supplied here
  },
})
    ↓   FulfillmentService.create() resolves the handler by `code`
        from config.shippingOptions.fulfillmentHandlers
bbbFulfillmentHandler.createFulfillment(ctx, orders, lines, args)
    ├── BbbCapacityGrant   grantedMinutes = grantedHours × 60 = 600
    │                      validUntil     = now + validityDays (30 d)
    │                      idempotent on orderLineId
    └── BbbEntitlement     bbb_room, source 'purchase',
                           validUntil = now + BbbProductAccess.accessDays
```

**The three durations are different things**

| Value | Where it is set | What it does |
|-------|-----------------|--------------|
| `grantedHours` (default `10`) | `bbbFulfillmentHandler` args; the automatic path passes `10` | `grantedMinutes = 600` on the organization's `BbbCapacityGrant` |
| `validityDays` (default `30`) | same | `grant.validUntil = now + 30 days` — how long the **org's capacity pool** lasts |
| `accessDays` | `BbbProductAccess` (Admin UI → Enrollments → Add Mapping) | `entitlement.validUntil = now + accessDays` — how long the **buyer's room access** lasts; `null` = lifetime |

**Why the Shipping Method does not control the automatic grant**

- In Vendure a `FulfillmentHandler` is chosen when a **Fulfillment is created**: `OrderService.createFulfillment(ctx, input: FulfillOrderInput)` where `input.handler` is a `ConfigurableOperationInput` (`code` + `arguments`). `FulfillmentService.create()` looks the handler up by `code` in `config.shippingOptions.fulfillmentHandlers`, calls its `createFulfillment(ctx, orders, lines, arguments)`, and records `handlerCode` on the `Fulfillment` row.
- `ShippingMethod` stores **only** `fulfillmentHandlerCode` (plus checker/calculator) — there is no args column for the fulfillment handler. The Shipping Method screen therefore selects which handler the Admin UI pre-selects; it never feeds args into the automatic path.
- The plugin registers the handler in its `configuration()` hook: `config.shippingOptions.fulfillmentHandlers = [...(existing ?? []), bbbFulfillmentHandler]`.
- The code block in `bbb-fulfillment.ts` documents the intent that handler arguments be left empty so the handler's **declared defaults** stay the single source of truth. The implementation currently repeats those same values explicitly (`10` / `30`), so **changing only the handler defaults would not change what an automatic purchase grants** — the policy is effectively pinned in `autoFulfillBbbOrder()`.

**Operational consequences**

| Situation | Behaviour |
|-----------|-----------|
| Variant mapped via `BbbProductAccess` or a session | Fulfilled automatically at `PaymentSettled` → 600-minute grant + (room) entitlement |
| Variant not mapped to anything | **Not** fulfilled automatically (no grant, no access) — fulfil manually (below) or map the variant |
| Order already has a `Fulfillment` | Skipped, so a manual fulfilment layered on top of the automatic one cannot double-grant |
| Handler throws | Logged at error level (`BbbFulfillment` loggerCtx) and the checkout still stands (fail-soft). Recover with a manual fulfilment — the missing capacity is visible in the grant ledger |
| Re-purchase of the same variant | The grant is written per new order line, but `BbbEntitlementService.create()` is skip-if-exists on `(customerId, type, resourceId)`, so the learner's entitlement validity is **not** extended |

**Fulfilling manually (hour bundles, repairs, non-mapped variants)**

```graphql
mutation {
  addFulfillmentToOrder(input: {
    lines: [{ orderLineId: "3", quantity: 1 }]
    handler: {
      code: "bbb-access-fulfillment"
      arguments: [
        { name: "grantedHours", value: "10" }
        { name: "validityDays", value: "30" }
      ]
    }
  }) {
    ... on Fulfillment { id handlerCode method trackingCode }
    ... on ErrorResult { errorCode message }
  }
}
```

Vendure's remaining-quantity guard rejects a redundant second fulfilment of the same line, and the handler additionally dedupes on `orderLineId` — a re-run cannot double-grant. For capacity unrelated to any order, use `createBbbCapacityGrant` instead.

**Two idempotent writers on the same event.** `BbbOrderFulfillmentListener` (a separate `OrderStateTransitionEvent` subscriber) also provisions learner access at `PaymentSettled`: a `bbb_session` entitlement (`validUntil = session.endTime`) for session-mapped variants, and a `bbb_room` entitlement (`validUntil = now + accessDays`) for room-mapped variants. Because `BbbEntitlementService.create()` is skip-if-exists on `(customerId, type, resourceId)`, the listener and the handler cannot create duplicate rows — and both compute the room expiry from the same `accessDays`.

### Usage Billing (at session close)

```
effectiveDurationMs = min(completedAt - provisionedAt, maxMeetingDurationMs)   -- 24 h cap

if duration < fairBillingMinDurationMs (2 min) → free, no ledger row (fair billing guard)

consumedMinutes = max(1, ceil(effectiveDurationMs / 60000))   -- whole minutes, rounded up, minimum 1
BbbUsageLedger entry written (unique on meeting+grant — prevents double billing, INV-002)
BbbCapacityGrant.consumedMinutes += consumedMinutes  (atomic increment)
if consumedMinutes >= grantedMinutes → exhausted = true
GrantConsumedEvent published
```

Amortisation notes:

- Duration is measured from `provisionedAt`, not from the first join.
- Meetings still `Active` after `maxMeetingDurationMs` (default 24 h) are force-completed by reconciliation and billed **at the capped ceiling**, so a BBB node crash can never accumulate unbounded consumption.
- The ledger is append-only and idempotent; `UsageLedger` rows are never updated or deleted, including after account anonymisation (INV-002, INV-013).

### Billing Examples

| Session Duration | Billed Minutes | Notes |
|-----------------|----------------|-------|
| 45 seconds | 0 | Under 2-minute fair billing threshold — no ledger row |
| 2 minutes | 2 | Exactly at the threshold → billable |
| 3 minutes | 3 | Minimum billable duration above the guard |
| 47 minutes | 47 | Actual minutes |
| 1h 2m | 62 | Rounded up to whole minutes |
| 30 h (orphaned `Active`) | 1440 | Capped at `maxMeetingDurationMs` (24 h) before billing |

### Managing grants from the Admin UI

**Admin UI → BigBlueButton → Capacity Grants** (`/bbb/plans`) provides a full grant management interface:

- **Summary bar** — remaining hours, total granted, active grant count
- **Add Plan** — set hours and validity days; shows live expiry date preview
- **Usage bar** — colour-coded per grant (green → amber at 75% → red at 100%)
- **Source** — Purchase (shows order ID) vs Manual (admin-created)
- **Status chips** — Active / Expired / Exhausted

---

## Scheduled Sessions & Templates

Scheduled sessions decouple business scheduling from infrastructure provisioning. A session is created as `DRAFT`, becomes visible to learners only when explicitly published (INV-021), and only its trainer can activate it inside its time window. Per-organization session counts are enforced atomically against `BbbOrganization.maxSessionsPerOrg` (INV-022).

### FSM

```
DRAFT ──(publishBbbScheduledSession)──► SCHEDULED ──(trainer starts within window)──► LIVE ──► FINISHED
                                            │
                                            ├──(updateBbbScheduledSession / admin cancels)──► CANCELLED
                                            └──(endTime passes without start)──► FINISHED
```

Only `DRAFT` sessions can be published. `cancelBbbScheduledSession` is the terminal path for `SCHEDULED`; `CANCELLED` and `FINISHED` are terminal states.

### Session Templates (factory, INV-023)

`BbbSessionTemplate` holds reusable defaults (`defaultTitle`, `defaultTrainerId`, `defaultSubjectTags`, `defaultVisibility`, `durationMinutes`, optional `productVariantId`). `createSessionsFromTemplate(templateId, startTimes)` fans out one `DRAFT` session per start time with `endTime = startTime + durationMinutes`. Templates are never booked themselves, deleting a template never touches sessions already generated from it, and every generated session must be published individually.

### Usage

```graphql
# Admin: schedule a session
mutation {
  createBbbScheduledSession(input: {
    organizationId: "org-id"
    trainerId: "member-id"
    title: "Monday Math Lesson"
    startTime: "2026-07-01T09:00:00Z"
    endTime: "2026-07-01T10:00:00Z"
  }) { id status }
}

# Trainer (shop API): start the session at or after startTime
mutation {
  startScheduledSession(sessionId: "session-id") {
    id
    status
    activeMeeting { state joinUrl }
  }
}

# Students: see upcoming sessions and poll for joinUrl
query {
  myScheduledSessions {
    id title startTime status
    activeMeeting { state }
  }
}
```

---

## Capacity Policies & Capacity Intelligence

### Infrastructure ceilings — ADR-031 / INV-015

`BbbPlatformCapacityPolicy` is the platform-controlled infrastructure ceiling. Resolution is deterministic and explicit about its provenance:

```
plan-matched (subscriptionPlanId) → channel-override (channelId) → platform-default (both null) → fallback
```

| Operation | Permission | Notes |
|-----------|-----------|-------|
| `effectiveCapacityPolicy(channelId)` | `BBBPlatformInfrastructure` | Returns `{ defaultRoomCapacity, maxRoomCapacity, maxConcurrentParticipants, maxConcurrentMeetings, source }` |
| `platformCapacityPolicies` | `BBBPlatformInfrastructure` | All policy rows |
| `upsertPlatformCapacityPolicy(input)` | `BBBPlatformInfrastructure` | Creates/updates a tier row; enabling adoption flips provisioning + org cache sync to policy-driven values |
| `deletePlatformCapacityPolicy(id)` | `BBBPlatformInfrastructure` | Row deletion |

A `source` of `platform-default` or `fallback` **never** overwrites an Admin-set `BbbOrganization.concurrentMeetingLimit`; only `plan` and `channel-override` do. `concurrentMeetingLimit` stays the single enforcement surface (INV-014) and the third convergence trigger (`BbbPlanCapacityReconciliationBootstrap`) repairs any organization whose cached value missed an event.

### Advisory forecasting — CI-001 / INV-012

`CapacityIntelligenceService` powers the `poolCapacityDashboard` query (platform tier):

| Output | Meaning |
|--------|---------|
| `poolLoadPercent`, `safeHeadroom` | Pool-wide utilisation and headroom (`80%` of total capacity − total virtual load) |
| `serverPoolHealth`, `servers[]` | Per-server virtual load, projected load, healthy/degraded state |
| `forecast[]` | Scheduled load forecast slots derived from upcoming `BbbScheduledSession` rows |
| `historical` | Historical peak statistics |
| `recommendation` | `urgency` (`none` \| `plan` \| `soon` \| `immediate`), `serversNeeded`, `peakForecastPercent`, `peakForecastAt`, `reasoning` |

The PILOS-style virtual-load model converts attendee counts into stream counts and weights them (`cameraRatio` 0.40, `micRatio` 0.70, `videoWeight` 3, `micWeight` 2, `listenerWeight` 1), targeting `0.70` utilisation. `BbbServer.capacity` is the operator-configured hardware ceiling.

`bbb-capacity-alert` runs every 15 minutes: it **always** appends a `BbbCapacityAlertLog` audit row (INV-002 extended) and publishes `CapacityAlertEvent` only when urgency is `soon` or `immediate`.

> **Capacity intelligence is advisory only.** Meetings are never blocked, delayed, or rejected for capacity reasons (INV-012). It informs operators; it does not gate provisioning.

---

## Trial Registrations & Conversion

Trial attendance is a first-class funnel, not a marketing checkbox:

```
Customer → registerForTrial(sessionId)      (shop API, Authenticated, 10 req/min per IP)
             └── BbbTrialRegistration (status: REGISTERED)
                   └── BbbEntitlement (type: bbb_session, source: trial)

Admin  → updateBbbTrialRegistrationStatus(id, status)   REGISTERED | ATTENDED | CANCELLED | NO_SHOW
       → convertTrialToEnrollment(registrationId, roomId, accessDays)
             └── BbbEntitlement (type: bbb_room, source: trial_conversion)   ← academy conversion
```

| Surface | Query / Mutation |
|---------|-----------------|
| Learner | `myTrialRegistrations`, `publicScheduledSessions`, `registerForTrial` |
| Tenant admin | `bbbTrialRegistrationsBySession`, `bbbTrialRegistrationsByOrganization`, `updateBbbTrialRegistrationStatus`, `convertTrialToEnrollment` |
| Admin UI | `/bbb/trials` (Trial Registrations) — platform-only nav since 2026-09-30 (H2/H3 hardening, §7 Q3) |

`convertTrialToEnrollment` is the only supported trial→paid transition: it issues the room entitlement and returns it, so the conversion is auditable in one row rather than inferred from registration status.

---

## Attendance Analytics & Learning Dashboard

### Attendance facts (3D.3d)

`SessionAttendance` rows accumulate per student, per session, from BBB webhook cycles — not first-join/last-leave snapshots. `cyclesCount` counts distinct attendance cycles and `totalDurationSeconds` sums them; `lastProcessedWebhookEventId` anchors idempotency so a replayed webhook cannot double-count (INV-004).

| Status | Meaning |
|--------|---------|
| `PRESENT` | Met the attendance bar for the session |
| `PARTIAL` | Attended, below the bar |
| `NO_SHOW` | Registered/entitled but never joined |

`source` distinguishes `WEBHOOK`-derived facts from `MANUAL_CORRECTION` rows, so a human fix is never mistaken for observed data.

| Report | Permission | Window |
|--------|-----------|--------|
| `scheduledSessionAttendance(sessionId)` | `BBBManageSessions` | Per-student rows for one session (includes resolved customer name/email) |
| `scheduledSessionAttendanceSummary(sessionId)` | `BBBManageSessions` | Registered / attended / no-show counts, rate, average duration, completion rate |
| `channelAttendanceSummary(from, to)` | `BBBManageSessions` | Channel-wide operational window, filtered on `lastEventAt` (session end) |
| `mySessionAttendance(sessionId)` | Shop `Authenticated` | The caller's **own** row only — never another student's |

### Learning dashboard (INV-006 / INV-008)

`myLearningDashboard` is the single storefront read model for "what can this learner do right now". It returns `LearningDashboard.courses: [LearningCourse!]!` where each course exposes `canJoin`, `joinUrl`, `nextSession { startsAt, endsAt }`, `instructorName`, `isTrial`, `entitlementType`, `entitlementSource`, and **server-derived** `ctaAction` (`join` \| `none`) plus `ctaLabel`.

Two invariants are enforced by the shape itself:

- **INV-006** — no `Bbb*` types cross the shop boundary; storefronts consume the domain API, not plugin internals.
- **INV-008** — the server tells the storefront what to render. The storefront must not re-derive entitlement or eligibility from the clock.

---

## Security Model

### Encryption at Rest

| Field | Algorithm | API exposure |
|-------|-----------|-------------|
| `BbbServer.encryptedApiSecret` | AES-256-GCM | `select: false` — never returned |
| `BbbMeeting.encryptedAttendeePassword` | AES-256-GCM | `select: false` — never returned |
| `BbbMeeting.encryptedModeratorPassword` | AES-256-GCM | `select: false` — never returned |

Join URLs are **never stored**. They are derived on-demand from encrypted passwords and include a configurable TTL signature.

### Webhook Verification

BBB webhook payloads are verified with HMAC-SHA256:

```ts
const expected = 'sha256=' + crypto
  .createHmac('sha256', serverSecret)
  .update(rawBody)
  .digest('hex');
crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
```

The verifier iterates all enabled servers' secrets until a match — supports multi-server setups.

### Supported Webhook Formats

Both BBB webhook formats are handled:

```json
// Legacy format
{ "event": "meeting-ended", "meetingID": "bbb-133" }

// bbb-webhooks module format
{ "event": { "data": { "id": "meeting-ended",
  "attributes": { "meeting": { "externalMeetingId": "bbb-133" } } } } }
```

---

## Rate Limiting & Webhook Hardening

| Surface | Limit | Notes |
|---------|-------|-------|
| `POST /bbb/webhook` | 100 req/min per IP | IPs in `BBB_WEBHOOK_ALLOWED_IPS` (comma-separated) skip the limiter; unknown senders are always limited |
| `registerForTrial` | 10 req/min per IP | Per-mutation limiter on the Shop API, returns `RATE_LIMITED` |
| `bbbJoinMeeting` | 10 req/min per IP | Protects the legacy direct-join path |
| `registerNewTenant` | 5 req/hour per IP | Tenant onboarding (tenant plugin) |

The webhook receiver is hardened end-to-end:

1. **Signature first** — HMAC-SHA256 over the raw body, compared with `timingSafeEqual`, iterating enabled servers' secrets until a match (supports multi-server deployments).
2. **Persist before processing (INV-004)** — the raw payload is written to `BbbWebhookEvent` and only then enqueued on the `bbb-webhook-processor` BullMQ queue. A crash between receipt and processing loses nothing.
3. **Both payload dialects** — legacy `{ event, meetingID }` and the `bbb-webhooks` module shape `{ event: { data: { id, attributes: { meeting: { externalMeetingId } } } } }` are normalised.
4. **Idempotent consumers** — the queue worker plus `BbbWebhookEvent` status and `SessionAttendance.lastProcessedWebhookEventId` make replays safe.

---

## Reconciliation Workers & Scheduled Tasks

Three `ScheduledTask`s are registered by the plugin's `configuration()` hook (id-deduped, so a shared server+worker config registers each once). Set `runScheduledTasks: false` to skip registration on nodes that must not run them.

| Task id | Cadence | Purpose |
|---------|---------|---------|
| `bbb-reconciliation` | every 5 min | Repair provisioning/active/room/billing drift; also emits and resets the metrics snapshot |
| `bbb-capacity-alert` | every 15 min | Capacity forecast sweep → `BbbCapacityAlertLog` row always, `CapacityAlertEvent` on `soon`/`immediate` |
| `bbb-daily-allowance` | every 1 h | Idempotent daily live-allowance writer for provider-free plans (ADR-045, INV-026) |

```ts
// bbb-reconciliation.task.ts
new ScheduledTask({
  id: 'bbb-reconciliation',
  schedule: (cron) => cron.every(5).minutes(),
  async execute({ injector }) {
    metricsService.logSnapshot();   // emit counters, then
    metricsService.reset();         //           zero them for the next window
    await Promise.all([
      reconciliationService.reconcileProvisioning(),    // stuck jobs
      reconciliationService.reconcileActiveMeetings(),  // DB/BBB drift
      reconciliationService.reconcileRooms(),           // room/meeting drift
      reconciliationService.reconcilePendingBilling(),  // ledger rows missing after a completed meeting
    ]);
  },
});
```

### What Each Job Does

| Job | What it fixes |
|-----|---------------|
| `reconcileProvisioning()` | Meeting stuck in `Provisioning` > 5 min → retry (max 3), then → `Failed` |
| `reconcileActiveMeetings()` | Meeting is `Active` in DB but gone from BBB → mark `Completed` + bill; meetings still `Active` past `maxMeetingDurationMs` (24 h) → force-complete and bill at the cap |
| `reconcileRooms()` | Room/meeting state drift (4 cases below) |
| `reconcilePendingBilling()` | Meeting already `Completed` but with no ledger entry → write the missing `BbbMeetingUsageLedger` row and consume the grant |

### Room Drift Cases

| Room state | Meeting state | Action |
|-----------|--------------|--------|
| `Provisioning` | `Active` | Transition room → `Active` |
| `Provisioning` | `Failed` or `Completed` | Transition room → `Idle` |
| `Active` | Completed or gone from BBB | Complete lifecycle + transition room → `Idle` |
| `Provisioning` | No meeting for > 5 min | Reset room → `Idle` (job was lost) |

### Grace Period

Meetings provisioned less than 90 seconds ago are skipped by reconciliation. BBB needs time to make a meeting queryable via `getMeetingInfo()`. This prevents false-positive completion of healthy meetings with no participants yet.

---

## Distributed Locking

Room provisioning uses a Redis distributed lock (`BbbRoomLockService`) to prevent concurrent double-provisioning across horizontally scaled server instances.

| Property | Value |
|----------|-------|
| Algorithm | `SET NX EX` with Lua-script atomic release |
| Key | `bbb:room:lock:{roomId}` |
| TTL | 30 seconds, extended every 10s via heartbeat |
| Failure mode | Fail-open by default (`roomLockStrict: false`) |

In `strict` mode, a Redis failure throws an error and blocks provisioning. In the default mode, provisioning proceeds without a lock (safe for single-instance deployments or when Redis is momentarily unavailable).

---

## Observability & Metrics

### Metrics Snapshot (emitted by the `bbb-reconciliation` task every 5 minutes)

```
[BBB Metrics]
Lock{acquired=12 contention=0 redisFail=0 hbExt=8 hbFail=0}
Provisioning{enqueued=5 suppressed=2 ok=5 fail=0 avgLat=1240ms}
Reconciliation{provFixed=0 active=3 rooms=1}
Lifecycle{staleDetected=0 staleRecovered=0 reprovision=0 runtimeFail=0
          webhookDone=5 webhookParseFail=0 duplicateBlocked=0 billingOk=5 billingFail=0}
BBB API{createOk=5 createFail=0 endOk=5 endFail=0 isRunningOk=15 isRunningFail=0}
```

Counters reset after each log. This gives a clean per-interval view of system health.

### OpenTelemetry Tracing

BBB API calls (`createMeeting`, `getMeetingInfo`, `endMeeting`) are traced with OpenTelemetry spans including server URL, meeting ID, duration, and error details.

---

## Domain Events

Subscribe to these events from other plugins or custom handlers:

```ts
import {
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionCancelledEvent,
  SessionStartedEvent,
  SessionEndedEvent,
  MeetingProvisionedEvent,
  MeetingCompletedEvent,
  MeetingFailedEvent,
  GrantConsumedEvent,
  RoomActivatedEvent,
  CapacityExhaustedEvent,
  CapacityAlertEvent,
} from './plugins/bigbluebutton-plugin';
```

| Event | Payload | Fired when |
|-------|---------|-----------|
| `SessionCreatedEvent` | sessionId, channelId | A scheduled session is created (`DRAFT`) — the marketplace projection consumes this as an eligibility transition |
| `SessionUpdatedEvent` | sessionId, channelId | Session details change |
| `SessionCancelledEvent` | sessionId, channelId | Session cancelled |
| `SessionStartedEvent` | sessionId, channelId | Session transitions to `LIVE` |
| `SessionEndedEvent` | sessionId, channelId | Session transitions to `FINISHED` |
| `MeetingProvisionedEvent` | ctx, meetingId, bbbMeetingId, roomId, organizationId, grantId | Provisioning succeeds |
| `MeetingCompletedEvent` | ctx, meetingId, roomId, organizationId, source, consumedHours | Session ends + billing runs. `source` ∈ `webhook` \| `end-meeting` \| `reconciliation` \| `stale-active-runtime` \| `manual` |
| `MeetingFailedEvent` | meetingId, roomId, organizationId, reason, retryCount | Provisioning fails |
| `GrantConsumedEvent` | grantId, meetingId, organizationId, consumedHours, remainingHours | Ledger row written |
| `RoomActivatedEvent` | roomId, meetingId, organizationId | Room transitions to `Active` |
| `CapacityExhaustedEvent` | ctx, organization, grant | A grant reaches `consumedMinutes >= grantedMinutes` |
| `CapacityAlertEvent` | urgency, message, peakForecastAt, serversNeeded | The capacity sweep projects load into `soon` (75–90%) or `immediate` (>90%) territory |

> **Units.** Capacity quantities persist in **minutes** (`grantedMinutes`, `consumedMinutes`, `remainingMinutesForGrant()`), but `MeetingCompletedEvent` and `GrantConsumedEvent` report **hours** (`consumedHours`, `remainingHours`). Do not mix the two when subscribing.

**Example — notify when a grant is nearly exhausted:**

```ts
eventBus.ofType(GrantConsumedEvent).subscribe((event) => {
  if (event.remainingHours < 2) {
    alertsService.send(`Org ${event.organizationId} has only ${event.remainingHours.toFixed(1)}h remaining`);
  }
});
```

---

## Tenant & Subscription Lifecycle

The plugin is fully event-driven: nothing in the tenant/commerce/subscription domain calls BBB code directly. Four listeners plus one bootstrap hook reconcile plugin state with platform events.

| Listener | Subscribes to | Effect |
|----------|--------------|--------|
| `BbbTenantProvisioningListener` | `TenantRegisteredEvent` | Creates (or synchronizes) the `BbbOrganization` for the new channel — slug/name derived from the tenant, assigned to the current channel |
| `BbbOrderFulfillmentListener` | `OrderStateTransitionEvent` (payment settled) | Provisions learner access: `bbb_session` entitlements for session-mapped variants and `bbb_room` entitlements for `BbbProductAccess` variants (idempotent on `customerId` + `type` + `resourceId`). The capacity grant itself is written by `bbbFulfillmentHandler` through `bbbOrderProcess` |
| `BbbSubscriptionListener` | `SubscriptionRenewedEvent` | Writes the per-period capacity pool for provider-backed plans (idempotent for recurring grants — BUG-032) |
| `BbbSubscriptionListener` | `SubscriptionPlanChangedEvent` | Converges plan-derived `concurrentMeetingLimit` (ADR-031 amendment, Decision 5) and triggers the daily-allowance writer for provider-free plans |
| `BbbSessionProvisioningListener` | `MeetingProvisionedEvent` / `MeetingCompletedEvent` | Drives `SCHEDULED → LIVE` and `LIVE → FINISHED`, plus a startup repair pass for sessions whose meeting already finished |
| `BbbPlanCapacityReconciliationBootstrap` | `onApplicationBootstrap` | Third convergence trigger: repairs organizations whose plan-derived concurrency cache missed an event or predates plan-derived capacity. Failures never block boot |

> **One writer per capacity fact.** `BbbDailyAllowanceService` owns daily grants; the renewal path owns period pools; `BbbPlanCapacityReconciliationBootstrap` owns the concurrency *cache*. Overlapping writers are the failure mode these seams exist to prevent.

---

## Data Deletion & Erasure

Deletion is **always anonymisation, never a cascade delete** (INV-013). Financial facts survive so revenue reporting stays reconstructable.

| Trigger | Handler | Scope |
|---------|---------|-------|
| Channel-scoped customer deletion | `BbbDeletionService.removeFromChannel(ctx, customerId, channelId)` | Deactivates that channel's entitlements and enrollments; unlinks the customer from the tenant |
| Full platform customer deletion | `BbbDeletionService.fullDelete(ctx, customerId)` | Anonymises every node across channels |
| Shop: `leaveAcademy` | Shop resolver mutation | Deactivates entitlements and unlinks the customer from the active channel — the channel comes from the request context, so no `channelId` argument exists |
| Shop: `deleteMyAccount(password)` | Shop resolver mutation | Anonymises all personal data platform-wide; requires the current password; irreversible |

`BbbUsageLedger` rows are never deleted or updated — they stay as the immutable usage record even after the customer is anonymised. Both handlers are registered with the platform `CustomerDeletionService` during `onApplicationBootstrap`, so any deletion flow in the platform automatically covers BBB data.

---

## Admin UI

The plugin registers a **BigBlueButton** section in the Vendure Admin Dashboard (`dashboard/index.tsx`). All management is done through Dashboard routes — there is no separate Angular UI extension to configure.

| Route | Nav item | Required permissions | What you can do |
|-------|----------|---------------------|-----------------|
| `/bbb/servers` | Servers | `BBBAdmin` \| `BBBPlatformInfrastructure` | Add BBB servers, view health/load/capacity, enable/disable |
| `/bbb/organizations` | Organizations | `BBBAdmin` \| `BBBManageOrganizations` | Platform view: create orgs, set concurrency + participant limits, suspend |
| `/bbb/rooms` | Rooms | `BBBAdmin` \| `BBBManageRooms` | Create rooms, view FSM state + retry count, reset/delete |
| `/bbb/meetings` | Meetings | `BBBAdmin` \| `BBBManageMeetings` | Create meetings, end live meetings, retry failed, delete |
| `/bbb/staff` | Staff | `BBBAdmin` \| `BBBManageMembers` | Add/remove TRAINER and ORG_ADMIN members, change roles |
| `/bbb/enrollments` | Enrollments | `BBBAdmin` \| `BBBManageRooms` | Map variants to rooms, manually enroll customers, revoke access |
| `/bbb/plans` | Capacity Grants | `BBBAdmin` \| `BBBPlatformInfrastructure` | Platform-only (H2/SEC-008): add/view capacity grants — remaining hours, usage bars, source (purchase vs manual vs daily allowance) |
| `/bbb/trials` | Trial Registrations | `BBBAdmin` \| `BBBPlatformInfrastructure` | Platform-only nav (§7 Q3): review trial sign-ups, update status, convert to enrollment |
| `/bbb/entitlements` | Entitlements | `BBBAdmin` \| `BBBManageEntitlements` | Grant/revoke access entitlements per learner and resource |
| `/bbb/sessions` | Sessions | `BBBAdmin` \| `BBBManageSessions` | Create/publish/cancel sessions, generate from templates |
| `/bbb/sessions/$id` | (detail, not in nav) | `BBBAdmin` \| `BBBManageSessions` | Session detail: window, trainer, linked meeting state, attendance |

#### Tenant vs platform tier

- **Tenant Admin screens** (`rooms`, `meetings`, `staff`, `enrollments`, `entitlements`, `sessions`) resolve the organization **server-side** from the request-context channel via `bbbMyOrganization` and never render a cross-tenant picker. This is the `useCurrentOrganization` hook shared by all tenant routes.
- **Platform screens** (`servers`, `organizations`, `plans`, `trials`) have no single tenant: organizations are browsed explicitly through `bbbOrganizations` and require the platform-tier permission (`BBBPlatformInfrastructure` / `BBBManageOrganizations`). `plans` (Capacity Grants) and `trials` are nav-gated to `BBBPlatformInfrastructure` **only** — both are platform governance surfaces since 2026-09-30 (H2 / §7 Q3), even though their components still resolve the organization from the active channel. Phase 6 of the billing plan relocates them into a single Platform section.
- Every nav item is additive on permissions: a user holding the legacy coarse `BBBAdmin` permission still sees all entries; granular permissions may be combined instead of granting `BBBAdmin`. Deeper per-operation mapping is in the [GraphQL API Reference](#graphql-api-reference).

> **Known deviation (recorded in the ADR, shrink-only baseline):** `MembershipsList` (FEAT-001 membership CRUD) exists under `dashboard/routes/memberships/` and is imported by `dashboard/index.tsx`, but **has no registered route** — it is not reachable from the Dashboard nav. Membership CRUD is currently only available through the Admin GraphQL API (`bbbOrgMemberships`, `createBbbOrgMembership`, `updateBbbOrgMembership`, `removeBbbOrgMembership`). The legacy organization-picker baseline is shrink-only and must not grow.

---

## GraphQL API Reference

### Admin API

Every admin field is guarded with `@Allow(BbbAdminPermission.Permission, <granular>.Permission)`: the coarse legacy `BBBAdmin` permission grants everything, or you can combine granular permissions instead.

| Granular permission | Governs |
|---------------------|---------|
| `BBBPlatformInfrastructure` | Servers, capacity policies, pool capacity dashboard, **capacity grants** (minting is platform-only — H2/SEC-008), **trial registrations nav** |
| `BBBManageOrganizations` | Organizations, **reading** capacity grants (own channel only — the query asserts channel ownership, BUG-049/INV-029) |
| `BBBManageRooms` | Rooms, product access mappings, enrollments |
| `BBBManageSessions` | Scheduled sessions, session templates, trials, attendance reporting |
| `BBBManageMeetings` | Meetings, moderator join URLs, retry/end |
| `BBBManageEntitlements` | Entitlements |
| `BBBManageMembers` | Organization members and memberships |

#### Queries

```graphql
# ── Platform infrastructure ────────────────────────────────────────── (BBBPlatformInfrastructure)
bbbServers(options: BbbServerListOptions): BbbServerList!
bbbServer(id: ID!): BbbServer
poolCapacityDashboard: PoolCapacityDashboard!        # capacity intelligence (advisory, INV-012)
platformCapacityPolicies: [BbbPlatformCapacityPolicy!]!   # ADR-031
effectiveCapacityPolicy(channelId: ID!): EffectiveCapacityPolicy!

# ── Organizations ──────────────────────────────────────────────────── (BBBManageOrganizations)
bbbOrganizations(options: BbbOrganizationListOptions): BbbOrganizationList!   # cross-tenant platform browse
bbbOrganization(id: ID!): BbbOrganization

# Tenant-scoped: resolved from the request-context channel — no client-side picker (INV-001).
# Allowed by every granular permission, since it only exposes the caller's own channel.
bbbMyOrganization: BbbOrganization

# ── Capacity grants ────────────────────────────────────────────────── (BBBManageOrganizations, channel-asserted)
# The organization must belong to the caller's channel (INV-029/BUG-049): a tenant admin
# reading another tenant's org gets ForbiddenError; SuperAdmin reads any org.
bbbCapacityGrants(organizationId: ID!, options: BbbCapacityGrantListOptions): BbbCapacityGrantList!

# ── Members & memberships ──────────────────────────────────────────── (BBBManageMembers)
bbbOrganizationMembers(organizationId: ID!, options: BbbOrganizationMemberListOptions): BbbOrganizationMemberList!
bbbOrganizationMember(id: ID!): BbbOrganizationMember
bbbOrgMemberships(organizationId: ID!): [BbbOrganizationMembership!]!    # FEAT-001

# ── Rooms, product access & enrollments ────────────────────────────── (BBBManageRooms)
bbbRooms(organizationId: ID!, options: BbbRoomListOptions): BbbRoomList!
bbbRoom(id: ID!): BbbRoom
bbbProductAccessByRoom(roomId: ID!): [BbbProductAccess!]!
bbbEnrollmentsByRoom(roomId: ID!, options: BbbEnrollmentListOptions): BbbEnrollmentList!
bbbProductVariantSearch(term: String!): [BbbProductVariantResult!]!

# ── Meetings ───────────────────────────────────────────────────────── (BBBManageMeetings)
bbbMeetings(organizationId: ID, options: BbbMeetingListOptions): BbbMeetingList!
bbbMeeting(id: ID!): BbbMeeting
bbbModeratorJoinUrl(meetingId: ID!, moderatorName: String!): String!

# ── Scheduled sessions, templates & trials ─────────────────────────── (BBBManageSessions)
bbbScheduledSessions(organizationId: ID!): [BbbScheduledSession!]!
bbbScheduledSession(id: ID!): BbbScheduledSession
bbbSessionTemplates(organizationId: ID!): [BbbSessionTemplate!]!
bbbTrialRegistrationsBySession(sessionId: ID!): [BbbTrialRegistration!]!
bbbTrialRegistrationsByOrganization(organizationId: ID!): [BbbTrialRegistration!]!

# ── Attendance analytics (3D.3d) ───────────────────────────────────── (BBBManageSessions)
scheduledSessionAttendance(sessionId: ID!): [SessionAttendanceAdmin!]!
scheduledSessionAttendanceSummary(sessionId: ID!): SessionAttendanceSummary!
channelAttendanceSummary(from: DateTime!, to: DateTime!): ChannelAttendanceSummary!

# ── Entitlements ───────────────────────────────────────────────────── (BBBManageEntitlements)
bbbEntitlements(options: BbbEntitlementListOptions): BbbEntitlementList!
```

#### Mutations

```graphql
# ── Platform infrastructure ────────────────────────────────────────── (BBBPlatformInfrastructure)
createBbbServer(input: CreateBbbServerInput!): BbbServer!
updateBbbServer(id: ID!, input: UpdateBbbServerInput!): BbbServer!
deleteBbbServer(id: ID!): Boolean!
upsertPlatformCapacityPolicy(input: PlatformCapacityPolicyInput!): BbbPlatformCapacityPolicy!
deletePlatformCapacityPolicy(id: ID!): Boolean!

# ── Organizations ──────────────────────────────────────────────────── (BBBManageOrganizations)
createBbbOrganization(input: CreateBbbOrganizationInput!): BbbOrganization!
updateBbbOrganization(id: ID!, input: UpdateBbbOrganizationInput!): BbbOrganization!

# deleteBbbOrganization + createBbbCapacityGrant are PLATFORM-ONLY since 2026-09-30
# (H2/SEC-008): gated by BBBPlatformInfrastructure, which the tenant admin role never holds.
deleteBbbOrganization(id: ID!): Boolean!                          # (BBBPlatformInfrastructure)
createBbbCapacityGrant(input: CreateBbbCapacityGrantInput!): BbbCapacityGrant!   # (BBBPlatformInfrastructure)
# ^ Manual grant. The fulfillment handler and the daily-allowance writer create theirs directly.

# ── Members & memberships ──────────────────────────────────────────── (BBBManageMembers)
addBbbMember(input: AddBbbMemberInput!): BbbOrganizationMember!
updateBbbMember(id: ID!, input: UpdateBbbMemberInput!): BbbOrganizationMember!
removeBbbMember(id: ID!): BbbOrganizationMember!
createBbbOrgMembership(input: CreateBbbOrgMembershipInput!): BbbOrganizationMembership!
updateBbbOrgMembership(id: ID!, input: UpdateBbbOrgMembershipInput!): BbbOrganizationMembership!
removeBbbOrgMembership(id: ID!): Boolean!

# ── Rooms, product access & enrollments ────────────────────────────── (BBBManageRooms)
createBbbRoom(input: CreateBbbRoomInput!): BbbRoom!
updateBbbRoom(id: ID!, input: UpdateBbbRoomInput!): BbbRoom!
deleteBbbRoom(id: ID!): Boolean!
resetBbbRoom(id: ID!): BbbRoom!                    # clears Failed state, resets retryCount to 0
createBbbProductAccess(input: CreateBbbProductAccessInput!): BbbProductAccess!
deleteBbbProductAccess(id: ID!): Boolean!
createBbbEnrollment(input: CreateBbbEnrollmentInput!): BbbEnrollment!
deactivateBbbEnrollment(id: ID!): BbbEnrollment!

# ── Meetings ───────────────────────────────────────────────────────── (BBBManageMeetings)
createBbbMeeting(input: CreateBbbMeetingInput!): BbbMeeting!
retryBbbMeeting(failedMeetingId: ID!): BbbMeeting!  # resets room FSM + creates new meeting
updateBbbMeeting(id: ID!, input: UpdateBbbMeetingInput!): BbbMeeting!
deleteBbbMeeting(id: ID!): Boolean!
endBbbMeeting(id: ID!): BbbMeeting!

# ── Scheduled sessions, templates & trials ─────────────────────────── (BBBManageSessions)
createBbbScheduledSession(input: CreateBbbScheduledSessionInput!): BbbScheduledSession!
updateBbbScheduledSession(id: ID!, input: UpdateBbbScheduledSessionInput!): BbbScheduledSession!
cancelBbbScheduledSession(id: ID!): BbbScheduledSession!
publishBbbScheduledSession(id: ID!): BbbScheduledSession!   # DRAFT → SCHEDULED (INV-021)
createBbbSessionTemplate(input: CreateBbbSessionTemplateInput!): BbbSessionTemplate!
deleteBbbSessionTemplate(id: ID!): Boolean!                 # generated sessions are untouched
createSessionsFromTemplate(templateId: ID!, startTimes: [String!]!): [BbbScheduledSession!]!
updateBbbTrialRegistrationStatus(id: ID!, status: String!): BbbTrialRegistration!
convertTrialToEnrollment(registrationId: ID!, roomId: ID!, accessDays: Int): BbbEntitlement!

# ── Entitlements ───────────────────────────────────────────────────── (BBBManageEntitlements)
createBbbEntitlement(input: CreateBbbEntitlementInput!): BbbEntitlement!
deleteBbbEntitlement(id: ID!): Boolean!
```

### Shop API

All shop fields require the `Authenticated` permission (logged-in customer) except `publicScheduledSessions` (public). Reads are always scoped to the caller and the active channel.

#### Queries

```graphql
# Meetings & rooms
myBbbMeetings(skip: Int, take: Int): BbbMeetingPublicList!
myBbbRooms: [BbbRoomPublic!]!                     # enrollment- and entitlement-backed room access
bbbRoomStatus(id: ID!): BbbRoomPublic             # poll this while status = provisioning
myBbbCapacityGrants: [BbbCapacityGrantPublic!]!   # grantedMinutes / consumedMinutes

# Learning surface
myLearningDashboard: LearningDashboard!           # domain API — courses + server-driven CTA (INV-006, INV-008)
myScheduledSessions: [BbbScheduledSessionPublic!]!
publicScheduledSessions: [BbbScheduledSessionPublic!]!   # @Allow(Public) — discover published sessions
myTrialRegistrations: [BbbTrialRegistrationPublic!]!
mySessionAttendance(sessionId: ID!): SessionAttendancePublic   # own row only

# Legacy — deprecated
myBbbEnrollments: [BbbEnrollmentPublic!]!
  @deprecated(reason: "Use myLearningDashboard or myBbbRooms backed by BbbEntitlement")
```

#### Mutations

```graphql
# Primary join entry point — handles provisioning + authorization in one call
bbbJoinRoom(roomId: ID!, participantName: String!): BbbJoinRoomResult!
# Returns: { status: "active" | "provisioning" | "failed", joinUrl?: String }

# Trainer: start a published session inside its window (provisions a meeting)
startScheduledSession(sessionId: ID!): BbbScheduledSessionPublic!

# Trial funnel — rate limited to 10 req/min per IP
registerForTrial(sessionId: ID!): BbbTrialRegistrationPublic!

# Account lifecycle (INV-013) — both use the active channel from the request context
leaveAcademy: LeaveAcademyResult!                 # deactivate entitlements + unlink customer from channel
deleteMyAccount(password: String!): DeleteAccountResult!   # anonymise all personal data; irreversible

# Legacy: direct meeting join (bypasses the room FSM)
bbbJoinMeeting(meetingId: ID!, participantName: String!): String!
```

> **Schema compatibility (INV-007).** Shop and Admin schema changes are additive only. Types removed from the storefront's view are first marked `@deprecated` — as `myBbbEnrollments` is above — before any future removal.

---

## Tests

### Unit / policy specs (no infrastructure)

| Spec | Pins |
|------|------|
| `__tests__/grant-selection.policy.spec.ts` | BUG-036 semantics: `internal_overhead` never selectable, `isUnbounded` ⇒ `Infinity`, "exhausted" vs "missing" outcomes |
| `__tests__/daily-allowance.policy.spec.ts` | ADR-045 / INV-026: 60-minute server-day window, `isDailyOnlyPlan` discriminator, disjoint daily vs period sets |

Both specs are deliberately infrastructure-free (`daily-allowance.policy.ts` and `grant-selection.policy.ts` import no Nest, no TypeORM, no Postgres) so the semantics the writers and gates depend on cannot drift.

### E2E specs

| Spec | Gate env | Covers |
|------|----------|--------|
| `__tests__/bbb-channel-isolation.e2e-spec.ts` | — | Tenant isolation across channels (INV-001) |
| `e2e/bbb-usage-ledger.e2e-spec.ts` | `BBB_USAGE_LEDGER_E2E` | Ledger immutability + double-billing prevention (INV-002) |
| `e2e/bbb-meeting-concurrency.e2e-spec.ts` | `MEETING_CONCURRENCY_E2E` | Concurrent provisioning / concurrency limit enforcement |
| `e2e/daily-allowance.e2e-spec.ts` | `DAILY_ALLOWANCE_E2E` | Daily grant writer idempotency per server day |
| `e2e/plan-derived-concurrency.e2e-spec.ts` | `PLAN_CAPACITY_E2E` | Plan-derived `concurrentMeetingLimit` convergence (ADR-031) |
| `e2e/attendance.e2e-spec.ts` | `ATTENDANCE_E2E` | Webhook → attendance cycles → summaries |
| `e2e/r4-runtime-lifecycle.e2e-spec.ts` | `R4_E2E` | Full runtime lifecycle: provision → join → complete → bill |

### Commands

```bash
npm run build                      # tsc — must exit 0
npm run build:dashboard            # vite — dashboard bundle
npm run verify:invariants          # platform invariant checkers (ADR/RFC/STORY/GraphQL contract)
npm run test:e2e:bbb-isolation     # channel isolation
npm run test:e2e:daily-allowance   # daily allowance
npm run test:e2e                   # full vitest suite (gated suites need their *_E2E env)
```

---

## Invariants, ADRs & Known Deviations

This plugin is governed by the platform invariant system (`docs/architecture/invariants.md`), verified by `npm run verify:invariants`.

| Invariant | Statement (short) | Where it lands here |
|-----------|-------------------|---------------------|
| INV-001 | Channel = Tenant, one identity system | `BbbOrganization.channelId` unique; `bbbMyOrganization`; `BbbEntitlement.channelId`; `BbbChannelAccessService` |
| INV-002 | Every billing fact is an immutable ledger row | `BbbUsageLedger` (unique `meeting`+`grant`), `BbbCapacityAlertLog` |
| INV-003 | One access-control system via entitlement | `BbbEntitlement`; `myLearningDashboard`; `myBbbEnrollments` deprecated |
| INV-004 | External webhooks are persisted before processing | `BbbWebhookEvent` + `bbb-webhook-processor` queue |
| INV-006 | Storefronts consume domain APIs, not plugin internals | `LearningCourse` / `SessionAttendancePublic` — no `Bbb*` types on the shop boundary |
| INV-007 | GraphQL schema changes are additive | `@deprecated` before removal |
| INV-008 | Business logic lives in Vendure; the storefront renders | server-derived `ctaAction` / `ctaLabel` |
| INV-012 | Capacity intelligence is advisory — meetings are never blocked | `poolCapacityDashboard`, `CapacityAlertEvent` |
| INV-013 | Customer deletions are anonymizations, no cascade deletes | `BbbDeletionService` handlers; ledger rows preserved |
| INV-014 | BBB infrastructure capacity is a single mutable integer per organization | `BbbOrganization.concurrentMeetingLimit` |
| INV-015 | BBB infrastructure capacity is platform-controlled | `BbbPlatformCapacityPolicy` + `effectiveCapacityPolicy` |
| INV-021 | Scheduled session starts as DRAFT and must be published | `status` default `DRAFT`; `publishBbbScheduledSession` |
| INV-022 | Organization session cap is enforced atomically | `maxSessionsPerOrg` |
| INV-023 | `BbbSessionTemplate` is a factory entity, not a booking entity | `createSessionsFromTemplate` |
| INV-026 | Daily live allowance is a server-day grant with exactly one writer | `BbbDailyAllowanceService` + `bbb-daily-allowance` task |

Key ADRs / defects referenced by this plugin: **ADR-031** (platform-controlled capacity, plan-derived concurrency), **ADR-039/044** (`providerPlanId` as the plan-identity discriminator), **ADR-045** (daily allowance), **BUG-032** (recurring-grant idempotency), **BUG-036** (single grant-selection policy), **CI-001/CI-005** (capacity intelligence + alerts), **FEAT-001** (memberships), **FEAT-002** (grant source types), **SEC-003/004** (password encryption, rate limiting), **3D.3d** (attendance analytics).

### Known deviations (accepted, recorded in the ADR)

| Deviation | Detail | Constraint |
|-----------|--------|-----------|
| `MembershipsList` is unrouted | The dashboard component exists and is imported, but no route registers it — FEAT-001 membership CRUD is Admin-API-only for now | The legacy organization-picker baseline is **shrink-only**; new screens must use `useCurrentOrganization` |
| Meetings create-target picker | Room creation/provisioning remains the primary path; the Meetings screen uses an explicit organization picker inherited from the legacy baseline rather than defaulting to the current organization | Follow-up work; must not add new pickers |
| Legacy room access via `BbbEnrollment` | `BbbEntitlement` is the ADR-targeted primitive and the purchase flow already writes `bbb_room` entitlements; `BbbEnrollment` remains the admin-only legacy/manual path and is still read by `bbbJoinRoom` / `bbbRoomStatus` alongside entitlements | Migration is incremental and additive (INV-007) |

### Migration governance

All schema changes for this plugin must be generated with the Vendure CLI and committed under `src/migrations/` (registered via `dbConnectionOptions.migrations`); hand-written migrations are prohibited unless the CLI cannot express the change and an ADR records the exception. After any entity change, run `npm run build`.

---

## File Reference

```
src/plugins/bigbluebutton-plugin/
├── index.ts                                   # Barrel exports (plugin, options, events, selected services)
├── bigbluebutton.plugin.ts                    # Decorator: entities, providers, schema, dashboard, tasks, middleware, config
├── constants.ts                               # Meeting FSM + transitions, org roles, BBBAdmin + 7 granular permissions
├── types.ts                                   # BigBlueButtonPluginOptions (incl. capacity-intelligence knobs)
├── generated-admin-types.ts                   # Generated Admin API types
├── generated-shop-types.ts                    # Generated Shop API types
├── gql/generated.ts                           # gql.tada typed documents
│
├── entities/                                  # 19 entities → tables bbb_*
│   ├── bbb-server.entity.ts                   # BBB host (API secret AES-256-GCM, capacity ceiling)
│   ├── bbb-organization.entity.ts             # Tenant (unique channelId) + concurrency/participant/session caps
│   ├── bbb-organization-member.entity.ts      # Staff membership + role (unique org+customer)
│   ├── bbb-organization-membership.entity.ts  # FEAT-001 membership record
│   ├── bbb-platform-capacity-policy.entity.ts # ADR-031 plan/channel capacity policy
│   ├── bbb-room.entity.ts                     # Room FSM + optimistic lock (version)
│   ├── bbb-meeting.entity.ts                  # Meeting FSM + encrypted passwords + immutable grantId
│   ├── bbb-product-access.entity.ts           # ProductVariant → BbbRoom mapping
│   ├── bbb-scheduled-session.entity.ts        # Session lifecycle DRAFT→… (unique org+slug)
│   ├── bbb-session-template.entity.ts         # Session factory (INV-023)
│   ├── instructor-assignment.entity.ts        # Instructor ↔ session assignment
│   ├── trial-registration.entity.ts           # Trial seats + status
│   ├── session-attendance.entity.ts           # Per-student attendance facts (webhook idempotency anchor)
│   ├── bbb-entitlement.entity.ts              # Access primitive (INV-003)
│   ├── bbb-enrollment.entity.ts               # Legacy room access (unique room+customer)
│   ├── bbb-capacity-grant.entity.ts           # Minute credit (order | subscription | internal_overhead)
│   ├── bbb-usage-ledger.entity.ts             # Immutable usage fact (INV-002)
│   ├── bbb-webhook-event.entity.ts            # Persisted-before-processing webhook (INV-004)
│   └── bbb-capacity-alert-log.entity.ts       # Capacity sweep audit rows
│
├── services/                                  # 29 modules (services + 2 pure policies)
│   ├── bbb-encryption.service.ts              # AES-256-GCM encrypt/decrypt
│   ├── bbb-api.service.ts                     # BBB REST adapter (SHA-256 checksum, OTEL spans)
│   ├── bbb-server.service.ts                  # Server CRUD
│   ├── bbb-server-selection.service.ts        # Least-loaded healthy server selection
│   ├── bbb-channel-access.service.ts          # Channel-scoped org resolution + isolation enforcement
│   ├── bbb-organization.service.ts            # Org CRUD + quota enforcement
│   ├── bbb-platform-capacity-policy.service.ts # Policy CRUD + effective-policy resolution
│   ├── capacity-intelligence.service.ts       # Advisory forecasting / pool dashboard (CI-001, INV-012)
│   ├── bbb-meeting.service.ts                 # Meeting lifecycle + join URLs + room join
│   ├── bbb-provisioning-worker.service.ts     # BullMQ worker: grant gate → createMeeting (BUG-036 semantics)
│   ├── bbb-join-url.service.ts                # Dynamic join-URL derivation + TTL signature
│   ├── bbb-room.service.ts                    # Room FSM + distributed provisioning
│   ├── bbb-room-lock.service.ts               # Redis lock (SET NX EX + Lua release, heartbeat)
│   ├── bbb-member.service.ts                  # Staff membership CRUD + role checks
│   ├── bbb-membership.service.ts              # FEAT-001 memberships
│   ├── grant-reader.service.ts                # Grant reads + remaining minutes
│   ├── grant-selection.policy.ts              # Pure selection semantics (BUG-036)
│   ├── bbb-daily-allowance.service.ts         # Sole daily-allowance writer (ADR-045, INV-026)
│   ├── daily-allowance.policy.ts              # Pure server-day + plan-discriminator rules
│   ├── bbb-entitlement.service.ts             # Entitlement CRUD + validity enforcement
│   ├── learning-dashboard.service.ts          # Learner read model (INV-006 / INV-008)
│   ├── bbb-scheduled-session.service.ts       # Session lifecycle, publish, templates
│   ├── trial-registration.service.ts          # Trial seats + conversion
│   ├── session-attendance.service.ts          # Attendance cycles from webhook events
│   ├── attendance-analytics.service.ts        # Session / channel attendance reporting
│   ├── bbb-reconciliation.service.ts          # Reconciliation + billing (single completion path)
│   ├── bbb-webhook-processor.service.ts       # Webhook queue consumer
│   ├── bbb-deletion.service.ts                # INV-013 anonymisation handlers
│   └── bbb-metrics.service.ts                 # In-memory metrics collector
│
├── events/
│   └── bbb-events.ts                          # 12 domain events
│
├── api/
│   ├── bbb-admin.resolver.ts                  # Admin resolvers (per-operation granular @Allow)
│   ├── bbb-shop.resolver.ts                   # Shop resolvers (Authenticated + channel scoping)
│   └── schema/
│       ├── bbb-admin.schema.ts                # Admin API SDL
│       └── bbb-shop.schema.ts                 # Shop API SDL
│
├── config/
│   ├── bbb-fulfillment.ts                     # FulfillmentHandler + order process
│   └── rate-limiter.middleware.ts             # Webhook + per-mutation shop rate limiters
│
├── workers/
│   └── bbb-webhook.controller.ts              # Webhook receiver (HMAC, dual format, persist-first)
│
├── listeners/
│   ├── bbb-tenant-provisioning.listener.ts    # TenantRegisteredEvent → BbbOrganization
│   ├── order-fulfillment.listener.ts          # OrderStateTransitionEvent → BbbEntitlement (session + room)
│   ├── bbb-subscription.listener.ts           # Renewed / PlanChanged → pool, concurrency, daily grant
│   ├── bbb-session-provisioning.listener.ts   # Meeting events → session LIVE/FINISHED
│   └── bbb-plan-capacity-reconciliation.bootstrap.ts  # Boot-time concurrency convergence
│
├── jobs/
│   ├── bbb-reconciliation.task.ts             # ScheduledTask — every 5 min
│   ├── bbb-capacity-alert.task.ts             # ScheduledTask — every 15 min
│   └── bbb-daily-allowance.task.ts            # ScheduledTask — every 1 h
│
├── __tests__/
│   ├── grant-selection.policy.spec.ts         # BUG-036 semantics
│   ├── daily-allowance.policy.spec.ts         # ADR-045 / INV-026 semantics
│   └── bbb-channel-isolation.e2e-spec.ts      # INV-001 isolation
│
├── e2e/
│   ├── bbb-usage-ledger.e2e-spec.ts
│   ├── bbb-meeting-concurrency.e2e-spec.ts
│   ├── daily-allowance.e2e-spec.ts
│   ├── plan-derived-concurrency.e2e-spec.ts
│   ├── attendance.e2e-spec.ts
│   └── r4-runtime-lifecycle.e2e-spec.ts
│
└── dashboard/
    ├── index.tsx                              # Nav section + routes + requiresPermission per item
    ├── shared/
    │   └── useCurrentOrganization.ts          # Channel-resolved org hook (INV-001)
    └── routes/
        ├── servers/ServersList.tsx
        ├── organizations/OrganizationsList.tsx
        ├── rooms/RoomsList.tsx
        ├── meetings/MeetingsList.tsx
        ├── members/MembersList.tsx
        ├── enrollments/EnrollmentsList.tsx
        ├── plans/PlansList.tsx                # Capacity grants + usage bars
        ├── trials/TrialRegistrationsList.tsx
        ├── entitlements/EntitlementsList.tsx
        ├── sessions/SessionsList.tsx
        ├── sessions/SessionDetail.tsx          # /bbb/sessions/$id
        └── memberships/MembershipsList.tsx     # FEAT-001 CRUD — imported, currently unrouted
```

---

## Roadmap

| Feature | Priority | Notes |
|---------|----------|-------|
| **Recording platform** — S3/MinIO storage, signed playback URLs | High | `BbbOrganization.recordingEnabled` is a flag today; no storage pipeline |
| **Prometheus metrics export** — migrate from in-memory counters to an exportable endpoint | High | `BbbMetricsService` is per-process only |
| **Keycloak SSO** — link a `keycloakSub` identity on `BbbOrganizationMember` | High | Staff access currently resolves through Vendure customers |
| **Room entitlements** — finish retiring the `BbbEnrollment` read path (`bbbJoinRoom` / `bbbRoomStatus` still accept it) | Medium | Purchases already write `bbb_room` entitlements; this makes `BbbEntitlement` the single access system (INV-003) and lets `myBbbEnrollments` be removed |
| **Usage ledger Admin UI** — drill into billing history per org, per grant | Medium | Ledger rows are already queryable; only the screen is missing |
| **Server placement engine** — region-aware routing, maintenance mode, draining | Medium | Selection is currently load-based only |
| **Routed memberships screen** — register `MembershipsList` and retire the remaining legacy organization pickers | Medium | Closes the recorded deviation; the picker baseline is shrink-only until then |
| **Scheduled session ↔ room linkage** — add `roomId` to sessions so enrolled room students auto-see classes | Medium | Sessions and rooms are currently independent |
| **Capacity-only bundle fulfilment** — represent a room-less capacity product so hour bundles are auto-fulfilled | Medium | `BbbProductAccess.roomId` is `NOT NULL` and `autoFulfillBbbOrder()` is BBB-only, so an unmapped bundle variant needs a manual fulfilment today |
| **Attendance-driven completion rules** — persist configurable presence thresholds | Low | `PRESENT`/`PARTIAL` boundaries are policy-in-code today |
| **Room-lock Prometheus metrics** — expose lock contention as exportable counters | Low | Folded into the general metrics-export item |
| **Entitlement renewal semantics** — extend `validUntil` when the same resource is re-purchased | Low | `BbbEntitlementService.create()` is skip-if-exists on `(customerId, type, resourceId)`, so a re-purchase does not extend access today |
| **Configurable purchase grant policy** — read the automatic path's `grantedHours` / `validityDays` from configuration | Low | `autoFulfillBbbOrder()` pins `10` / `30` explicitly, so this is a code change today (see [Automatic fulfillment (PaymentSettled)](#automatic-fulfillment-paymentsettled)) |

### Deferred follow-ups from the current dashboard work

| Item | Detail |
|------|--------|
| `build:dashboard` output hygiene | Add `--emptyOutDir` so stale chunks stop accumulating in `dist/dashboard/assets` |
| `EntitlementsList` raw-document baseline | Excluded from the dashboard query-state ratchet baseline; must shrink, never grow |
| Meetings create-target default | Default the create-target picker to the current organization |