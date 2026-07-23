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
import { BbbOrganizationMember } from "./entities/bbb-organization-member.entity";
import { BbbScheduledSession } from "./entities/bbb-scheduled-session.entity";
import { BbbRoom } from "./entities/bbb-room.entity";
import { BbbEnrollment } from "./entities/bbb-enrollment.entity";
import { BbbProductAccess } from "./entities/bbb-product-access.entity";
import { BbbTrialRegistration } from "./entities/trial-registration.entity";
import { BbbInstructorAssignment } from "./entities/instructor-assignment.entity";
import { BbbWebhookEvent } from "./entities/bbb-webhook-event.entity";
import { BbbEntitlement } from "./entities/bbb-entitlement.entity";
import { BbbOrganizationMembership } from "./entities/bbb-organization-membership.entity";
import { BbbCapacityAlertLog } from "./entities/bbb-capacity-alert-log.entity";
import { EventLog } from "../../platform/tracing/entities/event-log.entity";

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
import { GrantReaderService } from "./services/grant-reader.service";
import { LearningDashboardService } from "./services/learning-dashboard.service";
import { CapacityIntelligenceService } from "./services/capacity-intelligence.service";
import { BbbOrderFulfillmentListener } from "./listeners/order-fulfillment.listener";

import { PlatformTracingModule } from "../../platform/tracing/platform-tracing.module";
import { CorrelationInterceptor } from "../../platform/tracing/correlation-interceptor";
import { BullMQTracer } from "../../platform/tracing/bullmq-tracer";
import { WebhookRecorder } from "../../platform/tracing/webhook-recorder";
import { BbbAdminResolver } from "./api/bbb-admin.resolver";
import { BbbShopResolver } from "./api/bbb-shop.resolver";
import { BbbWebhookController } from "./workers/bbb-webhook.controller";
import { bbbReconciliationTask } from "./jobs/bbb-reconciliation.task";
import { bbbCapacityAlertTask } from "./jobs/bbb-capacity-alert.task";
import { bbbWebhookRateLimiter, shopApiRateLimiter } from "./config/rate-limiter.middleware";
import {
  bbbFulfillmentHandler,
  bbbOrderProcess,
} from "./config/bbb-fulfillment";
import { adminApiExtensions } from "./api/schema/bbb-admin.schema";
import { shopApiExtensions } from "./api/schema/bbb-shop.schema";
import { BigBlueButtonPluginOptions } from "./types";
import { BBB_PLUGIN_OPTIONS, BbbAdminPermission } from "./constants";

@VendurePlugin({
  imports: [PluginCommonModule, PlatformTracingModule, CustomerDeletionModule],

  entities: [
    BbbServer,
    BbbOrganization,
    BbbMeeting,
    BbbCapacityGrant,
    BbbUsageLedger,
    BbbOrganizationMember,
    BbbScheduledSession,
    BbbRoom,
    BbbEnrollment,
    BbbProductAccess,
    BbbTrialRegistration,
    BbbInstructorAssignment,
    BbbWebhookEvent,
    BbbEntitlement,
    BbbOrganizationMembership,
    BbbCapacityAlertLog,
    CustomerDeletionLog,
    EventLog,
  ],

  providers: [
    {
      provide: BBB_PLUGIN_OPTIONS,
      useFactory: () => BigBlueButtonPlugin.options,
    },
    CorrelationInterceptor,
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
    GrantReaderService,
    LearningDashboardService,
    CapacityIntelligenceService,
    BbbOrderFulfillmentListener,
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
    // Register rate limiters (SEC-004)
    config.apiOptions.middleware = [
      ...(config.apiOptions.middleware ?? []),
      {
        // Rate limit POST /bbb/webhook — 100 req/min per IP, allowlist via env
        route: "bbb/webhook",
        handler: bbbWebhookRateLimiter,
      },
      {
        // Rate limit Shop API mutations — registerForTrial (10/min), bbbJoinMeeting (10/min), registerNewTenant (5/hour)
        route: "shop-api",
        handler: shopApiRateLimiter,
      },
    ];

    config.authOptions.customPermissions = [
      ...(config.authOptions.customPermissions ?? []),
      BbbAdminPermission,
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
  private static initialized = false;
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
    if (BigBlueButtonPlugin.initialized) return;
    BigBlueButtonPlugin.initialized = true;

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
