# Runtime Flow

> **Purpose:** Document every event-driven flow across the platform. Shows service interactions, events, queues, and listeners.

---

## Tenant Registration

```
registerNewTenant(input)
  │
  ├─ 1. Persist TenantRegistrationLog { status: PENDING }
  ├─ 2. Create Seller (Vendure core)
  ├─ 3. Create Channel (unique channelCode/channelToken)
  ├─ 4. Create channel-scoped Role (TENANT_ADMIN_ROLE_PERMISSIONS)
  ├─ 5. Create Administrator (email + password)
  ├─ 6. Create TenantProfile (assignToCurrentChannel)
  ├─ 7. Create BbbOrganization (auto-provisions internal_overhead grant)
  └─ 8. Mark TenantRegistrationLog { status: COMPLETED }
       → Return { channelToken }
```

**Transaction:** All steps wrapped in `@Transaction()` — rolls back on any failure.

---

## Meeting Join

```
bbbJoinRoom(roomId, participantName)
  │
  ├─ INV-027: BbbRoomAccessService.evaluate()   ← BEFORE provisioning (BUG-045 fix)
  │    ├─ Source 1: BbbOrganizationMembership? → org_admin/moderator = MODERATOR, staff = VIEWER
  │    ├─ Source 2: BbbOrganizationMember (legacy)? → MODERATOR
  │    ├─ Source 3: BbbEntitlement { type: 'bbb_room' } (valid window)? → attendee
  │    ├─ Source 4: BbbEnrollment (active, in-window)? → attendee
  │    └─ No source passes → Access Denied (nothing enqueued, no grant linkage)
  │
  ├─ requestProvisioning(roomId)
  │    └─ Acquires Redis distributed lock on roomId
  │
  └─ If room is Idle:
       └─ createRoomMeetingAndEnqueue()
            └─ BullMQ: bbb-meeting-provisioning
  (If room is Active: join URL built from access.isModerator)
```

---

## Meeting Provisioning (BullMQ Worker)

```
bbb-meeting-provisioning job
  │
  ├─ Load meeting (pessimistic_write lock)
  ├─ Transition: PENDING → PROVISIONING
  ├─ Select BBB server (lowest currentLoad)
  ├─ Resolve earliest-expiring BbbCapacityGrant
  ├─ Call BBB createMeeting API
  ├─ Encrypt attendee/moderator passwords (AES-256-GCM)
  ├─ Store grantId on meeting (immutable billing linkage)
  ├─ Transition: PROVISIONING → ACTIVE
  ├─ Publish MeetingProvisionedEvent
  └─ Notify room: onMeetingActive()
```

---

## Webhook Processing

```
BBB POST /bbb/webhook/:serverId
  │
  ├─ Load the registered server and decrypt its API secret
  ├─ Reconstruct the configured callback URL (do not trust Host headers)
  ├─ Verify BBB callback authentication against the raw request body
  ├─ Parse the event array and discard non-allow-listed event types
  ├─ Compute a per-server SHA-256 deduplication key
  ├─ Persist BbbWebhookEvent { status: PENDING | PARSE_FAILED }
  ├─ If parsing succeeded and an allow-listed event exists:
  │    enqueue the persisted event ID to BullMQ: bbb-webhook-processor
  └─ Acknowledge the accepted delivery; persistence failure returns 5xx

bbb-webhook-processor job
  │
  ├─ Load BbbWebhookEvent by id
  ├─ Call BbbWebhookProcessorService / meeting lifecycle handlers
  │    ├─ meeting-ended → complete meeting lifecycle
  │    │    ├─ Transition meeting: ACTIVE → COMPLETED
  │    │    ├─ Reset room: Idle, currentMeetingId: null
  │    │    └─ Apply grant consumption where the meeting uses grant billing
  │    │         ├─ Calculate billable usage
  │    │         ├─ Write immutable BbbUsageLedger fact
  │    │         └─ Update the linked grant's consumed minutes
  │    ├─ metered billing path → write BbbMeteredUsage from per-minute samples
  │    └─ Update session attendance / recording facts where event data supports it
  └─ Mark processing outcome; retry failures through the queued worker
```

---

## Razorpay Checkout Webhook Processing (Flow A — platform payments)

