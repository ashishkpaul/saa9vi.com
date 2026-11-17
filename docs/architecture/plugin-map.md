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
| TenantLearnerMembership | `tenant_learner_membership` | No (scalar `channelId`, unique customer/channel) |
| TenantLearnerMembershipLog | `tenant_learner_membership_log` | No (scalar `channelId`, append-only transition audit) |
| TenantTheme | `tenant_theme` | No (scalar `channelId`, ADR-043) |

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
| `TenantShopResolver` | Shop API (Public) | Queries: `tenantProfile`, `instructorProfile(slug)`, `instructorProfiles`, `mediaResources(ownerType, ownerId)`, `myTenantTheme` (entitlement-conditional — returns null → platform default); mutations: `registerNewTenant`, `verifyTenantAdmin` |
| `TenantAdminResolver` | Admin API | Tenant profile, instructor, and media queries/CRUD; learner admission queries `tenantLearners`, `tenantLearnerMembershipLogs` and mutations `admitTenantLearner`, `activateTenantLearner`, `suspendTenantLearner`, `revokeTenantLearner`, `readmitTenantLearner`; SuperAdmin-only role repair query/mutation: `checkChannelRoleAssignments`, `repairChannelRoleAssignments`; theme lifecycle: `tenantThemes`, `tenantTheme`, `createTenantTheme`, `updateTenantTheme`, `publishTenantTheme`, `rollbackTenantTheme`, `resetTenantTheme` |

### Key Services

| Service | Purpose |
|---|---|
| `TenantRegistrationService` | 5-step tenant provisioning (Seller → Channel → Role → Administrator → TenantProfile) |
| `TenantProfileService` | Tenant profile CRUD with `assignToCurrentChannel` |
| `InstructorProfileService` | Instructor CRUD with explicit `channelId` filter |
| `MediaResourceService` | Tenant media CRUD |
| `TenantLearnerMembershipService` | Academy admission lifecycle: create/activate/suspend/readmit/revoke learners + audit log |
| `InstructorIndexerService` | Per-tenant Elasticsearch indexing for instructors |
| `DomainChannelResolverService` | Custom domain → channel token Redis mapping |
| `ChannelRoleRepairService` | Role repair — reconciles tenant admin roles, adds missing permissions (e.g. `ManageTenantPaymentAccount`) via `tenant:roles:repair` tooling |
| `TenantRoleReconciliationService` | Role reconciliation — keeps tenant role grants aligned with the current permission set |
| `TenantThemeService` | ADR-043 L1 theme lifecycle: immutable versioned drafts (draft → active → archived), draft cloning, publish/rollback/reset, advisory-locked version allocation, channel-scoped asset ownership validation |
| `TenantCommercialEligibilityService` | ADR-043 white-label entitlement gate (`whitelabelEnabled` + status ∈ {trialing, active, past_due}); contributes only the theming window + plan flag and **delegates** the shared evaluation to the platform `CommercialEntitlementService` (`src/platform/commercial/`), which is also ADR-042's `channelMarketplaceEligible()` — one evaluator, window supplied per entitlement |
| `TenantDeletionService` | GDPR deletion: anonymizes tenant-scoped learner records, instructor profiles and media resources |

