# Domain Model

> **Purpose:** Document every aggregate, its purpose, owner, lifecycle, relationships, and invariants. Generated from code entities.

---

## TenantProfile

| Property | Value |
|---|---|
| **Plugin** | TenantPlugin |
| **Table** | `tenant_profile` |
| **ChannelAware** | Yes |
| **Purpose** | Branding and contact information for a tenant academy. |

**Relationships:**
- 1:1 with Channel (via `channelId`)
- 1:1 with BbbOrganization (via `tenantProfileId` on BbbOrganization)

**Lifecycle:**
- Created during `registerNewTenant` or admin tenant creation
- Updated by tenant admin via Admin UI
- Deleted via customer deletion (anonymized, not hard-deleted)

**Fields:** `businessName`, `tagline`, `logoAssetId`, `timezone`, `contactEmail`, `customDomain`, `onboardingComplete`

---

## InstructorProfile

| Property | Value |
|---|---|
| **Plugin** | TenantPlugin |
| **Table** | `instructor_profile` |
| **ChannelAware** | No (scalar `channelId` — DL-010 exception) |
| **Purpose** | Public instructor profile for a tenant academy. |

**Relationships:**
- Scoped to Channel via scalar `channelId`
- Indexed in per-tenant Elasticsearch index (`instructor_profiles`)
- Indexed in platform-level Elasticsearch index (`saa9vi_marketplace_instructors`)

**Lifecycle:**
- Created by trainer or admin
- Updated by trainer
- Anonymized on customer deletion (name → "[deleted]", photo nullified, `isActive = false`)

**Invariants:**
- `(channelId, slug)` composite unique index
- All queries include explicit `channelId` WHERE clause

---

## BbbOrganization

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_organization` |
| **ChannelAware** | Yes |
| **Purpose** | Owns every live meeting resource for a tenant. |

**Owns:**
- BbbRoom (1:N)
- BbbOrganizationMembership (1:N)
- BbbCapacityGrant (1:N)
- BbbScheduledSession (1:N)
- BbbMeeting (1:N)

**Relationships:**
- 1:1 with Channel (unique `channelId` index)
- References TenantProfile via `tenantProfileId` (string FK, no TypeORM relation)

**Lifecycle:**
- Created automatically when tenant is provisioned
- Auto-provisions `internal_overhead` capacity grant on create
- Suspended via `suspended` flag

**Invariants:**
- Exactly one per Channel
- Cannot exist without Channel
- `slug` is globally unique

---

## BbbRoom

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_room` |
| **Purpose** | Persistent meeting container. |

**Relationships:**
- Belongs to BbbOrganization
- Can have a linked BbbMeeting (current active meeting)
- Can have a linked ProductVariant via BbbProductAccess

**Lifecycle:**
- Created by trainer or admin
- State machine: `Idle` → `Provisioning` → `Active` → `Idle` (on meeting end)
- `productVariantId = null` means internal/staff room (commerce bypass)

**Capacity (current):**
- `maxParticipants` defaults from `BbbOrganization.maxParticipantsPerMeeting` on creation (`input.maxParticipants ?? org.maxParticipantsPerMeeting`)
- Currently a single mutable integer — no tiered policy layer exists yet
- **Proposed:** `BbbPlatformCapacityPolicy` will govern this in Phase 2 (see ADR-031)
- This is the BBB infrastructure limit — distinct from commercial stock

---

## BbbInstructorAssignment

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_instructor_assignment` |
| **Purpose** | Maps an InstructorProfile to a BbbScheduledSession with a role and display order. |

**Relationships:**
- Belongs to BbbScheduledSession
- References InstructorProfile (TenantPlugin) via `instructorProfileId`

**Lifecycle:**
- Created when an instructor is assigned to a scheduled session
- Role: `primary` | `assistant`
- `displayOrder` controls instructor ordering within a session

**Invariants:**
- `(instructorProfileId, scheduledSessionId)` composite unique index
- `role` is a string-literal union (`primary` | `assistant`)

---

## BbbScheduledSession

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_scheduled_session` |
| **Purpose** | A planned live class with price, capacity, and time. The commercial product entity. |

**Relationships:**
- Belongs to BbbOrganization
- Has a trainer (BbbOrganizationMember)
- Has an optional activeMeeting (BbbMeeting)
- Links to ProductVariant via `productVariantId`

**Lifecycle:**
- Created by trainer with title, time, price, capacity
- Status: `SCHEDULED` → `LIVE` → `FINISHED` | `CANCELLED`
- Activated by trainer clicking "Start session"
- Indexed in marketplace ES index when published

**Invariants:**
- `(organizationId, slug)` composite unique index
- `channelId` denormalized for tenant isolation
- `maxAttendees` is a commercial field (how many can buy), distinct from `BbbRoom.maxParticipants` (infrastructure limit)

---