```
Razorpay POST /payments/razorpay/checkout-webhook
  │
  ├─ Verify X-Razorpay-Signature against the exact raw request body
  ├─ Resolve the provider event id (header preferred; payload fallback)
  ├─ Persist PaymentWebhookEvent before processing
  │    └─ UNIQUE(provider, providerEventId) is the duplicate-delivery boundary
  ├─ Enqueue only the persisted inbox-row ID to BullMQ:
  │    payment-webhook-reconciliation
  └─ Return success only after the inbox event is durable and enqueued

payment-webhook-reconciliation job
  │
  ├─ Load the PaymentWebhookEvent by ID
  ├─ Ignore non-settlement event types and terminal/duplicate deliveries
  ├─ Resolve the Vendure order from the persisted provider/order binding
  ├─ Require the order to remain in ArrangingPayment
  ├─ Re-read Razorpay order/payment server-to-server
  ├─ Verify payment/order binding, amount, currency and payment state
  ├─ Settle through Vendure OrderService.addPaymentToOrder()
  └─ Persist processing outcome; retry non-terminal failures, stop at the
     configured attempt limit
```

**Boundary:** Flow A uses Saa9vi's platform Razorpay credentials for tenant-admin payments to Saa9vi. It is separate from the recurring-subscription webhook below and from Flow B tenant-client collections.

---

## Razorpay Webhook Processing

```
Razorpay POST /payments/razorpay/webhook
  │
  ├─ Verify HMAC-SHA256 signature (raw body bytes)
  ├─ Persist ProviderWebhookEvent { status: 'pending' } (webhook receipt is
  │    immutable; processing metadata is mutable — see INV-004)
  ├─ Enqueue eventId to BullMQ: provider-webhook-processing
  └─ Return { status: 'ok' } immediately (201)

provider-webhook-processing job
  │
  ├─ Load ProviderWebhookEvent by id
  ├─ Increment attemptCount
  ├─ Resolve channel from SubscriptionProviderBinding (INV-001) — inside the
  │    try/catch, so a DB exception during resolution follows the same
  │    terminal-failure/retry bookkeeping as any other worker failure
  ├─ Route to RazorpayWebhookProcessor.processInboxEvent()
  │    │
  │    ├─ REPLAY BOUNDARY: findAttemptByProviderEventId(providerEventId)
  │    │    ├─ Terminal 'succeeded' attempt found:
  │    │    │    └─ reconcileTerminalAttempt() → replay finalizeAfterPayment()
  │    │    │         (cycle-monotonic CAS makes replay a no-op when already done)
  │    │    ├─ Terminal 'failed' attempt found:
  │    │    │    └─ no-op (fully complete)
  │    │    └─ No terminal attempt / only 'initiated': continue processing
  │    │
  │    ├─ normalizeEvent() → NormalizedBillingEvent
  │    │    including providerPeriodStart / providerPeriodEnd
  │    │    (from Razorpay current_start / current_end, Unix seconds → Date, UTC)
  │    │
  │    ├─ Handle by event type:
  │    │    ├─ subscription.pending
  │    │    │    ├─ requireProviderCycleForFailure() — throws if cycle absent
  │    │    │    ├─ updateBinding() (atomic: binding + subscription providerStatus)
  │    │    │    └─ markPastDueFromWebhook(subscriptionId, providerCycleStart)
  │    │    │         cycle-identity guard: providerCycleStart <= localPeriodStart → no-op
  │    │    │
  │    │    ├─ subscription.authenticated
  │    │    │    └─ updateBinding()
  │    │    │
  │    │    ├─ subscription.activated (charge-bearing path)
  │    │    │    ├─ assertProviderCyclePresent() — throws before any mutation if absent
  │    │    │    ├─ updateBinding() (atomic: binding + subscription providerStatus)
  │    │    │    └─ recordAttempt() → finalizeAfterPayment()
  │    │    │
  │    │    ├─ subscription.charged
  │    │    │    ├─ assertProviderCyclePresent() — throws before any mutation
  │    │    │    └─ recordAttempt() → finalizeAfterPayment()
  │    │    │
  │    │    ├─ subscription.halted
  │    │    │    ├─ requireProviderCycleForFailure() — throws if cycle absent
  │    │    │    ├─ updateBinding() (atomic)
  │    │    │    ├─ markPastDueFromWebhook(subscriptionId, providerCycleStart)
  │    │    │    └─ recordAttempt('failed') when payment details present
  │    │    │
  │    │    ├─ subscription.cancelled
  │    │    │    ├─ updateBinding() (atomic)
  │    │    │    └─ markCancelledFromWebhook()
  │    │    │
  │    │    └─ payment.failed / payment.charge_failed
  │    │         └─ recordAttempt('failed')
  │    │
  │    └─ Attempt persistence (INV-019, all via SubscriptionBillingAttemptService):
  │         ├─ Existing 'initiated' attempt (FIFO on attemptedAt):
  │         │    recordAttemptSuccess / recordAttemptFailure — provider IDs AND
  │         │    billingPeriodStart / billingPeriodEnd written in the SAME atomic
  │         │    CAS UPDATE as the terminal status (INV-020):
  │         │      succeeded:             both = authoritative provider cycle (YYYY-MM-DD, UTC)
  │         │      failed + cycle known:  both = confirmed provider failure cycle
  │         │      failed + no cycle:     both = NULL (cleared by CAS, not preserved)
  │         └─ No initiated attempt:
  │              recordAttemptFromWebhook() creates exactly ONE terminal attempt;
  │              billingPeriodStart/End = provider cycle dates, or NULL for failed
  │              attempts without a provider cycle (INV-020: cycle identity only)
  │
  │    finalizeAfterPayment(attemptId) — on succeeded attempt:
  │         ├─ Read billingPeriodStart / billingPeriodEnd from attempt row
  │         │    (no re-parsing of original webhook payload)
  │         ├─ Absent billingPeriodEnd → reconciliation incident (INV-020 fail-closed)
  │         └─ finalizeRenewalPeriod(targetStart, targetEnd):
  │              cycle-monotonic CAS:
  │                WHERE version = :v
  │                  AND (currentPeriodStart IS NULL OR currentPeriodStart < :targetStart)
  │              CAS success → publish SubscriptionRenewedEvent + SubscriptionInvoicePaidEvent
  │              CAS fail → reload + classify:
  │                cancelled            → SUCCESS (terminal guard)
  │                cycle already met    → SUCCESS (idempotent replay)
  │                version race, target still ahead → retry (max 3, safe — no charge)
  │                retry exhausted      → reconciliation incident
  │
  ├─ Mark ProviderWebhookEvent { status: 'processed', processedAt, channelId }
  │
  ├─ On exception (including MissingProviderCycleError) + attempts left:
  │    ├─ Persist binding-resolved channelId + errorMessage (INV-001: a retrying
  │    │    inbox event stays tenant-attributable)
  │    └─ Keep status: 'pending', rethrow for BullMQ retry
  │
  └─ On exception + MAX_ATTEMPTS exhausted:
       └─ Mark ProviderWebhookEvent { status: 'failed', failedAt } (terminal),
            retaining channelId + errorMessage for per-tenant triage
```

