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
| ProductReview | `product_review` | No (BUG-017) |
| ReviewRequest | `review_request` | No |
| ReviewReport | `review_report` | No |
| ReviewReward | `review_reward` | No |
| ReviewVote | `review_vote` | No |

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
| **Status** | Projection layer implemented (e2e coverage pending). Ad-entity tables migrated (Gate 1.1: `1788265440266-MarketplaceAdEntities`); advertising feature layer not yet wired. See `docs/implementation/phase3-audit.md`. |
| **Purpose** | Cross-channel Elasticsearch discovery layer for marketplace. |

### Owns

| Entity | Table | Purpose |
|---|---|---|
| MarketplaceAdCampaign | `marketplace_ad_campaign` | Sponsored listing campaigns |
| AdSpendLedger | `ad_spend_ledger` | Append-only ad spend records |
| AdWallet | `ad_wallet` | Prepaid ad wallet per tenant |
| AdWalletLedger | `ad_wallet_ledger` | Append-only wallet transactions — **not yet implemented** (planned Phase 3C) |

### Publishes

None.

### Consumes

| Event | Source Plugin |
|---|---|
| `InstructorProfileCreatedEvent` | TenantPlugin |
| `InstructorProfileUpdatedEvent` | TenantPlugin |
| `ProductVariantEvent` | Vendure core |

### API Surfaces

| Resolver | Scope | Purpose |
|---|---|---|
| `MarketplaceSearchResolver` | Shop API (Public) | `marketplaceSearch` |
| `MarketplaceAdminResolver` | Admin API | Ad campaign management, full reindex |

### Elasticsearch Indices

| Index | Documents | Purpose |
|---|---|---|
| `saa9vi_marketplace_sessions` | Sessions | Cross-channel session discovery |
| `saa9vi_marketplace_instructors` | Instructors | Cross-channel instructor discovery |

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
| **Status** | Unknown |
| **Purpose** | Customer suspension management. |
