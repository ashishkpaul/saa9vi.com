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

```
InstructorProfileCreatedEvent / InstructorProfileUpdatedEvent
  │
  └─ MarketplaceEventListener
       └─ MarketplaceIndexQueueService.enqueue('index-instructor', profileId)
            └─ BullMQ: marketplace-index
                 └─ MarketplaceIndexerService.indexInstructor()
                      └─ Write to saa9vi_marketplace_instructors ES index

ProductVariantEvent
  │
  └─ MarketplaceEventListener
       └─ MarketplaceIndexQueueService.enqueue('index-session', variantId)
            └─ BullMQ: marketplace-index
                 └─ MarketplaceIndexerService.indexSession()
                      └─ Write to saa9vi_marketplace_sessions ES index
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