### Failure Semantics

```
attempt 1 fails → pending, attemptCount=1
attempt 2 fails → pending, attemptCount=2
attempt 3 fails → failed, attemptCount=3, failedAt populated (terminal)
```

---

## Order Fulfillment → Entitlement

```
OrderStateTransitionEvent { toState: 'PaymentSettled' }
  │
  └─ BbbOrderFulfillmentListener.handlePaymentSettled()
       │
       ├─ For each order line:
       │    ├─ Check BbbScheduledSession by productVariantId
       │    │    └─ Found → create BbbEntitlement { type: 'bbb_session' }
       │    │              → continue (skip room path)
       │    │
       │    └─ Check BbbProductAccess by productVariantId
       │         └─ Found → create BbbEntitlement { type: 'bbb_room' }
       │
       └─ (Legacy parallel path: bbbFulfillmentHandler
            writes BbbEnrollment + BbbCapacityGrant)
```

---

## Trial Registration

```
registerForTrial(sessionId)
  │
  ├─ Validate session.isTrial = true
  ├─ Validate capacity (maxAttendees not exceeded)
  ├─ Create BbbTrialRegistration { status: REGISTERED }
  └─ Create BbbEntitlement { type: 'bbb_session', source: 'trial' }
       (non-fatal if creation fails)
```

---

## Reconciliation (Every 5 minutes)

```
bbb-reconciliation scheduled task (every 5 minutes)
  │
  ├─ Snapshot and reset the current BBB metrics window
  ├─ reconcileProvisioning()
  │    └─ Recover or fail meetings stuck in PROVISIONING past the timeout/retry policy
  ├─ reconcileActiveMeetings()
  │    ├─ Query BBB for meetings beyond the grace period
  │    ├─ Complete only on a confirmed remote end; transient outages/rejections are not proof
  │    └─ Force-complete meetings beyond maxMeetingDurationMs (billing ceiling)
  ├─ reconcileRooms()
  │    └─ Repair room/meeting state drift (Provisioning/Active → authoritative state)
  ├─ reconcilePendingBilling()
  │    └─ Recover completed grant-billed meetings missing their BbbUsageLedger fact
  ├─ reconcilePendingMeteredBilling()
  │    └─ Recover completed metered meetings missing BbbMeteredUsage
  ├─ repairRecordings()
  │    └─ Repair missing BBB recording IDs/playback URLs for bounded recent candidates
  └─ scanOrphanMeetings()
       └─ Report remote BBB meetings with no local row; report-only, never auto-end
```