## BbbPlatformCapacityPolicy ⚠️ Proposed — Not Yet Implemented

> **Status:** Proposed. See ADR-031. This entity does not exist in the codebase yet. The current mechanism is `BbbOrganization.maxParticipantsPerMeeting` — a single mutable integer set via admin dashboard form, with `BbbRoom.maxParticipants` defaulting from it on creation.

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin (Phase 2 — proposed) |
| **Table** | `bbb_platform_capacity_policy` (not yet created) |
| **Purpose** | Platform-level BBB capacity limits controlled by Portal Admin. |

**Fields:** `defaultRoomCapacity`, `maxRoomCapacity`, `maxConcurrentParticipants`, `subscriptionPlanId`

**Lifecycle (proposed):**
- Created by Portal Admin
- Applied to rooms on creation (sets `BbbRoom.maxParticipants`)
- Tenant can increase room capacity up to `maxRoomCapacity`
- Tied to subscription plan in Phase 2

**Invariants (proposed):**
- `defaultRoomCapacity <= maxRoomCapacity`
- `BbbOrganization.maxParticipantsPerMeeting` becomes a denormalized cache of the policy limit
- `BbbRoom.maxParticipants` is the BBB infrastructure limit — distinct from `ProductVariant.stockLevel` (commercial) and `BbbScheduledSession.maxAttendees` (session enrollment)

---

## BbbMeeting

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_meeting` |
| **Purpose** | A runtime BBB instance. Provisioned on demand. |

**State Machine:**
```
Pending → Provisioning → Active → Completed → Archived
                                         → Stale (terminal)
                    → Failed → Pending (retry)
```

**Relationships:**
- Belongs to BbbOrganization
- Optionally linked to a BbbRoom
- Optionally linked to a BbbScheduledSession (as activeMeeting)
- Has a grantId linking to BbbCapacityGrant (immutable billing linkage)

**Lifecycle:**
- Created when someone requests provisioning
- Provisioned by BullMQ worker (selects server, calls BBB API)
- Passwords encrypted with AES-256-GCM
- Completed via webhook, end-meeting, or reconciliation
- STALE = terminal, no ledger row written

**Invariants:**
- `grantId` set at provisioning time (immutable)
- No `BbbUsageLedger` row for STALE meetings
- `encryptionKeyVersion` column for key rotation

---

## BbbOrganizationMembership

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_organization_membership` |
| **ChannelAware** | No (scalar `channelId` — DL-017 exception) |
| **Purpose** | Internal moderator/staff access to an organization. |

**Roles:** `org_admin`, `moderator`, `staff`

**Relationships:**
- Belongs to BbbOrganization
- References Customer (Vendure core)

**Lifecycle:**
- Created by org admin
- Activated/deactivated via `isActive` flag

**Invariants:**
- `(organizationId, customerId)` unique composite index
- Membership check is Gate 1 in joinRoom auth waterfall (short-circuits entitlement)

---

## BbbEntitlement

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_entitlement` |
| **ChannelAware** | No (scalar `channelId` — DL-011 exception) |
| **Purpose** | Participant access grant. The ADR-targeted access primitive. |

**Types:** `bbb_session`, `bbb_room`
**Sources:** `purchase`, `trial`, `trial_conversion`, `admin`, `import`

**Relationships:**
- References Customer via `customerId`
- References resource (session or room) via `resourceId`

**Lifecycle:**
- Created by OrderFulfillmentListener (on PaymentSettled)
- Created by TrialRegistrationService (on trial registration)
- Checked by joinRoom() Gate 3
- Soft-deleted on customer deletion

**Invariants:**
- `(customerId, type, resourceId)` unique composite index
- Idempotent create — duplicate is no-op
- `hasAccess()` checks `validFrom`/`validUntil` window

---

## BbbCapacityGrant

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_capacity_grant` |
| **Purpose** | Prepaid or internal meeting minutes. The billing unit. |

**Source Types:** `order`, `subscription`, `internal_overhead`, `wallet`

**Relationships:**
- Belongs to BbbOrganization
- Linked to BbbMeeting via `grantId` (immutable at provisioning time)

**Lifecycle:**
- Created on order fulfillment, subscription renewal, or org creation (internal_overhead)
- Consumed by `consumeGrantHours()` on meeting completion
- Exhausted when `consumedMinutes >= grantedMinutes`

**Invariants:**
- `internal_overhead` grants are unbounded (`isUnbounded: true`) — skip exhaustion checks
- Earliest-expiring grant consumed first

---

## Article

| Property | Value |
|---|---|
| **Plugin** | CmsPlugin |
| **Table** | `article` |
| **ChannelAware** | Yes (ADR-036: two-class ownership via `CmsChannelAssignmentPolicy`) |
| **Purpose** | Blog/news article content for tenant storefronts and platform announcements. |

