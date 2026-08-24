import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { SUBSCRIPTION_PLUGIN_OPTIONS } from './constants';
import { OrganizationSubscription } from './entities/organization-subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SubscriptionAdminResolver } from './api/subscription-admin.resolver';
import { adminApiExtensions } from './api/schema/subscription-admin.schema';
import { SubscriptionService } from './services/subscription.service';
import { PluginInitOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [SubscriptionPlan, OrganizationSubscription],
    providers: [
        { provide: SUBSCRIPTION_PLUGIN_OPTIONS, useFactory: () => SubscriptionPlugin.options },
        SubscriptionService,
    ],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [SubscriptionAdminResolver],
    },
    configuration: config => {
        // Plugin-specific configuration
        // such as custom fields, custom permissions,
        // strategies etc. can be configured here by
        // modifying the `config` object.
        return config;
    },
    compatibility: '^3.0.0',
})
export class SubscriptionPlugin {
    static options: PluginInitOptions;

    static init(options: PluginInitOptions): Type<SubscriptionPlugin> {
        this.options = options;
        return SubscriptionPlugin;
    }
}
