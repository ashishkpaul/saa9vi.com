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

## Tenant Razorpay Checkout and Settlement (Flow B — G-1)

```
Authenticated tenant customer in the owning Channel
  │
  ├─ createTenantRazorpayCheckoutOrder(orderId)
  │    ├─ Require authenticated user
  │    ├─ Reload order with channels + customer.user
  │    ├─ Require current Channel + exact customer owner
  │    ├─ Require ArrangingPayment + positive total
  │    ├─ Reject paymentPurpose = 'platform-service'
  │    ├─ Require tenant account active + enabled
  │    └─ Create Razorpay Order with that Channel's credentials
  │
  ├─ Browser opens Razorpay Checkout with public tenant Key ID
  │
  └─ addPaymentToOrder(method: 'tenant-razorpay', metadata)
       │
       ├─ tenantRazorpayPaymentHandler.createPayment()
       │    └─ TenantRazorpayService.verifyAndSettle()
       │         ├─ Require authenticated Shop API user
       │         ├─ Reload/order-owner/channel/state checks
       │         ├─ Reject Flow A platform-service purpose
       │         ├─ Reject previously persisted Payment.transactionId
       │         ├─ Re-read tenant account; require active + enabled
       │         ├─ Decrypt tenant Key Secret only after account check
       │         ├─ Verify Razorpay Checkout HMAC (constant-time)
       │         ├─ Fetch Razorpay Order/Payment server-to-server
       │         ├─ Verify provider IDs, Vendure receipt/notes, amount/currency
       │         ├─ Capture authorized payment only after pre-capture checks
       │         └─ Require final provider payment status = captured
       │
       └─ Return Settled to Vendure PaymentMethodHandler
            └─ Vendure records the Payment through addPaymentToOrder
```

**Boundary:** Flow B uses only the tenant's Razorpay credentials resolved from the active Vendure Channel. Flow A remains a separate `razorpay` handler using platform credentials and `paymentPurpose = 'platform-service'`. G-1 handles synchronous Shop settlement only; it does not yet provide tenant webhook recovery. A payment captured by Razorpay just before a browser/network failure can require manual recovery until G-3 adds the tenant webhook inbox and reconciler. The duplicate transaction lookup rejects previously persisted payment IDs but is not an atomic concurrent-payment reservation.

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


---

## Course lifecycle and learner access (LearningPlugin / ADR-053)

### Course creation and tool snapshot

```text
createLearningCourse(input) [Admin API; tenant channel from RequestContext]
  |
  +-- validate slug/title
  +-- create LearningCourse { channelId, status: DRAFT, templateId }
  |
  +-- if templateId was supplied:
  |     load platform-default template (channelId NULL)
  |       or current-channel template
  |     validate each toolKey/settings through CourseToolRegistry
  |     copy CourseTemplateTool rows into CourseTool rows
  |
  +-- otherwise:
        enumerate CourseToolRegistry definitions
        create default CourseTool rows
```

The registry is populated during module initialization. LearningPlugin contributes `description`, `users`, `agenda`, and `announcements`; BigBlueButtonPlugin contributes `videoconference`. Tool routes/definitions are trusted code. Course tool visibility is presentation metadata, not a grant to join a BBB room.

### Enrollment and publication

```text
enrollLearner(courseId, customerId) [Admin API]
  |
  +-- assert course belongs to ctx.channelId
  +-- reject CLOSED / ARCHIVED course
  +-- LearnerAdmissionPort.isActiveMember(customerId, channelId)
  |     +-- false -> Forbidden
  |     +-- true  -> continue
  +-- create/reactivate CourseEnrollment as ENROLLED
        (COMPLETED / WITHDRAWN rows are terminal)

myCoursePages / myCoursePage(slug) [Shop API]
  |
  +-- resolve active User -> Vendure Customer
  +-- resolve course in ctx.channelId and require PUBLISHED
  +-- require CourseEnrollment.status = ENROLLED
  +-- require ACTIVE academy admission via LearnerAdmissionPort
  +-- return course + visible CoursePage.tools
```

Shop API also exposes `coursePageAnnouncements(courseId)`, subject to the same published-course, enrolled-customer and active-admission checks; only PUBLISHED announcements are returned.

The current Shop schema does not expose enrollment or invitation acceptance. The Admin mutation `enrollLearner` creates an ENROLLED enrollment directly. `INVITED` is a modeled state but no invitation creation/acceptance API is registered. CourseTemplate entities and snapshotting exist, but template CRUD is not exposed in the current GraphQL schema.

### Course lifecycle

```text
DRAFT --publishLearningCourse--> PUBLISHED
PUBLISHED --closeLearningCourse--> CLOSED
CLOSED --archiveLearningCourse (SuperAdmin)--> ARCHIVED
```

### Course-to-BBB scheduled-session association

`addCourseSession(courseId, sessionId)` checks that both the course and the existing `BbbScheduledSession` belong to the active channel, then stores a scalar association row. The LearningPlugin does not own the BBB session lifecycle; joining and room authorization remain in BigBlueButtonPlugin.