`TenantPlugin` also binds/exports `LEARNER_ADMISSION_PORT` using `TenantLearnerMembershipService`; the shared platform `LearnerAdmissionModule` is imported by LearningPlugin and BigBlueButtonPlugin.

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
| BbbSessionTemplate | `bbb_session_template` | No (scoped via organization; factory entity — not a bookable session) |
| BbbMeeting | `bbb_meeting` | No |
| BbbMeetingSample | `bbb_meeting_sample` | No (diagnostic/sample data) |
| BbbMeteredUsage | `bbb_metered_usage` | No (per-minute metering samples) |
| SessionAttendance | `session_attendance` | No (session/meeting attendance projection) |
| BbbOrganizationMembership | `bbb_organization_membership` | No (DL-017) |
| BbbOrganizationMember | `bbb_organization_member` | No (scoped via organization; distinct from Membership) |
| BbbEntitlement | `bbb_entitlement` | No (DL-011) |
| BbbEnrollment | `bbb_enrollment` | No (legacy) |
| BbbCapacityGrant | `bbb_capacity_grant` | No |
| BbbUsageLedger | `bbb_usage_ledger` | No |
| BbbWebhookEvent | `bbb_webhook_event` | No |
| BbbTrialRegistration | `bbb_trial_registration` | No |
| BbbMeteredUsage | `bbb_metered_usage` | No (append-only metered billing fact, ADR-047) |
| BbbMeetingSample | `bbb_meeting_sample` | No (per-minute metered meeting samples) |
| SessionAttendance | `session_attendance` | No (per-student attendance facts) |
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
| `BbbShopResolver` | Shop API | Public query `publicScheduledSessions`; authenticated queries `myBbbMeetings`, `myBbbCapacityGrants`, `myBbbRooms`, `bbbRoomStatus`, `myBbbEnrollments`, `myScheduledSessions`, `myTrialRegistrations`, `myLearningDashboard`, `mySessionAttendance`; authenticated mutations: `myBbbMeetings`, `myBbbCapacityGrants`, `myBbbRooms`, `bbbRoomStatus`, `myBbbEnrollments`, `myScheduledSessions`, `publicScheduledSessions`, `myTrialRegistrations`, `myLearningDashboard`, `mySessionAttendance`; mutations: `bbbJoinMeeting`, `bbbJoinRoom`, `startScheduledSession`, `registerForTrial`, `leaveAcademy`, `deleteMyAccount` |
| `BbbAdminResolver` | Admin API | Organization/server/member management; room, meeting, scheduled-session, template, entitlement, enrollment, capacity-grant and trial-registration operations; pool/capacity dashboards; attendance and billing summaries; metered-meeting and recording reads; reconciliation actions |
| `BbbWebhookController` | REST (Public) | `POST /bbb/webhook/:serverId` — authenticates the registered callback, deduplicates, persists `BbbWebhookEvent`, then enqueues processing |

### Key Services

| Service | Purpose |
|---|---|
| `BbbMeetingService` | Meeting lifecycle, join URL generation; **enqueue-only** (delegates provisioning to `BbbProvisioningWorkerService`) |
| `BbbProvisioningWorkerService` | Sole BBB provisioning consumer; provisions BBB meetings; performs **atomic org-capacity reservation** (`PROVISIONING + ACTIVE ≤ concurrentMeetingLimit`, pessimistic org lock + count + promote in one transaction); publishes `MeetingProvisionedEvent` / `MeetingFailedEvent` |
| `BbbSessionProvisioningListener` | Sole transition of `BbbScheduledSession` SCHEDULED → **LIVE** (on `MeetingProvisionedEvent`) and LIVE → **FINISHED** (on `MeetingCompletedEvent`); publishes `SessionEndedEvent` on completion; startup reconciliation for orphaned LIVE sessions |
| `BbbScheduledSessionService` | Session CRUD; **DRAFT → SCHEDULED** publish transition; per-org session cap enforcement (pessimistic org-row lock + count + insert in one resolver transaction; 0 = unlimited); template generation |
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
| `BbbRoomAccessService` | Shared authorization evaluator for room preview and join; checks membership, legacy member, entitlement and enrollment sources (INV-027) |
| `BbbMeteringService` | Per-minute participant sampling and append-only `BbbMeteredUsage` creation for metered organizations (INV-028) |
| `BbbBillingService` | Read-side usage and billing summaries (ADR-047) |
| `SessionAttendanceService` | Scheduled-session attendance recording |
| `AttendanceAnalyticsService` | Attendance analytics and summaries |
| `BbbPlatformCapacityPolicyService` | Resolves plan/platform capacity policy and synchronizes organization capacity limits |
| `BbbDailyAllowanceService` | Single writer of daily live-allowance grants (ADR-045 / INV-026) |
| `BbbWebhookProcessorService` | Processes persisted BBB webhook deliveries asynchronously; ingress is handled by `BbbWebhookController` |
| `BbbHooksService` | BBB webhook subscription lifecycle management |
| `BbbWebhookRetentionService` | Retention and pruning of processed BBB webhook events |
| `BbbServerLoadService` | Measured server load/health signals for server selection |

