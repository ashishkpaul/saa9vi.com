# Plugin Map

> **Purpose:** Document which plugin owns which responsibility, entities, events, and API surfaces. Makes bounded contexts explicit.

---

## TenantPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/tenant-plugin/` |
| **Status** | Beta |
| **Purpose** | Tenant profiles, instructors, media, and self-service registration. |

### Owns

| Entity | Table | ChannelAware |
|---|---|---|
| TenantProfile | `tenant_profile` | Yes |
| InstructorProfile | `instructor_profile` | No (DL-010) |
| MediaResource | `media_resource` | Yes |
| TenantRegistrationLog | `tenant_registration_log` | No |

### Publishes (key cross-plugin events — not an exhaustive inventory; see `src/plugins/tenant-plugin/events/tenant-events.ts` for the full set)

| Event | Subscribers |
|---|---|
| `InstructorProfileCreatedEvent` | MarketplaceIndexerPlugin |
| `InstructorProfileUpdatedEvent` | MarketplaceIndexerPlugin |
| `TenantProfileUpdatedEvent` | MarketplaceIndexerPlugin (bulk channel reindex) |
| `TenantRegisteredEvent` | BigBlueButtonPlugin (BBB org provisioning / slug sync — G1/B-2 architecture) |

### Consumes

None.

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `TenantShopResolver` | Shop API (Public) | `registerNewTenant`, `tenantProfile`, `instructorProfiles`, `mediaResources` |
| `TenantAdminResolver` | Admin API | Tenant profile CRUD, instructor CRUD, media CRUD |

### Key Services

| Service | Purpose |
|---|---|
| `TenantRegistrationService` | 5-step tenant provisioning (Seller → Channel → Role → Administrator → TenantProfile) |
| `TenantProfileService` | Tenant profile CRUD with `assignToCurrentChannel` |
| `InstructorProfileService` | Instructor CRUD with explicit `channelId` filter |
| `InstructorIndexerService` | Per-tenant Elasticsearch indexing for instructors |
| `DomainChannelResolverService` | Custom domain → channel token Redis mapping |

---

## BigBlueButtonPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/bigbluebutton-plugin/` |
| **Status** | Production-near |
| **Purpose** | Live class infrastructure — rooms, meetings, sessions, entitlements, billing. |

### Owns

| Entity | Table | ChannelAware |
|---|---|---|
| BbbOrganization | `bbb_organization` | Yes |
| BbbRoom | `bbb_room` | No (scoped via organization) |
| BbbScheduledSession | `bbb_scheduled_session` | No (scoped via organization) |
| BbbMeeting | `bbb_meeting` | No |
| BbbOrganizationMembership | `bbb_organization_membership` | No (DL-017) |
| BbbOrganizationMember | `bbb_organization_member` | No (scoped via organization; distinct from Membership) |
| BbbEntitlement | `bbb_entitlement` | No (DL-011) |
| BbbEnrollment | `bbb_enrollment` | No (legacy) |
| BbbCapacityGrant | `bbb_capacity_grant` | No |
| BbbUsageLedger | `bbb_usage_ledger` | No |
| BbbWebhookEvent | `bbb_webhook_event` | No |
| BbbTrialRegistration | `trial_registration` | No |
| BbbCapacityAlertLog | `bbb_capacity_alert_log` | No |
| BbbProductAccess | `bbb_product_access` | No |
| BbbInstructorAssignment | `bbb_instructor_assignment` | No (scoped via organization) |
| BbbServer | `bbb_server` | No |
| BbbPlatformCapacityPolicy | `bbb_platform_capacity_policy` | No |

### Publishes (key cross-plugin events — not an exhaustive inventory; see `src/plugins/bigbluebutton-plugin/events/bbb-events.ts` for the full set)

| Event | Subscribers |
|---|---|
| `MeetingProvisionedEvent` | BbbSessionProvisioningListener (session → LIVE), BbbMetricsService |
| `MeetingCompletedEvent` | BbbSessionProvisioningListener (session → FINISHED) |
| `GrantConsumedEvent` | Email plugin |
| `RoomActivatedEvent` | BbbMetricsService |
| `CapacityExhaustedEvent` | Email plugin |
| `CapacityAlertEvent` | Email plugin |

### Consumes

None (injects TenantPlugin services for org verification).

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `BbbShopResolver` | Shop API (Authenticated) | `joinRoom`, `myBbbRooms`, `bbbRoomStatus`, `myScheduledSessions`, `myLearningDashboard`, `registerForTrial` |
| `BbbAdminResolver` | Admin API | Room/meeting/session/membership/entitlement CRUD, `poolCapacityDashboard` |
| `BbbWebhookController` | REST (Public) | BBB webhook ingestion |

