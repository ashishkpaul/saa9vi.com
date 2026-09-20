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
  ├─ requestProvisioning(roomId)
  │    └─ Acquires Redis distributed lock on roomId
  │
  ├─ Gate 1: Organization Membership?
  │    ├─ Yes → provisionAndJoin() → moderator/attendee join URL
  │    └─ No → continue
  │
  ├─ Gate 2: BbbOrganizationMember (legacy)?
  │    ├─ Yes → isModerator? → moderator/attendee join URL
  │    └─ No → continue
  │
  ├─ Gate 3: BbbEntitlement { type: 'bbb_room' }?
  │    ├─ Yes → attendee join URL
  │    └─ No → Access Denied
  │
  └─ If room is Idle:
       └─ createRoomMeetingAndEnqueue()
            └─ BullMQ: bbb-meeting-provisioning
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
BBB POST /bbb/webhook
  │
  ├─ Validate HMAC signature
  ├─ Persist BbbWebhookEvent { status: PENDING }
  ├─ Enqueue eventId to BullMQ: bbb-webhook-processor
  └─ Return { ok: true } immediately

bbb-webhook-processor job
  │
  ├─ Load BbbWebhookEvent by id
  ├─ Call meetingService.handleWebhookEvent()
  │    ├─ meeting-ended → completeMeetingLifecycle()
  │    │    ├─ Transition: ACTIVE → COMPLETED
  │    │    ├─ Reset room: Idle, currentMeetingId: null
  │    │    └─ consumeGrantHours()
  │    │         ├─ Calculate duration (provisionedAt → completedAt)
  │    │         ├─ Write BbbUsageLedger row (append-only)
  │    │         └─ Increment grant.consumedMinutes
  │    └─ Update trial attendance from attendee data
  └─ Mark BbbWebhookEvent { status: PROCESSED }
       OR { status: FAILED } (retryable)
```

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
  ├─ Mark ProviderWebhookEvent { status: 'processed', processedAt }
  │
  ├─ On exception (including MissingProviderCycleError) + attempts left:
  │    └─ Keep status: 'pending', rethrow for BullMQ retry
  │
  └─ On exception + MAX_ATTEMPTS exhausted:
       └─ Mark ProviderWebhookEvent { status: 'failed', failedAt } (terminal)
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

## Reconciliation (Every 60s)

```
bbb-reconciliation scheduled task
  │
  ├─ 1. reconcileActiveMeetings()
  │    └─ For each Active meeting:
  │         ├─ Call BBB getMeetingInfo
  │         ├─ If null → markMeetingStale() (no ledger row)
  │         └─ If duration > maxMeetingDurationMs → force complete
  │              └─ Publish CapacityExhaustedEvent if billingCapped
  │
  ├─ 2. reconcileProvisioning()
  │    └─ For each Provisioning meeting past timeout:
  │         └─ Transition to FAILED
  │
  └─ 3. reconcileRooms()
       └─ Fix room/meeting state drift
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

## Scheduled Session Lifecycle

> Added 2026-09-20 (DRAFT state + template/recurring sessions).

### Direct session creation

```
createBbbScheduledSession(input)  [Admin API]
  │
  ├─ assert organization/channel access
  ├─ lock BbbOrganization row FOR UPDATE (same @Transaction() as insert)
  ├─ count DRAFT + SCHEDULED + LIVE sessions
  ├─ enforce maxSessionsPerOrg (0 = unlimited)
  └─ persist BbbScheduledSession  status = DRAFT
       │
       └─ SessionCreatedEvent → addIndexSessionJob
            └─ DRAFT ineligible → no-op / remove
```

### Template / recurring session generation

```
createBbbSessionTemplate(input)  [Admin API]
  │
  ├─ validate durationMinutes (1–1440)
  ├─ validate defaultTrainerId is active member of org
  └─ persist BbbSessionTemplate

createSessionsFromTemplate(templateId, startTimes[])  [Admin API]
  │
  ├─ validate batch (1..100, valid ISO-8601, no duplicates)
  ├─ validate template trainer still active in org
  ├─ lock BbbOrganization row FOR UPDATE (same @Transaction() as all inserts)
  ├─ count + enforce cap for entire batch atomically
  └─ persist each session  status = DRAFT
       └─ SessionCreatedEvent per session → DRAFT ineligible → no-op
```

### Publication

```
publishBbbScheduledSession(id)  [Admin API]
  │
  ├─ require status = DRAFT
  ├─ status → SCHEDULED
  └─ SessionUpdatedEvent → addIndexSessionJob
       ├─ PUBLIC + SCHEDULED → indexed
       └─ PRIVATE → removed
```

### Session start (trainer, Shop API)

```
startScheduledSession(sessionId)
  │
  ├─ require status = SCHEDULED  (DRAFT → error: publish first)
  └─ BbbMeetingService.createAndEnqueue()
       └─ BullMQ provisioning job → BbbApiService.createMeeting()
            └─ MeetingProvisionedEvent
                 └─ BbbSessionProvisioningListener
                      ├─ status → LIVE
                      └─ SessionStartedEvent → addIndexSessionJob
                           └─ PUBLIC + LIVE → indexed
```

### Session completion

```
BBB meeting ended → MeetingCompletedEvent
  └─ BbbSessionProvisioningListener
       ├─ status → FINISHED
       └─ SessionEndedEvent → addIndexSessionJob
            └─ FINISHED ineligible → removed from index
```

### Session cancellation

```
cancelBbbScheduledSession(id)  [Admin API]
  ├─ status → CANCELLED
  └─ SessionCancelledEvent → addIndexSessionJob
       └─ CANCELLED ineligible → removed from index
```

**Marketplace eligibility** (sole arbiter: `MarketplaceIndexerService.indexSession()`):
`visibility === PUBLIC AND status IN (SCHEDULED, LIVE)` → indexed.
All other states (DRAFT, FINISHED, CANCELLED) or PRIVATE visibility → removed.

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
       ├─ BBB handler: anonymize enrollments, entitlements; preserve ledger
       ├─ Tenant handler: anonymize InstructorProfile, MediaResource
       └─ Reviews handler: anonymize ProductReview.authorName, deactivate ReviewRequest
```

---

## Auth Waterfall (joinRoom)

```
joinRoom(roomId)
  │
  ├─ Gate 1: BbbOrganizationMembership.findActiveMembership()
  │    ├─ Found → provisionAndJoin(membership.role)
  │    │    ├─ org_admin/moderator → MODERATOR join URL
  │    │    └─ staff → VIEWER join URL
  │    └─ Not found → continue
  │
  ├─ Gate 2: BbbMemberService.findActiveMembership() (legacy)
  │    ├─ Found + isModerator → MODERATOR join URL
  │    └─ Not found → continue
  │
  └─ Gate 3: BbbEntitlementService.hasAccess(type: 'bbb_room')
       ├─ True → attendee join URL
       └─ False → Access Denied
