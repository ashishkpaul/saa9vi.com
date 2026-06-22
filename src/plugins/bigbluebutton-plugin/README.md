# BigBlueButton Orchestration Plugin for Vendure 3.x

A production-grade, multi-tenant Vendure plugin that turns BigBlueButton into a sellable product. Sell meeting-hour plans, auto-provision live classrooms, enroll students on purchase, and monitor everything from the Admin UI — without a single line of custom orchestration code.

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
- [Enrollment & Access Control](#enrollment--access-control)
- [Capacity Plans & Billing](#capacity-plans--billing)
- [Scheduled Sessions](#scheduled-sessions)
- [Security Model](#security-model)
- [Reconciliation Workers](#reconciliation-workers)
- [BBB Webhook Integration](#bbb-webhook-integration)
- [Distributed Locking](#distributed-locking)
- [Observability & Metrics](#observability--metrics)
- [Domain Events](#domain-events)
- [Admin UI](#admin-ui)
- [GraphQL API Reference](#graphql-api-reference)
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
  └── BbbProductAccess → BbbRoom "Math Class Room"
        └── BbbFulfillmentHandler creates:
              ├── BbbCapacityGrant (10 hours, 30 days validity)  ← org-level billing pool
              └── BbbEnrollment (student, 30 days)              ← room-level access
```

**Step-by-step setup:**

1. Create a BBB Server in Admin UI → Servers
2. Create an Organization in Admin UI → Organizations (one per Vendure channel/school)
3. Create a Room in Admin UI → Rooms (`Math Class Room`, slug: `math-class`)
4. Create a Vendure Product → ProductVariant (digital, e.g. "Math Class — 30 Days")
5. Set the variant's FulfillmentHandler to `bbb-access-fulfillment`, with `grantedHours: 10` and `validityDays: 30`
6. In Admin UI → Enrollments, map the variant to the room via "Add Mapping"
7. Add a trainer via Admin UI → Staff → Add Staff Member (role: `trainer`)
8. Student purchases the product → auto-enrolled, grant created
9. Trainer clicks "Join" in storefront → gets moderator URL (is the presenter)
10. Student clicks "Join" → gets attendee URL

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
  └── BbbFulfillmentHandler creates:
        └── BbbCapacityGrant (600 minutes, 30 days)   ← that's it, no enrollment
```

Consultants are added as Staff members (TRAINER/ORG_ADMIN). They create meetings directly from Admin UI → Meetings → Create Meeting, which provisions on-demand.

**Key difference from Use Case 1:** No `BbbProductAccess` or `BbbEnrollment`. Capacity is pooled across all meetings the org runs. The grant is consumed per meeting-hour at session close.

---

### Use Case 3 — Scheduled Webinar (Fixed Time Slot)

**Scenario:** A live webinar is scheduled for a specific date/time. Only a trainer can start it within the time window. Students can see the scheduled slot and join once it's live.

**How it maps:**

```
BbbScheduledSession
  ├── startTime / endTime
  ├── trainer (BbbOrganizationMember)
  └── activeMeeting (BbbMeeting, nullable — only set when LIVE)
```

**Flow:**
1. Admin creates `BbbScheduledSession` (title, startTime, endTime, trainerId)
2. Storefront shows `myScheduledSessions` to enrolled students
3. Trainer calls `startScheduledSession(sessionId)` at start time
4. Session transitions SCHEDULED → LIVE, meeting is provisioned
5. Students poll `myScheduledSessions` for `joinUrl`
6. Session auto-transitions to FINISHED when endTime passes

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
- Once a meeting is provisioned, it is **permanently linked** to that grant (`grantId` is immutable). Mid-meeting grant changes do not affect billing
- A meeting under 2 minutes is **not billed** (fair billing guard)
- Usage is billed in **whole minutes** — actual duration, not rounded hours
- When `consumedMinutes >= grantedMinutes`, the grant is marked `exhausted = true` and excluded from future provisioning
- If no active non-exhausted grant exists → provisioning fails with `"No minutes remaining on plan"`

**Managing grants from the Admin UI:**

Go to Admin UI → Plans. You can:
- See remaining hours at a glance (summary bar)
- Add a new plan (hours + validity days) without touching GraphQL
- See which grants came from purchases vs. manual admin additions
- See the colour-coded usage bar per grant (green → amber at 75% → red at 100%)

> **Operational tip:** Set a calendar reminder when grants expire. There is no automatic renewal — a student buying a new plan auto-creates a grant via the fulfillment handler, but admin-created grants must be renewed manually.

---

### Common Operational Issues and Solutions

| Symptom | Cause | Fix |
|---------|-------|-----|
| `"No minutes remaining on plan"` in meeting log | All capacity grants exhausted or expired | Admin UI → Plans → Add Plan |
| `"Couldn't start session"` on storefront | Room stuck in `Failed` state | Admin UI → Rooms → (room is in Failed state — `resetBbbRoom` mutation or delete+recreate) |
| Meeting stays in `Pending` forever | Provisioning job lost (worker restart during job) | Reconciliation worker auto-retries after 5 min. Check worker logs. |
| `"No active capacity grant found"` | Grant expired (past `validUntil`) | Add a new grant in Admin UI → Plans |
| Room shows `retryCount: 3`, no Retry button effect | `maxAutoRetries` reached; room is in `Failed` | Use `resetBbbRoom` mutation from GraphiQL, then try again |
| Student can't join after buying | `BbbProductAccess` not mapped to the variant | Admin UI → Enrollments → Add Mapping for the variant |
| Trainer joins as attendee, not moderator | Customer not added as Staff member | Admin UI → Staff → Add Staff Member with TRAINER role |

---

## Core Architecture

The plugin separates the **Commerce Domain** (Products, Orders, Payments) from the **Infrastructure Engine** (BBB servers, meeting FSM, room state) so your commerce node is never blocked by external video conferencing round-trips.

```
[ Vendure Channel ]
        │
        ▼
[ BbbOrganization ] ──► [ BbbCapacityGrant ]  (billing pool)
        │
        ├──► [ BbbRoom ] (persistent space)
        │         │
        │         ├──► [ BbbMeeting ] (FSM — live token)
        │         └──► [ BbbEnrollment ] (student access)
        │
        └──► [ BbbScheduledSession ] (calendar slot)
```

### Separation of Concerns

```
Organization
 ├── Staff (ORG_ADMIN / TRAINER roles)  → join as moderator
 └── Rooms
       └── Enrollments (students via purchase) → join as attendee
```

Students are **not** Organization Members. They access rooms via `BbbEnrollment`, created automatically on purchase. This prevents org-level access escalation — a student buying a room course cannot see or affect other rooms.

---

## Data Model

The system uses 10 interconnected entities:

| Entity | Purpose |
|--------|---------|
| `BbbServer` | BBB host with AES-256-GCM encrypted API secret |
| `BbbOrganization` | Tenant workspace linked 1:1 to a Vendure Channel |
| `BbbOrganizationMember` | Staff (ORG_ADMIN / TRAINER) linked to a Customer |
| `BbbRoom` | Persistent reusable classroom with its own FSM |
| `BbbMeeting` | Transient live session on a BBB server |
| `BbbCapacityGrant` | Purchased or manual minute-credit entitlement |
| `BbbUsageLedger` | Audit trail of usage deductions at session close |
| `BbbScheduledSession` | Calendar reservation with fixed access window |
| `BbbEnrollment` | Student room access (created on purchase) |
| `BbbProductAccess` | Maps a ProductVariant → BbbRoom |

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
| `active` | boolean | Deactivated on revoke or re-purchase upsert |
| `validFrom` | DateTime | Access start |
| `validUntil` | DateTime | Access expiry (null = lifetime) |
| `source` | enum | `purchase`, `admin`, `invite`, `import` |

Unique index on `(roomId, customerId)` — re-purchasing re-activates, does not duplicate.

#### BbbOrganizationMember roles

| Role | Capabilities |
|------|-------------|
| `ORG_ADMIN` | Buy plans, manage members, create meetings, join as moderator |
| `TRAINER` | Create meetings, join as moderator (presenter controls in BBB) |

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

### 1. Install

```bash
npm install @buylits/vendure-plugin-bigbluebutton
```

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
```

### 3. Vendure Config

```ts
// vendure-config.ts
import { BigBlueButtonPlugin } from '@buylits/vendure-plugin-bigbluebutton';

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
  meetingIdPrefix?: string;            // Prefix for BBB meeting IDs (default: "bbb")
  attendeeJoinUrlTtlSeconds?: number;  // Join URL TTL in seconds (default: 86400)
  runScheduledTasks?: boolean;         // Register reconciliation scheduler (default: true)

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

1. Create a **Product** with a **ProductVariant** in Vendure (digital, no stock tracking)
2. Set FulfillmentHandler to `bbb-access-fulfillment`
3. Set handler args: `grantedHours: 10`, `validityDays: 30`
4. Map the variant to the room in Admin UI → Enrollments → Add Mapping

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
- Creates a `BbbCapacityGrant` (600 minutes) for the org
- Creates a `BbbEnrollment` for the buyer (30-day access to the room)

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

For dev/test or admin-only orgs without a purchase flow, add a plan manually from Admin UI → Plans → Add Plan.

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

Webhook endpoint: `POST /bbb/webhook`

---

## Meeting Lifecycle

### FSM Transitions

```
             ┌──────────┐
             │  Pending │ ◄── createBbbMeeting / createRoomMeetingAndEnqueue
             └────┬─────┘
                  │ BullMQ worker picks up job
             ┌────▼──────────┐
       ┌─────┤ Provisioning  │
       │     └────┬──────────┘
       │          │ BBB createMeeting succeeds
       │     ┌────▼──────┐
       │     │  Active   │ ◄── participants can join
       │     └────┬──────┘
       │          │ webhook / reconciliation / endBbbMeeting
       │     ┌────▼────────┐
       │     │  Completed  │ ◄── billing runs here
       │     └────┬────────┘
       │          │
       │     ┌────▼────────┐
       │     │  Archived   │
       │     └─────────────┘
       │
  ┌────▼────┐
  │ Failed  │ ◄── can transition back to Pending via retryBbbMeeting
  └─────────┘
```

### Provisioning Flow (Async via BullMQ)

```
1. createBbbMeeting() called
   → Meeting saved in PENDING state
   → setImmediate(() => provisioningQueue.add(...))
      ↑ deferred to next event loop tick so the DB transaction commits first

2. BullMQ Worker (doProvisionMeeting)
   → Transition PENDING → PROVISIONING
   → Select least-loaded healthy BBB server
   → Find earliest-expiring non-exhausted grant
   → Guard: remainingMinutes > 0 (else throw "No minutes remaining on plan")
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
       ├─ Student path (active BbbEnrollment) → attendee join URL
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

## Enrollment & Access Control

### Authorization Decision Tree

```
bbbJoinRoom(roomId)
      │
      ▼
Is Customer an active BbbOrganizationMember (TRAINER/ORG_ADMIN)?
      │ Yes                    │ No
      ▼                        ▼
Moderator join URL     Does Customer have active BbbEnrollment for this room?
                              │ Yes                    │ No
                              ▼                        ▼
                       Attendee join URL        Error: "No access"
```

### Student Enrollment (Primary Path — Purchase-Driven)

1. Admin creates `BbbProductAccess` (variant → room mapping)
2. Student purchases the product
3. `bbbFulfillmentHandler` creates `BbbEnrollment` + `BbbCapacityGrant`
4. Student calls `bbbJoinRoom` → enrollment found → attendee join URL

Re-purchasing re-activates the enrollment and extends `validUntil`. It does not create duplicates (unique constraint on `roomId + customerId`).

### Staff Access (Trainer / Admin Path)

1. Admin calls `addBbbMember` with role `trainer` or `org-admin`
2. Staff member calls `bbbJoinRoom` → membership found → moderator join URL
3. In BBB, the moderator is the **presenter** (can share slides, control whiteboard, mute others)

---

## Capacity Plans & Billing

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

The resolved grant ID is stored immutably on the meeting (`meeting.grantId`). If the org purchases a new grant mid-meeting, billing still hits the original grant.

### Usage Billing (at session close)

```
Duration = completedAt - provisionedAt

if duration < 2 minutes → free (fair billing guard)

consumedMinutes = ceil(duration in minutes)  -- whole minutes, rounded up
BbbUsageLedger entry written (unique on meeting+grant — prevents double billing)
BbbCapacityGrant.consumedMinutes += consumedMinutes  (atomic increment)
if consumedMinutes >= grantedMinutes → exhausted = true
GrantConsumedEvent published
```

### Billing Examples

| Session Duration | Billed Minutes | Notes |
|-----------------|----------------|-------|
| 45 seconds | 0 | Under 2-minute fair billing threshold |
| 3 minutes | 3 | Minimum billable |
| 47 minutes | 47 | Actual minutes |
| 1h 2m | 62 | Whole minutes |

### Managing Plans from Admin UI

Admin UI → Plans provides a full grant management interface:

- **Summary bar** — remaining hours, total granted, active grant count
- **Add Plan** — set hours and validity days; shows live expiry date preview
- **Usage bar** — colour-coded per grant (green → amber at 75% → red at 100%)
- **Source** — Purchase (shows order ID) vs Manual (admin-created)
- **Status chips** — Active / Expired / Exhausted

---

## Scheduled Sessions

Scheduled sessions decouple business scheduling from infrastructure provisioning. Only a trainer can activate a session within its time window.

### FSM

```
SCHEDULED ──(trainer starts within window)──► LIVE ──► FINISHED
    │
    └──(admin cancels)──► CANCELLED
    └──(endTime passes without start)──► FINISHED
```

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

## Reconciliation Workers

A scheduled task runs every 5 minutes across three reconciliation jobs in parallel:

```ts
// bbb-reconciliation.task.ts
new ScheduledTask({
  id: 'bbb-reconciliation',
  schedule: (cron) => cron.every(5).minutes(),
  async execute({ injector }) {
    await Promise.all([
      reconciliationService.reconcileProvisioning(),   // stuck jobs
      reconciliationService.reconcileActiveMeetings(), // DB/BBB drift
      reconciliationService.reconcileRooms(),          // room/meeting drift
    ]);
  },
});
```

### What Each Job Does

| Job | What it fixes |
|-----|---------------|
| `reconcileProvisioning()` | Meeting stuck in `Provisioning` > 5 min → retry (max 3), then → `Failed` |
| `reconcileActiveMeetings()` | Meeting is `Active` in DB but gone from BBB → mark `Completed` + bill |
| `reconcileRooms()` | Room/meeting state drift (4 cases below) |

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

### Metrics Snapshot (logged every 5 minutes)

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
  MeetingProvisionedEvent,
  MeetingCompletedEvent,
  MeetingFailedEvent,
  GrantConsumedEvent,
  RoomActivatedEvent,
} from '@buylits/vendure-plugin-bigbluebutton';
```

| Event | Payload | Fired when |
|-------|---------|-----------|
| `MeetingProvisionedEvent` | meetingId, bbbMeetingId, roomId, organizationId, grantId | Provisioning succeeds |
| `MeetingCompletedEvent` | meetingId, roomId, organizationId, source, consumedMinutes | Session ends + billing runs |
| `MeetingFailedEvent` | meetingId, roomId, organizationId, reason, retryCount | Provisioning fails |
| `GrantConsumedEvent` | grantId, meetingId, organizationId, consumedMinutes, remainingMinutes | Ledger written |
| `RoomActivatedEvent` | roomId, meetingId, organizationId | Room transitions to Active |

**Example — send a Slack notification when a grant is nearly exhausted:**

```ts
eventBus.ofType(GrantConsumedEvent).subscribe((event) => {
  const remainingHours = event.remainingMinutes / 60;
  if (remainingHours < 2) {
    slackService.send(`⚠️ Org ${event.organizationId} has only ${remainingHours.toFixed(1)}h remaining`);
  }
});
```

---

## Admin UI

The plugin registers a **BigBlueButton** section in the Vendure Admin Dashboard. All management is done through the Dashboard UI routes.

| Route | Page | What you can do |
|-------|------|-----------------|
| `/extensions/bbb/servers` | Servers | Add BBB servers, view health/load, enable/disable |
| `/extensions/bbb/organizations` | Organizations | Create orgs, set concurrency + participant limits |
| `/extensions/bbb/rooms` | Rooms | Create rooms, view FSM state + retry count, delete |
| `/extensions/bbb/meetings` | Meetings | Create meetings, end live meetings, retry failed, auto-refresh every 15s |
| `/extensions/bbb/plans` | Plans | **Add/view capacity grants** — remaining hours, usage bars, source (purchase vs manual) |
| `/extensions/bbb/enrollments` | Enrollments | Map variants to rooms, manually enroll customers, revoke access |
| `/extensions/bbb/staff` | Staff | Add/remove TRAINER and ORG_ADMIN members, change roles |

The UI is built with the Vendure Dashboard extension system and does not require any additional Angular UI extension configuration.

---

## GraphQL API Reference

### Admin API

All queries and mutations require the `BBBAdmin` custom permission.

#### Queries

```graphql
# Servers
bbbServers(options: BbbServerListOptions): BbbServerList!
bbbServer(id: ID!): BbbServer

# Organizations
bbbOrganizations(options: BbbOrganizationListOptions): BbbOrganizationList!
bbbOrganization(id: ID!): BbbOrganization

# Staff
bbbOrganizationMembers(organizationId: ID!, options: BbbOrganizationMemberListOptions): BbbOrganizationMemberList!
bbbOrganizationMember(id: ID!): BbbOrganizationMember

# Meetings
bbbMeetings(organizationId: ID, options: BbbMeetingListOptions): BbbMeetingList!
bbbMeeting(id: ID!): BbbMeeting
bbbModeratorJoinUrl(meetingId: ID!, moderatorName: String!): String!

# Capacity grants (Plans)
bbbCapacityGrants(organizationId: ID!): [BbbCapacityGrant!]!

# Rooms
bbbRooms(organizationId: ID!, options: BbbRoomListOptions): BbbRoomList!
bbbRoom(id: ID!): BbbRoom

# Product access & enrollments
bbbProductAccessByRoom(roomId: ID!): [BbbProductAccess!]!
bbbEnrollmentsByRoom(roomId: ID!, options: BbbEnrollmentListOptions): BbbEnrollmentList!
bbbProductVariantSearch(term: String!): [BbbProductVariantResult!]!

# Scheduled sessions
bbbScheduledSessions(organizationId: ID!): [BbbScheduledSession!]!
```

#### Mutations

```graphql
# Servers
createBbbServer(input: CreateBbbServerInput!): BbbServer!
updateBbbServer(id: ID!, input: UpdateBbbServerInput!): BbbServer!
deleteBbbServer(id: ID!): Boolean!

# Organizations
createBbbOrganization(input: CreateBbbOrganizationInput!): BbbOrganization!
updateBbbOrganization(id: ID!, input: UpdateBbbOrganizationInput!): BbbOrganization!
deleteBbbOrganization(id: ID!): Boolean!

# Staff
addBbbMember(input: AddBbbMemberInput!): BbbOrganizationMember!
updateBbbMember(id: ID!, input: UpdateBbbMemberInput!): BbbOrganizationMember!
removeBbbMember(id: ID!): BbbOrganizationMember!

# Meetings
createBbbMeeting(input: CreateBbbMeetingInput!): BbbMeeting!
retryBbbMeeting(failedMeetingId: ID!): BbbMeeting!   # resets room FSM + creates new meeting
updateBbbMeeting(id: ID!, input: UpdateBbbMeetingInput!): BbbMeeting!
deleteBbbMeeting(id: ID!): Boolean!
endBbbMeeting(id: ID!): BbbMeeting!

# Capacity grants (Plans)
createBbbCapacityGrant(input: CreateBbbCapacityGrantInput!): BbbCapacityGrant!

# Rooms
createBbbRoom(input: CreateBbbRoomInput!): BbbRoom!
updateBbbRoom(id: ID!, input: UpdateBbbRoomInput!): BbbRoom!
deleteBbbRoom(id: ID!): Boolean!
resetBbbRoom(id: ID!): BbbRoom!   # clears Failed state, resets retryCount to 0

# Product access & enrollments
createBbbProductAccess(input: CreateBbbProductAccessInput!): BbbProductAccess!
deleteBbbProductAccess(id: ID!): Boolean!
createBbbEnrollment(input: CreateBbbEnrollmentInput!): BbbEnrollment!
deactivateBbbEnrollment(id: ID!): BbbEnrollment!

# Scheduled sessions
createBbbScheduledSession(input: CreateBbbScheduledSessionInput!): BbbScheduledSession!
cancelBbbScheduledSession(id: ID!): BbbScheduledSession!
```

### Shop API

All shop queries require `Authenticated` permission (logged-in customer).

#### Queries

```graphql
myBbbMeetings(skip: Int, take: Int): BbbMeetingPublicList!
myBbbCapacityGrants: [BbbCapacityGrantPublic!]!    # shows grantedMinutes, consumedMinutes
myBbbRooms: [BbbRoomPublic!]!
bbbRoomStatus(id: ID!): BbbRoomPublic              # poll this while status=provisioning
myBbbEnrollments: [BbbEnrollmentPublic!]!
myScheduledSessions: [BbbScheduledSessionPublic!]!
```

#### Mutations

```graphql
# Primary join entry point — handles provisioning + authorization in one call
bbbJoinRoom(roomId: ID!, participantName: String!): BbbJoinRoomResult!
# Returns: { status: "active" | "provisioning" | "failed", joinUrl?: String }

# Legacy: direct meeting join (bypasses room FSM)
bbbJoinMeeting(meetingId: ID!, participantName: String!): String!

# Trainer: start a scheduled session
startScheduledSession(sessionId: ID!): BbbScheduledSessionPublic!
```

---

## File Reference

```
src/plugins/bigbluebutton-plugin/
├── index.ts                              # Barrel export + event classes
├── bigbluebutton.plugin.ts               # Plugin class + DI registration
├── constants.ts                          # FSM states, permissions, queue names, org roles
├── types.ts                              # BigBlueButtonPluginOptions interface
│
├── entities/
│   ├── bbb-server.entity.ts              # BBB server (API secret AES-256-GCM)
│   ├── bbb-organization.entity.ts        # Tenant (1:1 with Channel)
│   ├── bbb-meeting.entity.ts             # Meeting FSM + encrypted passwords + grantId
│   ├── bbb-capacity-grant.entity.ts      # Minute-credit entitlement
│   ├── bbb-usage-ledger.entity.ts        # Billing audit trail (unique meeting+grant)
│   ├── bbb-organization-member.entity.ts # Staff membership + role
│   ├── bbb-room.entity.ts                # Persistent space (optimistic lock via version)
│   ├── bbb-scheduled-session.entity.ts   # Business-level scheduled session
│   ├── bbb-enrollment.entity.ts          # Student room access (via purchase)
│   └── bbb-product-access.entity.ts      # ProductVariant → BbbRoom mapping
│
├── services/
│   ├── bbb-encryption.service.ts         # AES-256-GCM encrypt/decrypt
│   ├── bbb-api.service.ts                # BBB REST adapter (SHA-256 checksum, OTEL)
│   ├── bbb-server.service.ts             # Server CRUD + load-aware selection
│   ├── bbb-organization.service.ts       # Org CRUD + quota enforcement
│   ├── bbb-meeting.service.ts            # Meeting lifecycle + join URL + room join
│   ├── bbb-member.service.ts             # Staff membership CRUD + role checks
│   ├── bbb-room.service.ts               # Room FSM + distributed provisioning
│   ├── bbb-scheduled-session.service.ts  # Session lifecycle + trainer activation
│   ├── bbb-reconciliation.service.ts     # Reconciliation + billing
│   ├── bbb-room-lock.service.ts          # Redis distributed lock (heartbeat)
│   └── bbb-metrics.service.ts            # In-memory metrics collector
│
├── events/
│   └── bbb-events.ts                     # 5 domain events
│
├── api/
│   ├── bbb-admin.resolver.ts             # Admin GraphQL resolvers
│   ├── bbb-shop.resolver.ts              # Shop GraphQL resolvers
│   └── schema/
│       ├── bbb-admin.schema.ts           # Admin API SDL
│       └── bbb-shop.schema.ts            # Shop API SDL
│
├── config/
│   └── bbb-fulfillment.ts                # FulfillmentHandler + enrollment creation
│
├── workers/
│   └── bbb-webhook.controller.ts         # Webhook receiver (HMAC, dual format)
│
├── jobs/
│   └── bbb-reconciliation.task.ts        # ScheduledTask (every 5 min)
│
├── __tests__/
│   └── bbb-billing.spec.ts               # Billing lifecycle test suite
│
└── dashboard/
    ├── index.tsx                         # Dashboard extension entry
    └── routes/
        ├── servers/
        │   └── ServersList.tsx
        ├── organizations/
        │   └── OrganizationsList.tsx
        ├── rooms/
        │   └── RoomsList.tsx
        ├── meetings/
        │   └── MeetingsList.tsx           # auto-refresh 15s
        ├── plans/
        │   └── PlansList.tsx              # Capacity grant management + usage bars
        ├── enrollments/
        │   └── EnrollmentsList.tsx
        └── members/
            └── MembersList.tsx
```

---

## Roadmap

| Feature | Priority |
|---------|----------|
| **Keycloak SSO** — link `keycloakSub` on `BbbOrganizationMember` for SSO identity resolution | High |
| **Prometheus metrics export** — migrate from in-memory to exportable counters | High |
| **Recording platform** — S3/MinIO storage, signed playback URLs | High |
| **Attendance analytics** — participant history, session duration dashboards | Medium |
| **Usage ledger Admin UI** — drill into billing history per org per grant | Medium |
| **Server placement engine** — region-aware routing, maintenance mode, draining | Medium |
| **Scheduled session ↔ room linkage** — add `roomId` to sessions so enrolled students auto-see upcoming classes | Medium |
| **Room scheduler** — recurring weekly slots, calendar export | Low |
| **Room lock Prometheus metrics** — expose lock contention as exportable counters | Low |