### Key Services

| Service | Purpose |
|---|---|
| `BbbMeetingService` | Meeting lifecycle, join URL generation; **enqueue-only** (delegates provisioning to `BbbProvisioningWorkerService`) |
| `BbbProvisioningWorkerService` | Sole BBB provisioning consumer; provisions BBB meetings; performs **atomic org-capacity reservation** (`PROVISIONING + ACTIVE ≤ concurrentMeetingLimit`, pessimistic org lock + count + promote in one transaction); publishes `MeetingProvisionedEvent` / `MeetingFailedEvent` |
| `BbbSessionProvisioningListener` | Sole transition of `BbbScheduledSession` SCHEDULED → **LIVE** (on `MeetingProvisionedEvent`) and LIVE → **FINISHED** (on `MeetingCompletedEvent`); startup reconciliation for orphaned LIVE sessions |
| `BbbRoomService` | Room lifecycle, provisioning requests |
| `BbbEntitlementService` | Entitlement create/hasAccess/delete |
| `BbbMembershipService` | Organization membership CRUD and lookup |
| `BbbReconciliationService` | Active meeting reconciliation, grant consumption |
| `BbbServerSelectionService` | BBB server selection by load |
| `BbbMetricsService` | Metrics recording for provisioning, completion, webhooks |
| `CapacityIntelligenceService` | Pool health, 48h forecast, capacity recommendations |
| `LearningDashboardService` | Domain API for student dashboard |
| `TrialRegistrationService` | Trial registration and conversion |
| `GrantReaderService` | Abstracted grant resolution (Q-009 seam) |

### Job Queues

| Queue | Schedule | Purpose |
|---|---|---|
| `bbb-meeting-provisioning` | On demand | Provision BBB meeting |
| `bbb-webhook-processor` | On demand | Process persisted webhook event |
| `bbb-reconciliation` | Every 60s | Reconcile active meetings |
| `bbb-capacity-alert` | Every 15min | Capacity intelligence check |

---

## CmsPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/cms/` |
| **Status** | Beta |
| **Purpose** | Articles, pages, banners for tenant storefronts. |

### Owns

| Entity | Table | ChannelAware |
|---|---|---|
| Article | `article` | Yes |
| Page | `page` | Yes |
| Banner | `banner` | Yes |
| NavigationMenu | `navigation_menu` | Yes (one per channel, unique channelId) |

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `CmsShopResolver` | Shop API (Public) | `cmsArticles`, `cmsPage`, `cmsBanners` |
| `CmsAdminResolver` | Admin API | Article/page/banner CRUD |

### Job Queues

| Queue | Schedule | Purpose |
|---|---|---|
| `banner-activator` | Every 60s | Precompute `isCurrentlyActive` flag |

---

## ReviewsPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/reviews/` |
| **Status** | Beta |
| **Purpose** | Product reviews, moderation, fraud detection, reputation aggregation. |

### Owns

| Entity | Table | ChannelAware |
|---|---|---|
| ProductReview | `product_review` | Yes (BUG-017 fixed — `channels[]` + scalar `channelId`) |
| ReviewRequest | `review_request` | Yes |
| ReviewReport | `review_report` | Yes |
| ReviewReward | `review_reward` | Yes |
| ReviewVote | `review_vote` | Yes |

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `ReviewsShopResolver` | Shop API | `productReviews`, `canReviewProduct`, `submitReview` |
| `ReviewsAdminResolver` | Admin API | Review moderation, reports, rewards |

---

## MarketplaceIndexerPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/marketplace/` |
| **Status** | Projection layer implemented; Gate 1 discovery E2E passing (7/7, commit `2e74020`). Ad-entity tables migrated (Gate 1.1: `1788265440266-MarketplaceAdEntities`). **Gates 2–3 complete** — attribution (`d6926a9`, `683b2f7`) and commission ledger with atomic single-use replay (`f534872`), verified by 6/6 commission e2e (`1bcf5e2`). **Phase 3C advertising COMPLETE** (3C.1–3C.7b): AdWalletLedger, wallet service boundary, campaign spend wiring, Banner.scope, bounded bid-boost, 14/14 advertising E2E, 3C.7a self-serve Admin API (tenant-scoped campaign/wallet/spend resolvers), and 3C.7b React dashboard (campaign list/detail, wallet, spend report — all consuming the Admin API). **Commission reconciliation (R1–R3) COMPLETE** (`fab9969`): read-only `CommissionReconciliationService` + Admin GraphQL query, channel-scoped with SuperAdmin `allChannels` service-side clamp, 7/7 reconciliation E2E on real PostgreSQL. **Phase 3D retention remains.** See `docs/implementation/roadmap.md` for the full Phase 3C breakdown. |
| **Purpose** | Cross-channel Elasticsearch discovery layer for marketplace. |