**Relationships:**
- `@ManyToMany(() => Channel) channels[]` — join table for channel assignment
- `@ManyToOne(() => Asset) featuredAsset` — optional featured image

**Lifecycle:**
- Created by admin (SuperAdmin → platform/default channel; Tenant Admin → tenant channel only)
- Updated/deleted by admin within channel scope
- `publishedAt` timestamp set on publish toggle

**Invariants:**
- `(channelId, slug)` composite unique index — enforced by both DB index and `assertSlugIsUnique()` in `ArticleService.create()`
- Slugs are unique per channel, not globally — a platform article and a seller article may share a slug
- Channel assignment via `CmsChannelAssignmentPolicy.assign()`, not `assignToCurrentChannel()` (ADR-036 / BUG-031)

---

## Page

| Property | Value |
|---|---|
| **Plugin** | CmsPlugin |
| **Table** | `page` |
| **ChannelAware** | Yes (ADR-036: two-class ownership via `CmsChannelAssignmentPolicy`) |
| **Purpose** | Static CMS pages (About, Help, Pricing, academy landing pages, etc.). |

**Relationships:**
- `@ManyToMany(() => Channel) channels[]` — join table for channel assignment
- `sections: PageSection[]` — JSON blob of page section blocks (hero, richText, productGrid, articleGrid, bannerSlot)

**Lifecycle:**
- Created by admin (SuperAdmin → platform/default channel; Tenant Admin → tenant channel only)
- Updated/deleted by admin within channel scope

**Invariants:**
- `(channelId, slug)` composite unique index — enforced by both DB index and `assertSlugIsUnique()` in `PageService.create()`
- Channel assignment via `CmsChannelAssignmentPolicy.assign()`, not `assignToCurrentChannel()` (ADR-036 / BUG-031)

---

## Banner

| Property | Value |
|---|---|
| **Plugin** | CmsPlugin |
| **Table** | `banner` |
| **ChannelAware** | Yes (ADR-036: two-class ownership via `CmsChannelAssignmentPolicy`) |
| **Purpose** | Promotional banners for storefront placements (hero, sidebar, footer, etc.). |

**Relationships:**
- `@ManyToOne(() => Asset) image` — banner image asset
- `@ManyToMany(() => Channel) channels[]` — join table for channel assignment

**Lifecycle:**
- Created by admin (SuperAdmin → platform/default channel; Tenant Admin → tenant channel only)
- Activation state managed by `banner-activator` BullMQ scheduled task (CMS-002 / BUG-015) — precomputes `isCurrentlyActive` every 60s
- Updated/deleted by admin within channel scope

**Invariants:**
- `isCurrentlyActive` is precomputed by scheduled task — storefront queries filter on this boolean, not date-range comparisons
- Channel assignment via `CmsChannelAssignmentPolicy.assign()`, not `assignToCurrentChannel()` (ADR-036 / BUG-031)

---

## BbbUsageLedger

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_usage_ledger` |
| **Purpose** | Immutable billing facts. Append-only. |

**Invariants:**
- Rows are never updated (INV-002)
- Rows are never deleted
- `(meetingId, grantId)` unique index
- Source of billing truth: `SUM(consumedMinutes) WHERE organizationId = X AND period`

---

## BbbWebhookEvent

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_webhook_event` |
| **Purpose** | Persisted BBB webhook event. Enables replay and audit. |

**Status:** `PENDING` → `PROCESSED` | `FAILED`

**Invariants:**
- Persisted before processing (INV-004)
- Never updated after final status
- Failed events queryable for replay

---

## BbbTrialRegistration

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `trial_registration` |
| **Purpose** | Records a student's registration for a free trial session. |

**Status:** `REGISTERED` → `ATTENDED` | `NO_SHOW`

**Lifecycle:**
- Created on `registerForTrial` mutation
- Status updated from BBB webhook attendee data
- Can be converted to enrollment via `convertTrialToEnrollment()`

---

## ProductReview

| Property | Value |
|---|---|
| **Plugin** | ReviewsPlugin |
| **Table** | `product_review` |
| **ChannelAware** | No (BUG-017 — pending remediation) |
| **Purpose** | Student review of a purchased session. |

**Status:** `new` → `approved` | `rejected` | `flagged`

**Invariants:**
- Channel isolation via explicit `channelId` WHERE clauses (not ORM-enforced)
- `authorName` anonymized on customer deletion

---

## CommissionLedger

| Property | Value |
|---|---|
| **Plugin** | MarketplacePlugin (Phase 3) |
| **Table** | `commission_ledger` |
| **Purpose** | Append-only ledger for marketplace commission. |

**Invariants:**
- Row written for every `orderSource = 'marketplace'` order (DL-030)
- `amountInPaise: 0` when `MARKETPLACE_COMMISSION_PERCENT` is 0%
- Rows never updated, never deleted
- No rows for `orderSource = 'direct'` or `'referral'`
