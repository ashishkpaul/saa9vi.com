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
- Effective capacity resolved from `BbbPlatformCapacityPolicy` via the organization's subscription plan (ADR-031, implemented)
- `BbbOrganization.maxParticipantsPerMeeting` acts as a write-through policy cache
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
- Optionally generated from a BbbSessionTemplate (factory only — template is not retained on the session row)

**Lifecycle:**
```
DRAFT → SCHEDULED → LIVE → FINISHED
                  ↘ CANCELLED
DRAFT → CANCELLED  (direct cancel before publishing)
```
- Created by admin/trainer; starts as **`DRAFT`** (not yet visible to learners or startable)
- `publishBbbScheduledSession` (Admin API) transitions `DRAFT → SCHEDULED`
- Trainer calls `startScheduledSession` (Shop API) to provision the BBB meeting; status moves to `LIVE` after provisioning
- Meeting completion transitions to `FINISHED`; admin cancel transitions to `CANCELLED`
- Marketplace eligibility: `PUBLIC` visibility + `SCHEDULED` or `LIVE` status

**Fields (additions 2026-09-20):**
- `status` default changed from `SCHEDULED` to `DRAFT`

**Invariants:**
- `(organizationId, slug)` composite unique index
- `channelId` denormalized for tenant isolation
- `maxAttendees` is a commercial field (how many can buy), distinct from `BbbRoom.maxParticipants` (infrastructure limit)
- A `DRAFT` session cannot be started — trainer must publish first
- `BbbOrganization.maxSessionsPerOrg` (0 = unlimited) limits the total number of non-terminal sessions (DRAFT + SCHEDULED + LIVE) per organization; enforced with a pessimistic write lock on the org row

---