### Owns

| Entity | Table | Purpose |
|---|---|---|
| MarketplaceAdCampaign | `marketplace_ad_campaign` | Sponsored listing campaigns |
| AdSpendLedger | `ad_spend_ledger` | Append-only ad spend records |
| AdWallet | `ad_wallet` | Prepaid ad wallet per tenant |
| AdWalletLedger | `ad_wallet_ledger` | Append-only wallet transactions (3C.1, immutable subscriber enforced) |
| CommissionLedger | `commission_ledger` | Append-only marketplace commission facts (3B; INV-002/DL-030; UNIQUE orderId + UNIQUE marketplaceRef) |

### Publishes

None.

### Consumes

| Event | Source Plugin |
|---|---|
| `InstructorProfileCreatedEvent` | TenantPlugin |
| `InstructorProfileUpdatedEvent` | TenantPlugin |
| `TenantProfileUpdatedEvent` | TenantPlugin |
| `SessionCreatedEvent` | BigBlueButtonPlugin |
| `SessionUpdatedEvent` | BigBlueButtonPlugin |
| `SessionStartedEvent` | BigBlueButtonPlugin |
| `SessionCancelledEvent` | BigBlueButtonPlugin |
| `ReviewApprovedEvent` | ReviewsPlugin |
| `ReviewRejectedEvent` | ReviewsPlugin |
| `ReviewHiddenEvent` | ReviewsPlugin |
| `ProductVariantEvent` | Vendure core |
| `ProductVariantPriceEvent` | Vendure core |

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `MarketplaceSearchResolver` | Shop API (Public) | `marketplaceSearch` |
| `MarketplaceAdminResolver` | Admin API (SuperAdmin) | Full reindex |
| `MarketplaceAdvertisingResolver` | Admin API (MarketplaceAdvertising) | Self-serve campaign management, wallet ledger, spend reports |
| `MarketplaceCommissionResolver` | Admin API (ReadMarketplaceCommission) | Commission ledger reads for tenant admins |
| `MarketplaceCommissionReconciliationResolver` | Admin API (ReadMarketplaceCommission) | Read-only `commissionReconciliation` Orders↔CommissionLedger report; channel-scoped, SuperAdmin may pass `allChannels:true` (service-side clamp) |

### Elasticsearch Indices

| Index | Documents | Purpose |
|---|---|---|
| `saa9vi_marketplace_sessions` | Sessions | Cross-channel session discovery |
| `saa9vi_marketplace_instructors` | Instructors | Cross-channel instructor discovery |

### Dashboard

| Property | Value |
|---|---|
| **Entry** | `dashboard/index.tsx` (registered via `dashboard: './dashboard/index.tsx'` in plugin decorator) |
| **Framework** | React `.tsx` via Vendure Dashboard v3 `defineDashboardExtension` |
| **Nav section** | `marketplace` (MegaphoneIcon, order 200) |
| **Routes** | `campaign-list`, `campaign-detail`, `wallet`, `spend-report` |
| **Permissions** | All routes require `MarketplaceAdvertising` CRUD permissions |
| **Data source** | Admin GraphQL API only — no direct entity access |

---

## PlatformDashboardPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/platform-dashboard/` |
| **Status** | Live |
| **Purpose** | Saa9vi login branding — replaces Vendure logo, welcome message, and footer. |

### Owns

No entities. Pure UI extension.

### API Surfaces

None. Dashboard extension only (`login.logo`, `login.beforeForm`, `login.afterForm`).

---

## LoadSimulationPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/load-simulation-plugin/` |
| **Status** | Production-near (Admin API only) |
| **Purpose** | Causal drift / load-test observability. |

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `LoadSimulationAdminResolver` | Admin API (SuperAdmin) | `runLoadTest` |

---

## CustomerSuspensionPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/customer-suspension/` |
| **Status** | Beta — platform-wide + channel-scoped suspension implemented. |
| **Purpose** | Customer suspension management (INV-014): platform-wide (SuperAdmin) and per-channel (academy admin) suspension, enforced at checkout via a custom order process. |

### Owns