---

## One-time Razorpay checkout — Flow A (PaymentsPlugin)

```text
createRazorpayCheckoutOrder(orderId?) [Shop API]
  |
  +-- require authenticated caller
  +-- resolve active/explicit order and check channel + customer ownership
  +-- require order.state = ArrangingPayment and total > 0
  +-- require order.customFields.paymentPurpose = 'platform-service'
  +-- create provider order with platform RAZORPAY_KEY_ID/SECRET
  +-- return public checkout handle
  |
  +-- addPaymentToOrder(method: 'razorpay')
        +-- razorpayPaymentHandler -> RazorpayCheckoutService.verifyAndSettle()
        +-- fetch provider order/payment and validate signature/binding
        +-- capture when required
        +-- return Settled only after server-side provider verification
```

The platform one-time webhook route is `POST /payments/razorpay/checkout-webhook`. It verifies the Razorpay HMAC over the raw request body, persists a `PaymentWebhookEvent` inbox record, enqueues the inbox ID to `payment-webhook-reconciliation`, and then acknowledges the delivery. The worker reconciles only settling events (`payment.captured`, `order.paid`) and uses bounded retries. This flow is deliberately separate from recurring subscriptions.

## Per-tenant Razorpay checkout — Flow B (partial implementation)

```text
Admin: upsertTenantPaymentAccount
  |
  +-- encrypt Key Secret (+ optional webhook secret) with AES-256-GCM
  +-- persist channel-scoped TenantPaymentAccount as pending / disabled
  |
Admin: verifyTenantPaymentAccount
  +-- GET /payments?count=1 using tenant Key ID/Secret
  +-- on success mark account active (does not enable it)
  |
Admin: setTenantPaymentAccountEnabled(true)
  |
Shop: createTenantRazorpayCheckoutOrder(orderId?)
  +-- require authenticated caller (`ctx.activeUserId`)
  +-- resolve account from ctx.channelId; require active + enabled
  +-- explicit order ID or OrderService.getActiveOrderForUser(ctx, activeUserId)
  +-- reload with channels + customer.user
  +-- require current Channel AND customer.user.id = activeUserId
  +-- require ArrangingPayment and total > 0
  +-- only then resolve/decrypt tenant credentials
  +-- create Razorpay order using tenant credentials
  +-- return provider order ID, amount, currency and public Key ID
```

**Current stopping point:** the reviewed `PaymentsPlugin` does not register a tenant-specific Vendure `PaymentMethodHandler`. `TenantRazorpayService.verifyAndSettle()` contains signature/provider-binding logic but has no registered handler/call site, so the order-creation path is not yet connected to `addPaymentToOrder` and Vendure order settlement. No tenant-specific Flow B webhook controller, inbox or reconciliation worker exists. The platform `razorpayPaymentHandler` is Flow A only and rejects orders whose `paymentPurpose` is not `platform-service`.

**Credential-probe caveat:** `verifyTenantPaymentAccount` performs `GET /payments?count=1`; it does not create a ₹1 test order. `verifyTenantPaymentWebhook` only confirms that the configured encrypted webhook secret exists and decrypts; it does not test a signed webhook delivery or verify a registered endpoint.

**G-2 owner-boundary update (17 November 2026):** service-level ownership enforcement is now implemented in the checkout-order path. Explicit and active-order paths both reload the order with `customer.user`, require exact equality with `ctx.activeUserId`, and fail closed for missing/foreign ownership. Targeted regression tests have been added; execution remains pending. This closes the source-level G-2 finding but does not close Flow B settlement (G-1) or webhook/recovery (G-3).



---

## Marketplace tenant-channel checkout target — ADR-055 proposal

**Status:** Target design, not current runtime behavior. The reviewed baseline remains marketplace discovery plus tenant-storefront routing; Flow B settlement/webhooks are incomplete per ADR-054.

```text
Marketplace listing
  -> trusted server resolves owner Channel and signed marketplace provenance
  -> marketplace storefront creates/loads tenant-channel cart
  -> tenant-channel order enters ArrangingPayment
  -> Shop API returns eligible payment methods for that tenant context
  -> selected tenant PaymentMethodHandler resolves that tenant's credentials
  -> provider payment verified and tenant order settled
  -> fulfilment is selected by product fulfilment model

Digital:
  -> activate CourseEnrollment / time-bounded BbbEntitlement / content access
  -> subscription renewal extends paid period; grace/expiry policy applies

Physical:
  -> stock allocation / physical fulfilment / dispatch / delivery / returns
```

Constraints: never create a tenant-owned order in the default marketplace channel; never trust browser-supplied channel/payee/credentials; initial cart/order contains one tenant only. Marketplace attribution records origin and does not grant channel/payment authority. See [ADR-055](../adr/adr-055-marketplace-commerce-and-revenue-model.md).
