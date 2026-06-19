// src/plugins/bigbluebutton-plugin/bigbluebutton.plugin.ts

import { OnApplicationBootstrap } from "@nestjs/common";
import {
  PluginCommonModule,
  RuntimeVendureConfig,
  VendurePlugin,
} from "@vendure/core";
import path from "path";

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

import { BbbEncryptionService } from "./services/bbb-encryption.service";
import { BbbApiService } from "./services/bbb-api.service";
import { BbbServerService } from "./services/bbb-server.service";
import { BbbOrganizationService } from "./services/bbb-organization.service";
import { BbbMeetingService } from "./services/bbb-meeting.service";
import { BbbReconciliationService } from "./services/bbb-reconciliation.service";
import { BbbMemberService } from "./services/bbb-member.service"; // NEW
import { BbbRoomService } from "./services/bbb-room.service";
import { BbbScheduledSessionService } from "./services/bbb-scheduled-session.service";
import { BbbRoomLockService } from "./services/bbb-room-lock.service";
import { BbbServerSelectionService } from "./services/bbb-server-selection.service";
import { BbbMetricsService } from "./services/bbb-metrics.service";

import { BbbAdminResolver } from "./api/bbb-admin.resolver";
import { BbbShopResolver } from "./api/bbb-shop.resolver";
import { BbbWebhookController } from "./workers/bbb-webhook.controller";
import { bbbReconciliationTask } from "./jobs/bbb-reconciliation.task";

import {
  bbbFulfillmentHandler,
  bbbOrderProcess,
} from "./config/bbb-fulfillment";

import { adminApiExtensions } from "./api/schema/bbb-admin.schema";
import { shopApiExtensions } from "./api/schema/bbb-shop.schema";

import { BigBlueButtonPluginOptions } from "./types";
import { BBB_PLUGIN_OPTIONS, BbbAdminPermission } from "./constants";

@VendurePlugin({
  imports: [PluginCommonModule],

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
  ],

  providers: [
    {
      provide: BBB_PLUGIN_OPTIONS,
      useFactory: () => BigBlueButtonPlugin.options,
    },
    BbbEncryptionService,
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
  ],

  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [BbbAdminResolver],
  },

  dashboard: path.join(__dirname, "dashboard/index.tsx"),

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
  static options: BigBlueButtonPluginOptions = {};

  static uiExtensions = {
    extensionPath: path.join(__dirname, "ui"),
    routes: [{ route: "bbb", filePath: "routes.ts" }],
    providers: ["providers.ts"],
  };

  static init(
    options: BigBlueButtonPluginOptions = {},
  ): typeof BigBlueButtonPlugin {
    this.options = options;
    return BigBlueButtonPlugin;
  }

  constructor(private readonly meetingService: BbbMeetingService) {}

  async onApplicationBootstrap() {
    await this.meetingService.init();
  }
}