| Entity | Table | ChannelAware |
|---|---|---|
| CustomerChannelStatus | `customer_channel_status` | No (scalar `channelId`, unique per `customerId`+`channelId`) |
| CustomerStatusChangeLog | `customer_status_change_log` | No (append-only audit, optional `channelId`) |

### Publishes

None.

### Consumes

None (extends `orderOptions.process` with `customerStatusOrderProcess` to block suspended-customer checkouts).

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `CustomerSuspensionAdminResolver` | Admin API (SuperAdmin; tenant admins for channel-scoped) | `suspendCustomer`, `reinstateCustomer`, `suspendCustomerInChannel`, `reinstateCustomerInChannel`, `customerStatusChangeLogs`, `customerChannelStatus`, `customerChannelStatuses` |

---

## SubscriptionPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/subscription/` |
| **Status** | **Razorpay is the sole active recurring-billing provider** (per ADR-038; provider factory resolves `razorpay` — and defaults an omitted provider to Razorpay — while other explicit provider values are rejected; `vendure-config.ts` sets `provider: 'razorpay'`). The legacy Juspay implementation was **fully removed** in `9a31beb` (provider-neutral refactor) and its six legacy tables were **dropped** in `466a4ef` (ADR-040); only the Razorpay provider is present under `providers/`. |
| **Purpose** | Subscription billing bounded context — plans, organization subscriptions, provider-neutral billing, webhooks, dunning FSM, renewal reconciliation. |

### Owns

| Entity | Table | ChannelAware |
|---|---|---|
| SubscriptionPlan | `subscription_plan` | No (platform-global plan catalogue; unique `slug`, not channel-scoped — scoping happens via `OrganizationSubscription`) |
| OrganizationSubscription | `organization_subscription` | Yes — **implements `ChannelAware`** (= Channel/tenant) |
| SubscriptionProviderBinding | `subscription_provider_binding` | Yes — **implements `ChannelAware`** (provider-neutral binding) |
| SubscriptionBillingAttempt | `subscription_billing_attempt` | Tenant-scoped via scalar `channelId` only (ADR-003 exception); provider-neutral billing attempt |
| ProviderWebhookEvent | `provider_webhook_event` | Tenant-scoped via scalar `channelId` only (ADR-003 exception); webhook receipt, UNIQUE(provider, providerEventId) |
| RenewalPaymentReconciliationRequired | `subscription_reconciliation_required` | Tenant-scoped via scalar `channelId` only (ADR-003 exception); operator-visible reconcile-after-charge incidents, ADR-040 |

### Publishes

