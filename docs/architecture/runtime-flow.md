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
