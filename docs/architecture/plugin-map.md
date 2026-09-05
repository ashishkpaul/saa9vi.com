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

### Publishes

| Event | Subscribers |
|---|---|
| `InstructorProfileCreatedEvent` | MarketplaceIndexerPlugin |
| `InstructorProfileUpdatedEvent` | MarketplaceIndexerPlugin |

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

### Publishes

| Event | Subscribers |
|---|---|
| `MeetingProvisionedEvent` | BbbMetricsService |
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
| `BbbMeetingService` | Meeting lifecycle, join URL generation, provisioning |
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
| **Status** | Projection layer implemented; Gate 1 discovery E2E passing (7/7, commit `2e74020`). Ad-entity tables migrated (Gate 1.1: `1788265440266-MarketplaceAdEntities`). **Gates 2–3 complete** — attribution (`d6926a9`, `683b2f7`) and commission ledger with atomic single-use replay (`f534872`), verified by 6/6 commission e2e (`1bcf5e2`). **Phase 3C advertising COMPLETE** (3C.1–3C.7b): AdWalletLedger, wallet service boundary, campaign spend wiring, Banner.scope, bounded bid-boost, 14/14 advertising E2E, 3C.7a self-serve Admin API (tenant-scoped campaign/wallet/spend resolvers), and 3C.7b React dashboard (campaign list/detail, wallet, spend report — all consuming the Admin API). **Phase 3D retention remains.** See `docs/implementation/roadmap.md` for the full Phase 3C breakdown. |
| **Purpose** | Cross-channel Elasticsearch discovery layer for marketplace. |

### Owns

| Entity | Table | Purpose |
|---|---|---|
| MarketplaceAdCampaign | `marketplace_ad_campaign` | Sponsored listing campaigns |
| AdSpendLedger | `ad_spend_ledger` | Append-only ad spend records |
| AdWallet | `ad_wallet` | Prepaid ad wallet per tenant |
| AdWalletLedger | `ad_wallet_ledger` | Append-only wallet transactions (3C.1, immutable subscriber enforced) |

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
| **Status** | Phase 2 — recurring billing & dunning. Billing provider = Juspay. See RFC-001 / ADR-037. |
| **Purpose** | Subscription billing bounded context — plans, organization subscriptions, Juspay recurring payments, webhooks, dunning FSM, renewal reconciliation. |

### Owns

| Entity | Table | ChannelAware |
|---|---|---|
| SubscriptionPlan | `subscription_plan` | Yes |
| OrganizationSubscription | `organization_subscription` | Yes (= Channel/tenant) |
| JuspayPaymentAttempt | `juspay_payment_attempt` | No (scalar `channelId`; CLAIM→CHARGE→FINALIZE CAS) |
| JuspaySubscriptionMandate | `juspay_subscription_mandate` | No |
| JuspayWebhookEvent | `juspay_webhook_event` | No |
| JuspayWebhookEndpoint | `juspay_webhook_endpoint` | No (unique `token` + `channelId`, per-tenant secret) |
| RenewalPaymentReconciliationRequired | `juspay_payment_reconciliation_required` | No (scalar `channelId`; status PENDING/RESOLVED) |

### Publishes

(`subscription.events.ts` — renewal / dunning / reconciliation lifecycle events consumed by the plugin's own jobs and listeners.)

### Consumes

| Event / Input | Source |
|---|---|
| Juspay webhooks | `POST /payments/juspay/webhook/:token` (`JuspayWebhookController`, fail-closed Basic Auth + HMAC, AES-256-GCM secret) |
| Scheduled tasks | `subscriptionRenewalTask` (every 10 min), `subscriptionDunningTask` |

### Consumes — Scheduled Tasks

| Task | Schedule | Purpose |
|---|---|---|
| `subscriptionRenewalTask` | Every 10 min | Discover subscriptions needing period advance / charge |
| `subscriptionDunningTask` | Every 10 min | Dunning FSM retry + grace-expiry → cancel |

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `SubscriptionAdminResolver` | Admin API | `subscriptionPlans`, `organizationSubscriptions`, `juspayMandates`, `juspayPaymentAttempts`, `reconciliationIncidents`, `createSubscriptionPlan`, `updateSubscriptionPlan`, `subscribeToPlan` |

### Key Services

| Service | Purpose |
|---|---|
| `JuspayBillingService` | Recurring charge orchestration (CLaim/charge/reconcile; provider contract ADR-037) |
| `JuspayPaymentAttemptService` | CLAIM→CHARGE→FINALIZE optimistic-locking payment-attempt ledger |
| `JuspayWebhookAuthService` | Fail-closed webhook auth (Basic + HMAC signature) |
| `JuspayWebhookQueueService` | Persist-then-process webhook queue (INV-004) |
| `JuspayWebhookProcessorService` | Webhook dispatch / reconciliation |
| `JuspayEncryptionService` | AES-256-GCM secret-at-rest (fail-closed in production) |
| `JuspayWebhookEndpointService` | Per-tenant webhook endpoints + secrets |
| `SubscriptionService` / `SubscriptionRenewalService` | Plan/enrollment lifecycle, renewal discovery & period advance |
| `JuspaySdk` (`juspay-sdk.ts`) | Juspay HTTP client |

> ⚠️ **ADR-037 note:** Recurring-billing provider contract is verified against docs/code; live provider-contract verification + production credential rollout remain pending.