### Job Queues

| Queue | Schedule | Purpose |
|---|---|---|
| `bbb-meeting-provisioning` | On demand | Provision BBB meeting |
| `bbb-webhook-processor` | On demand | Process persisted webhook event |

### Scheduled Tasks

| Task | Schedule | Purpose |
|---|---|---|
| `bbb-reconciliation` | Every 5 minutes | Reconciles provisioning, confirmed active-meeting state and room drift; recovers grant/metered billing, repairs missing recording URLs, and reports unknown remote meetings (report-only) |
| `bbb-hooks-reconciliation` | Every 5 minutes | Reconciles BBB webhook subscriptions across enabled, healthy servers |
| `bbb-capacity-alert` | Every 15 minutes | Capacity intelligence check; builds dashboard and publishes alerts |
| `bbb-server-health` | Every 5 minutes | Per-server health probe; marks servers healthy/unhealthy |
| `bbb-server-load` | Every 1 minute | 1-minute measured-load tick for every enabled BBB server |
| `bbb-daily-allowance` | Every 1 hour | Creates daily capacity grants per server |
| `bbb-metering` | Every 1 minute | Samples live metered meetings into per-minute learner counts |
| `bbb-metering-prune` | Daily at 03:30 | Prunes old metered samples to keep the table bounded |
| `bbb-webhook-retention` | Daily at 03:00 | Prunes processed BBB webhook events |

### Scheduled Tasks

| Task | Schedule / trigger | Purpose |
|---|---|---|
| `bbb-metering` | Every minute | Record attendee/minute metering samples (idempotent bucket writes) |
| `bbb-metering-prune` | Daily at 03:30 | Prune obsolete metering samples when they can no longer be billed |
| `bbb-daily-allowance` | Hourly | Materialize the current server-day free allowance grant |
| `bbb-server-health` | Every 5min | Signed health probes; sole recovery writer for server health state |

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
| `CmsShopResolver` | Shop API (Public, published content only) | `cmsArticle(slug)`, `cmsArticles`, `cmsPage(slug)`, `cmsBanners(placement)` — read-only |
| `CmsAdminResolver` | Admin API | `articles`, `article`, `banners`, `banner`, `cmsPages`, `cmsPage`; Article, Banner, and Page CRUD (NavigationMenu is an entity/service, not exposed by these API extensions) |

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
| `ProductReviewShopResolver` | Shop API | `canReviewProduct`, `pendingReviewRequests`, `validateReviewToken`; mutations `submitProductReview`, `voteOnReview`, `reportReview`; `ProductReview.userVote` field resolver |
| `ProductReviewAdminResolver` | Admin API (`SuperAdmin` or review-admin permission) | `productReviews`, `productReview`; moderation mutations `updateProductReview`, `approveProductReview`, `rejectProductReview`, `hideProductReview`, `flagProductReview`, `respondToReview` |

### Key Services / extensions

The plugin registers target, eligibility and aggregation strategy registries plus the ProductReview target/strategy implementations, anti-fraud, aggregation/cache, request/reward/report and customer-deletion services. It also exposes a review upload REST controller and a Vendure dashboard extension.

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
| `MarketplaceCommissionResolver` | Shop API (`Owner`) | `applyMarketplaceReference` — validates/applies marketplace attribution to the active order; it is not a commission-collection endpoint |
| `MarketplaceCheckoutResolver` | Shop API (public resolver; service requires authenticated user) | `createMarketplaceSessionCheckout(sessionId, marketplaceRef?)` — resolves a public BBB session to its tenant Channel, validates target-Channel customer/cart ownership, and returns tenant Razorpay-eligible methods |
| `MarketplaceCommissionReconciliationResolver` | Admin API (ReadMarketplaceCommission) | Read-only `commissionReconciliation` Orders↔CommissionLedger report; channel-scoped, SuperAdmin may pass `allChannels:true` (service-side clamp) |

