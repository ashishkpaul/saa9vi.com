import { PluginCommonModule, RuntimeVendureConfig, Type, VendurePlugin } from '@vendure/core';
 
import { SUBSCRIPTION_PLUGIN_OPTIONS } from './constants';
import { OrganizationSubscription } from './entities/organization-subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { JuspaySubscriptionMandate } from './entities/juspay-subscription-mandate.entity';
import { JuspayPaymentAttempt } from './entities/juspay-payment-attempt.entity';
import { JuspayWebhookEvent } from './entities/juspay-webhook-event.entity';
import { SubscriptionAdminResolver } from './api/subscription-admin.resolver';
import { adminApiExtensions } from './api/schema/subscription-admin.schema';
import { SubscriptionService } from './services/subscription.service';
import { SubscriptionRenewalService } from './services/subscription-renewal.service';
import { SubscriptionRenewalQueueService } from './services/subscription-renewal-queue.service';
import { subscriptionRenewalTask } from './jobs/subscription-renewal.task';
import { PluginInitOptions } from './types';
 
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [SubscriptionPlan, OrganizationSubscription, JuspaySubscriptionMandate, JuspayPaymentAttempt, JuspayWebhookEvent],
    providers: [
        { provide: SUBSCRIPTION_PLUGIN_OPTIONS, useFactory: () => SubscriptionPlugin.options },
        SubscriptionService,
        SubscriptionRenewalService,
        SubscriptionRenewalQueueService,
    ],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [SubscriptionAdminResolver],
    },
    configuration: (config: RuntimeVendureConfig) => {
        // Register the renewal task in the Vendure scheduler
        const existingIds = new Set(
            (config.schedulerOptions.tasks ?? []).map((t) => t.id),
        );
        if (!existingIds.has(subscriptionRenewalTask.id)) {
            config.schedulerOptions.tasks = [
                ...(config.schedulerOptions.tasks ?? []),
                subscriptionRenewalTask,
            ];
        }
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
