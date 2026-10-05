// src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts

import { Inject, OnApplicationBootstrap } from "@nestjs/common";
import {
  PluginCommonModule,
  RuntimeVendureConfig,
  VendurePlugin,
} from "@vendure/core";
import { CustomerDeletionLog } from "../../platform/customer-deletion/entities/customer-deletion-log.entity";
import { CustomerDeletionModule } from "../../platform/customer-deletion/customer-deletion.module";
import { CustomerDeletionService } from "../../platform/customer-deletion/customer-deletion.service";

import { BbbServer } from "./entities/bbb-server.entity";
import { BbbOrganization } from "./entities/bbb-organization.entity";
import { BbbMeeting } from "./entities/bbb-meeting.entity";
import { BbbCapacityGrant } from "./entities/bbb-capacity-grant.entity";
import { BbbUsageLedger } from "./entities/bbb-usage-ledger.entity";
import { BbbMeetingSample } from "./entities/bbb-meeting-sample.entity";
import { BbbMeteredUsage } from "./entities/bbb-metered-usage.entity";
import { BbbOrganizationMember } from "./entities/bbb-organization-member.entity";
import { BbbScheduledSession } from "./entities/bbb-scheduled-session.entity";
import { BbbRoom } from "./entities/bbb-room.entity";
import { BbbEnrollment } from "./entities/bbb-enrollment.entity";
import { BbbProductAccess } from "./entities/bbb-product-access.entity";
import { BbbTrialRegistration } from "./entities/trial-registration.entity";
import { BbbInstructorAssignment } from "./entities/instructor-assignment.entity";
import { BbbWebhookEvent } from "./entities/bbb-webhook-event.entity";
import { SessionAttendance } from "./entities/session-attendance.entity";
import { SessionAttendanceService } from "./services/session-attendance.service";
import { BbbEntitlement } from "./entities/bbb-entitlement.entity";
import { BbbOrganizationMembership } from "./entities/bbb-organization-membership.entity";
import { BbbCapacityAlertLog } from "./entities/bbb-capacity-alert-log.entity";
import { BbbPlatformCapacityPolicy } from "./entities/bbb-platform-capacity-policy.entity";
import { BbbSessionTemplate } from "./entities/bbb-session-template.entity";
import { EventLog } from "../../platform/tracing/entities/event-log.entity";

import { BbbChannelAccessService } from "./services/bbb-channel-access.service";
import { BbbEncryptionService } from "./services/bbb-encryption.service";
import { BbbApiService } from "./services/bbb-api.service";
import { BbbServerService } from "./services/bbb-server.service";
import { BbbOrganizationService } from "./services/bbb-organization.service";
import { BbbMeetingService } from "./services/bbb-meeting.service";
import { BbbReconciliationService } from "./services/bbb-reconciliation.service";
import { BbbMemberService } from "./services/bbb-member.service";
import { BbbRoomService } from "./services/bbb-room.service";
import { BbbScheduledSessionService } from "./services/bbb-scheduled-session.service";
import { BbbRoomLockService } from "./services/bbb-room-lock.service";
import { BbbServerSelectionService } from "./services/bbb-server-selection.service";
import { BbbMetricsService } from "./services/bbb-metrics.service";
import { TrialRegistrationService } from "./services/trial-registration.service";
import { BbbWebhookProcessorService } from "./services/bbb-webhook-processor.service";
import { BbbEntitlementService } from "./services/bbb-entitlement.service";
import { BbbDeletionService } from "./services/bbb-deletion.service";
import { BbbMembershipService } from "./services/bbb-membership.service";
import { BbbRoomAccessService } from "./services/room-access.service";
import { GrantReaderService } from "./services/grant-reader.service";
import { GrantConsumptionService } from "./services/bbb-grant-consumption.service";
import { MeetingLifecycleService } from "./services/bbb-meeting-lifecycle.service";
import { BbbDailyAllowanceService } from "./services/bbb-daily-allowance.service";
import { BbbMeteringService } from "./services/bbb-metering.service";
import { BbbBillingService } from "./services/bbb-billing.service";
import { BbbOpsAlertService } from "./services/bbb-ops-alert.service";
import { bbbDailyAllowanceTask } from "./jobs/bbb-daily-allowance.task";
import { bbbMeteringTask } from "./jobs/bbb-metering.task";
import { bbbMeteringPruneTask } from "./jobs/bbb-metering-prune.task";
import { LearningDashboardService } from "./services/learning-dashboard.service";
import { CapacityIntelligenceService } from "./services/capacity-intelligence.service";
import { AttendanceAnalyticsService } from "./services/attendance-analytics.service";
import { BbbPlatformCapacityPolicyService } from "./services/bbb-platform-capacity-policy.service";
import { BbbJoinUrlService } from "./services/bbb-join-url.service";
import { BbbProvisioningWorkerService } from "./services/bbb-provisioning-worker.service";
import { BBB_PROVISIONING_ENQUEUER } from "./services/bbb-provisioning-enqueuer";
import { BbbOrderFulfillmentListener } from "./listeners/order-fulfillment.listener";
import { BbbSubscriptionListener } from "./listeners/bbb-subscription.listener";
import { BbbSessionProvisioningListener } from "./listeners/bbb-session-provisioning.listener";
import { BbbTenantProvisioningListener } from "./listeners/bbb-tenant-provisioning.listener";
import { BbbCapacityAlertListener } from "./listeners/bbb-capacity-alert.listener";
import { BbbPlanCapacityReconciliationBootstrap } from "./listeners/bbb-plan-capacity-reconciliation.bootstrap";