---

## Capacity Intelligence (Every 15min)

```
bbb-capacity-alert scheduled task
  │
  ├─ CapacityIntelligenceService.buildDashboard()
  │    ├─ Live pool health (server loads, participants)
  │    ├─ 48h load forecast (from scheduled sessions)
  │    └─ Capacity recommendation
  │
  ├─ Append BbbCapacityAlertLog row (always)
  │
  └─ If urgency = 'immediate' or 'soon':
       └─ Publish CapacityAlertEvent → Email plugin
```

---

## Banner Activation (Every 60s)

```
banner-activator scheduled task
  │
  ├─ Find banners where isActive=true AND startsAt<=NOW AND isCurrentlyActive=false
  │    └─ Set isCurrentlyActive = true
  │
  └─ Find banners where isCurrentlyActive=true AND (isActive=false OR endsAt<NOW)
       └─ Set isCurrentlyActive = false
```

---

## Scheduled Session Lifecycle

> Added 2026-09-20 to reflect the DRAFT state and template/recurring session features.

### Direct session creation

```
createBbbScheduledSession(input)  [Admin API]
  │
  ├─ assert organization/channel access (BbbChannelAccessService)
  ├─ validate session inputs
  ├─ lock BbbOrganization row FOR UPDATE (same @Transaction() as insert)
  ├─ count DRAFT + SCHEDULED + LIVE sessions
  ├─ enforce maxSessionsPerOrg (0 = unlimited)
  └─ persist BbbScheduledSession  status = DRAFT
       │
       └─ SessionCreatedEvent
            └─ MarketplaceEventListener → addIndexSessionJob
                 └─ DRAFT is not marketplace-eligible → no-op / remove
```

### Template / recurring session generation

```
createBbbSessionTemplate(input)  [Admin API]
  │
  ├─ validate durationMinutes (1–1440)
  ├─ validate defaultTrainerId is active member of organization
  └─ persist BbbSessionTemplate

createSessionsFromTemplate(templateId, startTimes[])  [Admin API]
  │
  ├─ validate batch (1..100 occurrences, valid ISO-8601, no duplicates)
  ├─ validate template trainer still active in org
  ├─ lock BbbOrganization row FOR UPDATE (same @Transaction() as all inserts)
  ├─ count DRAFT + SCHEDULED + LIVE sessions
  ├─ enforce maxSessionsPerOrg for entire batch
  └─ persist each BbbScheduledSession  status = DRAFT
       │
       └─ SessionCreatedEvent per session → marketplace no-op (DRAFT ineligible)
```

### Publication

```
publishBbbScheduledSession(id)  [Admin API]
  │
  ├─ assert session/channel access
  ├─ require status = DRAFT  (any other status → error)
  ├─ status → SCHEDULED
  └─ SessionUpdatedEvent
       └─ MarketplaceEventListener → addIndexSessionJob
            ├─ PUBLIC + SCHEDULED → indexed in saa9vi_marketplace_sessions
            └─ PRIVATE or other status → removed
```

### Session start (trainer)

```
startScheduledSession(sessionId)  [Shop API, trainer only]
  │
  ├─ require status = SCHEDULED  (DRAFT → clear error: publish first)
  └─ BbbMeetingService.createAndEnqueue()
       │
       └─ BullMQ provisioning job
            └─ BbbApiService.createMeeting()
                 │
                 └─ MeetingProvisionedEvent
                      └─ BbbSessionProvisioningListener
                           ├─ session.status → LIVE
                           └─ SessionStartedEvent
                                └─ MarketplaceEventListener → addIndexSessionJob
                                     └─ PUBLIC + LIVE → indexed / re-indexed
```

### Session completion

```
BBB meeting ended
  │
  └─ BbbWebhookProcessor / BbbReconciliationService
       └─ MeetingCompletedEvent
            └─ BbbSessionProvisioningListener
                 ├─ session.status → FINISHED
                 └─ SessionEndedEvent
                      └─ MarketplaceEventListener → addIndexSessionJob
                           └─ FINISHED is not eligible → removed from index
```

### Session cancellation

```
cancelBbbScheduledSession(id)  [Admin API]
  │
  ├─ status → CANCELLED
  └─ SessionCancelledEvent
       └─ MarketplaceEventListener → addIndexSessionJob
            └─ CANCELLED is not eligible → removed from index
```

**Marketplace eligibility rule** (sole arbiter — `MarketplaceIndexerService.indexSession()`):

```
visibility === PUBLIC  AND  status IN (SCHEDULED, LIVE)
  → indexed / updated

anything else (DRAFT, FINISHED, CANCELLED, PRIVATE)
  → removed from public index
```