### Key Services

| Service | Purpose |
|---|---|
| `MarketplaceCheckoutService` | MCR-1.3 first slice: server-resolves BBB session → owning Channel; validates Product/Variant and tenant payment readiness; switches authenticated Shop context; establishes a one-tenant active cart; reprices via Vendure; returns only eligible `tenant-razorpay` methods. No generic product checkout or fulfilment is claimed. |

**MCR checkout verification boundary (17 November 2026):** implementation is on feature branch `feat/marketplace-tenant-channel-checkout`; focused unit tests, codegen, backend build and two-tenant Shop API E2E are pending. No new entity/table/migration is added by this slice.

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
| `SubscriptionAdminResolver` | Admin API | `subscriptionPlans`, `organizationSubscriptions`, `providerMandates`, `providerPaymentAttempts`, `reconciliationIncidents`, `createSubscriptionPlan`, `updateSubscriptionPlan`, `subscribeToPlan`, `changeOrganizationSubscriptionPlan`, `cancelOrganizationSubscription` |
| `SubscriptionShopResolver` | Shop API | Public query `availableSubscriptionPlans`; authenticated queries `mySubscription`, `myLiveUsage`; authenticated mutations `requestMySubscriptionPlanChange`, `cancelMySubscription` |

Pause and resume are implemented in the provider adapters (`RecurringBillingProvider`) but are not yet exposed through either API surface.

> **ADR-046 status:** tenant self-service plan change and cancellation are implemented on the Shop API through `requestMySubscriptionPlanChange` and `cancelMySubscription`. The tenant is resolved from `ctx.channelId`; plan changes use a per-channel cooldown and the storefront receives a transient authorization URL where provider authorization is required. Live Razorpay authorization/webhook verification remains a separate production-readiness gate.

### Key Services

| Service | Purpose |
|---|---|
| `RazorpayWebhookProcessor` | Razorpay webhook dispatch / reconciliation (provider-qualified `findAttemptByProviderEventId` for replay boundary; ADR-041 G2–G7 provider-cycle model); delegates billing-attempt persistence to `SubscriptionBillingAttemptService` |
| `ProviderWebhookQueueService` | Persist-then-process webhook queue (INV-004), BullMQ-backed, `MAX_ATTEMPTS=3` |
| `RazorpaySubscriptionProvider` | Razorpay Subscriptions API adapter (implements `RecurringBillingProvider`) |
| `SubscriptionBillingAttemptService` | Authorized CLAIM→CHARGE→FINALIZE billing-attempt ledger writer (the only permitted writer of `SubscriptionBillingAttempt`, INV-019) |
| `SubscriptionRenewalService` | Renewal discovery — `processRenewals()` selects `status IN ('active','trialing') AND currentPeriodEnd < now`, so **any** `active` row with a past period end becomes a charge candidate (including a provider-free row: see plan §0.19 F-7) — cycle-monotonic FINALIZE CAS (ADR-041), bounded retry (MAX 3), reconcile-after-charge incidents |
| `SubscriptionRenewalQueueService` | BullMQ-backed `subscription-renewal` queue |
| `SubscriptionService` | Plan/enrollment lifecycle (depends on `RecurringBillingProvider` interface) |
| `SubscriptionShopService` | Tenant-facing commercial reads (`mySubscription`, `myLiveUsage`, public plan catalogue) |
| `TenantSelfServeSubscriptionCooldownService` | Five-minute per-channel plan-change cooldown (ADR-046) |
| `FreePlanProvisioningService` / listener | Provider-free Free Basic subscription provisioning on `TenantRegisteredEvent` |

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


---

## LearningPlugin

| Property | Value |
|---|---|
| **Directory** | `src/plugins/learning-plugin/` |
| **Status** | Backend domain and Admin/Shop GraphQL are registered; storefront integration and the full enrollment/commercial workflow remain separate verification items |
| **Purpose** | Chamilo-inspired course domain — courses, templates/tool snapshots, enrollments, BBB session links and announcements. |

