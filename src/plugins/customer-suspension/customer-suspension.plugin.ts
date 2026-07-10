import {
  PluginCommonModule,
  RuntimeVendureConfig,
  Type,
  VendurePlugin,
} from "@vendure/core";

import { CUSTOMER_SUSPENSION_PLUGIN_OPTIONS, CustomerSuspensionPermission } from "./constants";
import { PluginInitOptions } from "./types";
import { CustomerChannelStatus } from "./entities/customer-channel-status.entity";
import { CustomerStatusChangeLog } from "./entities/customer-status-change-log.entity";
import { CustomerSuspensionService } from "./services/customer-suspension.service";
import { CustomerSuspensionAdminResolver } from "./api/customer-suspension-admin.resolver";
import { adminApiExtensions } from "./api/schema/customer-suspension-admin.schema";
import { customerStatusOrderProcess } from "./config/customer-status-order-process";

@VendurePlugin({
  imports: [PluginCommonModule],

  entities: [CustomerChannelStatus, CustomerStatusChangeLog],

  providers: [
    { provide: CUSTOMER_SUSPENSION_PLUGIN_OPTIONS, useFactory: () => CustomerSuspensionPlugin.options },
    CustomerSuspensionService,
  ],

  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [CustomerSuspensionAdminResolver],
  },

  configuration(config: RuntimeVendureConfig) {
    // Register custom permission for customer suspension operations
    config.authOptions.customPermissions = [
      ...(config.authOptions.customPermissions ?? []),
      CustomerSuspensionPermission,
    ];

    // Register order process to block checkouts for suspended customers
    config.orderOptions.process = [
      ...(config.orderOptions.process ?? []),
      customerStatusOrderProcess,
    ];

    return config;
  },

  compatibility: "^3.0.0",
})
export class CustomerSuspensionPlugin {
  static options: PluginInitOptions;

  static init(options: PluginInitOptions = {}): Type<CustomerSuspensionPlugin> {
    this.options = options;
    return CustomerSuspensionPlugin;
  }
}