## BbbSessionTemplate ✅ Implemented (2026-09-20)

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_session_template` |
| **Purpose** | A reusable factory configuration for generating multiple BbbScheduledSession instances (recurring/series support). **Not a bookable entity** — it is a configuration carrier only. |

**Fields:** `name`, `defaultTitle`, `defaultTrainerId`, `durationMinutes`, `defaultSubjectTags`, `defaultVisibility`, `productVariantId`, `organizationId`, `channelId`

**Relationships:**
- Belongs to BbbOrganization
- `channelId` inherited from organization at creation time (INV-001 authoritative aggregate)

**Lifecycle:**
- Created by admin via `createBbbSessionTemplate`
- Used to batch-generate sessions via `createSessionsFromTemplate(templateId, startTimes: [ISO8601...])`
- Each generated session is an independent DRAFT BbbScheduledSession
- `endTime` for each occurrence = `startTime + durationMinutes`
- Template can be deleted independently; deleting a template does not affect already-generated sessions
- Listed per organization via `bbbSessionTemplates(organizationId)`

**Invariants:**
- `defaultTrainerId` must be an active member of the template's organization (validated at create and at generation time)
- `durationMinutes` must be between 1 and 1440 (inclusive)
- Batch generation rejects more than 100 occurrences in a single call
- Duplicate start times within a single batch are rejected
- Invalid ISO 8601 strings are rejected before any DB write
- Session cap (`maxSessionsPerOrg`) is enforced across the whole batch atomically

---

## BbbPlatformCapacityPolicy ✅ Implemented

> **Status:** Implemented (Phase 2, per ADR-031; corrected 2026-09-04 — this section previously said "Proposed — Not Yet Implemented").

| Property | Value |
|---|---|
| **Plugin** | BigBlueButtonPlugin |
| **Table** | `bbb_platform_capacity_policy` |
| **Purpose** | Platform-level BBB capacity policy controlled by Portal Admin and resolved from the organization's subscription plan. |

**Fields:** `defaultRoomCapacity`, `maxRoomCapacity`, `maxConcurrentParticipants`, `subscriptionPlanId`

**Lifecycle:**
- Created or updated by Portal Admin through the platform capacity-policy API
- Effective policy resolved from the organization's subscription plan
- Applied when provisioning rooms (sets `BbbRoom.maxParticipants`)
- `BbbOrganization.maxParticipantsPerMeeting` is synchronized as a write-through policy cache

**Invariants:**
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
| **ChannelAware** | Yes (`channels[]` + `channelId`; BUG-017 remediated — corrected 2026-09-04) |
| **Purpose** | Student review of a purchased session. |

**Status:** `new` → `approved` | `rejected` | `flagged`

**Invariants:**
- Channel isolation via explicit `channelId` WHERE clauses (not ORM-enforced)
- `authorName` anonymized on customer deletion

---

## CommissionLedger

| Property | Value |
|---|---|
| **Plugin** | MarketplaceIndexerPlugin (`src/plugins/marketplace`) — *corrected from "MarketplacePlugin (Phase 3)", which does not exist; the bounded context is the existing marketplace plugin* |
| **Table** | `commission_ledger` |
| **Purpose** | Append-only ledger for marketplace commission. |

**Invariants:**
- Row written for every `orderSource = 'marketplace'` order (DL-030)
- `amountInPaise: 0` when `MARKETPLACE_COMMISSION_PERCENT` is 0%
- Rows never updated, never deleted
- No rows for `orderSource = 'direct'` or `'referral'`

> **ⓘ Attribution dependency:** Commission rows depend on `Order.customFields.orderSource` being stamped correctly at checkout. The classification mechanism is settled in the ADR-021 addendum: the storefront passes a raw `referrerCode`/`utm_source`; Vendure-side `OrderProcess` logic classifies (INV-008). MarketplaceAttributionService shipped (`750da49`, issue/verify: HMAC + TTL + channel); CommissionLedger entity+sub shipped (`584530b`); Phase 3B ongoing.

---

## SubscriptionPlan ✅ Implemented

| Property | Value |
|---|---|
| **Plugin** | SubscriptionPlugin (`src/plugins/subscription`) |
| **Table** | `subscription_plan` |
| **ChannelAware** | No — platform-global (portal) catalogue |
| **Purpose** | Tenant SaaS tier catalogue (Starter / Growth / Enterprise) with capacity/feature limits. |

**Relationships:**
- 1:N with OrganizationSubscription (each tenant subscribes to exactly one plan)
- Referenced by BbbPlatformCapacityPolicy via `subscriptionPlanId` (ADR-031)

**Lifecycle:**
- Created/updated by Portal Admin (SuperAdmin) via `createSubscriptionPlan`
- Stored once; subscribed to by many tenants

**Fields:** `name`, `slug` (unique), `description`, `monthlyPriceInPaise`, `includedBbbMinutes`, `maxStudents`, `customDomainEnabled`, `whitelabelEnabled`, `isActive`, `sortOrder`, `providerPlanId`

**Invariants:**
- Deliberately NOT channel-scoped — plans are global (INV-001 applies to subscription *state*, not the catalogue).
- `providerPlanId` (Razorpay `plan_id`, ADR-039) is nullable during rollout; the provider-wired subscribe flow fails closed when unset.
- Razorpay plan carries amount/currency/frequency server-side — never duplicated here.
- Capacity limits are NOT stored here; they live in `BbbPlatformCapacityPolicy` (ADR-031).

---

## OrganizationSubscription ✅ Implemented

| Property | Value |
|---|---|
| **Plugin** | SubscriptionPlugin |
| **Table** | `organization_subscription` |
| **ChannelAware** | Yes — dual `channels[]` + scalar `channelId` (ADR-003) |
| **Purpose** | A tenant academy's subscription to a SaaS tier. One row per tenant. |

**Relationships:**
- N:1 with SubscriptionPlan (via `plan`)
- 1:1 with Channel (via `channelId`; the channel uniquely identifies the organization through Channel ↔ TenantProfile ↔ BbbOrganization — no separate `organizationId` column)
- 1:N with SubscriptionBillingAttempt

**Lifecycle (FSM — ADR-039):**
- `pending_provider_auth` → `active` → `past_due` → `cancelled`
- `trialing` retained for non-provider flows
- Only provider webhooks drive `pending_provider_auth` → `active`; Razorpay is the authoritative activation source (INV-004).

**Fields:** `plan`, `channels`, `channelId`, `status`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `cancelledAt`, `dunningRetryCount`, `lastDunningAttemptAt`, `billingCustomerId` (provider-neutral customer reference, e.g. Razorpay `customer_id`), `providerStatus`, `providerShortUrl`, `version`

**Invariants:**
- `UNIQUE(channelId) WHERE status != 'cancelled'` — at most one non-cancelled subscription per tenant.
- `pending_provider_auth` occupies the one-active-subscription slot (provider authorization must not be bypassed by a second subscribe).
- `providerShortUrl` is returned to the admin caller at creation; it is not automatically cleared on activation (documented residual — authoritative post-auth state is `status` + the binding).
- `version` is a plain CAS token for renewal compare-and-swap (NOT auto-locking); the worker must check affected-rows === 1 before charging.
- Status column is `varchar`, so adding FSM values is not a DB-enum migration.

---

## SubscriptionProviderBinding ✅ Implemented

| Property | Value |
|---|---|
| **Plugin** | SubscriptionPlugin |
| **Table** | `subscription_provider_binding` |
| **ChannelAware** | Yes — dual `channels[]` + scalar `channelId` (ADR-003) |
| **Purpose** | Provider-neutral binding of an OrganizationSubscription to a provider subscription (e.g. Razorpay `subscription_id`). |

**Relationships:**
- N:1 with OrganizationSubscription (via `subscription`)

**Lifecycle:**
- Created at subscription-creation time inside `subscribeToPlan()` (ADR-039) — the sole first-binding mechanism.
- Updated by provider webhooks (status/active mirroring).

**Fields:** `subscription`, `channels`, `channelId`, `provider`, `providerSubscriptionId`, `providerPlanId`, `providerStatus`, `active`, `metadata`

**Invariants:**
- `UNIQUE(provider, providerSubscriptionId)` — provider-qualified subscription identity is the authoritative uniqueness contract.
- Provider-specific details live in the provider adapter; this entity stays provider-neutral.
- The worker resolves the tenant channel from this binding before invoking the provider processor and fails closed when no binding exists (INV-018); channel is never taken from arbitrary request context.

---

## SubscriptionBillingAttempt ✅ Implemented

| Property | Value |
|---|---|
| **Plugin** | SubscriptionPlugin |
| **Table** | `subscription_billing_attempt` |
| **ChannelAware** | No ORM relationship — denormalized scalar `channelId` (ADR-003 scalar-only exception) |
| **Purpose** | Provider-neutral record of a single billing attempt against a subscription (retries create new rows). |

**Relationships:**
- N:1 with OrganizationSubscription (via `subscription`)

**Lifecycle:** `initiated` → `succeeded` | `failed` (terminal results are never overwritten)

**Fields:** `subscription`, `channelId`, `provider`, `providerSubscriptionId`, `providerPaymentId`, `providerInvoiceId`, `providerEventId`, `invoiceId`, `providerAttemptId`, `amountPaise`, `currency`, `billingPeriodStart`, `billingPeriodEnd`, `status`, `failureReason`, `attemptedAt`

**Invariants:**
- Append-only per attempt — terminal results are never overwritten.
- `UNIQUE(provider, providerEventId)` provides webhook idempotency.
- `UNIQUE(provider, providerPaymentId) WHERE providerPaymentId IS NOT NULL` (named index `UQ_billing_attempt_provider_payment`) is the database-level guard against two concurrent webhook workers independently persisting the same provider payment; a unique-violation loser converges through the shared terminal-attempt reconciliation helper.
- `billingPeriodStart` (YYYY-MM-DD, UTC, nullable) — the provider billing-cycle start. Uniform semantics across all terminal states: `NULL` means cycle identity is unknown or not applicable (renewal-worker-initiated rows before terminal CAS; failed attempts where the provider supplied no cycle); a date value means an authoritative provider cycle from Razorpay `current_start`. The field is cycle identity, not a generic audit timestamp — a value that does not originate from a provider cycle MUST NOT be stored here (INV-020).
- `billingPeriodEnd` (YYYY-MM-DD, UTC, nullable) — the durable carrier of the provider billing-cycle end (ADR-041 / INV-020). Set from Razorpay `current_end` on webhook-created attempts. `NULL` for renewal-worker-initiated attempts, failed attempts without a provider cycle, and pre-G2 legacy rows.
- `finalizeAfterPayment()` reads `billingPeriodStart`/`billingPeriodEnd` from this row to reconstruct the authoritative provider cycle on every call including replays. A row with `billingPeriodEnd = null` triggers a reconciliation incident rather than falling back to local arithmetic (INV-020).
- Supersedes the legacy `juspay_payment_attempt` table, which was dropped in 466a4ef (ADR-040).

---

## ProviderWebhookEvent ✅ Implemented

| Property | Value |
|---|---|
| **Plugin** | SubscriptionPlugin |
| **Table** | `provider_webhook_event` |
| **ChannelAware** | No ORM relationship — denormalized scalar `channelId` (ADR-003 scalar-only exception) |
| **Purpose** | Immutable inbox recording that a provider webhook was received (authoritative receipt). |

**Relationships:**
- Logical reference to the resolved SubscriptionProviderBinding (binding → `channelId`)

**Lifecycle:** `pending` → `processed` | `failed` (terminal). Intermediate retry failures leave status `pending`; `attemptCount` tracks retries.

**Fields:** `channelId` (nullable at ingress), `provider`, `providerEventId`, `eventType`, `payloadHash`, `rawPayload`, `receivedAt`, `verifiedAt`, `processedAt`, `failedAt`, `processingStatus`, `attemptCount`, `errorMessage`

**Invariants:**
- Events are append-only — never updated except processing/verification timestamps and retry counters.
- `UNIQUE(provider, providerEventId)` prevents duplicate processing.
- `channelId` is NULL at ingress and resolved by the worker from the provider binding — the authoritative channel comes from the binding, not arbitrary request context (INV-018).
- The legacy Juspay webhook entities (`juspay_webhook_event`, `juspay_webhook_endpoint`, etc.) were dropped in 466a4ef (ADR-040) after the provider-neutral refactor (9a31beb); the unified `provider_webhook_event` inbox is the sole webhook record (ADR-038).

---

## TenantTheme ✅ Implemented (2026-09-21, ADR-043 L1)

| Property | Value |
|---|---|
| **Plugin** | TenantPlugin (`src/plugins/tenant-plugin`) |
| **Table** | `tenant_theme` |
| **ChannelAware** | No ORM relationship — immutable scalar `channelId` (ADR-003 scalar-only exception) |
| **Purpose** | One version of a tenant academy's storefront branding (L1 controlled theme). Tenant presentation as data, not code (ADR-043). |

**Relationships:**
- Logical 1:1 with Channel (via `channelId`; no `channels[]` join table)
- Logical reference to Vendure `Asset` (via `logoAssetId`; asset must belong to the same channel)

**Lifecycle:**
- `draft` → `active` (publish) → `archived` (superseded by the next published version)
- Live changes require a new draft: `active vN` → clone → `draft vN+1` → publish → `vN` archived
- `rollbackTenantTheme` re-activates an archived version (archiving the currently active one)
- `resetTenantTheme` archives the active version → channel returns to the platform default

**Fields:** `channelId`, `version`, `status` (`draft` | `active` | `archived`), `primaryColor`, `secondaryColor`, `accentColor`, `backgroundColor`, `textColor`, `fontFamily` (curated allow-list key), `logoAssetId`, `displayName`, `createdAt`, `updatedAt`

**Invariants:**
- `UNIQUE(channelId, version)` + `UNIQUE(channelId) WHERE status = 'active'` (PostgreSQL partial index) — at most one active theme per channel, DB-enforced.
- Published versions (`active`/`archived`) are immutable; only `draft` rows are editable. `version` is allocated (`MAX(version)+1`) at draft creation under a per-channel advisory lock — **not** incremented on save.
- All reads/writes are channel-scoped from `ctx.channelId`; the channel is never a caller-supplied argument (INV-025).
- Non-null `logoAssetId` must resolve to an existing Asset whose `channels[]` contains the tenant's own channel.
- Commercially gated (INV-025 / ADR-043 §2.1): create/update/publish/rollback/draft-clone and the storefront read require subscription exists + `plan.whitelabelEnabled = true` + status ∈ {`trialing`, `active`, `past_due`}, evaluated solely by `TenantCommercialEligibilityService`. Ineligible `myTenantTheme` (public Shop read) returns `null` → platform default.
- `resetTenantTheme` (removing branding) is always permitted.
- Theme data never applies to the admin portal, marketplace, or other tenants' storefronts.