### Owns

| Entity | Table | Channel scope |
|---|---|---|
| LearningCourse | `learning_course` | Scalar `channelId`; unique `(channelId, slug)` |
| CourseTemplate | `course_template` | Nullable scalar `channelId`; NULL denotes platform-default template |
| CourseTemplateTool | `course_template_tool` | Scalar `templateId`; scoped through template |
| CourseTool | `course_tool` | Scalar `courseId`; scoped through parent course |
| CourseEnrollment | `course_enrollment` | Scalar `channelId` plus course/customer identifiers |
| CourseScheduledSession | `course_scheduled_session` | Scalar `channelId` plus course/session identifiers |
| CourseAnnouncement | `course_announcement` | Scalar `channelId` plus course identifier |

The course/template/session identifiers are scalar columns in the current entities; they are not TypeORM relation decorators.

### Publishes

None at present.

### Consumes / shared ports

| Port / Module | Provider / contributor |
|---|---|
| `LearnerAdmissionPort` (`LEARNER_ADMISSION_PORT`) | Platform module backed by `TenantLearnerMembershipService` |
| `CourseToolRegistry` | Shared platform module; contributors registered during module initialization |
| Built-in tools | `LearningToolContributor`: `description`, `users`, `agenda`, `announcements` |
| BBB tool | `BbbVideoconferenceToolContributor`: `videoconference` |

### API surfaces

| Resolver | Scope | Actual operations |
|---|---|---|
| `LearningAdminResolver` | Admin API | Queries: `learningCourses`, `learningCourse`, `courseEnrollments`, `courseAnnouncements`, `courseTools`, `courseScheduledSessions`, `courseToolDefinitions`; mutations: course create/update/publish/close/archive, learner enroll/suspend/complete/withdraw, announcement create/update/publish, tool update, add/remove course session |
| `LearningShopResolver` | Shop API (Authenticated) | `myCoursePages`, `myCoursePage(slug)`, `coursePageAnnouncements(courseId)` — no Shop enrollment mutation exists |
| `CoursePageFieldResolver` | Shop API | Resolves visible `CoursePage.tools` |

Admin operations (`courseManagePermission`, `courseEnrollPermission`, `courseAnnouncementPermission`) are granted to tenant admins via `TENANT_ADMIN_ROLE_PERMISSIONS`.

No Shop enrollment/invitation-acceptance mutation or template CRUD GraphQL surface is currently exposed. `createLearningCourse` accepts an optional `templateId`; the course creation service snapshots template tools into course tools.

### Key services

| Service | Purpose |
|---|---|
| `LearningCourseService` | Channel-scoped course CRUD and lifecycle; template-tool snapshot |
| `CourseEnrollmentService` | Channel-scoped enrollment FSM; requires ACTIVE academy admission |
| `CourseAnnouncementService` | Course announcement lifecycle |
| `CourseScheduledSessionService` | Link/unlink existing BBB scheduled sessions |
| `CourseToolRegistry` | Startup tool-definition registry; duplicate-key and settings validation |
| `LearningDeletionService` | Channel-scoped and full customer-deletion handling |

### Permissions

| Permission | Grantee |
|---|---|
| `CourseManage` (CRUD) | Tenant admins |
| `CourseEnroll` (CRUD) | Tenant admins |
| `CourseAnnouncement` (CRUD) | Tenant admins |

> Permission definitions live in `src/platform/course-permissions.ts` and are granted to new tenant-admin roles through `TENANT_ADMIN_ROLE_PERMISSIONS`.

### Enrollment FSM

```text
INVITED   -> ENROLLED | WITHDRAWN
ENROLLED  -> SUSPENDED | COMPLETED | WITHDRAWN
SUSPENDED -> ENROLLED | COMPLETED | WITHDRAWN
COMPLETED -> terminal
WITHDRAWN -> terminal
```