---

## Marketplace Indexing

> Corrected 2026-09-04 to match the implemented event→projection contract (see Gate 1.4 matrix in `phase3-audit.md`). All session projection paths pass through `MarketplaceIndexerService.indexSession()`, which is the sole arbiter of public eligibility: `visibility === PUBLIC` AND `status IN (SCHEDULED, LIVE)` — eligible sessions are indexed/updated; everything else is removed from the public index.

**Instructor projection**

```
InstructorProfileCreatedEvent
  │
  └─ MarketplaceEventListener
       └─ MarketplaceIndexQueueService.enqueue('index-instructor', profileId)
            └─ BullMQ: marketplace-index
                 └─ MarketplaceIndexerService.indexInstructor()
                      └─ Write to saa9vi_marketplace_instructors ES index

InstructorProfileUpdatedEvent
  │
  ├─ Reindex the instructor document (as above)
  └─ Resolve BbbInstructorAssignment rows for that profile
       └─ enqueue('index-session', sessionId) for each affected session
            └─ Session docs embed instructorName — stale names are corrected here
```

**Session lifecycle projection**

```
SessionCreatedEvent / SessionUpdatedEvent / SessionStartedEvent / SessionCancelledEvent
  │
  └─ MarketplaceEventListener
       └─ addIndexSessionJob(sessionId)
            └─ BullMQ: marketplace-index
                 └─ MarketplaceIndexerService.indexSession(sessionId)
```

**Product variant projection**

```
ProductVariantEvent (create/update/delete)
  │
  └─ MarketplaceEventListener
       ├─ Decode GraphQL variant IDs
       ├─ Resolve BbbScheduledSession rows by productVariantId
       └─ addIndexSessionJob(sessionId) for each affected session
            └─ indexSession(sessionId)
```

**Product variant price projection**

```
ProductVariantPriceEvent (channel price create/update/delete)
  │
  └─ MarketplaceEventListener
       ├─ Extract productVariantId from price entities
       ├─ Resolve affected BbbScheduledSession rows
       └─ addIndexSessionJob(sessionId)
            └─ indexSession(sessionId)
```

> Vendure emits `ProductVariantPriceEvent` — not `ProductVariantEvent` — for channel price mutations, so this path is required; price-only changes otherwise leave stale `priceInPaise` in ES documents.

**Academy / review projection**

```
TenantProfileUpdatedEvent
  └─ handleAcademyProfileChange() → bulk channel reindex

ReviewApprovedEvent / ReviewRejectedEvent / ReviewHiddenEvent
  └─ Affected sessions → recompute Bayesian rating → indexSession()
```

---

## Customer Deletion

```
leaveAcademy() / deleteMyAccount()
  │
  └─ CustomerDeletionService
       ├─ BBB handler: anonymize enrollments/entitlements and retain immutable billing facts
       ├─ Tenant handler: anonymize InstructorProfile and MediaResource
       ├─ Learning handler: remove or anonymize learner/course-enrollment records in scope
       └─ Reviews handler: anonymize ProductReview.authorName and deactivate ReviewRequest
```

---

## Room Access Evaluation (INV-027 — shared by bbbJoinRoom and bbbRoomStatus)

```
bbbJoinRoom(roomId) / bbbRoomStatus(id)
  │
  ├─ BbbRoomAccessService.evaluate() — ONE decision, both surfaces (BUG-045 fix)
  │    ├─ Source 1: BbbOrganizationMembership.findActiveMembership()
  │    │    ├─ Found → allowed; org_admin/moderator → MODERATOR, staff → VIEWER
  │    │    └─ Not found → continue
  │    ├─ Source 2: BbbMemberService.findActiveMembership() (legacy)
  │    │    ├─ Found → allowed; valid legacy roles (org-admin/trainer) → MODERATOR
  │    │    └─ Not found → continue
  │    ├─ Source 3: BbbEntitlement { type: 'bbb_room' }, validFrom <= now <= validUntil
  │    │    ├─ Valid → allowed (attendee)
  │    │    └─ Invalid → continue
  │    └─ Source 4: BbbEnrollment (active: true, validUntil/expiresAt in window)
  │         ├─ Valid → allowed (attendee)
  │         └─ Invalid or absent → Access Denied
  │
  └─ bbbJoinRoom delegates to BbbMeetingService.joinRoom(), where evaluation runs
     BEFORE requestProvisioning (BUG-045 #3) — a denied customer never enqueues a
     meeting; bbbRoomStatus throws ForbiddenError on denial (preview denial ⇔ join denial)
```