import { PlatformTracingModule } from "../../platform/tracing/platform-tracing.module";
import { CorrelationInterceptor } from "../../platform/tracing/correlation-interceptor";
import { BullMQTracer } from "../../platform/tracing/bullmq-tracer";
import { WebhookRecorder } from "../../platform/tracing/webhook-recorder";
import { BbbAdminResolver } from "./api/bbb-admin.resolver";
import { BbbShopResolver } from "./api/bbb-shop.resolver";
import { BbbWebhookController } from "./workers/bbb-webhook.controller";
import { bbbReconciliationTask } from "./jobs/bbb-reconciliation.task";
import { bbbCapacityAlertTask } from "./jobs/bbb-capacity-alert.task";
import { BBB_WEBHOOK_RATE_LIMIT_ROUTES, bbbWebhookRateLimiter, shopApiRateLimiter } from "./config/rate-limiter.middleware";
import {
  bbbFulfillmentHandler,
  bbbOrderProcess,
} from "./config/bbb-fulfillment";
import { adminApiExtensions } from "./api/schema/bbb-admin.schema";
import { shopApiExtensions } from "./api/schema/bbb-shop.schema";
import { BigBlueButtonPluginOptions } from "./types";
import {
  BBB_GRANULAR_PERMISSIONS,
  BBB_PLUGIN_OPTIONS,
  BbbAdminPermission,
} from "./constants";