The current Admin enrollment mutation creates `ENROLLED` directly; invitation creation/acceptance is not yet exposed. BBB course-tool visibility does not grant meeting access; BBB authorization remains authoritative (INV-027).

---

## PaymentsPlugin (Flow A + Flow B settlement and webhook recovery)

PaymentsPlugin provides the platform one-time payment lifecycle for Flow A and per-tenant Razorpay configuration, checkout-order creation, synchronous Shop settlement and tenant webhook recovery for Flow B. The G-3 webhook code is on its feature PR branch; generated migration and local verification remain pending.

### Flow A — Platform payments

Flow A uses Saa9vi's platform Razorpay credentials. It has a registered Vendure PaymentMethodHandler, a persist-first webhook inbox and `payment-webhook-reconciliation`.

### Flow B — Tenant-client collections

Flow B implements per-tenant Razorpay credential configuration, credential verification, account enable/disable operations, tenant-specific checkout-order creation and synchronous settlement via `tenant-razorpay`.

The G-1 change registers `tenantRazorpayPaymentHandler` (code `tenant-razorpay`) and wires `TenantRazorpayService.verifyAndSettle()` through Vendure's Shop `addPaymentToOrder` lifecycle. It enforces tenant account active/enabled state, customer/channel ownership, HMAC and provider order/payment bindings before returning Settled. The G-3 branch adds a separate tenant webhook controller, ChannelAware inbox and bounded reconciliation worker; it does not reuse Flow A or SubscriptionPlugin webhook pipelines.

See ADR-051 and ADR-054.

### Owns

| Entity | Table | Purpose |
|---|---|---|
| PaymentWebhookEvent | `payment_webhook_event` | Flow A one-time Razorpay webhook inbox |
| TenantPaymentWebhookEvent | `tenant_payment_webhook_event` | Flow B tenant-scoped durable webhook inbox; ChannelAware, deduplicated by provider + Channel + provider event ID |
| TenantPaymentAccount | `tenant_payment_account` | One Razorpay account per channel/provider; Key ID plaintext, Key Secret and webhook secret AES-256-GCM encrypted |

| `TenantPaymentAdminResolver` | Admin API (`ManageTenantPaymentAccount`; `allTenantPaymentAccounts` is SuperAdmin-only) | `tenantPaymentAccount`, `allTenantPaymentAccounts`, `upsertTenantPaymentAccount`, `setTenantPaymentAccountEnabled`, `deleteTenantPaymentAccount`, `verifyTenantPaymentAccount`, `verifyTenantPaymentWebhook` |
| `TenantRazorpayShopResolver` | Shop API (`Owner`) | `createTenantRazorpayCheckoutOrder` |
| `RazorpayShopResolver` | Shop API (authenticated order owner) | `createRazorpayCheckoutOrder`; requires `paymentPurpose = 'platform-service'` |
| `razorpayPaymentHandler` | Vendure PaymentMethodHandler (`razorpay`) | One-time platform Razorpay payment; uses platform environment credentials and is restricted to `paymentPurpose = 'platform-service'` |
| `tenantRazorpayPaymentHandler` | Vendure PaymentMethodHandler (`tenant-razorpay`) | Flow B Shop settlement; resolves tenant credentials from the active Channel |
| `RazorpayPaymentsWebhookController` | Public REST | Flow A `POST /payments/razorpay/checkout-webhook`; platform-secret HMAC, durable platform inbox, queue handoff |
| `TenantRazorpayWebhookController` | Public REST | Flow B `POST /payments/razorpay/tenant-webhook/:channelToken`; resolves tenant Channel, verifies tenant-secret HMAC, persists ChannelAware inbox, queues event ID |
| `TenantPaymentWebhookQueueService` | BullMQ worker | Flow B only; re-reads tenant Razorpay order/payment and settles through `tenant-razorpay`, bounded retries (3 attempts) |


The Admin safe view never returns decrypted secrets. `verifyTenantPaymentAccount` probes Razorpay with `GET /payments?count=1`; `verifyTenantPaymentWebhook` only checks webhook-secret presence/decryption and is not a signed webhook test. The Shop mutation creates a Razorpay order using credentials resolved from `ctx.channelId`.