(`subscription.events.ts` — renewal / dunning / reconciliation lifecycle events consumed by the plugin's own jobs and listeners.)

### Consumes

| Event / Input | Source |
|---|---|
| Razorpay webhooks | `POST /payments/razorpay/webhook` (`RazorpayWebhookController`, HMAC-SHA256, raw body) |
| Scheduled tasks | `subscriptionRenewalTask` (every 10 min), `subscriptionDunningTask` |

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `SubscriptionAdminResolver` | Admin API | `subscriptionPlans`, `organizationSubscriptions`, `providerMandates`, `providerPaymentAttempts`, `reconciliationIncidents`, `createSubscriptionPlan`, `updateSubscriptionPlan`, `subscribeToPlan` |

### Key Services

| Service | Purpose |
|---|---|
| `RazorpayWebhookProcessor` | Razorpay webhook dispatch / reconciliation (provider-qualified `findAttemptByProviderEventId` for replay boundary; ADR-041 G2–G7 provider-cycle model); delegates billing-attempt persistence to `SubscriptionBillingAttemptService` |
| `ProviderWebhookQueueService` | Persist-then-process webhook queue (INV-004), BullMQ-backed, `MAX_ATTEMPTS=3` |
| `RazorpaySubscriptionProvider` | Razorpay Subscriptions API adapter (implements `RecurringBillingProvider`) |
| `SubscriptionBillingAttemptService` | Authorized CLAIM→CHARGE→FINALIZE billing-attempt ledger writer (the only permitted writer of `SubscriptionBillingAttempt`, INV-019) |
| `SubscriptionRenewalService` | Renewal discovery, cycle-monotonic FINALIZE CAS (ADR-041), bounded retry (MAX 3), reconcile-after-charge incidents |
| `SubscriptionRenewalQueueService` | BullMQ-backed `subscription-renewal` queue |
| `SubscriptionService` | Plan/enrollment lifecycle (depends on `RecurringBillingProvider` interface) |

### Razorpay Webhook Flow

```text
Razorpay POST /payments/razorpay/webhook
    ↓
HMAC-SHA256 signature verification (raw body bytes)
    ↓
Persist ProviderWebhookEvent { status: 'pending' } (webhook receipt:
provider/providerEventId/eventType/payloadHash/rawPayload are immutable;
attemptCount/channelId/processingStatus/processedAt/failedAt/errorMessage
are mutable processing metadata)
    ↓
Return 201 immediately (persisted + enqueued)
    ↓
BullMQ: provider-webhook-processing queue
    ↓
Resolve channel from SubscriptionProviderBinding (INV-001)
    ↓
RazorpayWebhookProcessor.processInboxEvent()
    ↓
REPLAY BOUNDARY: findAttemptByProviderEventId('razorpay', providerEventId)
    Terminal 'succeeded' attempt → reconcileTerminalAttempt()
        → replay finalizeAfterPayment() [cycle-monotonic CAS → idempotent]
    Terminal 'failed' attempt → no-op
    No terminal attempt / only 'initiated' → continue
    ↓
normalizeEvent() → NormalizedBillingEvent
    including providerPeriodStart / providerPeriodEnd
    from Razorpay current_start / current_end (Unix seconds → Date, UTC)
    ↓
Handle by event type:
    subscription.pending / subscription.halted:
        requireProviderCycleForFailure() — throws MissingProviderCycleError if absent
        updateBinding() [atomic transaction: binding + subscription.providerStatus]
        markPastDueFromWebhook(subscriptionId, providerCycleStart)
            cycle-identity guard: providerCycleStart <= localPeriodStart → stale, no-op
    subscription.authenticated:
        updateBinding() [atomic]
    subscription.activated (charge-bearing):
        assertProviderCyclePresent() — throws MissingProviderCycleError BEFORE any mutation
        updateBinding() [atomic]
        recordAttempt() → finalizeAfterPayment()
    subscription.charged:
        assertProviderCyclePresent() — throws BEFORE any mutation
        recordAttempt() → finalizeAfterPayment()
    subscription.cancelled:
        updateBinding() [atomic]
        markCancelledFromWebhook()
    payment.failed / payment.charge_failed:
        recordAttempt('failed')
    ↓
Attempt persistence (INV-019, all via SubscriptionBillingAttemptService):
    Existing 'initiated' attempt (FIFO on attemptedAt):
        recordAttemptSuccess / recordAttemptFailure
        billingPeriodStart / billingPeriodEnd written in SAME atomic CAS UPDATE
        as terminal status (INV-020):
          succeeded:             both = authoritative provider cycle (YYYY-MM-DD, UTC)
          failed + cycle known:  both = confirmed provider failure cycle
          failed + no cycle:     both = NULL (cleared by CAS — INV-020: cycle identity only)
    No initiated attempt:
        recordAttemptFromWebhook() — billingPeriodStart/End = provider cycle,
        or NULL for failed attempts without provider cycle (INV-020)
    ↓
finalizeAfterPayment(attemptId) — on succeeded attempt:
    Reads billingPeriodStart / billingPeriodEnd from attempt row (no payload re-parse)
    billingPeriodEnd = NULL → reconciliation incident (INV-020 fail-closed)
    finalizeRenewalPeriod():
        cycle-monotonic CAS:
            WHERE version = :v
              AND (currentPeriodStart IS NULL OR currentPeriodStart < :targetStart)
        CAS success → publishFinalizeEvents() [awaited eventBus.publish()]
        CAS fail → reload with 'plan' relation + classify:
            cancelled            → SUCCESS (terminal guard)
            cycle already met    → SUCCESS (idempotent replay)
            version race, target still ahead → retry (max 3, reload includes plan)
            retry exhausted      → reconciliation incident
    ↓
Mark ProviderWebhookEvent { status: 'processed', processedAt }
    ↓
On MissingProviderCycleError or any exception + attempts left:
    Keep status: 'pending', rethrow for BullMQ retry
    ↓
On exception + MAX_ATTEMPTS exhausted:
    Mark ProviderWebhookEvent { status: 'failed', failedAt } (terminal)
```

### Failure Semantics

```text
attempt 1 fails → pending, attemptCount=1
attempt 2 fails → pending, attemptCount=2
attempt 3 fails → failed, attemptCount=3, failedAt populated (terminal)
```

> ⚠️ **R2-G status (current):** ADR-041 G2–G7 provider-cycle redesign is CODE COMPLETE.
> Runtime re-verification against a fresh Razorpay Test subscription is required before
> closing R2-E/F/G. Halted-subscription recovery (D-5) remains an open product gap.
> See `production-readiness.md`.