@VendurePlugin({
  imports: [PluginCommonModule, PlatformTracingModule, CustomerDeletionModule],

  entities: [
    BbbServer,
    BbbOrganization,
    BbbMeeting,
    BbbCapacityGrant,
    BbbUsageLedger,
    BbbMeetingSample,
    BbbMeteredUsage,
    BbbOrganizationMember,
    BbbScheduledSession,
    BbbRoom,
    BbbEnrollment,
    BbbProductAccess,
    BbbTrialRegistration,
    BbbInstructorAssignment,
    BbbWebhookEvent,
    SessionAttendance,
    BbbEntitlement,
    BbbOrganizationMembership,
    BbbCapacityAlertLog,
    BbbPlatformCapacityPolicy,
    BbbSessionTemplate,
    CustomerDeletionLog,
    EventLog,
  ],

  providers: [
    {
      provide: BBB_PLUGIN_OPTIONS,
      useFactory: () => BigBlueButtonPlugin.options,
    },
    CorrelationInterceptor,
    BbbChannelAccessService,
    BbbEncryptionService,
    BullMQTracer,
    WebhookRecorder,
    BbbApiService,
    BbbServerService,
    BbbOrganizationService,
    BbbMeetingService,
    BbbReconciliationService,
    BbbMemberService,
    BbbScheduledSessionService,
    BbbRoomService,
    BbbMetricsService,
    BbbRoomLockService,
    BbbServerSelectionService,
    TrialRegistrationService,
    BbbWebhookProcessorService,
    BbbEntitlementService,
    BbbDeletionService,
    BbbMembershipService,
    // INV-027 (BUG-045): the single room-access evaluation shared by
    // bbbRoomStatus (preview) and joinRoom (action).
    BbbRoomAccessService,
    GrantReaderService,
    // S7A (Phase 7.3): the grant billing boundary — BbbMeetingService (lifecycle
    // path) and BbbReconciliationService (recovery loop) both depend on this
    // instead of on each other.
    GrantConsumptionService,
    // S7A (Phase 7.4): the shared meeting lifecycle boundary. BbbRoomService
    // (runtime staleness) and BbbReconciliationService (force-complete /
    // stale detection) depend on this instead of on BbbMeetingService, which
    // removes the meeting <-> room import cycle.
    MeetingLifecycleService,
    // Slice 6 — the single writer of daily live-allowance grants (ADR-045 /
    // INV-026). Provider-free plans get a 60-minute grant per server day; every
    // consumer of "today's allowance" reads it back from BbbCapacityGrant, so
    // there is no parallel allowance store.
    BbbDailyAllowanceService,
    BbbMeteringService,
    // ADR-047 Phase 4 — billing READ API (summary / metered history / platform
    // roll-up). Money is computed only through metered-billing.policy (D2).
    BbbBillingService,
    LearningDashboardService,
    BbbPlatformCapacityPolicyService,
    BbbJoinUrlService,
    BbbProvisioningWorkerService,
    // S7A (Phase 7.2): enqueue-only port — BbbMeetingService depends on this
    // token, not on the worker class, which breaks the
    // meeting → provisioning → room → meeting cycle.
    { provide: BBB_PROVISIONING_ENQUEUER, useExisting: BbbProvisioningWorkerService },
    CapacityIntelligenceService,
    SessionAttendanceService,
    AttendanceAnalyticsService,
    BbbOrderFulfillmentListener,
    BbbSubscriptionListener,
    BbbSessionProvisioningListener,
    BbbTenantProvisioningListener,
    // Production-readiness items 4 + 6: the operator alert channel (log +
    // OPS_ALERT_WEBHOOK_URL) and its CapacityAlertEvent consumer — before
    // this, immediate capacity alerts reached only the Postgres audit table.
    BbbOpsAlertService,
    BbbCapacityAlertListener,
    // ADR-031 amendment (Decision 5): the third convergence trigger — repairs
    // any organisation whose plan-derived concurrentMeetingLimit cache missed an
    // event or predates plan-derived capacity.
    BbbPlanCapacityReconciliationBootstrap,
  ],

  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [BbbAdminResolver],
  },

  dashboard: './dashboard/index.tsx',

  shopApiExtensions: {
    schema: shopApiExtensions,
    resolvers: [BbbShopResolver],
  },

  controllers: [BbbWebhookController],

  configuration(config: RuntimeVendureConfig) {
    // Prevent duplicate registration if the configuration function is
    // invoked more than once (e.g. server + worker share the same config).
    const existingIds = new Set(
      (config.schedulerOptions.tasks ?? []).map((t) => t.id),
    );
    if (!existingIds.has(bbbReconciliationTask.id)) {
      config.schedulerOptions.tasks = [
        ...(config.schedulerOptions.tasks ?? []),
        bbbReconciliationTask,
      ];
    }
    if (!existingIds.has(bbbCapacityAlertTask.id)) {
      config.schedulerOptions.tasks = [
        ...(config.schedulerOptions.tasks ?? []),
        bbbCapacityAlertTask,
      ];
    }
    // ADR-047 Phase 2B: the per-minute metered sampling tick. Its write is
    // idempotent (`ON CONFLICT (meetingId, bucketMinute) DO NOTHING`), so
    // duplicate registration or an overlapping run can never double-count
    // minutes; the guard is the same id-dedupe every other task here uses.
    if (!existingIds.has(bbbMeteringTask.id)) {
      config.schedulerOptions.tasks = [
        ...(config.schedulerOptions.tasks ?? []),
        bbbMeteringTask,
      ];
    }
    // ADR-047 Phase 2B: sample retention. Idempotent DELETE, scoped to meetings
    // that can no longer be billed.
    if (!existingIds.has(bbbMeteringPruneTask.id)) {
      config.schedulerOptions.tasks = [
        ...(config.schedulerOptions.tasks ?? []),
        bbbMeteringPruneTask,
      ];
    }
    if (!existingIds.has(bbbDailyAllowanceTask.id)) {
      config.schedulerOptions.tasks = [
        ...(config.schedulerOptions.tasks ?? []),
        bbbDailyAllowanceTask,
      ];
    }
    // Register rate limiters (SEC-004)
    config.apiOptions.middleware = [
      ...(config.apiOptions.middleware ?? []),
      // SEC-004: webhook rate limiting — 100 req/min per IP (allowlist via
      // BBB_WEBHOOK_ALLOWED_IPS). One entry per path in
      // BBB_WEBHOOK_RATE_LIMIT_ROUTES; matching, including the future W3
      // route `/bbb/webhook/<serverId>`, is pinned by
      // bbb-webhook-ingress.spec.ts.
      ...BBB_WEBHOOK_RATE_LIMIT_ROUTES.map((route) => ({
        route,
        handler: bbbWebhookRateLimiter,
      })),
      {
        // Rate limit Shop API mutations — registerForTrial (10/min), bbbJoinMeeting (10/min), registerNewTenant (5/hour)
        route: "shop-api",
        handler: shopApiRateLimiter,
      },
    ];

    config.authOptions.customPermissions = [
      ...(config.authOptions.customPermissions ?? []),
      BbbAdminPermission,
      ...BBB_GRANULAR_PERMISSIONS,
    ];
    config.orderOptions.process = [
      ...(config.orderOptions.process ?? []),
      bbbOrderProcess,
    ];
    config.shippingOptions.fulfillmentHandlers = [
      ...(config.shippingOptions.fulfillmentHandlers ?? []),
      bbbFulfillmentHandler,
    ];
    return config;
  },

  compatibility: ">=3.0.0",
})
export class BigBlueButtonPlugin implements OnApplicationBootstrap {
  // Instance-level flag so each NestJS app (e.g. separate e2e test environments
  // in the same process) initializes its own handlers independently.
  // A static flag would persist across test suites and silently skip
  // handler registration for the second and subsequent test servers.
  private initialized = false;
  static options: BigBlueButtonPluginOptions = {};

  static init(
    options: BigBlueButtonPluginOptions = {},
  ): typeof BigBlueButtonPlugin {
    this.options = options;
    return BigBlueButtonPlugin;
  }

  constructor(
    private readonly meetingService: BbbMeetingService,
    private readonly webhookProcessor: BbbWebhookProcessorService,
    private readonly bbbDeletionService: BbbDeletionService,
    @Inject(CustomerDeletionService)
    private readonly customerDeletionService: CustomerDeletionService,
  ) {}

  async onApplicationBootstrap() {
    // Guard: prevent double-initialization when both server and worker
    // share the same plugin instance and onApplicationBootstrap fires twice.
    if (this.initialized) return;
    this.initialized = true;

    // Initialize job queues
    await this.meetingService.init();
    await this.webhookProcessor.init();

    // Register customer deletion handlers
    this.customerDeletionService.registerChannelScopedHandler(
      'bbb-plugin',
      (ctx, customerId, channelId) =>
        this.bbbDeletionService.removeFromChannel(ctx, customerId, channelId),
    );
    this.customerDeletionService.registerFullDeleteHandler(
      'bbb-plugin',
      (ctx, customerId) =>
        this.bbbDeletionService.fullDelete(ctx, customerId),
    );
  }
}