**Still not implemented:** live provider validation and marketplace owner-channel checkout (MCR-1.3). G-3 webhook code is implemented on its feature PR branch, but the new ChannelAware inbox entity requires a CLI-generated migration before merge. Local webhook/settlement tests, backend build and real HTTP delivery/retry validation remain pending. The `verifyTenantPaymentWebhook` Admin mutation still checks secret presence/decryption only; it is not a signed webhook test. The global `Payment.transactionId` guard is sequential duplicate detection, not an atomic reservation for concurrent first-use requests. G-2 ownership tests were reported by the user as 10/10 passing; G-1 settlement tests were reported as 21/21 passing and backend `tsc` build completed without errors.

### Key services and secrets

| Service | Purpose |
|---|---|
| `TenantPaymentEncryptionService` | AES-256-GCM; requires 32-byte `TENANT_PAYMENT_ENCRYPTION_KEY` outside dev; optional previous-key decrypt fallback |
| `TenantPaymentAccountService` | Account CRUD, channel resolution, encryption/decryption and safe GraphQL view |
| `TenantRazorpayOrdersClient` | Tenant-keyed Razorpay Orders/Payments API calls |
| `TenantRazorpayService` | Tenant checkout-order creation; synchronous Shop settlement; Admin settlement only when bound to a matching verified pending tenant webhook inbox event |
| `RazorpayCheckoutService` | Flow A order/payment verification and settlement |
| `PaymentWebhookQueueService` | Flow A platform webhook reconciliation (BullMQ; bounded retries) |
| `TenantPaymentWebhookQueueService` | Flow B tenant webhook reconciliation (BullMQ; 3 attempts; provider truth re-read) |

`TENANT_PAYMENT_ENCRYPTION_KEY` is distinct from `VENDURE_ENCRYPTION_KEY`, which configures Vendure's `DefaultEncryptionStrategy` for Stripe secret encryption.

### Permissions

| Permission | Grantee |
|---|---|
| `ManageTenantPaymentAccount` (CRUD) | Tenant admins; granted to new roles by TenantPlugin |

Existing tenant roles may lack the permission. `tenant:roles:check` is read-only; the current `tenant:roles:repair` apply path writes Role records directly via repository save and conflicts with the GraphQL-only mutation policy. Do not run it without an approved exception; add a SuperAdmin Admin GraphQL repair path first.


---

## Marketplace commerce cross-plugin responsibilities — ADR-055 proposal

| Context | Owns / remains authoritative for | Required integration |
|---|---|---|
| PaymentsPlugin | Flow A platform one-time payment; tenant payment-account configuration and Flow B payment boundary | Complete tenant PaymentMethodHandler, settlement and tenant webhook/reconciliation before Flow B is production-ready |
| SubscriptionPlugin | Tenant `OrganizationSubscription` (tenant → Saa9vi) | Do not reuse it for learner-to-tenant recurring subscriptions |
| LearningPlugin | `LearningCourse`, `CourseEnrollment`, course access/read APIs | Integrate learner subscription state with course enrollment and bounded digital access |
| BigBlueButtonPlugin | Sessions, BBB entitlements, capacity grants and usage billing | Keep free trial access separate from paid entitlements; retain ADR-047 usage facts |
| Marketplace | Search projections, attribution, commission ledger, AdWallet and AdSpendLedger | Add owner-channel-aware marketplace checkout and listing destinations; retain 0% commission |
| Vendure core commerce | Product/variant, tenant Channel, Order, Payment, stock, shipping and fulfilment primitives | All tenant-owned checkout operations run in the owning tenant Channel; initial order contains one tenant only |

Marketplace-hosted checkout is an integration surface, not a new catalogue or merchant-of-record bounded context. See [ADR-055](../adr/adr-055-marketplace-commerce-and-revenue-model.md) and [MCR worklist](../implementation/marketplace-commerce-revenue-worklist.md).
